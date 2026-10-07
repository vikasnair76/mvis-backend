import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filterEffectivePlannerSuggestions,
  formatPlannerAction,
  formatPlannerEvidence,
  getPlannerSnoozePresets,
  getPlannerSuggestionPresentation,
  matchesPlannerContext,
  resolvePlannerNavigationTarget,
} from "../services/plannerPresentation";
import {
  canExecutePlannerSuggestion,
  type PlannerSuggestionDoc,
} from "../services/plannerSuggestions";

let checks = 0;
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1; };
const now = Date.parse("2026-07-25T16:00:00Z");
const target = {type: "subtask" as const, id: "task-a", goalId: "goal-a", ownerUid: "u1"};
const suggestion = (patch: Partial<PlannerSuggestionDoc> = {}): PlannerSuggestionDoc => ({
  id: "suggestion-a", ownerUid: "u1", scope: "personal", groupId: null,
  type: "schedule_work", status: "active", priority: "high",
  confidence: {level: "high", score: 0.8}, title: "Plan task",
  summary: "This task needs time.", rationale: "Due soon.",
  evidence: [{kind: "due_date", label: "Due", valueNumber: now + 86_400_000}],
  target: {primary: target, related: []},
  proposedAction: {type: "review_entity", target},
  source: {type: "deterministic_rule", ruleId: "due_soon_unscheduled_work",
    ruleVersion: 1, generatedBy: "server", inputFingerprint: "hidden",
    timeBucket: "hidden"}, dedupeKey: "hidden", generationRunId: null,
  generatedAtMs: now, expiresAtMs: now + 7 * 86_400_000,
  snoozedUntilMs: null, viewedAtMs: null, actedAtMs: null, acceptedAtMs: null,
  acceptedByUid: null, executionResult: null,
  dismissedAtMs: null, dismissalReason: null, expiredAtMs: null,
  archivedAtMs: null, invalidatedAtMs: null, invalidationReason: null,
  notifiedAtMs: null, notificationBatchId: null,
  createdAtMs: now, updatedAtMs: now, ...patch,
});

for (const [ruleId, label] of [
  ["overdue_unscheduled_work", "Overdue work"],
  ["due_soon_unscheduled_work", "Due soon"],
  ["due_date_overload", "Busy deadline"],
  ["calendar_conflict", "Schedule conflict"],
  ["open_window_scheduling_opportunity", "Open time"],
  ["neglected_active_goal", "Goal check-in"],
  ["high_priority_board_card_stalled", "Board follow-up"],
  ["routine_occurrence_conflict", "Routine conflict"],
]) eq(getPlannerSuggestionPresentation(ruleId).label, label, `${ruleId} presentation`);
eq(getPlannerSuggestionPresentation("future_rule").label, "Planning suggestion",
  "unknown rule fallback");
ok(formatPlannerEvidence(suggestion().evidence[0], "America/New_York")?.startsWith("Due:"),
  "date evidence formatted");
eq(formatPlannerEvidence({kind: "overdue", label: "Late", valueNumber: 3},
  "UTC"), "3 days overdue", "overdue evidence");
eq(formatPlannerEvidence({kind: "workload", label: "Items", valueNumber: 4},
  "UTC"), "Items: 4", "workload evidence");
eq(formatPlannerEvidence({kind: "assignment", label: "Assigned"},
  "UTC"), "Assigned", "missing evidence value safe");
eq(formatPlannerAction({type: "review_entity", target}, "UTC"),
  "Review the related work.", "review action");
ok(formatPlannerAction({type: "schedule_entity", target, proposedStartAtMs: now,
  proposedEndAtMs: now + 30 * 60_000, timeZone: "UTC"}, "UTC")
  .startsWith("Consider scheduling"), "schedule action");
ok(!formatPlannerAction(suggestion().proposedAction, "UTC").includes("{"),
  "no raw action JSON");

eq(resolvePlannerNavigationTarget({type: "goal", id: "goal-a"}), "/goal/goal-a",
  "goal navigation");
eq(resolvePlannerNavigationTarget(target),
  "/goal/goal-a?highlightSubtaskId=task-a", "subtask navigation");
eq(resolvePlannerNavigationTarget({type: "board_card", id: "card-a",
  boardId: "board-a"}), "/board/board-a", "board navigation");
eq(resolvePlannerNavigationTarget({type: "calendar_event", id: "event-a"}),
  "/calendar", "personal calendar navigation");
eq(resolvePlannerNavigationTarget({type: "calendar_event", id: "event-a",
  groupId: "group-a"}), "/group/group-a/calendar", "group calendar navigation");
