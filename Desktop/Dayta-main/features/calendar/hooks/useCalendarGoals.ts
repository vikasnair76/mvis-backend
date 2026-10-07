import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import type { Goal } from "../types/calendar.types";
import { isGroupSharedGoal } from "../utils";

/**
 * Owns the goal + subtask graph the calendar renders from:
 *  - goals the user owns
 *  - group-shared goals with a subtask assigned to the user
 *  - a live subtask subscription per visible goal
 */
export function useCalendarGoals(
  userId: string | null | undefined,
  isReady: boolean
) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assignedSharedGoals, setAssignedSharedGoals] = useState<Goal[]>([]);
  const [subtasksByGoal, setSubtasksByGoal] = useState<Record<string, any[]>>({});

  const subtaskUnsubsRef = useRef<Record<string, (() => void) | null>>({});

  // Owned goals
  useEffect(() => {
    if (!isReady || !userId) {
      setGoals([]);
      setSubtasksByGoal({});
      return;
    }

    const qy = query(
      collection(db, "goals"),
      where("userId", "==", userId),
      orderBy("createdAtMs", "desc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        console.error("[useCalendarGoals] goals subscription failed", err);
      }
    );

    return () => unsub();
  }, [isReady, userId]);

  // Group-shared goals that have a subtask assigned to this user
  useEffect(() => {
    if (!isReady || !userId) {
      setAssignedSharedGoals([]);
      return;
    }

    let cancelled = false;

    const qy = query(
      collectionGroup(db, "subtasks"),
      where("assignedToUid", "==", userId)
    );

    const unsub = onSnapshot(
      qy,
      async (snap) => {
        const goalIds = Array.from(
          new Set(
            snap.docs
              .map((d) => d.ref.parent.parent?.id ?? null)
              .filter((goalId): goalId is string => !!goalId)
          )
        );

        const loadedGoals = await Promise.all(
          goalIds.map(async (goalId) => {
            const goalSnap = await getDoc(doc(db, "goals", goalId));
            if (!goalSnap.exists()) return null;

            const goal = {
              id: goalSnap.id,
              ...(goalSnap.data() as Omit<Goal, "id">),
            } as Goal;

            if (goal.userId === userId) return null;
            if (!isGroupSharedGoal(goal)) return null;

            return goal;
          })
        );

        if (cancelled) return;
        setAssignedSharedGoals(
          loadedGoals.filter((goal): goal is Goal => goal != null)
        );
      },
      (err) => {
        console.error(
          "[useCalendarGoals] assigned shared goals subscription failed",
          err
        );
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [isReady, userId]);

  const visibleGoals = useMemo(() => {
    const map = new Map<string, Goal>();
    goals.forEach((goal) => map.set(goal.id, goal));
    assignedSharedGoals.forEach((goal) => map.set(goal.id, goal));
    return Array.from(map.values());
  }, [goals, assignedSharedGoals]);

  const activeGoalIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of visibleGoals) if (g.status !== "completed") s.add(g.id);
    return s;
  }, [visibleGoals]);

  // One subtask subscription per visible goal, added/torn down as goals change.
  const visibleGoalIdsKey = useMemo(
    () =>
      visibleGoals
        .map((g) => g.id)
        .sort()
        .join(","),
    [visibleGoals]
  );

  useEffect(() => {
    const existing = subtaskUnsubsRef.current;
    const goalIds = visibleGoalIdsKey ? visibleGoalIdsKey.split(",") : [];
    const goalIdSet = new Set(goalIds);

    Object.keys(existing).forEach((gid) => {
      if (goalIdSet.has(gid)) return;
      existing[gid]?.();
      delete existing[gid];
      setSubtasksByGoal((prev) => {
        const next = { ...prev };
        delete next[gid];
        return next;
      });
    });

    goalIds.forEach((goalId) => {
      if (existing[goalId]) return;

      const qy = query(
        collection(db, "goals", goalId, "subtasks"),
        orderBy("createdAtMs", "desc")
      );

      existing[goalId] = onSnapshot(
        qy,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setSubtasksByGoal((prev) => ({ ...prev, [goalId]: list }));
        },
        (err) =>
          console.error(
            "[useCalendarGoals] subtasks subscription failed",
            goalId,
            err
          )
      );
    });
  }, [visibleGoalIdsKey]);

  // Tear every subtask listener down when the calendar unmounts.
  useEffect(() => {
    return () => {
      Object.values(subtaskUnsubsRef.current).forEach((fn) => fn?.());
      subtaskUnsubsRef.current = {};
    };
  }, []);

  return {
    goals,
    assignedSharedGoals,
    visibleGoals,
    activeGoalIds,
    subtasksByGoal,
    setSubtasksByGoal,
  };
}
