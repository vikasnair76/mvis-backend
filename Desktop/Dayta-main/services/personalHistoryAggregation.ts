import {DateTime, IANAZone} from "luxon";
import {
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
} from "./personalHistory";

export type PersonalHistoryDayGroup = {
  dayKey: string;
  startOfDayMs: number;
  events: PersonalHistoryEvent[];
};

export type PersonalHistoryMonthSummary = {
  totalEvents: number;
  goalCreatedCount: number;
  goalCompletedCount: number;
  subtaskCompletedCount: number;
  plannerAppliedCount: number;
  calendarBlockCreatedCount: number;
  boardCardCompletedCount: number;
  milestoneCompletedCount: number;
  routineCompletedCount: number;
  activeDayCount: number;
};

export function comparePersonalHistoryEvents(
  left: PersonalHistoryEvent,
  right: PersonalHistoryEvent
) {
  const timeDifference = right.occurredAtMs - left.occurredAtMs;
  if (timeDifference) return timeDifference;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

export function groupPersonalHistoryEventsByDay(
  events: readonly PersonalHistoryEvent[],
  timeZone: string
): PersonalHistoryDayGroup[] {
  if (!IANAZone.isValidZone(timeZone)) {
    throw new Error("invalid_timezone");
  }
  const groups = new Map<string, PersonalHistoryEvent[]>();
  for (const event of events) {
    const dayKey = DateTime.fromMillis(event.occurredAtMs, {
      zone: timeZone,
    }).toFormat("yyyy-MM-dd");
    const current = groups.get(dayKey);
    if (current) current.push(event);
    else groups.set(dayKey, [event]);
  }
  return [...groups.entries()]
    .map(([dayKey, items]) => ({
      dayKey,
      startOfDayMs: DateTime.fromISO(dayKey, {zone: timeZone})
        .startOf("day").toMillis(),
      events: [...items].sort(comparePersonalHistoryEvents),
    }))
    .sort((left, right) =>
      right.startOfDayMs - left.startOfDayMs);
}

const summaryKeys: Partial<Record<
PersonalHistoryEventType,
keyof Omit<PersonalHistoryMonthSummary, "totalEvents" | "activeDayCount">
>> = {
  goal_created: "goalCreatedCount",
  goal_completed: "goalCompletedCount",
  subtask_completed: "subtaskCompletedCount",
  planner_suggestion_applied: "plannerAppliedCount",
  calendar_block_created: "calendarBlockCreatedCount",
  planning_board_card_completed: "boardCardCompletedCount",
  milestone_completed: "milestoneCompletedCount",
  routine_completed: "routineCompletedCount",
};

export function summarizePersonalHistoryMonth(
  events: readonly PersonalHistoryEvent[],
  timeZone: string
): PersonalHistoryMonthSummary {
  const summary: PersonalHistoryMonthSummary = {
    totalEvents: events.length,
    goalCreatedCount: 0,
    goalCompletedCount: 0,
    subtaskCompletedCount: 0,
    plannerAppliedCount: 0,
    calendarBlockCreatedCount: 0,
    boardCardCompletedCount: 0,
    milestoneCompletedCount: 0,
    routineCompletedCount: 0,
    activeDayCount: 0,
  };
  for (const event of events) {
    const key = summaryKeys[event.eventType];
    if (key) summary[key] += 1;
  }
  summary.activeDayCount =
    groupPersonalHistoryEventsByDay(events, timeZone).length;
  return summary;
}

export function mergePersonalHistoryEventPages(
  current: readonly PersonalHistoryEvent[],
  incoming: readonly PersonalHistoryEvent[],
  onConflict?: (event: PersonalHistoryEvent) => void
) {
  const seen = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    const existing = seen.get(event.id);
    if (!existing) seen.set(event.id, event);
    else if (
      existing.sourceEventId !== event.sourceEventId ||
      existing.eventType !== event.eventType ||
      existing.occurredAtMs !== event.occurredAtMs
    ) onConflict?.(event);
  }
  return [...seen.values()];
}