eq(resolvePlannerNavigationTarget({type: "routine_occurrence", id: "occ-a",
  groupId: "group-a", routineId: "routine-a"}),
  "/group/group-a/routine-occurrence/occ-a", "occurrence navigation");
eq(resolvePlannerNavigationTarget(undefined), null, "missing target fallback");

eq(matchesPlannerContext(suggestion(), {goalId: "goal-a"}), true, "goal context");
eq(matchesPlannerContext(suggestion(), {goalId: "other"}), false, "wrong goal excluded");
eq(matchesPlannerContext(suggestion({scope: "group", groupId: "group-a",
  target: {primary: {...target, groupId: "group-a"}, related: []}}),
{groupId: "group-a"}), true, "group context");
eq(matchesPlannerContext(suggestion(), {groupId: "group-a"}), false,
  "wrong group excluded");

eq(filterEffectivePlannerSuggestions([suggestion()], "active", now).length, 1,
  "active included");
eq(filterEffectivePlannerSuggestions([suggestion({expiresAtMs: now})], "active", now).length,
  0, "effectively expired excluded");
eq(filterEffectivePlannerSuggestions([suggestion({status: "snoozed",
  snoozedUntilMs: now + 1000})], "snoozed", now).length, 1, "future snooze included");
eq(filterEffectivePlannerSuggestions([suggestion({status: "snoozed",
  snoozedUntilMs: now - 1})], "active", now).length, 1, "due snooze effectively active");

const presets = getPlannerSnoozePresets(now, "America/New_York");
eq(presets.length, 4, "bounded snooze presets");
ok(presets.every((item) => item.atMs > now), "snooze presets future");
eq(new Set(presets.map((item) => item.id)).size, presets.length, "snooze IDs stable");
const executable = suggestion({
  source: {type: "deterministic_rule",
    ruleId: "open_window_scheduling_opportunity", ruleVersion: 1,
    generatedBy: "server", inputFingerprint: null, timeBucket: "day"},
  proposedAction: {type: "schedule_entity", target,
    proposedStartAtMs: now + 60_000, proposedEndAtMs: now + 31 * 60_000,
    timeZone: "America/New_York"},
});
ok(canExecutePlannerSuggestion(executable, now), "supported active action executable");
ok(!canExecutePlannerSuggestion({...executable, scope: "group", groupId: "g1"},
  now), "group action not executable");
ok(!canExecutePlannerSuggestion({...executable, status: "snoozed",
  snoozedUntilMs: now + 60_000}, now), "snoozed action not executable");
ok(!canExecutePlannerSuggestion(suggestion(), now), "review action not executable");

const service = readFileSync("services/plannerSuggestions.ts", "utf8");
const screen = readFileSync("app/planner/index.tsx", "utf8");
const card = readFileSync("components/planner/PlannerSuggestionCard.tsx", "utf8");
const preview = readFileSync("components/planner/PlannerContextPreview.tsx", "utf8");
ok(service.includes("limit(safeSize + 1)"), "history page bounded");
ok(service.includes("startAfter(cursor)"), "history cursor pagination");
ok(service.includes("httpsCallable") && service.includes("\"requestPlannerRefresh\""),
  "manual refresh uses callable");
ok(!screen.includes("plannerGenerationRequests"), "UI does not write queue");
ok(!screen.includes("plannerScheduleState"), "UI does not read schedule state");
ok(!screen.includes("plannerGenerationRuns"), "UI does not read generation runs");
ok(!card.includes("JSON.stringify"), "card never renders raw JSON");
ok(!card.includes("Accept"), "no accept action");
ok(card.includes("Review & apply"), "explicit apply control exists");
ok(screen.includes("Apply this suggestion?"), "apply confirmation required");
ok(screen.includes("executePlannerSuggestion(item.id)"),
  "client sends suggestion ID only");
ok(!screen.includes("acceptPlannerSuggestion"), "no direct accepted write");
ok(!screen.includes("createPlanningCalendarEvent"), "no direct calendar mutation");
const settings = readFileSync("app/(tabs)/settings.tsx", "utf8");
ok(settings.includes("Planner notifications"), "Planner notification settings visible");
ok(settings.includes("conflictNotificationsEnabled") &&
  settings.includes("opportunityNotificationsEnabled"),
"supported notification categories exposed");
ok(preview.includes("slice(0, 2)"), "context preview capped");
ok(screen.includes("FlatList"), "virtualized center list");
ok(screen.includes("accessibilityState={{selected:"), "segment accessibility");
ok(card.includes("accessibilityState={{expanded}}"), "evidence accessibility");

console.log(`Planner UI QA passed: ${checks} checks.`);
