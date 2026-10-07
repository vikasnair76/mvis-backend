import { useMemo } from "react";
import {
  getEffectiveSubtaskForDate,
  getScheduleOverrideKey,
  isSubtaskDueOnDate,
  type ScheduleOverrideRecord,
} from "../../../services/scheduling";
import type { DatedItem, Goal, ViewMode } from "../types/calendar.types";
import {
  addDays,
  completionKey,
  dateKeyLocal,
  dayStartMs,
  daysInMonth,
  isGroupSharedGoal,
  isOneTimeSubtask,
  splitDueCompleted,
  startOfMonth,
} from "../utils";

function toDatedItem(args: {
  date: Date;
  goal: Goal;
  subtask: any;
  subtaskForDate: any;
  isSharedAssigned: boolean;
  override: ScheduleOverrideRecord | null;
  isUnscheduledForSelectedDay: boolean;
}): DatedItem {
  const { date, goal, subtask, subtaskForDate, isSharedAssigned, override } = args;

  return {
    date,
    goalId: goal.id,
    goalTitle: goal.title,
    subtaskId: subtask.id,
    title: subtask.title,
    isSharedAssigned,
    sharedSourceGroupName:
      typeof (goal as any).sharedGroupName === "string"
        ? (goal as any).sharedGroupName
        : null,
    frequency: subtask.frequency,
    dueAtMs: args.isUnscheduledForSelectedDay
      ? null
      : typeof subtaskForDate?.dueAtMs === "number"
      ? subtaskForDate.dueAtMs
      : null,
    metricValue:
      typeof subtask.metricValue === "number" ? subtask.metricValue : null,
    metricUnit: typeof subtask.metricUnit === "string" ? subtask.metricUnit : null,
    contributesToMetric: !!subtask.contributesToMetric,
    hasScheduleOverride: !!override,
    scheduleOverrideSource: args.isUnscheduledForSelectedDay
      ? override?.source ?? "unscheduled"
      : override?.source ?? null,
    isUnscheduledForSelectedDay: args.isUnscheduledForSelectedDay,
    linkedCalendarEventId:
      typeof subtask.linkedCalendarEventId === "string"
        ? subtask.linkedCalendarEventId
        : null,
    linkedCalendarEventTitle:
      typeof subtask.linkedCalendarEventTitle === "string"
        ? subtask.linkedCalendarEventTitle
        : null,
    linkedCalendarEventStartMs:
      typeof subtask.linkedCalendarEventStartMs === "number"
        ? subtask.linkedCalendarEventStartMs
        : null,
    linkedCalendarLastKnownMissing:
      typeof subtask.linkedCalendarLastKnownMissing === "boolean"
        ? subtask.linkedCalendarLastKnownMissing
        : null,
    linkedCalendarMissingAtMs:
      typeof subtask.linkedCalendarMissingAtMs === "number"
        ? subtask.linkedCalendarMissingAtMs
        : null,
  };
}

/**
 * Expands goals + subtasks into per-day agenda items for the visible range,
 * then splits the selected day into due / completed / unscheduled buckets.
 */
