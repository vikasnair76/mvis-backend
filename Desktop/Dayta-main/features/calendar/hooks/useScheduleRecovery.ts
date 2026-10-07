import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../services/firebase";
import {
  buildOneTimeSchedulePatch,
  buildRecurringSkippedOverride,
  buildRecurringTimedOverride,
  buildRecurringUnscheduledOverride,
  getScheduleOverrideKey,
  getScheduleType,
  type ScheduleOverrideRecord,
} from "../../../services/scheduling";
import type { DatedItem, GoogleCalendarEvent } from "../types/calendar.types";
import {
  DEFAULT_SUGGESTED_SLOT_MINUTES,
  confirmAction,
  dateKeyLocal,
  dayStartMs,
  findFirstAvailableSlotOnDateNotBefore,
  formatTimeRangeLabel,
  getNoSlotLabel,
  getRecoverySuggestionNotBeforeMs,
  getTomorrowMorningMs,
  sameDay,
  type TimeSlot,
} from "../utils";

const RESCHEDULED_BADGE_MS = 2500;

type RecoveryAction =
  | "suggestedTime"
  | "reassignLater"
  | "reassignTomorrow"
  | "unscheduled"
  | "skip"
  | "clearOverride";

/**
 * The recovery actions on a conflicting or unscheduled agenda item: move it to
 * an open slot, push it to tomorrow, unschedule it, skip the day, or restore
 * the normal schedule.
 */
