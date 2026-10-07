import {
  findPlannerFreeWindows,
  getPlannerDayStartMs,
  getPlannerLocalDayKey,
  getPlanningDayBounds,
  mergePlannerIntervals,
  plannerIntervalsConflict,
  type PlannerBoardCardSnapshot,
  type PlannerCalendarEventSnapshot,
  type PlannerEntityRef,
  type PlannerGoalSnapshot,
  type PlannerInputSnapshot,
  type PlannerInterval,
  type PlannerPriority,
  type PlannerScope,
  type PlannerSubtaskSnapshot,
  type PlannerSuggestionType,
} from "./plannerSnapshot.js";

export type PlannerEvidenceKind =
  | "due_date" | "overdue" | "calendar_gap" | "calendar_conflict"
  | "workload" | "priority" | "inactivity" | "routine_history"
  | "completion_pattern" | "dependency" | "assignment";
export type PlannerAction =
  | {type: "review_entity"; target: PlannerEntityRef}
  | {type: "schedule_entity"; target: PlannerEntityRef; proposedStartAtMs: number;
    proposedEndAtMs: number | null; timeZone: string | null}
  | {type: "reschedule_entity"; target: PlannerEntityRef;
    existingStartAtMs: number | null; proposedStartAtMs: number;
    proposedEndAtMs: number | null; timeZone: string | null}
  | {type: "move_board_card"; target: PlannerEntityRef; boardId: string;
    proposedColumnId: string}
  | {type: "create_focus_block"; proposedStartAtMs: number;
    proposedEndAtMs: number; linkedTargets: PlannerEntityRef[]};
export interface PlannerSuggestionCandidate {
  ownerUid: string; scope: PlannerScope; groupId: string | null;
  type: PlannerSuggestionType; priority: PlannerPriority;
  confidence: {level: "low" | "medium" | "high"; score: number};
  title: string; summary: string; rationale: string;
  evidence: {kind: PlannerEvidenceKind; label: string;
    valueText?: string | null; valueNumber?: number | null;
    sourceRef?: PlannerEntityRef | null}[];
  target: {primary: PlannerEntityRef; related: PlannerEntityRef[]};
  proposedAction: PlannerAction;
  source: {ruleId: string; ruleVersion: number; inputFingerprint: string;
    timeBucket: string | null};
  score: number;
}
export interface PlannerEvaluationContext {
  nowMs: number; timeZone: string; maxCandidates: number;
  dueSoonHorizonMs?: number; neglectedAfterMs?: number;
  overloadThreshold?: number; minimumOpenWindowMs?: number;
}
export interface PlannerHeuristicRule {
  id: string; version: number; suggestionType: PlannerSuggestionType;
  maxCandidates: number;
  evaluate(snapshot: PlannerInputSnapshot,
    context: PlannerEvaluationContext): PlannerSuggestionCandidate[];
}

