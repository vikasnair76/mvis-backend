import assert from "node:assert/strict";
import {
  buildPlannerInputSnapshot,
  buildPlannerWindow,
  findPlannerFreeWindows,
  getPlannerDayEndMs,
  getPlannerDayStartMs,
  getPlannerLocalDayKey,
  getPlannerLocalWeekKey,
  mergePlannerIntervals,
  normalizePlannerInterval,
  plannerIntervalsConflict,
  PLANNER_SOURCE_LIMITS,
} from "../functions/lib/plannerSnapshot.js";
import {
  calendarConflictRule,
  dueDateOverloadRule,
  dueSoonUnscheduledRule,
  evaluatePlannerHeuristics,
  neglectedGoalRule,
  openWindowRule,
  overdueUnscheduledRule,
  routineConflictRule,
  stalledBoardCardRule,
  suppressAndRankPlannerCandidates,
} from "../functions/lib/plannerHeuristics.js";
import {plannerCandidateToTrustedInput}
  from "../functions/lib/plannerGeneration.js";
import {buildTrustedPlannerSuggestionWrite}
  from "../functions/lib/plannerSuggestionFoundation.js";

let assertions = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); assertions += 1;
};
const ok = (value, message) => {
  assert.ok(value, message); assertions += 1;
};
const zone = "America/New_York";
const now = Date.parse("2026-03-07T17:00:00.000Z");
const day = 86_400_000;
const source = (id, data) => ({id, data});
const baseSources = {
  preferences: {enabled: true, allowPersonalSuggestions: true,
    allowGroupSuggestions: true, hiddenSuggestionTypes: []},
  goals: [source("goal-a", {userId: "u1", title: "Goal A", status: "active",
    createdAtMs: now - 30 * day, updatedAtMs: now - 20 * day})],
  subtasks: [
    source("overdue", {goalId: "goal-a", userId: "u1", title: "Overdue",
      dueAtMs: now - 2 * day, createdAtMs: now - 5 * day, priority: "high"}),
    source("soon", {goalId: "goal-a", userId: "u1", title: "Soon",
      dueAtMs: now + day, createdAtMs: now - day, priority: "medium"}),
  ],
  boardCards: [source("card-a", {boardId: "board-a", ownerUid: "u1",
    title: "Urgent card", columnId: "ideas", priority: "high",
    createdAtMs: now - day, updatedAtMs: now - day})],
  calendarEvents: [
    source("event-a", {ownerUid: "u1", title: "One",
      startAtMs: now + 60 * 60_000, endAtMs: now + 2 * 60 * 60_000}),
    source("event-b", {ownerUid: "u1", title: "Two",
      startAtMs: now + 90 * 60_000, endAtMs: now + 3 * 60 * 60_000}),
  ],
  routines: [source("routine-a", {groupId: "g1", title: "Routine",
    status: "active", participantUids: ["u1"], updatedAtMs: now})],
  routineOccurrences: [source("occ-a", {routineId: "routine-a", groupId: "g1",
    routineTitleSnapshot: "Routine", startAtMs: now + 60 * 60_000,
    endAtMs: now + 2 * 60 * 60_000, status: "scheduled",
    executionStatus: "scheduled", participantUids: ["u1"],
    calendarProjectionId: "projection-a"})],
  authoritativeSources: ["goals", "subtasks", "boardCards", "calendarEvents",
    "routines", "routineOccurrences", "memberships"],
};
const snapshot = buildPlannerInputSnapshot({
  ownerUid: "u1", generatedAtMs: now, timeZone: zone, sources: baseSources,
});
const context = {nowMs: now, timeZone: zone, maxCandidates: 25};

