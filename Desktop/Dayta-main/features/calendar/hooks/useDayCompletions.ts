import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase";
import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import {
  getGoalCompletionsForDay,
  type GoalCompletionRecord,
} from "../../../services/goalCompletionQueries";
import { toggleSubtaskCompletedTx } from "../../../services/subtasks";
import { bumpHeatCount, completionKey, dateKeyLocal } from "../utils";

/**
 * Completion state for the selected day, plus the subtask complete/undo action.
 *
 * `completedByDayKey` is kept as a cache across days so week/month toggles stay
 * responsive without refetching.
 */
export function useDayCompletions(args: {
  userId: string | null | undefined;
  isReady: boolean;
  selectedDayKey: string;
  tz: string;
  activeGoalIds: Set<string>;
  onHeatChange?: (updater: (prev: HeatmapByDayKey) => HeatmapByDayKey) => void;
}) {
  const { userId, isReady, selectedDayKey, tz, activeGoalIds, onHeatChange } = args;

  const [completedByDayKey, setCompletedByDayKey] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [goalCompletionsForSelectedDay, setGoalCompletionsForSelectedDay] =
    useState<GoalCompletionRecord[]>([]);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  // Subtask completions for the selected day
  useEffect(() => {
    if (!isReady || !userId) return;

    let cancelled = false;

    async function load() {
      const setForDay = new Set<string>();

      const qy = query(
        collectionGroup(db, "completions"),
        where("userId", "==", userId),
        where("dayKey", "==", selectedDayKey)
      );

      const snap = await getDocs(qy);

      snap.forEach((d) => {
        const data: any = d.data();
        if (!data?.goalId || !activeGoalIds.has(data.goalId)) return;
        if (data?.goalId && data?.subtaskId) {
          setForDay.add(completionKey(data.goalId, data.subtaskId));
        }
      });

      if (cancelled) return;

      setCompletedByDayKey((prev) => {
        const next = new Map(prev);
        next.set(selectedDayKey, setForDay);
        return next;
      });
    }

    load().catch((e) =>
      console.error("[useDayCompletions] load day completions failed", e)
    );

    return () => {
      cancelled = true;
    };
  }, [isReady, userId, selectedDayKey, activeGoalIds]);

  // Whole-goal completions for the selected day
  useEffect(() => {
    if (!isReady || !userId) {
      setGoalCompletionsForSelectedDay([]);
      return;
    }

    let cancelled = false;

    getGoalCompletionsForDay(userId, selectedDayKey)
      .then((rows) => {
        if (!cancelled) setGoalCompletionsForSelectedDay(rows);
      })
      .catch((e) =>
        console.error("[useDayCompletions] load goal completions failed", e)
      );

    return () => {
      cancelled = true;
    };
  }, [isReady, userId, selectedDayKey]);

  const toggleSubtask = useCallback(
    async (
      goalId: string,
      subtaskId: string,
      date: Date,
      metricValue?: number | null
    ) => {
      if (!userId) {
        Alert.alert("Sign in required", "Please sign in to update tasks.");
        return;
      }

      const dayKey = dateKeyLocal(date, tz);
      const key = `${goalId}:${subtaskId}:${dayKey}`;
      const cKey = completionKey(goalId, subtaskId);

      if (pendingKeys.has(key)) return;

      // Read completion state before any local mutation.
      const wasCompletedBefore = completedByDayKey.get(dayKey)?.has(cKey) ?? false;
      const metric = typeof metricValue === "number" ? metricValue : 0;

      setPendingKeys((prev) => new Set(prev).add(key));

      try {
        await toggleSubtaskCompletedTx(
          goalId,
          subtaskId,
          dayKey,
          userId,
          metricValue ?? null
        );

        onHeatChange?.((prev) =>
          bumpHeatCount(
            prev,
            dayKey,
            wasCompletedBefore ? -1 : +1,
            wasCompletedBefore ? -metric : +metric
          )
        );

        setCompletedByDayKey((prev) => {
          const next = new Map(prev);
          const setForDay = new Set(next.get(dayKey) ?? []);
          if (setForDay.has(cKey)) setForDay.delete(cKey);
          else setForDay.add(cKey);
          next.set(dayKey, setForDay);
          return next;
        });
      } catch (e: any) {
        console.error("[useDayCompletions] toggle failed", e);
        Alert.alert("Update failed", e?.message ?? "Unknown error");
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [userId, tz, pendingKeys, completedByDayKey, onHeatChange]
  );

  return {
    completedByDayKey,
    goalCompletionsForSelectedDay,
    pendingKeys,
    toggleSubtask,
  };
}
