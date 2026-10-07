import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {
  classifyPlannerAction,
  executeTrustedPlannerSuggestion,
  plannerIntervalsOverlap,
  PLANNER_EXECUTION_CALENDAR_LIMIT,
} from "../functions/lib/plannerActionExecution.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const ownerUid = "planner-execution-owner";
const now = Date.parse("2026-07-26T14:00:00Z");
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

eq(classifyPlannerAction("schedule_entity", "personal"), "executable",
  "personal scheduling executable");
eq(classifyPlannerAction("schedule_entity", "group"), "deferred",
  "group scheduling deferred");
eq(classifyPlannerAction("review_entity", "personal"), "navigation_only",
  "review navigation only");
for (const type of ["reschedule_entity", "set_priority", "set_due_date",
  "move_board_card", "create_focus_block"]) {
  eq(classifyPlannerAction(type, "personal"), "deferred", `${type} deferred`);
}
eq(classifyPlannerAction("unknown", "personal"), "informational_only",
  "unknown action fails closed");
eq(plannerIntervalsOverlap({startAtMs: 1, endAtMs: 2},
  {startAtMs: 2, endAtMs: 3}), false, "adjacent intervals do not overlap");
eq(plannerIntervalsOverlap({startAtMs: 1, endAtMs: 3},
  {startAtMs: 2, endAtMs: 4}), true, "half-open overlap detected");
eq(PLANNER_EXECUTION_CALENDAR_LIMIT, 250, "calendar validation is bounded");
const callableSource = readFileSync("functions/src/index.ts", "utf8");
const executionSource = readFileSync(
  "functions/src/plannerActionExecution.ts", "utf8");
ok(callableSource.includes("Object.keys(payload).length !== 1"),
  "callable rejects extra client fields");
ok(callableSource.includes("suggestionId: payload.suggestionId"),
  "callable forwards suggestion ID only");
ok(!executionSource.includes("collection(\"messages\")") &&
  !executionSource.includes("collection(\"comments\")") &&
  !executionSource.includes("pushTokens") &&
  !executionSource.includes("storagePath"),
"execution reads no forbidden collaboration, token, or media data");
ok(!callableSource.includes("logger.info(\"[Planner] action") &&
  !callableSource.includes("proposedAction:"),
"callable does not log action payload");

await db.doc(`users/${ownerUid}/settings/planner`).set({
  enabled: true, allowPersonalSuggestions: true,
  allowGroupSuggestions: true, hiddenSuggestionTypes: [], updatedAtMs: now,
});
const suggestion = (id, patch = {}) => ({
  id, ownerUid, scope: "personal", groupId: null, type: "schedule_work",
  status: "active", title: "Plan work", summary: "Open window",
  rationale: "No conflict existed.", evidence: [],
  target: {primary: {type: "goal", id: `goal-${id}`, ownerUid}, related: []},
  proposedAction: {
    type: "schedule_entity",
    target: {type: "goal", id: `goal-${id}`, ownerUid},
    proposedStartAtMs: now + 60 * 60_000,
    proposedEndAtMs: now + 90 * 60_000,
    timeZone: "UTC",
  },
  source: {type: "deterministic_rule",
    ruleId: "open_window_scheduling_opportunity", ruleVersion: 1,
    generatedBy: "server", inputFingerprint: "input", timeBucket: "day"},
  generatedAtMs: now - 1000, expiresAtMs: now + 24 * 60 * 60_000,
  snoozedUntilMs: null, acceptedAtMs: null, actedAtMs: null,
  createdAtMs: now - 1000, updatedAtMs: now - 1000, ...patch,
});
async function seed(id, suggestionPatch = {}, targetPatch = {}) {
  const value = suggestion(id, suggestionPatch);
  const target = value.proposedAction.target;
  const goalId = target.type === "subtask" ? target.goalId : target.id;
  await Promise.all([
    db.doc(`users/${ownerUid}/plannerSuggestions/${id}`).set(value),
    db.doc(`goals/${goalId}`).set({
      id: goalId, userId: ownerUid, title: `Current ${id}`,
      status: "active", archived: false, createdAtMs: now, updatedAtMs: now,
      ...targetPatch,
    }),
  ]);
}

await seed("concurrent");
const started = Date.now();
const concurrent = await Promise.all(Array.from({length: 10}, () =>
  executeTrustedPlannerSuggestion({
    firestore: db, ownerUid, suggestionId: "concurrent", nowMs: now,
  })));
ok(concurrent.every((item) =>
  ["applied", "already_applied"].includes(item.status)),
"all concurrent callers receive idempotent success");
eq(concurrent.filter((item) => item.status === "applied").length, 1,
  "ten concurrent calls execute once");