check(snapshot.metadata.version, 1, "snapshot version");
check(snapshot.timeZone, zone, "time zone");
check(snapshot.goals.length, 1, "goal normalization");
check(snapshot.subtasks.length, 2, "subtask normalization");
check(snapshot.boardCards[0].completed, false, "board terminal semantics");
check(snapshot.boardCards[0].backlog, true, "board backlog semantics");
check(snapshot.calendarEvents.length, 2, "calendar normalization");
check(snapshot.routines[0].currentUserParticipant, true, "participant minimization");
check(snapshot.routineOccurrences[0].assignedToCurrentUser, true, "occurrence relevance");
ok(!("description" in snapshot.goals[0]), "goal private description excluded");
ok(!("note" in snapshot.routineOccurrences[0]), "check-in note excluded");

const malformed = buildPlannerInputSnapshot({ownerUid: "u1", generatedAtMs: now,
  timeZone: "bad-zone", sources: {
    goals: [source("bad/id", {userId: "u1"}), source("valid", {
      userId: "u1", title: "", status: "active", createdAtMs: now})],
    calendarEvents: [source("bad-event", {ownerUid: "u1", startAtMs: 5, endAtMs: 4})],
  }});
check(malformed.timeZone, "UTC", "invalid zone fallback");
check(malformed.goals.length, 1, "invalid id isolated");
check(malformed.goals[0].title, "Untitled goal", "blank title safe");
check(malformed.calendarEvents.length, 0, "invalid interval rejected");

const duplicate = buildPlannerInputSnapshot({ownerUid: "u1", generatedAtMs: now,
  timeZone: zone, sources: {goals: [
    source("same", {userId: "u1", title: "First", status: "active"}),
    source("same", {userId: "u1", title: "Second", status: "active"}),
  ]}});
check(duplicate.goals.length, 1, "duplicate source dedupe");
check(duplicate.goals[0].title, "Second", "deterministic duplicate policy");

const capped = buildPlannerInputSnapshot({ownerUid: "u1", generatedAtMs: now,
  timeZone: zone, sources: {goals: Array.from({length: 130}, (_, index) =>
    source(`g-${String(index).padStart(3, "0")}`, {userId: "u1", title: "G",
      status: "active"})), truncatedSources: ["goals_limit"]}});
check(capped.goals.length, PLANNER_SOURCE_LIMITS.goals, "goal cap");
check(capped.metadata.truncated, true, "truncation visible");
check(capped.metadata.truncationReasons, ["goals_limit"], "truncation reason");

check(getPlannerLocalDayKey(now, zone), "2026-03-07", "local day");
check(getPlannerLocalWeekKey(now, zone), "2026-W10", "local week");
const dstStart = getPlannerDayStartMs(Date.parse("2026-03-08T17:00:00Z"), zone);
const dstEnd = getPlannerDayEndMs(Date.parse("2026-03-08T17:00:00Z"), zone);
check(dstEnd - dstStart, 23 * 60 * 60_000, "DST spring day");
const dstFallStart = getPlannerDayStartMs(Date.parse("2026-11-01T17:00:00Z"), zone);
const dstFallEnd = getPlannerDayEndMs(Date.parse("2026-11-01T17:00:00Z"), zone);
check(dstFallEnd - dstFallStart, 25 * 60 * 60_000, "DST fall day");
const window = buildPlannerWindow(now, zone);
ok(window.startAtMs < now && window.endAtMs > now, "bounded window");

check(normalizePlannerInterval({startAtMs: 5, endAtMs: 4}), null,
  "negative duration rejected");
const adjacentA = {startAtMs: 0, endAtMs: 10, sourceIds: ["a"]};
const adjacentB = {startAtMs: 10, endAtMs: 20, sourceIds: ["b"]};
check(plannerIntervalsConflict(adjacentA, adjacentB), false, "adjacent not conflict");
check(mergePlannerIntervals([adjacentB, adjacentA]).length, 1,
  "adjacent busy intervals merge");
const free = findPlannerFreeWindows({busy: [{startAtMs: 20, endAtMs: 30,
  sourceIds: []}], rangeStartAtMs: 0, rangeEndAtMs: 50, minimumDurationMs: 10});
check(free.map((item) => [item.startAtMs, item.endAtMs]), [[0, 20], [30, 50]],
  "free windows");

