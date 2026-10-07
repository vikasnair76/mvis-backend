import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import { dayKeyFromDate, getUserTz } from "../../../services/dateKey";

export function getEventDurationMinutes(event: {
  startMs: number;
  endMs: number | null;
}): number | null {
  if (
    typeof event?.startMs !== "number" ||
    !Number.isFinite(event.startMs) ||
    typeof event?.endMs !== "number" ||
    !Number.isFinite(event.endMs)
  ) {
    return null;
  }

  if (event.endMs <= event.startMs) return null;

  const minutes = Math.round((event.endMs - event.startMs) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  return minutes;
}

export function formatEventDurationLabel(event: {
  startMs: number;
  endMs: number | null;
}): string | null {
  const minutes = getEventDurationMinutes(event);
  if (minutes == null) return null;

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hr`;
  }

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return `${hours} hr ${remaining} min`;
  }

  return `${minutes} min`;
}

export function normalizeMetricUnit(unit: unknown): string {
  if (typeof unit !== "string") return "";
  return unit.trim().toLowerCase();
}

export function getTimeMetricUnitKind(unit: unknown): "hours" | "minutes" | null {
  const normalized = normalizeMetricUnit(unit);

  if (
    normalized === "hour" ||
    normalized === "hours" ||
    normalized === "hr" ||
    normalized === "hrs"
  ) {
    return "hours";
  }

  if (
    normalized === "minute" ||
    normalized === "minutes" ||
    normalized === "min" ||
    normalized === "mins"
  ) {
    return "minutes";
  }

  return null;
}

export function isTimeBasedMetricSubtask(subtask: any): boolean {
  if (subtask?.contributesToMetric !== true) return false;
  return getTimeMetricUnitKind(subtask?.metricUnit) != null;
}

export function isMetricCapableSubtask(subtask: any): boolean {
  return subtask?.contributesToMetric === true;
}

export function convertEventDurationToMetricValue(
  subtask: any,
  event: { startMs: number; endMs: number | null }
): number | null {
  if (!isTimeBasedMetricSubtask(subtask)) return null;

  const durationMinutes = getEventDurationMinutes(event);
  if (durationMinutes == null) return null;

  const unitKind = getTimeMetricUnitKind(subtask?.metricUnit);

  if (unitKind === "hours") {
    return Math.round((durationMinutes / 60) * 100) / 100;
  }

  if (unitKind === "minutes") {
    return durationMinutes;
  }

  return null;
}

export function formatMetricValueLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function getDurationApplyLabel(metricValue: number, subtask: any): string {
  const unitKind = getTimeMetricUnitKind(subtask?.metricUnit);

  if (unitKind === "hours") {
    return `Apply event duration (${formatMetricValueLabel(metricValue)} hr)`;
  }

  if (unitKind === "minutes") {
    return `Apply event duration (${formatMetricValueLabel(metricValue)} min)`;
  }

  return "Apply event duration";
}

export function buildHeatmapFromCompletionSnapshot(
  snap: any,
  activeGoalIds?: Set<string>
): HeatmapByDayKey {
  const heat: HeatmapByDayKey = {};

  snap.forEach((docSnap: any) => {
    const data = docSnap.data() as any;

    const dayKey = String(data?.dayKey ?? "");
    const goalId = String(data?.goalId ?? "");
    if (!dayKey) return;

    if (activeGoalIds && goalId && !activeGoalIds.has(goalId)) return;

    const mv = data?.metricValue;
    const metricValue =
      typeof mv === "number" && Number.isFinite(mv) ? mv : 0;

    if (!heat[dayKey]) {
      heat[dayKey] = { count: 0, metricSum: 0 };
    }

    heat[dayKey].count += 1;
    heat[dayKey].metricSum += metricValue;
  });

  return heat;
}

export function getCombinedCompletionCountForDay(
  dayKey: string,
  heatByDayKey: HeatmapByDayKey,
  goalCompletionCountsByDay: Record<string, number>
): number {
  const subtaskCount = heatByDayKey[dayKey]?.count ?? 0;
  const goalCount = goalCompletionCountsByDay[dayKey] ?? 0;
  return subtaskCount + goalCount;
}

export function splitDueCompleted<T>(
  items: T[],
  isCompleted: (item: T) => boolean
): { due: T[]; completed: T[] } {
  const due: T[] = [];
  const completed: T[] = [];

  for (const it of items) {
    if (isCompleted(it)) completed.push(it);
    else due.push(it);
  }

  return { due, completed };
}

export function getLinkedEventActionKey(item: {
  goalId: string;
  subtaskId: string;
  date: Date;
}): string {
  return `${item.goalId}:${item.subtaskId}:${dayKeyFromDate(item.date, getUserTz())}`;
}

export function getLinkedEventMissingNoticeText(args: {
  variant: "due" | "unscheduled" | "completed";
  missingAtMs?: number | null;
}): string {
  const missingSinceLabel =
    typeof args.missingAtMs === "number"
      ? ` Missing since ${new Date(args.missingAtMs).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}.`
      : "";

  if (args.variant === "completed") {
    return `This linked event is no longer in your synced Google Calendar data.${missingSinceLabel} You can keep the completed task as-is or unlink the missing event.`;
  }

  return `This linked event is no longer in your synced Google Calendar data.${missingSinceLabel} You can keep the task as-is or unlink the missing event.`;
}

export function getLinkedEventMismatchText(): string {
  return "Linked event time differs from task time";
}

export function getApplyPanelTitle(applyStep: "goal" | "subtask"): string {
  return applyStep === "goal" ? "Apply event to goal" : "Choose a subtask";
}

export function getApplyPanelHint(applyStep: "goal" | "subtask"): string {
  return applyStep === "goal"
    ? "Select a goal to continue."
    : "Choose a subtask, then select how to apply this event.";
}

export type ApplyBlockedFlags = {
  isAlreadyCompletedForEventDay: boolean;
  isOnceSubtaskAlreadyCompleted: boolean;
  isLinkedToDifferentEvent: boolean;
};

export function getApplyCompletionBlockedReason(
  args: ApplyBlockedFlags
): string | null {
  if (args.isLinkedToDifferentEvent) {
    return "This subtask is already linked to a different calendar event. Replace the link first if you want this event to drive it.";
  }
  if (args.isOnceSubtaskAlreadyCompleted) {
    return "This one-time subtask was already completed and cannot be completed again.";
  }
  if (args.isAlreadyCompletedForEventDay) {
    return "This subtask is already completed for the event day.";
  }
  return null;
}

export function getApplyDurationBlockedReason(
  args: ApplyBlockedFlags
): string | null {
  if (args.isAlreadyCompletedForEventDay) {
    return "This subtask is already completed for the event day.";
  }
  if (args.isOnceSubtaskAlreadyCompleted) {
    return "This one-time subtask is already completed.";
  }
  if (args.isLinkedToDifferentEvent) {
    return "This subtask is already linked to a different calendar event.";
  }
  return null;
}

/** The shared preconditions for driving a subtask from a specific event. */
export function getApplyBlockedFlags(args: {
  subtask: any | null;
  eventId: string;
  isAlreadyCompletedForEventDay: boolean;
}): ApplyBlockedFlags {
  const s = args.subtask;
  const isOneTime = s?.scheduleType === "oneTime" || s?.frequency === "once";

  return {
    isAlreadyCompletedForEventDay: args.isAlreadyCompletedForEventDay,
    isOnceSubtaskAlreadyCompleted:
      s?.frequency === "once" && s?.firstCompletedAtMs != null,
    isLinkedToDifferentEvent:
      isOneTime &&
      !!s?.linkedCalendarEventId &&
      s.linkedCalendarEventId !== args.eventId,
  };
}
