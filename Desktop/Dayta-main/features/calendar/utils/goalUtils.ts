import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import { dayKeyFromDate } from "../../../services/dateKey";
import type { Goal } from "../types/calendar.types";

export function isOneTimeSubtask(subtask: any): boolean {
  return subtask?.scheduleType === "oneTime" || subtask?.frequency === "once";
}

export function isGroupSharedGoal(goal: Goal): boolean {
  return (goal as any).visibility === "group_shared";
}

/** Day key for a Date, normalized to the local calendar day first. */
export function dateKeyLocal(d: Date, tz: string): string {
  const dayOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dayKeyFromDate(dayOnly, tz);
}

export function completionKey(goalId: string, subtaskId: string): string {
  return `${goalId}:${subtaskId}`;
}

/** Optimistic local heat adjustment so a toggle reflects immediately. */
export function bumpHeatCount(
  prev: HeatmapByDayKey,
  dayKey: string,
  deltaCount: number,
  deltaMetricSum: number = 0
): HeatmapByDayKey {
  const cur = prev[dayKey] ?? { count: 0, metricSum: 0 };

  const nextCount = Math.max(0, (cur.count ?? 0) + deltaCount);
  const nextMetricSum = Math.max(0, (cur.metricSum ?? 0) + deltaMetricSum);

  return {
    ...prev,
    [dayKey]: { ...cur, count: nextCount, metricSum: nextMetricSum },
  };
}

export function formatTaskDueLabel(dueAtMs?: number | null): string | null {
  if (typeof dueAtMs !== "number") return null;

  return new Date(dueAtMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getScheduleOverrideBadgeLabel(
  source?: "suggestedTime" | "snooze" | "skip" | "unscheduled" | null
): string {
  if (source === "snooze") return "Snoozed";
  if (source === "suggestedTime") return "Rescheduled";
  if (source === "skip") return "Skipped";
  if (source === "unscheduled") return "Unscheduled";
  return "Adjusted";
}

export function formatTimeRangeLabel(startMs: number, endMs: number): string {
  const startLabel = new Date(startMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endLabel = new Date(endMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${startLabel} - ${endLabel}`;
}

export function buildDaySummaryLabel(args: {
  subtaskCount: number;
  goalCount: number;
  metricSum: number;
}): string {
  const parts: string[] = [];

  if (args.goalCount > 0) {
    parts.push(`${args.goalCount} goal${args.goalCount === 1 ? "" : "s"} completed`);
  }

  if (args.subtaskCount > 0) {
    parts.push(
      `${args.subtaskCount} subtask${args.subtaskCount === 1 ? "" : "s"} completed`
    );
  }

  if (parts.length === 0) {
    parts.push("No completions yet");
  }

  if (args.metricSum > 0) {
    parts.push(`${args.metricSum} metric`);
  }

  return parts.join(" • ");
}

export function formatLinkedEventLabel(
  title?: string | null,
  startMs?: number | null,
  options?: { missing?: boolean }
): string | null {
  if (!title) {
    return options?.missing
      ? "Linked event is missing from Google Calendar"
      : null;
  }

  const timeLabel =
    typeof startMs === "number"
      ? new Date(startMs).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  if (options?.missing) {
    return timeLabel
      ? `Missing linked event: ${title} • ${timeLabel}`
      : `Missing linked event: ${title}`;
  }

  return timeLabel
    ? `Linked event: ${title} • ${timeLabel}`
    : `Linked event: ${title}`;
}
