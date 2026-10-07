import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { dayKeyFromMs, getUserTz } from "../../../services/dateKey";
import { db } from "../../../services/firebase";
import type { HomeTaskItem } from "../../../services/nowDecision";
import { toggleSubtaskCompletedTx } from "../../../services/subtasks";
import type { GoalLite, QuickPlanOption, SubtaskLite } from "../types/home.types";
import { getQuickPlanDate, isRelevantForToday, taskKey } from "../utils";

/**
 * Today's candidate tasks across the user's active goals, today's completion
 * set, and the two write actions the Home screen offers.
 *
 * `hydratedUid` is the uid whose first goals snapshot (or zero-goal / error
 * result) has settled. The screen is ready only when `hydratedUid === uid`.
 * A plain boolean would be wrong here: on a uid change it stays `true` from
 * the previous account for one render (this effect resets it *after* the
 * render that first sees the new uid), which would flash the old account's
 * tasks — or "All clear" — under the new account. Keying by uid closes that
 * gap without needing the auth and data state to update in one batch.
 */
export function useHomeTasks(uid: string | null) {
  const [items, setItems] = useState<HomeTaskItem[]>([]);
  const [completedTodayKeys, setCompletedTodayKeys] = useState<Set<string>>(new Set());
  const [hydratedUid, setHydratedUid] = useState<string | null>(null);
  const [pendingCompleteKey, setPendingCompleteKey] = useState<string | null>(null);

  // Active goals -> one subtask listener per goal. The goals snapshot tears
  // down and rebuilds the subtask listeners whenever the goal set changes.
  useEffect(() => {
    // Drop the previous account's data the moment the uid changes, so nothing
    // derived from it can be observed even by a consumer that ignores the gate.
    setItems([]);
    setCompletedTodayKeys(new Set());

    if (!uid) {
      setHydratedUid(null);
      return;
    }

    const goalsQuery = query(
      collection(db, "goals"),
      where("userId", "==", uid),
      where("status", "==", "active")
    );

    const subtaskUnsubs: (() => void)[] = [];

    const unsubGoals = onSnapshot(
      goalsQuery,
      (goalSnap) => {
        subtaskUnsubs.forEach((unsub) => unsub());
        subtaskUnsubs.length = 0;

        const goals: GoalLite[] = goalSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<GoalLite, "id">),
        }));

        if (goals.length === 0) {
          setItems([]);
          setCompletedTodayKeys(new Set());
          setHydratedUid(uid);
          return;
        }

        const byGoal: Record<string, HomeTaskItem[]> = {};

        goals.forEach((goal) => {
          const unsubSubtasks = onSnapshot(
            collection(db, "goals", goal.id, "subtasks"),
            (subtaskSnap) => {
              const tz = getUserTz();
              const todayKey = dayKeyFromMs(Date.now(), tz);

              byGoal[goal.id] = subtaskSnap.docs
                .map((docSnap) => {
                  const s = {
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<SubtaskLite, "id">),
                  };
                  return {
                    goalId: goal.id,
                    subtaskId: s.id,
                    goalTitle: goal.title,
                    title: s.title,
                    dueAtMs: typeof s.dueAtMs === "number" ? s.dueAtMs : null,
                    isCompletedToday: false,
                    frequency: s.frequency ?? null,
                    weeklyDay: s.weeklyDay ?? null,
                    scheduledDayKey: s.scheduledDayKey ?? null,
                    todayKey,
                  };
                })
                .filter((item) => isRelevantForToday(item, tz));

              setItems(Object.values(byGoal).flat());
              setHydratedUid(uid);
            }
          );

          subtaskUnsubs.push(unsubSubtasks);
        });
      },
      (error) => {
        console.error("[Home] failed to subscribe to goals", error);
        setItems([]);
        setHydratedUid(uid);
      }
    );

    return () => {
      unsubGoals();
      subtaskUnsubs.forEach((unsub) => unsub());
    };
  }, [uid]);

  // Today's completions -> set of "goalId:subtaskId".
  useEffect(() => {
    if (!uid) {
      setCompletedTodayKeys(new Set());
      return;
    }

    const todayKey = dayKeyFromMs(Date.now(), getUserTz());

    const unsub = onSnapshot(
      query(
        collectionGroup(db, "completions"),
        where("userId", "==", uid),
        where("dayKey", "==", todayKey)
      ),
      (snap) => {
        const next = new Set<string>();
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as { goalId?: string; subtaskId?: string };
          if (typeof data.goalId !== "string") return;
          if (typeof data.subtaskId !== "string") return;
          next.add(`${data.goalId}:${data.subtaskId}`);
        });
        setCompletedTodayKeys(next);
      },
      (error) => {
        console.error("[Home] failed to subscribe to today completions", error);
      }
    );

    return () => unsub();
  }, [uid]);

  const completeTask = useCallback(
    async (item: HomeTaskItem) => {
      if (!uid) {
        Alert.alert("Sign in required", "Please sign in first.");
        return;
      }

      const key = taskKey(item);
      if (pendingCompleteKey === key) return;

      try {
        setPendingCompleteKey(key);

        const todayKey = dayKeyFromMs(Date.now(), getUserTz());
        await toggleSubtaskCompletedTx(item.goalId, item.subtaskId, todayKey, uid);

        // Optimistic flip; the completions snapshot will confirm it.
        setCompletedTodayKeys((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      } catch (e: any) {
        console.error("[Home] failed to complete task", e);
        Alert.alert("Couldn’t complete task", e?.message ?? "Unknown error");
      } finally {
        setPendingCompleteKey(null);
      }
    },
    [uid, pendingCompleteKey]
  );

  const quickPlanTask = useCallback(
    async (item: HomeTaskItem, option: QuickPlanOption) => {
      try {
        const targetDate = getQuickPlanDate(option);
        const scheduledDayKey = dayKeyFromMs(targetDate.getTime(), getUserTz());

        await updateDoc(doc(db, "goals", item.goalId, "subtasks", item.subtaskId), {
          dueAtMs: targetDate.getTime(),
          scheduledDayKey,
          updatedAt: serverTimestamp(),
        });

        setItems((prev) =>
          prev.map((existing) =>
            existing.goalId === item.goalId && existing.subtaskId === item.subtaskId
              ? { ...existing, dueAtMs: targetDate.getTime() }
              : existing
          )
        );

        Alert.alert(
          "Planned",
          option === "today_evening"
            ? `"${item.title}" is planned for this evening.`
            : `"${item.title}" is planned for tomorrow morning.`
        );
      } catch (e: any) {
        console.error("[Home] failed to quick-plan task", e);
        Alert.alert("Couldn’t plan task", e?.message ?? "Unknown error");
      }
    },
    []
  );

  return {
    items,
    completedTodayKeys,
    hydratedUid,
    pendingCompleteKey,
    completeTask,
    quickPlanTask,
  };
}
