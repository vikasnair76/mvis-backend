import {DateTime, IANAZone} from "luxon";
import {
  type GroupHistoryEvent,
  type GroupHistoryEventType,
} from "./groupHistory";

export type GroupHistoryMonthSummary = {
  totalEvents: number;
  sharedSubtaskCompletedCount: number;
  groupTaskCompletedCount: number;
  routineOccurrenceCompletedCount: number;
  activeLocalDayCount: number;
  sharedSubtaskContributors: GroupHistoryContributorRollup[];
};

export type GroupHistoryContributorRollup = {
  uid: string | null;
  displayName: string | null;
  completedCount: number;
};

export type GroupHistoryAggregationResult = {
  summary: GroupHistoryMonthSummary;
  duplicateEventCount: number;
};

export function createEmptyGroupHistoryMonthSummary():
GroupHistoryMonthSummary {
  return {
    totalEvents: 0,
    sharedSubtaskCompletedCount: 0,
    groupTaskCompletedCount: 0,
    routineOccurrenceCompletedCount: 0,
    activeLocalDayCount: 0,
    sharedSubtaskContributors: [],
  };
}

const countKey: Record<GroupHistoryEventType, keyof Omit<
GroupHistoryMonthSummary,
"totalEvents" | "activeLocalDayCount" | "sharedSubtaskContributors"
>> = {
  shared_subtask_completed: "sharedSubtaskCompletedCount",
  group_task_completed: "groupTaskCompletedCount",
  group_routine_occurrence_completed: "routineOccurrenceCompletedCount",
};

export function compareGroupHistoryEvents(
  left: GroupHistoryEvent,
  right: GroupHistoryEvent
) {
  const timeDifference = right.occurredAtMs - left.occurredAtMs;
  if (timeDifference) return timeDifference;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

export function aggregateGroupHistoryEvents(
  events: readonly GroupHistoryEvent[],
  timeZone: string
): GroupHistoryAggregationResult {
  if (!IANAZone.isValidZone(timeZone)) throw new Error("invalid_timezone");
  const summary = createEmptyGroupHistoryMonthSummary();
  const seen = new Set<string>();
  const activeDays = new Set<string>();
  const contributors = new Map<string, GroupHistoryContributorRollup>();
  let duplicateEventCount = 0;
  for (const event of events) {
    if (seen.has(event.id)) {
      duplicateEventCount += 1;
      continue;
    }
    seen.add(event.id);
    summary.totalEvents += 1;
    summary[countKey[event.eventType]] += 1;
    if (event.eventType === "shared_subtask_completed") {
      const uid = event.creditedMemberUid ?? event.actorUid;
      const key = uid ?? "__unknown__";
      const existing = contributors.get(key);
      if (existing) {
        existing.completedCount += 1;
        existing.displayName ??=
          event.creditedMemberDisplayName ?? event.actorDisplayName;
      } else {
        contributors.set(key, {
          uid,
          displayName:
            event.creditedMemberDisplayName ?? event.actorDisplayName,
          completedCount: 1,
        });
      }
    }
    activeDays.add(DateTime.fromMillis(event.occurredAtMs, {
      zone: timeZone,
    }).toFormat("yyyy-MM-dd"));
  }
  summary.activeLocalDayCount = activeDays.size;
  summary.sharedSubtaskContributors = [...contributors.values()].sort(
    (left, right) => right.completedCount - left.completedCount ||
      (left.displayName ?? left.uid ?? "").localeCompare(
        right.displayName ?? right.uid ?? "")
  );
  return {summary, duplicateEventCount};
}

export function mergeGroupHistoryEvents(
  current: readonly GroupHistoryEvent[],
  incoming: readonly GroupHistoryEvent[]
) {
  const events = new Map(current.map((event) => [event.id, event]));
  let duplicateEventCount = 0;
  let conflict = false;
  for (const event of incoming) {
    const existing = events.get(event.id);
    if (!existing) {
      events.set(event.id, event);
      continue;
    }
    duplicateEventCount += 1;
    if (existing.occurredAtMs !== event.occurredAtMs ||
      existing.eventType !== event.eventType ||
      existing.sourceEventId !== event.sourceEventId) conflict = true;
  }
  return {
    events: [...events.values()].sort(compareGroupHistoryEvents),
    duplicateEventCount,
    conflict,
  };
}