export function useScheduleRecovery(args: {
  userId: string | null | undefined;
  tz: string;
  selectedDate: Date;
  subtasksByGoal: Record<string, any[]>;
  selectedDayEvents: GoogleCalendarEvent[];
  onOverrideChanged: (
    key: string,
    record: ScheduleOverrideRecord | null
  ) => void;
}) {
  const {
    userId,
    tz,
    selectedDate,
    subtasksByGoal,
    selectedDayEvents,
    onOverrideChanged,
  } = args;

  const [pendingByAction, setPendingByAction] = useState<
    Record<RecoveryAction, Set<string>>
  >({
    suggestedTime: new Set(),
    reassignLater: new Set(),
    reassignTomorrow: new Set(),
    unscheduled: new Set(),
    skip: new Set(),
    clearOverride: new Set(),
  });

  const [recentlyRescheduledKeys, setRecentlyRescheduledKeys] = useState<
    Set<string>
  >(new Set());

  const badgeTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timeouts = badgeTimeoutsRef.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      badgeTimeoutsRef.current = [];
    };
  }, []);

  const itemKeyFor = useCallback(
    (item: DatedItem) =>
      `${item.goalId}:${item.subtaskId}:${dateKeyLocal(item.date, tz)}`,
    [tz]
  );

  const isPending = useCallback(
    (key: string) =>
      Object.values(pendingByAction).some((set) => set.has(key)),
    [pendingByAction]
  );

  const setPending = useCallback(
    (action: RecoveryAction, key: string, pending: boolean) => {
      setPendingByAction((prev) => {
        const next = new Set(prev[action]);
        if (pending) next.add(key);
        else next.delete(key);
        return { ...prev, [action]: next };
      });
    },
    []
  );

  const markRescheduled = useCallback((key: string) => {
    setRecentlyRescheduledKeys((prev) => new Set(prev).add(key));

    const timeout = setTimeout(() => {
      setRecentlyRescheduledKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, RESCHEDULED_BADGE_MS);

    badgeTimeoutsRef.current.push(timeout);
  }, []);

  const getBaseSubtask = useCallback(
    (goalId: string, subtaskId: string) =>
      (subtasksByGoal[goalId] ?? []).find((s: any) => s.id === subtaskId) ?? null,
    [subtasksByGoal]
  );

  /**
   * Runs `write` under the pending flag for `action`, surfacing failures as an
   * alert rather than an unhandled rejection.
   */
  const runAction = useCallback(
    async (
      action: RecoveryAction,
      item: DatedItem,
      write: () => Promise<void>
    ) => {
      const key = itemKeyFor(item);
      if (isPending(key)) return;

      setPending(action, key, true);

      try {
        await write();
      } catch (e: any) {
        console.error(`[useScheduleRecovery] ${action} failed`, e);
        Alert.alert("Update failed", e?.message ?? "Unknown error");
      } finally {
        setPending(action, key, false);
      }
    },
    [itemKeyFor, isPending, setPending]
  );

  /** Writes a concrete due time, as a subtask patch or a per-day override. */
  const writeTimedSchedule = useCallback(
    async (
      item: DatedItem,
      targetDayKey: string,
      dueAtMs: number,
      source: "suggestedTime" | "snooze"
    ) => {
      const baseSubtask = getBaseSubtask(item.goalId, item.subtaskId);
      if (!baseSubtask) throw new Error("Subtask not found");

      if (getScheduleType(baseSubtask) === "oneTime") {
        await updateDoc(
          doc(db, "goals", item.goalId, "subtasks", item.subtaskId),
          {
            ...buildOneTimeSchedulePatch(targetDayKey, dueAtMs),
            updatedAt: serverTimestamp(),
          }
        );
        return;
      }

      const overrideRef = doc(
        db,
        "goals",
        item.goalId,
        "subtasks",
        item.subtaskId,
        "scheduleOverrides",
        targetDayKey
      );

      await setDoc(
        overrideRef,
        buildRecurringTimedOverride({
          userId: userId ?? "",
          goalId: item.goalId,
          subtaskId: item.subtaskId,
          dayKey: targetDayKey,
          dueAtMs,
          source,
        }),
        { merge: true }
      );

      onOverrideChanged(getScheduleOverrideKey(item.subtaskId, targetDayKey), {
        dueAtMs,
        isSkipped: false,
        isUnscheduled: false,
        source,
      });
    },
    [getBaseSubtask, userId, onOverrideChanged]
  );

  const useSuggestedTime = useCallback(
    async (item: DatedItem, slot: TimeSlot) => {
      const currentTimeLabel =
        typeof item.dueAtMs === "number"
          ? new Date(item.dueAtMs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })
          : "No current time";

      const nextTimeLabel = formatTimeRangeLabel(slot.startMs, slot.endMs);

      const confirmed = await confirmAction(
        "Use suggested time?",
        `${item.title}\n\nCurrent: ${currentTimeLabel}\nSuggested: ${nextTimeLabel}`
      );
      if (!confirmed) return;

      await runAction("suggestedTime", item, async () => {
        const baseSubtask = getBaseSubtask(item.goalId, item.subtaskId);
        if (!baseSubtask) throw new Error("Subtask not found");

        // A one-time subtask moves to whatever day the slot lands on; a
        // recurring one gets a per-day override on the day it was due.
        const targetDayKey =
          getScheduleType(baseSubtask) === "oneTime"
            ? dateKeyLocal(new Date(slot.startMs), tz)
            : dateKeyLocal(item.date, tz);

        await writeTimedSchedule(
          item,
          targetDayKey,
          slot.startMs,
          "suggestedTime"
        );

        markRescheduled(itemKeyFor(item));

        Alert.alert(
          "Time updated",
          `${item.title}\n\n${currentTimeLabel} → ${nextTimeLabel}`
        );
      });
    },
    [
      runAction,
      getBaseSubtask,
      tz,
      writeTimedSchedule,
      markRescheduled,
      itemKeyFor,
    ]
  );

  const reassignLaterToday = useCallback(
    async (item: DatedItem) => {
      const effectiveDate = item.date ?? selectedDate;

      // Must use the same not-before cutoff the recovery row's label was
      // computed with, or the tap writes an earlier time than it advertised
      // (and on today, a time already in the past).
      const slot = findFirstAvailableSlotOnDateNotBefore(
        effectiveDate,
        selectedDayEvents,
        DEFAULT_SUGGESTED_SLOT_MINUTES,
        getRecoverySuggestionNotBeforeMs({
          itemDate: effectiveDate,
          dueAtMs: item.dueAtMs ?? null,
        })
      );

      if (!slot) {
        Alert.alert(
          "No opening available",
          getNoSlotLabel(DEFAULT_SUGGESTED_SLOT_MINUTES, {
            noMoreToday: sameDay(effectiveDate, new Date()),
          })
        );
        return;
      }

      await runAction("reassignLater", item, async () => {
        await writeTimedSchedule(
          item,
          dateKeyLocal(effectiveDate, tz),
          slot.startMs,
          "snooze"
        );

        markRescheduled(itemKeyFor(item));

        Alert.alert(
          "Reassigned",
          `${item.title}\n\nNow scheduled for ${formatTimeRangeLabel(
            slot.startMs,
            slot.endMs
          )}`
        );
      });
    },
    [
      selectedDate,
      selectedDayEvents,
      runAction,
      writeTimedSchedule,
      tz,
      markRescheduled,
      itemKeyFor,
    ]
  );

  const reassignTomorrowMorning = useCallback(
    async (item: DatedItem) => {
      const effectiveDate = item.date ?? selectedDate;
      const sourceDayKey = dateKeyLocal(effectiveDate, tz);
      const targetMs = getTomorrowMorningMs(effectiveDate);
      const targetDate = new Date(targetMs);

      // Guard against a DST shift landing "tomorrow morning" back on today.
      const sourceDayStart = dayStartMs(effectiveDate);
      const sourceDayEnd = sourceDayStart + 24 * 60 * 60 * 1000;
      const targetDayKey =
        targetMs >= sourceDayStart && targetMs < sourceDayEnd
          ? sourceDayKey
          : dateKeyLocal(targetDate, tz);

      await runAction("reassignTomorrow", item, async () => {
        const baseSubtask = getBaseSubtask(item.goalId, item.subtaskId);
        if (!baseSubtask) throw new Error("Subtask not found");

        if (getScheduleType(baseSubtask) === "oneTime") {
          await updateDoc(
            doc(db, "goals", item.goalId, "subtasks", item.subtaskId),
            buildOneTimeSchedulePatch(targetDayKey, targetMs)
          );
        } else {
          const uid = userId ?? "";
          const overridePath = (dayKey: string) =>
            doc(
              db,
              "goals",
              item.goalId,
              "subtasks",
              item.subtaskId,
              "scheduleOverrides",
              dayKey
            );

          // Vacate the source day, then claim the target day.
          await setDoc(
            overridePath(sourceDayKey),
            buildRecurringUnscheduledOverride({
              userId: uid,
              goalId: item.goalId,
              subtaskId: item.subtaskId,
              dayKey: sourceDayKey,
              source: "snooze",
            }),
            { merge: true }
          );

          await setDoc(
            overridePath(targetDayKey),
            buildRecurringTimedOverride({
              userId: uid,
              goalId: item.goalId,
              subtaskId: item.subtaskId,
              dayKey: targetDayKey,
              dueAtMs: targetMs,
              source: "snooze",
            }),
            { merge: true }
          );

          onOverrideChanged(
            getScheduleOverrideKey(item.subtaskId, sourceDayKey),
            {
              dueAtMs: null,
              isSkipped: false,
              isUnscheduled: true,
              source: "snooze",
            }
          );

          onOverrideChanged(
            getScheduleOverrideKey(item.subtaskId, targetDayKey),
            {
              dueAtMs: targetMs,
              isSkipped: false,
              isUnscheduled: false,
              source: "snooze",
            }
          );
        }

        markRescheduled(itemKeyFor(item));

        Alert.alert(
          "Reassigned",
          `${item.title}\n\nNow scheduled for ${targetDate.toLocaleDateString(
            [],
            { weekday: "short", month: "short", day: "numeric" }
          )} at ${new Date(targetMs).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}`
        );
      });
    },
    [
      selectedDate,
      tz,
      runAction,
      getBaseSubtask,
      userId,
      onOverrideChanged,
      markRescheduled,
      itemKeyFor,
    ]
  );

  const markUnscheduledForDay = useCallback(
    async (item: DatedItem) => {
      const baseSubtask = getBaseSubtask(item.goalId, item.subtaskId);
      const scheduleType = baseSubtask
        ? getScheduleType(baseSubtask)
        : "recurring";

      const confirmed = await confirmAction(
        "Mark unscheduled?",
        scheduleType === "oneTime"
          ? `${item.title}\n\nThis will remove its scheduled date and time until you reassign it.`
          : `${item.title}\n\nThis will remove it from the selected date without marking it skipped.`
      );
      if (!confirmed) return;

      const dayKey = dateKeyLocal(item.date, tz);

      await runAction("unscheduled", item, async () => {
        if (!baseSubtask) throw new Error("Subtask not found");

        if (scheduleType === "oneTime") {
          await updateDoc(
            doc(db, "goals", item.goalId, "subtasks", item.subtaskId),
            buildOneTimeSchedulePatch(null, null)
          );
          return;
        }

        await setDoc(
          doc(
            db,
            "goals",
            item.goalId,
            "subtasks",
            item.subtaskId,
            "scheduleOverrides",
            dayKey
          ),
          buildRecurringUnscheduledOverride({
            userId: userId ?? "",
            goalId: item.goalId,
            subtaskId: item.subtaskId,
            dayKey,
            source: "unscheduled",
          }),
          { merge: true }
        );

        onOverrideChanged(getScheduleOverrideKey(item.subtaskId, dayKey), {
          dueAtMs: null,
          isSkipped: false,
          isUnscheduled: true,
          source: "unscheduled",
        });
      });
    },
    [getBaseSubtask, tz, runAction, userId, onOverrideChanged]
  );

  const skipForDay = useCallback(
    async (item: DatedItem) => {
      const confirmed = await confirmAction(
        "Skip for this day?",
        `${item.title}\n\nThis will hide it from the selected date without changing future occurrences.`
      );
      if (!confirmed) return;

      const dayKey = dateKeyLocal(item.date, tz);

      await runAction("skip", item, async () => {
        await setDoc(
          doc(
            db,
            "goals",
            item.goalId,
            "subtasks",
            item.subtaskId,
            "scheduleOverrides",
            dayKey
          ),
          buildRecurringSkippedOverride({
            userId: userId ?? "",
            goalId: item.goalId,
            subtaskId: item.subtaskId,
            dayKey,
          }),
          { merge: true }
        );

        onOverrideChanged(getScheduleOverrideKey(item.subtaskId, dayKey), {
          dueAtMs: null,
          isSkipped: true,
          isUnscheduled: false,
          source: "skip",
        });
      });
    },
    [tz, runAction, userId, onOverrideChanged]
  );

  const clearOverrideForDay = useCallback(
    async (item: DatedItem) => {
      const confirmed = await confirmAction(
        "Clear override for this day?",
        `${item.title}\n\nThis will restore the normal schedule for the selected date.`
      );
      if (!confirmed) return;

      const dayKey = dateKeyLocal(item.date, tz);

      await runAction("clearOverride", item, async () => {
        await deleteDoc(
          doc(
            db,
            "goals",
            item.goalId,
            "subtasks",
            item.subtaskId,
            "scheduleOverrides",
            dayKey
          )
        );

        onOverrideChanged(getScheduleOverrideKey(item.subtaskId, dayKey), null);
      });
    },
    [tz, runAction, onOverrideChanged]
  );

  return {
    pendingByAction,
    recentlyRescheduledKeys,
    isPending,
    useSuggestedTime,
    reassignLaterToday,
    reassignTomorrowMorning,
    markUnscheduledForDay,
    skipForDay,
    clearOverrideForDay,
  };
}
