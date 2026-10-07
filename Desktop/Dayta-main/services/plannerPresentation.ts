import { DateTime } from "luxon";
import {
  getEffectivePlannerSuggestionStatus,
  getPlannerSuggestionTargetRoute,
  type PlannerEntityRef,
  type PlannerProposedAction,
  type PlannerSuggestionDoc,
  type PlannerSuggestionEvidence,
  type PlannerSuggestionType,
} from "./plannerSuggestions";

const TYPE_PRESENTATION: Record<PlannerSuggestionType, {label: string; category: string}> = {
  schedule_work: {label: "Schedule idea", category: "Schedule"},
  reschedule_work: {label: "Timing review", category: "Schedule"},
  resolve_conflict: {label: "Schedule conflict", category: "Calendar"},
  prioritize_work: {label: "Busy deadline", category: "Workload"},
  split_work: {label: "Break down work", category: "Workload"},
  surface_neglected_work: {label: "Goal check-in", category: "Goal"},
  move_board_card: {label: "Board follow-up", category: "Board"},
  adjust_deadline: {label: "Deadline review", category: "Workload"},
  routine_timing: {label: "Routine conflict", category: "Routine"},
  focus_block: {label: "Open time", category: "Schedule"},
};
const RULE_PRESENTATION: Record<string, {label: string; category: string}> = {
  overdue_unscheduled_work: {label: "Overdue work", category: "Schedule"},
  due_soon_unscheduled_work: {label: "Due soon", category: "Schedule"},
  due_date_overload: {label: "Busy deadline", category: "Workload"},
  calendar_conflict: {label: "Schedule conflict", category: "Calendar"},
  open_window_scheduling_opportunity: {label: "Open time", category: "Schedule"},
  neglected_active_goal: {label: "Goal check-in", category: "Goal"},
  high_priority_board_card_stalled: {label: "Board follow-up", category: "Board"},
  routine_occurrence_conflict: {label: "Routine conflict", category: "Routine"},
};
export function getPlannerSuggestionPresentation(type: unknown) {
  if (typeof type === "string" && type in RULE_PRESENTATION) return RULE_PRESENTATION[type];
  return typeof type === "string" && type in TYPE_PRESENTATION
    ? TYPE_PRESENTATION[type as PlannerSuggestionType]
    : {label: "Planning suggestion", category: "Planner"};
}
export function getPlannerSuggestionDocPresentation(suggestion: PlannerSuggestionDoc) {
  return getPlannerSuggestionPresentation(suggestion.source.ruleId || suggestion.type);
}
const dateText = (value: number, timeZone: string) => {
  if (!Number.isFinite(value)) return null;
  const date = DateTime.fromMillis(value, {zone: timeZone});
  return date.isValid ? date.toLocaleString(DateTime.DATETIME_MED) : null;
};
export function formatPlannerEvidence(
  evidence: PlannerSuggestionEvidence,
  timeZone: string,
) {
  if (!evidence || typeof evidence.label !== "string") return null;
  const number = evidence.valueNumber;
  if (["due_date", "calendar_gap", "calendar_conflict", "inactivity"].includes(evidence.kind)
    && typeof number === "number") {
    const formatted = dateText(number, timeZone);
    return formatted ? `${evidence.label}: ${formatted}` : evidence.label;
  }
  if (evidence.kind === "overdue" && typeof number === "number") {
    return `${Math.max(0, Math.round(number))} ${Math.round(number) === 1 ? "day" : "days"} overdue`;
  }
  if (evidence.kind === "workload" && typeof number === "number") {
    return `${evidence.label}: ${Math.max(0, Math.round(number))}`;
  }
  if (typeof evidence.valueText === "string" && evidence.valueText.trim()) {
    return `${evidence.label}: ${evidence.valueText.trim()}`;
  }
  if (typeof number === "number") return `${evidence.label}: ${number}`;
  return evidence.label.trim() || null;
}
export function formatPlannerAction(action: PlannerProposedAction, timeZone: string) {
  if (!action || typeof action !== "object") return "Review this suggestion and its related work.";
  if (action.type === "review_entity") return "Review the related work.";
  if (action.type === "schedule_entity") {
    const start = dateText(action.proposedStartAtMs, timeZone);
    return start ? `Consider scheduling this for ${start}.` : "Consider scheduling this work.";
  }
  if (action.type === "reschedule_entity") {
    const start = dateText(action.proposedStartAtMs, timeZone);
    return start ? `Consider moving this to ${start}.` : "Consider a different time.";
  }
  if (action.type === "move_board_card") return "Consider moving this card to the suggested board stage.";
  if (action.type === "set_priority") return `Consider changing the priority to ${action.proposedPriority}.`;
  if (action.type === "set_due_date") {
    const due = dateText(action.proposedDueAtMs, timeZone);
    return due ? `Consider reviewing the deadline around ${due}.` : "Consider reviewing the deadline.";
  }
  if (action.type === "create_focus_block") {
    const start = dateText(action.proposedStartAtMs, timeZone);
    return start ? `Consider reserving focus time at ${start}.` : "Consider reserving a focus block.";
  }
  return "Review this suggestion and its related work.";
}
export function resolvePlannerNavigationTarget(ref: PlannerEntityRef | null | undefined) {
  if (!ref) return null;
  return getPlannerSuggestionTargetRoute(ref);
}
export function getPlannerOpenLabel(ref: PlannerEntityRef | null | undefined) {
  if (!ref) return "Review related work";
  if (ref.type === "goal") return "Open goal";
  if (ref.type === "subtask") return "Open subtask";
  if (ref.type === "board" || ref.type === "board_card") return "Open board";
  if (ref.type === "calendar_event") return "Open calendar";
  if (ref.type === "routine" || ref.type === "routine_occurrence") return "Open routine";
  return "Review related work";
}
export function getPlannerSnoozePresets(nowMs: number, timeZone: string) {
  const now = DateTime.fromMillis(nowMs, {zone: timeZone});
  if (!now.isValid) return [];
  const laterToday = now.plus({hours: 4});
  const tomorrowMorning = now.plus({days: 1}).startOf("day").set({hour: 9});
  return [
    {id: "later_today", label: "Later today", atMs: laterToday.toMillis()},
    {id: "tomorrow_morning", label: "Tomorrow morning", atMs: tomorrowMorning.toMillis()},
    {id: "three_days", label: "In 3 days", atMs: now.plus({days: 3}).toMillis()},
    {id: "one_week", label: "In 1 week", atMs: now.plus({weeks: 1}).toMillis()},
  ].filter((item) => item.atMs > nowMs);
}
export function filterEffectivePlannerSuggestions(
  suggestions: PlannerSuggestionDoc[],
  status: "active" | "snoozed",
  nowMs: number,
) {
  return suggestions.filter((item) => getEffectivePlannerSuggestionStatus(item, nowMs) === status);
}
export function matchesPlannerContext(
  suggestion: PlannerSuggestionDoc,
  context: {goalId?: string; boardId?: string; groupId?: string},
) {
  const refs = [suggestion.target.primary, ...suggestion.target.related];
  return refs.some((ref) =>
    (!!context.goalId && (ref.id === context.goalId || ref.goalId === context.goalId)) ||
    (!!context.boardId && (ref.id === context.boardId || ref.boardId === context.boardId)) ||
    (!!context.groupId && ref.groupId === context.groupId)
  );
}
