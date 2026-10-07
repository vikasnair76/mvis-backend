import { DateTime, IANAZone } from "luxon";
import type { PersonalHistoryMonthSummary } from "../../../services/personalHistoryAggregation";
import { PersonalHistoryQueryError } from "../../../services/personalHistoryQueries";
import type { HistoryFilterOption, HistoryUiError } from "../types/history.types";

export const PAGE_SIZE = 50;

export const EMPTY_SUMMARY: PersonalHistoryMonthSummary = {
  totalEvents: 0,
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

export const HISTORY_FILTERS: HistoryFilterOption[] = [
  { value: "all", label: "All", emptyLabel: "history" },
  { value: "goal", label: "Goals", emptyLabel: "Goal history" },
  { value: "subtask", label: "Subtasks", emptyLabel: "Subtask history" },
  { value: "planner", label: "Planner", emptyLabel: "Planner activity" },
  { value: "calendar", label: "Calendar", emptyLabel: "Calendar history" },
  { value: "board", label: "Boards", emptyLabel: "Board history" },
  { value: "milestone", label: "Milestones", emptyLabel: "Milestone history" },
];

export function normalizeUiError(error: unknown): HistoryUiError {
  return error instanceof PersonalHistoryQueryError &&
    error.code === "permission_denied"
    ? "permission_denied"
    : "query_failed";
}

/** The device zone if luxon recognises it, else UTC. */
export function getDeviceTimeZone(): string {
  const zone = DateTime.local().zoneName;
  return IANAZone.isValidZone(zone) ? zone : "UTC";
}

export function getEmptyLabelForFilter(filter: HistoryFilterOption["value"]): string {
  return HISTORY_FILTERS.find((item) => item.value === filter)?.emptyLabel ?? "history";
}
