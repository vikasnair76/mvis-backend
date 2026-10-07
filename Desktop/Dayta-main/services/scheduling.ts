import { dayKeyFromDate } from "./dateKey";

export type ScheduleOverrideRecord = {
  dueAtMs?: number | null;
  isSkipped?: boolean;
  isUnscheduled?: boolean;
  source?: "suggestedTime" | "snooze" | "skip" | "unscheduled" | null;
};

export type ScheduleType = "recurring" | "oneTime";

export type ScheduleOverrideSource =
  | "suggestedTime"
  | "snooze"
  | "skip"
  | "unscheduled"
  | null;

export function dayStartMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function buildOneTimeSchedulePatch(
  targetDayKey: string | null,
  dueAtMs?: number | null
) {
  return {
    scheduleType: "oneTime" as const,
    scheduledDayKey: targetDayKey,
    dueAtMs: typeof dueAtMs === "number" ? dueAtMs : null,
  };
}

export function buildRecurringOverridePatch(params: {
  userId: string;
  goalId: string;
  subtaskId: string;
  dayKey: string;
  dueAtMs?: number | null;
  isSkipped?: boolean;
  isUnscheduled?: boolean;
  source?: "suggestedTime" | "snooze" | "skip" | "unscheduled" | null;
}) {
  return {
    userId: params.userId,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    dayKey: params.dayKey,
    dueAtMs: typeof params.dueAtMs === "number" ? params.dueAtMs : null,
    isSkipped: !!params.isSkipped,
    isUnscheduled: !!params.isUnscheduled,
    source: params.source ?? null,
    updatedAtMs: Date.now(),
  };
}

export function buildRecurringTimedOverride(params: {
  userId: string;
  goalId: string;
  subtaskId: string;
  dayKey: string;
  dueAtMs: number;
  source: "suggestedTime" | "snooze";
}) {
  return buildRecurringOverridePatch({
    userId: params.userId,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    dayKey: params.dayKey,
    dueAtMs: params.dueAtMs,
    isSkipped: false,
    isUnscheduled: false,
    source: params.source,
  });
}

export function buildRecurringUnscheduledOverride(params: {
  userId: string;
  goalId: string;
  subtaskId: string;
  dayKey: string;
  source: "snooze" | "unscheduled";
}) {
  return buildRecurringOverridePatch({
    userId: params.userId,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    dayKey: params.dayKey,
    dueAtMs: null,
    isSkipped: false,
    isUnscheduled: true,
    source: params.source,
  });
}

export function buildRecurringSkippedOverride(params: {
  userId: string;
  goalId: string;
  subtaskId: string;
  dayKey: string;
}) {
  return buildRecurringOverridePatch({
    userId: params.userId,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    dayKey: params.dayKey,
    dueAtMs: null,
    isSkipped: true,
    isUnscheduled: false,
    source: "skip",
  });
}

export function dayRangeMs(d: Date) {
  const start = dayStartMs(d);
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

export function getScheduleOverrideKey(subtaskId: string, dayKey: string) {
  return `${subtaskId}:${dayKey}`;
}

export function isRecurringSubtask(subtask: {
  frequency?: string;
  scheduleType?: "recurring" | "oneTime";
}) {
  if (subtask.scheduleType) {
    return subtask.scheduleType === "recurring";
  }

  // Backward compatibility
  return subtask.frequency === "daily" || subtask.frequency === "weekly";
}

export function getScheduleType(subtask: {
  frequency?: string;
  scheduleType?: "recurring" | "oneTime";
}) {
  if (subtask.scheduleType) return subtask.scheduleType;

  // Backward compatibility
  if (subtask.frequency === "daily" || subtask.frequency === "weekly") {
    return "recurring";
  }

  return "oneTime";
}
export function getScheduledDayKey(
  subtask: {
    frequency?: string;
    scheduleType?: "recurring" | "oneTime";
    scheduledDayKey?: string | null;
    dueAtMs?: number | null;
  },
  tz: string
) {
  if (typeof subtask.scheduledDayKey === "string" && subtask.scheduledDayKey) {
    return subtask.scheduledDayKey;
  }

  const scheduleType = getScheduleType(subtask);

  // Backward compatibility for old one-time items
  if (scheduleType === "oneTime" && typeof subtask.dueAtMs === "number") {
    return dayKeyFromDate(new Date(subtask.dueAtMs), tz);
  }

  return null;
}

export function getDateKeyForSchedule(date: Date, tz: string) {
  const dayOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return dayKeyFromDate(dayOnly, tz);
}

export function getEffectiveSubtaskForDate<
  T extends {
    id: string;
    dueAtMs?: number | null;
    frequency?: string;
    scheduleType?: "recurring" | "oneTime";
    scheduledDayKey?: string | null;
  }
>(
  subtask: T,
  date: Date,
  tz: string,
  scheduleOverridesByKey: Record<string, ScheduleOverrideRecord>
): T & {
  dueAtMs?: number | null;
  isSkipped?: boolean;
  isUnscheduled?: boolean;
  source?: "suggestedTime" | "snooze" | "skip" | "unscheduled" | null;
  scheduleType?: "recurring" | "oneTime";
  scheduledDayKey?: string | null;
} {
  const dayKey = getDateKeyForSchedule(date, tz);
  const override = scheduleOverridesByKey[getScheduleOverrideKey(subtask.id, dayKey)] ?? null;

  const resolvedScheduleType = getScheduleType(subtask);
  const resolvedScheduledDayKey = getScheduledDayKey(subtask, tz);

  if (!override) {
    return {
      ...subtask,
      scheduleType: resolvedScheduleType,
      scheduledDayKey: resolvedScheduledDayKey,
    };
  }

  return {
    ...subtask,
    dueAtMs:
      typeof override.dueAtMs === "number"
        ? override.dueAtMs
        : (subtask.dueAtMs ?? null),
    isSkipped: !!override.isSkipped,
    isUnscheduled: !!override.isUnscheduled,
    source: override.source ?? null,
    scheduleType: resolvedScheduleType,
    scheduledDayKey: resolvedScheduledDayKey,
  };
}

export function isSubtaskDueOnDate(
  subtask: {
    frequency?: string;
    weeklyDay?: number;
    dueAtMs?: number | null;
    isSkipped?: boolean;
    isUnscheduled?: boolean;
    scheduleType?: "recurring" | "oneTime";
    scheduledDayKey?: string | null;
  },
  date: Date,
  tz: string
): boolean {
  if (subtask.isSkipped) return false;
  if (subtask.isUnscheduled) return false;

  const scheduleType = getScheduleType(subtask);
  const dayKey = getDateKeyForSchedule(date, tz);

  if (scheduleType === "oneTime") {
    const scheduledDayKey = getScheduledDayKey(subtask, tz);
    return scheduledDayKey === dayKey;
  }

  const { start, end } = dayRangeMs(date);
  const dow = date.getDay();

  if (
    typeof subtask.dueAtMs === "number" &&
    subtask.dueAtMs >= start &&
    subtask.dueAtMs < end
  ) {
    return true;
  }

  if (subtask.frequency === "daily") return true;

  if (subtask.frequency === "weekly") {
    const wd = typeof subtask.weeklyDay === "number" ? subtask.weeklyDay : null;
    return wd === dow;
  }

  return false;
}