const event = await db.doc(
  "planningCalendarEvents/planner_concurrent"
).get();
ok(event.exists, "deterministic calendar event created");
eq(event.data().ownerUid, ownerUid, "calendar owner is caller");
eq(event.data().scope, "personal", "personal event created");
eq(event.data().visibility, "private", "calendar event is private");
eq(event.data().title, "Current concurrent", "authoritative target title used");
eq(event.data().plannerSuggestionId, "concurrent", "suggestion marker stored");
eq(event.data().plannerExecutionId, "concurrent", "execution marker stored");
eq(event.data().groupId, null, "no group event created");
ok(!("attendees" in event.data()), "no attendees added");
const accepted = await db.doc(
  `users/${ownerUid}/plannerSuggestions/concurrent`
).get();
eq(accepted.data().status, "accepted", "suggestion accepted after creation");
eq(accepted.data().acceptedByUid, ownerUid, "accepting actor recorded");
const execution = await db.doc(
  `users/${ownerUid}/plannerSuggestionExecutions/concurrent`
).get();
eq(execution.data().status, "completed", "execution completed");
eq(execution.data().targetId, "planner_concurrent", "execution target recorded");
eq((await db.collection("planningCalendarEvents")
  .where("plannerSuggestionId", "==", "concurrent").get()).size, 1,
"only one target event exists");
const concurrentHistory = await db.collection(
  `users/${ownerUid}/historyEvents`
).where("sourceEventId", "==", "planner_execution:concurrent").get();
eq(concurrentHistory.size, 1, "ten concurrent executions write one history fact");
const historyData = concurrentHistory.docs[0].data();
eq(historyData.eventType, "planner_suggestion_applied",
  "trusted planner event type recorded");
eq(historyData.displayTitle, "Current concurrent",
  "history snapshots authoritative target title");
ok(!("evidence" in historyData) && !("proposedAction" in historyData),
  "history excludes planner evidence and action payload");
ok(Date.now() - started < 10_000, "ten-way emulator execution completes promptly");

await seed("adjacent", {
  proposedAction: {
    type: "schedule_entity",
    target: {type: "goal", id: "goal-adjacent", ownerUid},
    proposedStartAtMs: now + 2 * 60 * 60_000,
    proposedEndAtMs: now + 150 * 60_000,
    timeZone: "UTC",
  },
});
await db.doc("planningCalendarEvents/adjacent-busy").set({
  id: "adjacent-busy", ownerUid, scope: "personal", type: "personal",
  visibility: "private", title: "Adjacent", startAtMs: now + 150 * 60_000,
  endAtMs: now + 180 * 60_000, archived: false, blocksTime: true,
  createdByUid: ownerUid, createdAtMs: now, updatedAtMs: now,
});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "adjacent", nowMs: now,
})).status, "applied", "adjacent calendar event does not conflict");

await seed("conflict", {
  proposedAction: {
    type: "schedule_entity",
    target: {type: "goal", id: "goal-conflict", ownerUid},
    proposedStartAtMs: now + 4 * 60 * 60_000,
    proposedEndAtMs: now + 270 * 60_000,
    timeZone: "UTC",
  },
});
await db.doc("planningCalendarEvents/conflicting-busy").set({
  id: "conflicting-busy", ownerUid, scope: "personal", type: "personal",
  visibility: "private", title: "Busy", startAtMs: now + 250 * 60_000,
  endAtMs: now + 300 * 60_000, archived: false, blocksTime: true,
  createdByUid: ownerUid, createdAtMs: now, updatedAtMs: now,
});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "conflict", nowMs: now,
})).status, "calendar_conflict_detected", "new conflict rejects action");
eq((await db.doc("planningCalendarEvents/planner_conflict").get()).exists,
  false, "conflict creates no event");
eq((await db.collection(`users/${ownerUid}/historyEvents`)
  .where("sourceEventId", "==", "planner_execution:conflict").get()).size,
0, "conflict creates no history");
eq((await db.doc(`users/${ownerUid}/plannerSuggestions/conflict`).get())
  .data().status, "invalidated", "stale suggestion invalidated");

await seed("completed", {}, {status: "completed"});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "completed", nowMs: now,
})).status, "stale_evidence", "completed target rejected");
eq((await db.doc("planningCalendarEvents/planner_completed").get()).exists,
  false, "completed target creates no event");

await seed("snoozed", {status: "snoozed", snoozedUntilMs: now + 60_000});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "snoozed", nowMs: now,
})).status, "suggestion_snoozed", "active snooze rejected");
await seed("expired", {expiresAtMs: now});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "expired", nowMs: now,
})).status, "suggestion_expired", "effective expiration rejected");
await seed("group", {scope: "group", groupId: "group-1",
  proposedAction: {
    type: "schedule_entity",
    target: {type: "goal", id: "goal-group", ownerUid, groupId: "group-1"},
    proposedStartAtMs: now + 60 * 60_000,
    proposedEndAtMs: now + 90 * 60_000, timeZone: "UTC",
  }});
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "group", nowMs: now,
})).status, "unsupported_action", "group-derived action deferred");
eq((await executeTrustedPlannerSuggestion({
  firestore: db, ownerUid, suggestionId: "missing", nowMs: now,
})).status, "suggestion_not_found", "missing suggestion is safe");

console.log(`Planner action execution QA passed (${checks} checks).`);
