import { useEffect, useState } from "react";
import {
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import {
  getScheduleOverrideKey,
  type ScheduleOverrideRecord,
} from "../../../services/scheduling";
import type { CalendarRangeDayKeys } from "../types/calendar.types";

/**
 * Per-day schedule overrides (rescheduled / snoozed / skipped / unscheduled)
 * for the day keys currently in view, keyed by `${subtaskId}:${dayKey}`.
 */
export function useScheduleOverrides(args: {
  userId: string | null | undefined;
  isReady: boolean;
  rangeKeys: CalendarRangeDayKeys;
}) {
  const { userId, isReady, rangeKeys } = args;

  const [scheduleOverridesByKey, setScheduleOverridesByKey] = useState<
    Record<string, ScheduleOverrideRecord>
  >({});

  useEffect(() => {
    if (!isReady || !userId) {
      setScheduleOverridesByKey({});
      return;
    }

    const qy = query(
      collectionGroup(db, "scheduleOverrides"),
      where("userId", "==", userId),
      where("dayKey", ">=", rangeKeys.startDayKey),
      where("dayKey", "<=", rangeKeys.endDayKey),
      orderBy("dayKey")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const next: Record<string, ScheduleOverrideRecord> = {};

        snap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (!data?.subtaskId || !data?.dayKey) return;

          next[getScheduleOverrideKey(data.subtaskId, data.dayKey)] = {
            dueAtMs: typeof data?.dueAtMs === "number" ? data.dueAtMs : null,
            isSkipped: !!data.isSkipped,
            isUnscheduled: !!data.isUnscheduled,
            source: data?.source ?? null,
          };
        });

        setScheduleOverridesByKey(next);
      },
      (err) => {
        console.error("[useScheduleOverrides] subscription failed", err);
      }
    );

    return () => unsub();
  }, [isReady, userId, rangeKeys.startDayKey, rangeKeys.endDayKey]);

  return { scheduleOverridesByKey, setScheduleOverridesByKey };
}
