import { useEffect, useMemo, useState } from "react";
import {
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import { dayKeyFromDate, getUserTz } from "../../../services/dateKey";
import { subscribeGoalCompletionsForRange } from "../../../services/goalCompletionQueries";
import type { ViewMode } from "../types/calendar.types";
import {
  buildHeatmapFromCompletionSnapshot,
  monthRangeDayKeys,
  weekRangeDayKeys,
} from "../utils";

export function useCalendarHeatmap(args: {
  userId: string | null | undefined;
  isReady: boolean;
  selectedDate: Date;
  viewMode: ViewMode;
  weekDates: Date[];
  activeGoalIds?: Set<string>;
}) {
  const { userId, isReady, selectedDate, viewMode, weekDates, activeGoalIds } = args;

  const [heatByDayKey, setHeatByDayKey] = useState<HeatmapByDayKey>({});
  const [goalCompletionCountsByDay, setGoalCompletionCountsByDay] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(false);

  const tz = useMemo(() => getUserTz(), []);

  const rangeKeys = useMemo(() => {
    if (viewMode === "week") {
      return weekRangeDayKeys(weekDates, tz);
    }
    if (viewMode === "month") {
      return monthRangeDayKeys(selectedDate, tz);
    }
    const dayKey = dayKeyFromDate(selectedDate, tz);
    return { startDayKey: dayKey, endDayKey: dayKey };
  }, [viewMode, weekDates, selectedDate, tz]);

  // Subtask completions (collection group "completions") -> heat aggregates.
  useEffect(() => {
    if (!isReady || !userId) {
      setHeatByDayKey({});
      return;
    }

    setLoading(true);

    const qy = query(
      collectionGroup(db, "completions"),
      where("userId", "==", userId),
      where("dayKey", ">=", rangeKeys.startDayKey),
      where("dayKey", "<=", rangeKeys.endDayKey),
      orderBy("dayKey")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setHeatByDayKey(buildHeatmapFromCompletionSnapshot(snap, activeGoalIds));
        setLoading(false);
      },
      (err) => {
        console.error("[useCalendarHeatmap] completion subscription error", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [
    isReady,
    userId,
    rangeKeys.startDayKey,
    rangeKeys.endDayKey,
    activeGoalIds,
  ]);

  // Whole-goal completions -> per-day counts.
  useEffect(() => {
    if (!isReady || !userId) {
      setGoalCompletionCountsByDay({});
      return;
    }

    const unsub = subscribeGoalCompletionsForRange(
      userId,
      rangeKeys.startDayKey,
      rangeKeys.endDayKey,
      (records) => {
        const counts: Record<string, number> = {};
        for (const r of records) {
          counts[r.dayKey] = (counts[r.dayKey] ?? 0) + 1;
        }
        setGoalCompletionCountsByDay(counts);
      },
      (err) => {
        console.error("[useCalendarHeatmap] goal completion error", err);
      }
    );

    return () => unsub();
  }, [isReady, userId, rangeKeys.startDayKey, rangeKeys.endDayKey]);

  return {
    heatByDayKey,
    setHeatByDayKey,
    goalCompletionCountsByDay,
    loading,
    rangeKeys,
  };
}