const overdue = overdueUnscheduledRule.evaluate(snapshot, context);
check(overdue.length, 1, "overdue rule");
check(overdue[0].proposedAction.type, "review_entity", "no invented overdue time");
check(overdue[0].confidence.level, "high", "direct confidence");
const dueSoon = dueSoonUnscheduledRule.evaluate(snapshot, context);
check(dueSoon.length, 1, "due soon excludes overdue");
const stalled = stalledBoardCardRule.evaluate(snapshot, context);
check(stalled.length, 1, "stalled card rule");
check(stalled[0].proposedAction.type, "move_board_card", "declarative card action");
const neglected = neglectedGoalRule.evaluate(snapshot, context);
check(neglected.length, 1, "neglected goal rule");
ok(!neglected[0].summary.includes("forgot"), "neutral neglected copy");
const conflict = calendarConflictRule.evaluate(snapshot, context);
check(conflict.length, 1, "calendar conflict");
check(conflict[0].proposedAction.type, "review_entity", "conflict no invented time");
const routineConflict = routineConflictRule.evaluate(snapshot, context);
check(routineConflict.length, 1, "routine conflict");
check(routineConflict[0].proposedAction.type, "review_entity", "routine remains advisory");
const open = openWindowRule.evaluate(snapshot, context);
ok(open.length > 0, "open window rule");
check(open[0].proposedAction.type, "schedule_entity", "concrete open window action");

const overloadedSources = {...baseSources, subtasks: Array.from({length: 4},
  (_, index) => source(`load-${index}`, {goalId: "goal-a", userId: "u1",
    title: `Load ${index}`, dueAtMs: now + day, createdAtMs: now}))};
const overloaded = buildPlannerInputSnapshot({ownerUid: "u1", generatedAtMs: now,
  timeZone: zone, sources: overloadedSources});
check(dueDateOverloadRule.evaluate(overloaded, context).length, 1,
  "one overload candidate per day");
const truncatedOverload = {...overloaded,
  metadata: {...overloaded.metadata, truncated: true,
    truncationReasons: ["subtasks_limit"]}};
check(dueDateOverloadRule.evaluate(truncatedOverload, context).length, 0,
  "complete-data rule skips truncation");

const hidden = {...snapshot, preferences: {...snapshot.preferences,
  hiddenSuggestionTypes: ["schedule_work"]}};
check(overdueUnscheduledRule.evaluate(hidden, context).length, 0, "hidden type");
const disabled = {...snapshot, preferences: {...snapshot.preferences, enabled: false}};
check(evaluatePlannerHeuristics(disabled, context).length, 0, "planner disabled");
const personalOff = {...snapshot, preferences: {...snapshot.preferences,
  allowPersonalSuggestions: false}};
check(overdueUnscheduledRule.evaluate(personalOff, context).length, 0,
  "personal scope disabled");

const evaluatedA = evaluatePlannerHeuristics(snapshot, context);
const reordered = buildPlannerInputSnapshot({ownerUid: "u1", generatedAtMs: now,
  timeZone: zone, sources: {...baseSources,
    subtasks: [...baseSources.subtasks].reverse(),
    calendarEvents: [...baseSources.calendarEvents].reverse()}});
const evaluatedB = evaluatePlannerHeuristics(reordered, context);
check(evaluatedA, evaluatedB, "input ordering invariant");
ok(evaluatedA.length <= 25, "global cap");
ok(evaluatedA.every((item) => item.score >= 0 && item.score <= 100),
  "bounded internal score");
ok(evaluatedA.every((item) => item.evidence.length > 0), "evidence required");
ok(evaluatedA.every((item) => item.proposedAction), "action required");

const generic = overdue[0];
const concrete = {...generic, score: generic.score + 1,
  proposedAction: {type: "schedule_entity", target: generic.target.primary,
    proposedStartAtMs: now + day, proposedEndAtMs: now + day + 30 * 60_000,
    timeZone: zone}};
check(suppressAndRankPlannerCandidates([generic, concrete]).length, 1,
  "concrete suppresses generic");