export function useAgendaItems(args: {
  userId: string | null | undefined;
  visibleGoals: Goal[];
  subtasksByGoal: Record<string, any[]>;
  scheduleOverridesByKey: Record<string, ScheduleOverrideRecord>;
  completedByDayKey: Map<string, Set<string>>;
  selectedDate: Date;
  selectedDayKey: string;
  viewMode: ViewMode;
  weekDates: Date[];
  tz: string;
}) {
  const {
    userId,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    completedByDayKey,
    selectedDate,
    selectedDayKey,
    viewMode,
    weekDates,
    tz,
  } = args;

  const datedItems = useMemo<DatedItem[]>(() => {
    const dates: Date[] = [];

    if (viewMode === "day") {
      dates.push(new Date(selectedDate));
    } else if (viewMode === "week") {
      dates.push(...weekDates);
    } else {
      const start = startOfMonth(selectedDate);
      const n = daysInMonth(selectedDate);
      for (let i = 0; i < n; i++) dates.push(addDays(start, i));
    }

    const uid = userId ?? null;
    const out: DatedItem[] = [];

    for (const date of dates) {
      const dayKey = dateKeyLocal(date, tz);

      for (const g of visibleGoals) {
        if (g.status === "completed") continue;

        for (const s of subtasksByGoal[g.id] ?? []) {
          const isSharedAssigned =
            g.userId !== uid && isGroupSharedGoal(g) && s.assignedToUid === uid;

          if (g.userId !== uid && !isSharedAssigned) continue;

          const subtaskForDate =
            getEffectiveSubtaskForDate(s, date, tz, scheduleOverridesByKey) ?? s;

          if (!isSubtaskDueOnDate(subtaskForDate, date, tz)) continue;

          const override =
            scheduleOverridesByKey[getScheduleOverrideKey(s.id, dayKey)] ?? null;

          if (override?.isSkipped) continue;
          if (override?.isUnscheduled) continue;

          out.push(
            toDatedItem({
              date,
              goal: g,
              subtask: s,
              subtaskForDate,
              isSharedAssigned,
              override,
              isUnscheduledForSelectedDay: false,
            })
          );
        }
      }
    }

    out.sort((a, b) => {
      const d = dayStartMs(a.date) - dayStartMs(b.date);
      if (d !== 0) return d;

      const aHasDue = typeof a.dueAtMs === "number";
      const bHasDue = typeof b.dueAtMs === "number";

      if (aHasDue && bHasDue) {
        const due = a.dueAtMs! - b.dueAtMs!;
        if (due !== 0) return due;
      } else if (aHasDue && !bHasDue) {
        return -1;
      } else if (!aHasDue && bHasDue) {
        return 1;
      }

      return a.title.localeCompare(b.title);
    });

    return out;
  }, [
    userId,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    selectedDate,
    viewMode,
    weekDates,
    tz,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, { date: Date; items: DatedItem[] }>();

    for (const it of datedItems) {
      const k = dateKeyLocal(it.date, tz);
      const existing = map.get(k);
      if (existing) existing.items.push(it);
      else map.set(k, { date: it.date, items: [it] });
    }

    return Array.from(map.values()).sort(
      (a, b) => dayStartMs(a.date) - dayStartMs(b.date)
    );
  }, [datedItems, tz]);

  const selectedGroup = useMemo(() => {
    return grouped.find((g) => dateKeyLocal(g.date, tz) === selectedDayKey) ?? null;
  }, [grouped, selectedDayKey, tz]);

  const selectedSplit = useMemo(() => {
    const items = selectedGroup?.items ?? [];
    const completedSet = completedByDayKey.get(selectedDayKey) ?? new Set<string>();

    return splitDueCompleted(items, (t) =>
      completedSet.has(completionKey(t.goalId, t.subtaskId))
    );
  }, [selectedGroup, completedByDayKey, selectedDayKey]);

  const selectedDayUnscheduledItems = useMemo<DatedItem[]>(() => {
    const uid = userId ?? null;
    const out: DatedItem[] = [];

    for (const g of visibleGoals) {
      if (g.status === "completed") continue;

      for (const s of subtasksByGoal[g.id] ?? []) {
        const isSharedAssigned =
          g.userId !== uid && isGroupSharedGoal(g) && s.assignedToUid === uid;

        if (g.userId !== uid && !isSharedAssigned) continue;

        const override =
          scheduleOverridesByKey[getScheduleOverrideKey(s.id, selectedDayKey)] ??
          null;

        if (override?.isUnscheduled) {
          out.push(
            toDatedItem({
              date: selectedDate,
              goal: g,
              subtask: s,
              subtaskForDate: s,
              isSharedAssigned,
              override,
              isUnscheduledForSelectedDay: true,
            })
          );
          continue;
        }

        const scheduledDayKey =
          typeof s.scheduledDayKey === "string" && s.scheduledDayKey
            ? s.scheduledDayKey
            : null;

        if (isOneTimeSubtask(s) && !scheduledDayKey) {
          out.push(
            toDatedItem({
              date: selectedDate,
              goal: g,
              subtask: s,
              subtaskForDate: s,
              isSharedAssigned,
              override: null,
              isUnscheduledForSelectedDay: true,
            })
          );
        }
      }
    }

    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }, [
    userId,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    selectedDayKey,
    selectedDate,
  ]);

  return {
    datedItems,
    grouped,
    selectedGroup,
    selectedSplit,
    selectedDayUnscheduledItems,
  };
}