const DAY_MS = 86_400_000;
const RULE_CAP = 10;
export const PLANNER_GLOBAL_CANDIDATE_CAP = 25;
const hash = (value: unknown) => {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item) ? item.map(canonical) :
      item && typeof item === "object" ?
        Object.fromEntries(Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)])) : item;
  const input = JSON.stringify(canonical(value));
  let first = 2166136261; let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second ^ input.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}` +
    `${(second >>> 0).toString(16).padStart(8, "0")}`;
};
const refForWork = (item: PlannerSubtaskSnapshot | PlannerBoardCardSnapshot |
PlannerGoalSnapshot): PlannerEntityRef => {
  if ("goalId" in item) return {type: "subtask", id: item.id,
    ownerUid: item.ownerUid, groupId: item.groupId, goalId: item.goalId};
  if ("boardId" in item) return {type: "board_card", id: item.id,
    ownerUid: item.ownerUid, groupId: item.groupId, boardId: item.boardId};
  return {type: "goal", id: item.id, ownerUid: item.ownerUid,
    groupId: item.groupId};
};
const refForEvent = (item: PlannerCalendarEventSnapshot): PlannerEntityRef => ({
  type: "calendar_event", id: item.id, ownerUid: item.ownerUid,
  groupId: item.groupId,
});
const allowed = (snapshot: PlannerInputSnapshot, scope: PlannerScope,
  type: PlannerSuggestionType) => snapshot.preferences.enabled &&
    (scope === "personal" ? snapshot.preferences.allowPersonalSuggestions :
      snapshot.preferences.allowGroupSuggestions) &&
    !snapshot.preferences.hiddenSuggestionTypes.includes(type);
const safeWork = (snapshot: PlannerInputSnapshot) =>
  [...snapshot.subtasks, ...snapshot.boardCards]
    .filter((item) => !item.completed && !item.archived &&
      item.relevantToCurrentUser);
const scheduled = (item: PlannerSubtaskSnapshot | PlannerBoardCardSnapshot) =>
  "scheduledStartAtMs" in item && item.scheduledStartAtMs != null;
const baseCandidate = (input: {
  snapshot: PlannerInputSnapshot; scope: PlannerScope; groupId: string | null;
  type: PlannerSuggestionType; priority: PlannerPriority;
  ruleId: string; ruleVersion: number; primary: PlannerEntityRef;
  related?: PlannerEntityRef[]; action: PlannerAction; title: string;
  summary: string; rationale: string; evidence: PlannerSuggestionCandidate["evidence"];
  score: number; timeBucket?: string | null; state: unknown;
}): PlannerSuggestionCandidate => ({
  ownerUid: input.snapshot.ownerUid, scope: input.scope, groupId: input.groupId,
  type: input.type, priority: input.priority,
  confidence: {level: input.score >= 80 ? "high" : "medium",
    score: Math.max(0, Math.min(1, input.score / 100))},
  title: input.title, summary: input.summary, rationale: input.rationale,
  evidence: input.evidence.slice(0, 5),
  target: {primary: input.primary, related: (input.related || []).slice(0, 5)},
  proposedAction: input.action,
  source: {ruleId: input.ruleId, ruleVersion: input.ruleVersion,
    inputFingerprint: `plannerInput_${hash(input.state)}`,
    timeBucket: input.timeBucket || null},
  score: Math.max(0, Math.min(100, input.score)),
});
const rule = (id: string, suggestionType: PlannerSuggestionType,
  evaluate: PlannerHeuristicRule["evaluate"], maxCandidates = RULE_CAP):
PlannerHeuristicRule => ({id, version: 1, suggestionType, maxCandidates, evaluate});

export const overdueUnscheduledRule = rule("overdue_unscheduled_work",
  "schedule_work", (snapshot, context) => {
    const today = getPlannerDayStartMs(context.nowMs, context.timeZone);
    return safeWork(snapshot).filter((item) => item.dueAtMs != null &&
      item.dueAtMs < today && !scheduled(item) &&
      allowed(snapshot, item.scope, "schedule_work"))
      .map((item) => {
        const target = refForWork(item);
        const days = Math.max(1, Math.floor((today - item.dueAtMs!) / DAY_MS));
        return baseCandidate({
          snapshot, scope: item.scope, groupId: item.groupId,
          type: "schedule_work", priority: item.priority === "high" ? "high" : "medium",
          ruleId: "overdue_unscheduled_work", ruleVersion: 1, primary: target,
          action: {type: "review_entity", target},
          title: `Review overdue work: ${item.title}`,
          summary: "This item is overdue and has no scheduled work time.",
          rationale: "The due date has passed and no valid schedule is present.",
          evidence: [{kind: "due_date", label: "Due date", valueNumber: item.dueAtMs},
            {kind: "overdue", label: "Days overdue", valueNumber: days}],
          score: item.priority === "high" ? 94 : 84,
          timeBucket: getPlannerLocalDayKey(context.nowMs, context.timeZone),
          state: {id: item.id, dueAtMs: item.dueAtMs, scheduled: false,
            priority: item.priority, updatedAtMs: item.updatedAtMs},
        });
      });
  });

export const dueSoonUnscheduledRule = rule("due_soon_unscheduled_work",
  "schedule_work", (snapshot, context) => {
    const horizon = context.dueSoonHorizonMs || 48 * 60 * 60 * 1000;
    return safeWork(snapshot).filter((item) => item.dueAtMs != null &&
      item.dueAtMs >= context.nowMs && item.dueAtMs <= context.nowMs + horizon &&
      !scheduled(item) && allowed(snapshot, item.scope, "schedule_work"))
      .map((item) => {
        const target = refForWork(item);
        return baseCandidate({
          snapshot, scope: item.scope, groupId: item.groupId,
          type: "schedule_work", priority: item.priority === "high" ? "high" : "medium",
          ruleId: "due_soon_unscheduled_work", ruleVersion: 1, primary: target,
          action: {type: "review_entity", target},
          title: `Plan due-soon work: ${item.title}`,
          summary: "This item is due soon and has no scheduled work time.",
          rationale: "Its due date is within the next 48 hours.",
          evidence: [{kind: "due_date", label: "Due date", valueNumber: item.dueAtMs},
            {kind: "priority", label: "Priority", valueText: item.priority || "medium"}],
          score: item.priority === "high" ? 88 : 75,
          timeBucket: getPlannerLocalDayKey(context.nowMs, context.timeZone),
          state: {id: item.id, dueAtMs: item.dueAtMs, priority: item.priority},
        });
      });
  });

export const dueDateOverloadRule = rule("due_date_overload", "prioritize_work",
  (snapshot, context) => {
    if (snapshot.metadata.truncationReasons.some((reason) =>
      reason.includes("subtasks") || reason.includes("boardCards"))) return [];
    const threshold = context.overloadThreshold || 4;
    const buckets = new Map<string, ReturnType<typeof safeWork>>();
    for (const item of safeWork(snapshot)) {
      if (item.dueAtMs == null || !allowed(snapshot, item.scope, "prioritize_work")) continue;
      const key = `${item.scope}:${item.groupId || ""}:` +
        getPlannerLocalDayKey(item.dueAtMs, context.timeZone);
      buckets.set(key, [...(buckets.get(key) || []), item]);
    }
    return Array.from(buckets.entries()).filter(([, items]) => items.length >= threshold)
      .map(([key, items]) => {
        const sorted = items.slice().sort((a, b) =>
          (a.dueAtMs! - b.dueAtMs!) || a.id.localeCompare(b.id));
        const primary = refForWork(sorted[0]);
        const keyParts = key.split(":");
        const dayKey = keyParts[keyParts.length - 1];
        return baseCandidate({
          snapshot, scope: sorted[0].scope, groupId: sorted[0].groupId,
          type: "prioritize_work", priority: "high",
          ruleId: "due_date_overload", ruleVersion: 1, primary,
          related: sorted.slice(1, 6).map(refForWork),
          action: {type: "review_entity", target: primary},
          title: `Review workload for ${dayKey}`,
          summary: `${items.length} active items are due on the same local day.`,
          rationale: "A grouped review can help resolve the concentrated due-date load.",
          evidence: [{kind: "workload", label: "Items due", valueNumber: items.length},
            {kind: "due_date", label: "Local due day", valueText: dayKey}],
          score: Math.min(96, 75 + items.length * 3), timeBucket: dayKey,
          state: {dayKey, ids: sorted.map((item) => item.id),
            dueDates: sorted.map((item) => item.dueAtMs)},
        });
      });
  }, 5);

function blockingEvents(snapshot: PlannerInputSnapshot) {
  const seenGenerated = new Set<string>();
  return snapshot.calendarEvents.filter((event) => {
    if (event.cancelled || !event.blocksTime) return false;
    const identity = event.linkedEntity ?
      `${event.linkedEntity.type}:${event.linkedEntity.id}` : `event:${event.id}`;
    if (event.generated && seenGenerated.has(identity)) return false;
    if (event.generated) seenGenerated.add(identity);
    return true;
  }).sort((a, b) => a.startAtMs - b.startAtMs ||
    a.endAtMs - b.endAtMs || a.id.localeCompare(b.id));
}
export const calendarConflictRule = rule("calendar_conflict", "resolve_conflict",
  (snapshot) => {
    const events = blockingEvents(snapshot); const result: PlannerSuggestionCandidate[] = [];
    const active: PlannerCalendarEventSnapshot[] = [];
    for (const event of events) {
      while (active.length && active[0].endAtMs <= event.startAtMs) active.shift();
      for (const other of active) {
        const left = {startAtMs: other.startAtMs, endAtMs: other.endAtMs, sourceIds: [other.id]};
        const right = {startAtMs: event.startAtMs, endAtMs: event.endAtMs, sourceIds: [event.id]};
        if (!plannerIntervalsConflict(left, right)) continue;
        if (other.linkedEntity?.type === "routine_occurrence" ||
          event.linkedEntity?.type === "routine_occurrence") continue;
        const scope: PlannerScope = other.scope === "group" || event.scope === "group" ?
          "group" : "personal";
        if (!allowed(snapshot, scope, "resolve_conflict")) continue;
        const primary = refForEvent(other);
        result.push(baseCandidate({
          snapshot, scope, groupId: other.groupId || event.groupId,
          type: "resolve_conflict", priority: "high",
          ruleId: "calendar_conflict", ruleVersion: 1, primary,
          related: [refForEvent(event)], action: {type: "review_entity", target: primary},
          title: "Review a calendar conflict",
          summary: "Two time-blocking calendar events overlap.",
          rationale: "The event intervals overlap; no replacement time is assumed.",
          evidence: [{kind: "calendar_conflict", label: "Overlap starts",
            valueNumber: Math.max(other.startAtMs, event.startAtMs)}],
          score: 90, timeBucket: getPlannerLocalDayKey(event.startAtMs, snapshot.timeZone),
          state: {ids: [other.id, event.id].sort(), starts: [other.startAtMs, event.startAtMs],
            ends: [other.endAtMs, event.endAtMs]},
        }));
      }
      active.push(event);
      active.sort((a, b) => a.endAtMs - b.endAtMs || a.id.localeCompare(b.id));
    }
    return result;
  });

export const openWindowRule = rule("open_window_scheduling_opportunity",
  "schedule_work", (snapshot, context) => {
    const minimum = context.minimumOpenWindowMs || 30 * 60 * 1000;
    const busy = mergePlannerIntervals(blockingEvents(snapshot).map((event) => ({
      startAtMs: event.startAtMs, endAtMs: event.endAtMs, sourceIds: [event.id],
    })));
    const work = safeWork(snapshot).filter((item) => item.dueAtMs != null &&
      item.dueAtMs > context.nowMs && !scheduled(item) &&
      allowed(snapshot, item.scope, "schedule_work"))
      .sort((a, b) => a.dueAtMs! - b.dueAtMs! ||
        (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0) ||
        a.id.localeCompare(b.id));
    const results: PlannerSuggestionCandidate[] = [];
    const reserved: PlannerInterval[] = [];
    for (const item of work) {
      const startDay = getPlannerDayStartMs(context.nowMs, context.timeZone);
      for (let dayMs = startDay; dayMs < Math.min(item.dueAtMs!, snapshot.window.endAtMs);
        dayMs = getPlannerDayStartMs(dayMs + 36 * 60 * 60 * 1000, context.timeZone)) {
        const bounds = getPlanningDayBounds(dayMs, context.timeZone);
        const start = Math.max(bounds.startAtMs, context.nowMs);
        const end = Math.min(bounds.endAtMs, item.dueAtMs!);
        const free = findPlannerFreeWindows({busy: [...busy, ...reserved],
          rangeStartAtMs: start, rangeEndAtMs: end, minimumDurationMs: minimum})[0];
        if (!free) continue;
        const proposedEndAtMs = free.startAtMs + minimum;
        const target = refForWork(item);
        results.push(baseCandidate({
          snapshot, scope: item.scope, groupId: item.groupId,
          type: "schedule_work", priority: item.priority === "high" ? "high" : "medium",
          ruleId: "open_window_scheduling_opportunity", ruleVersion: 1, primary: target,
          action: {type: "schedule_entity", target, proposedStartAtMs: free.startAtMs,
            proposedEndAtMs, timeZone: context.timeZone},
          title: `Open time for ${item.title}`,
          summary: "A 30-minute open calendar window exists before this item is due.",
          rationale: "The proposed interval is inside planning hours and does not overlap a blocking event.",
          evidence: [{kind: "calendar_gap", label: "Open window starts",
            valueNumber: free.startAtMs}, {kind: "due_date", label: "Due date",
            valueNumber: item.dueAtMs}],
          score: item.priority === "high" ? 92 : 82,
          timeBucket: getPlannerLocalDayKey(free.startAtMs, context.timeZone),
          state: {id: item.id, dueAtMs: item.dueAtMs,
            proposedStartAtMs: free.startAtMs, proposedEndAtMs},
        }));
        reserved.push({startAtMs: free.startAtMs, endAtMs: proposedEndAtMs, sourceIds: []});
        break;
      }
      if (results.length >= RULE_CAP) break;
    }
    return results;
  });

export const neglectedGoalRule = rule("neglected_active_goal", "surface_neglected_work",
  (snapshot, context) => {
    const threshold = context.neglectedAfterMs || 14 * DAY_MS;
    return snapshot.goals.filter((goal) => !goal.completed && !goal.archived &&
      goal.lastMeaningfulActivityAtMs != null &&
      goal.lastMeaningfulActivityAtMs <= context.nowMs - threshold &&
      allowed(snapshot, goal.scope, "surface_neglected_work"))
      .map((goal) => {
        const target = refForWork(goal);
        return baseCandidate({
          snapshot, scope: goal.scope, groupId: goal.groupId,
          type: "surface_neglected_work", priority: goal.priority || "medium",
          ruleId: "neglected_active_goal", ruleVersion: 1, primary: target,
          action: {type: "review_entity", target},
          title: `Review active goal: ${goal.title}`,
          summary: "This active goal has not had a recent meaningful update.",
          rationale: "The last recorded activity is outside the 14-day lookback.",
          evidence: [{kind: "inactivity", label: "Last activity",
            valueNumber: goal.lastMeaningfulActivityAtMs}],
          score: goal.priority === "high" ? 78 : 68,
          timeBucket: getPlannerLocalDayKey(context.nowMs, context.timeZone),
          state: {id: goal.id, lastActivityAtMs: goal.lastMeaningfulActivityAtMs,
            status: "active"},
        });
      });
  });

export const stalledBoardCardRule = rule("high_priority_board_card_stalled",
  "move_board_card", (snapshot, context) =>
    snapshot.boardCards.filter((card) => !card.completed && !card.archived &&
      card.backlog && card.priority === "high" && card.relevantToCurrentUser &&
      allowed(snapshot, card.scope, "move_board_card"))
      .map((card) => {
        const target = refForWork(card);
        return baseCandidate({
          snapshot, scope: card.scope, groupId: card.groupId,
          type: "move_board_card", priority: "high",
          ruleId: "high_priority_board_card_stalled", ruleVersion: 1, primary: target,
          action: {type: "move_board_card", target, boardId: card.boardId,
            proposedColumnId: card.scope === "group" ? "in_progress" : "next"},
          title: `Review high-priority backlog card: ${card.title}`,
          summary: "A high-priority card remains in a backlog column.",
          rationale: "The board schema identifies the current column as backlog.",
          evidence: [{kind: "priority", label: "Priority", valueText: "high"},
            {kind: "inactivity", label: "Current column", valueText: card.columnId}],
          score: 80, timeBucket: getPlannerLocalDayKey(context.nowMs, context.timeZone),
          state: {id: card.id, boardId: card.boardId, columnId: card.columnId,
            priority: card.priority, updatedAtMs: card.updatedAtMs},
        });
      }));

export const routineConflictRule = rule("routine_occurrence_conflict",
  "routine_timing", (snapshot) => {
    const events = blockingEvents(snapshot);
    return snapshot.routineOccurrences.filter((occurrence) =>
      occurrence.schedulerStatus === "scheduled" &&
      !["completed", "skipped", "cancelled"].includes(occurrence.executionStatus) &&
      occurrence.assignedToCurrentUser &&
      allowed(snapshot, "group", "routine_timing"))
      .flatMap((occurrence) => {
        const conflicts = events.filter((event) =>
          event.id !== occurrence.generatedEventId &&
          event.linkedEntity?.id !== occurrence.id &&
          plannerIntervalsConflict(
            {startAtMs: occurrence.startAtMs, endAtMs: occurrence.endAtMs,
              sourceIds: [occurrence.id]},
            {startAtMs: event.startAtMs, endAtMs: event.endAtMs, sourceIds: [event.id]}));
        if (!conflicts.length) return [];
        const primary: PlannerEntityRef = {type: "routine_occurrence", id: occurrence.id,
          groupId: occurrence.groupId, routineId: occurrence.routineId};
        return [baseCandidate({
          snapshot, scope: "group", groupId: occurrence.groupId,
          type: "routine_timing", priority: "high",
          ruleId: "routine_occurrence_conflict", ruleVersion: 1, primary,
          related: conflicts.slice(0, 5).map(refForEvent),
          action: {type: "review_entity", target: primary},
          title: `Review routine timing: ${occurrence.title}`,
          summary: "This assigned routine occurrence overlaps another blocking event.",
          rationale: "The routine remains unchanged; this suggestion only requests review.",
          evidence: [{kind: "calendar_conflict", label: "Conflicting events",
            valueNumber: conflicts.length}],
          score: 95,
          timeBucket: getPlannerLocalDayKey(occurrence.startAtMs, snapshot.timeZone),
          state: {id: occurrence.id, startAtMs: occurrence.startAtMs,
            endAtMs: occurrence.endAtMs, conflicts: conflicts.map((item) => item.id).sort()},
        })];
      });
  });

export const PLANNER_HEURISTIC_RULES: PlannerHeuristicRule[] = [
  overdueUnscheduledRule, dueSoonUnscheduledRule, dueDateOverloadRule,
  calendarConflictRule, openWindowRule, neglectedGoalRule,
  stalledBoardCardRule, routineConflictRule,
];

const identity = (candidate: PlannerSuggestionCandidate) =>
  `${candidate.type}:${candidate.target.primary.type}:${candidate.target.primary.id}:` +
  `${candidate.source.timeBucket || ""}`;
export function suppressAndRankPlannerCandidates(candidates: PlannerSuggestionCandidate[],
  maxCandidates = PLANNER_GLOBAL_CANDIDATE_CAP) {
  const ordered = candidates.slice().sort((a, b) =>
    b.score - a.score || a.source.ruleId.localeCompare(b.source.ruleId) ||
    a.target.primary.id.localeCompare(b.target.primary.id) ||
    (a.source.timeBucket || "").localeCompare(b.source.timeBucket || ""));
  const byIdentity = new Map<string, PlannerSuggestionCandidate>();
  const concreteTargets = new Set(ordered.filter((item) =>
    item.proposedAction.type === "schedule_entity")
    .map((item) => `${item.target.primary.type}:${item.target.primary.id}`));
  const routineConflictTargets = new Set(ordered.filter((item) =>
    item.source.ruleId === "routine_occurrence_conflict")
    .map((item) => item.target.primary.id));
  for (const item of ordered) {
    const targetKey = `${item.target.primary.type}:${item.target.primary.id}`;
    if (item.proposedAction.type === "review_entity" &&
      item.type === "schedule_work" && concreteTargets.has(targetKey)) continue;
    if (item.source.ruleId === "due_soon_unscheduled_work" &&
      ordered.some((other) => other.source.ruleId === "overdue_unscheduled_work" &&
        other.target.primary.id === item.target.primary.id)) continue;
    if (item.source.ruleId === "calendar_conflict" &&
      (routineConflictTargets.has(item.target.primary.id) ||
      item.target.related.some((ref) => routineConflictTargets.has(ref.id)))) continue;
    const key = identity(item);
    if (!byIdentity.has(key)) byIdentity.set(key, item);
  }
  const perType = new Map<PlannerSuggestionType, number>();
  const result: PlannerSuggestionCandidate[] = [];
  for (const item of byIdentity.values()) {
    const count = perType.get(item.type) || 0;
    if (count >= 8) continue;
    perType.set(item.type, count + 1);
    result.push(item);
    if (result.length >= Math.max(0, maxCandidates)) break;
  }
  return result;
}
export function evaluatePlannerHeuristics(snapshot: PlannerInputSnapshot,
  context: PlannerEvaluationContext) {
  if (!snapshot.preferences.enabled) return [];
  const candidates = PLANNER_HEURISTIC_RULES.flatMap((item) =>
    item.evaluate(snapshot, context).slice(0, item.maxCandidates));
  return suppressAndRankPlannerCandidates(candidates,
    Math.min(context.maxCandidates, PLANNER_GLOBAL_CANDIDATE_CAP));
}