check(suppressAndRankPlannerCandidates(Array(40).fill(0).map((_, index) =>
  ({...generic, target: {primary: {...generic.target.primary, id: `x-${index}`},
    related: []}, score: 100 - index}))).length, 8, "per-type cap");

const trusted = plannerCandidateToTrustedInput(evaluatedA[0],
  {generationRunId: "run-a", nowMs: now});
const writeA = buildTrustedPlannerSuggestionWrite(trusted);
const writeB = buildTrustedPlannerSuggestionWrite({...trusted,
  generationRunId: "run-b", generatedAtMs: now + 1000, updatedAtMs: now + 1000});
check(writeA.id, writeB.id, "generation metadata excluded from identity");
check(writeA.data.dedupeKey, writeB.data.dedupeKey, "stable dedupe key");
check(writeA.data.source.inputFingerprint,
  evaluatedA[0].source.inputFingerprint, "fingerprint preserved");
check(writeA.data.source.ruleId, evaluatedA[0].source.ruleId, "rule id preserved");
check(writeA.data.source.ruleVersion, 1, "rule version preserved");
check(writeA.data.source.timeBucket, evaluatedA[0].source.timeBucket,
  "time bucket preserved");
ok(!("score" in writeA.data), "internal score not persisted");

const performanceSources = {
  ...baseSources,
  goals: Array.from({length: 100}, (_, index) => source(`goal-${index}`, {
    userId: "u1", title: `Goal ${index}`, status: "active",
    createdAtMs: now - index * day, updatedAtMs: now - index * day})),
  subtasks: Array.from({length: 250}, (_, index) => source(`task-${index}`, {
    goalId: `goal-${index % 100}`, userId: "u1", title: `Task ${index}`,
    dueAtMs: now + (index % 14 + 1) * day, priority: index % 5 ? "medium" : "high",
    createdAtMs: now - index})),
  boardCards: Array.from({length: 200}, (_, index) => source(`card-${index}`, {
    boardId: `board-${index % 20}`, ownerUid: "u1", title: `Card ${index}`,
    columnId: index % 4 ? "active" : "ideas", priority: index % 7 ? "medium" : "high",
    updatedAtMs: now - index})),
  calendarEvents: Array.from({length: 250}, (_, index) => source(`event-${index}`, {
    ownerUid: "u1", title: "Busy", startAtMs: now + index * 45 * 60_000,
    endAtMs: now + index * 45 * 60_000 + 30 * 60_000})),
  routines: Array.from({length: 100}, (_, index) => source(`routine-${index}`, {
    groupId: `group-${index % 20}`, title: "Routine", status: "active",
    participantUids: ["u1"], updatedAtMs: now})),
  routineOccurrences: Array.from({length: 200}, (_, index) => source(`occ-${index}`, {
    routineId: `routine-${index % 100}`, groupId: `group-${index % 20}`,
    routineTitleSnapshot: "Routine", startAtMs: now + index * 60 * 60_000,
    endAtMs: now + index * 60 * 60_000 + 30 * 60_000,
    status: "scheduled", executionStatus: "scheduled", participantUids: ["u1"]})),
};
const started = performance.now();
const performanceSnapshot = buildPlannerInputSnapshot({ownerUid: "u1",
  generatedAtMs: now, timeZone: zone, sources: performanceSources});
const perfA = evaluatePlannerHeuristics(performanceSnapshot, context);
const perfB = evaluatePlannerHeuristics(performanceSnapshot, context);
const elapsed = performance.now() - started;
check(perfA, perfB, "performance fixture deterministic");
ok(perfA.length <= 25, "performance fixture capped");
ok(elapsed < 5000, `performance fixture completes (${elapsed.toFixed(1)} ms)`);

console.log(`Planner snapshot/heuristics QA passed: ${assertions} assertions.`);
console.log(`Performance fixture: 100 goals, 250 subtasks, 200 cards, 250 events, ` +
  `100 routines, 200 occurrences in ${elapsed.toFixed(1)} ms.`);
