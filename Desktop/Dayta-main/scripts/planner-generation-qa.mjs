import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {generatePlannerSuggestions}
  from "../functions/lib/plannerGeneration.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const ownerUid = "planner-generation-owner";
const now = Date.parse("2026-07-25T16:00:00.000Z");
let assertions = 0;
const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); assertions += 1;
};
const ok = (value, message) => {
  assert.ok(value, message); assertions += 1;
};

await Promise.all([
  db.doc(`users/${ownerUid}`).set({uid: ownerUid, timeZone: "America/New_York"}),
  db.doc(`users/${ownerUid}/settings/planner`).set({
    enabled: true, allowPersonalSuggestions: true,
    allowGroupSuggestions: true, hiddenSuggestionTypes: [], updatedAtMs: now,
  }),
  db.doc("goals/planner-goal").set({
    userId: ownerUid, title: "Planner goal", status: "active",
    createdAtMs: now - 30 * 86_400_000, updatedAtMs: now - 20 * 86_400_000,
  }),
  db.doc("goals/planner-goal/subtasks/planner-task").set({
    goalId: "planner-goal", userId: ownerUid, title: "Overdue task",
    dueAtMs: now - 2 * 86_400_000, priority: "high",
    scheduleType: "oneTime", createdAtMs: now - 10 * 86_400_000,
    updatedAtMs: now - 10 * 86_400_000, firstCompletedAtMs: null,
  }),
  db.doc("planningBoards/planner-board").set({
    id: "planner-board", ownerUid, scope: "personal", archived: false,
    title: "Planner board", columns: [], createdAtMs: now, updatedAtMs: now,
  }),
  db.doc("planningBoards/planner-board/cards/planner-card").set({
    id: "planner-card", boardId: "planner-board", ownerUid,
    title: "Urgent idea", columnId: "ideas", priority: "high",
    archived: false, createdAtMs: now, updatedAtMs: now,
  }),
  db.doc("planningCalendarEvents/planner-event").set({
    id: "planner-event", ownerUid, scope: "personal", type: "personal",
    title: "Busy", startAtMs: now + 2 * 60 * 60_000,
    endAtMs: now + 3 * 60 * 60_000, archived: false,
    createdAtMs: now, updatedAtMs: now,
  }),
]);

const first = await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now, runId: "run-1", trigger: "test",
});
check(first.status, "completed", "first run completes");
ok(first.suggestionsCreated > 0, "first run creates suggestions");
check(first.failureCode, null, "no failure code");
const firstSuggestions = await db.collection(`users/${ownerUid}/plannerSuggestions`).get();
check(firstSuggestions.size, first.suggestionsCreated, "created count exact");
ok(firstSuggestions.size <= 25, "bounded suggestion writes");
ok(firstSuggestions.docs.every((item) => !("score" in item.data())),
  "internal score is not persisted");
ok(firstSuggestions.docs.every((item) =>
  !JSON.stringify(item.data()).includes("description")),
  "private descriptions absent");

const second = await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now + 1000, runId: "run-2", trigger: "test",
});
check(second.status, "completed", "second run completes");
check(second.suggestionsCreated, 0, "same state creates no new suggestions");
check(second.suggestionsReused, firstSuggestions.size, "same state reused");
const secondSuggestions = await db.collection(`users/${ownerUid}/plannerSuggestions`).get();
check(secondSuggestions.size, firstSuggestions.size, "same state no duplicates");

const taskSuggestion = secondSuggestions.docs.find((item) =>
  item.data().target?.primary?.id === "planner-task");
ok(taskSuggestion, "task suggestion exists");
await taskSuggestion.ref.update({
  status: "accepted", acceptedAtMs: now + 1500, actedAtMs: now + 1500,
  updatedAtMs: now + 1500,
});
const third = await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now + 2000, runId: "run-3", trigger: "test",
});
check(third.status, "completed", "terminal rerun completes");
const terminal = await taskSuggestion.ref.get();
check(terminal.data().status, "accepted", "accepted suggestion not resurrected");
check(terminal.data().acceptedAtMs, now + 1500, "terminal metadata preserved");

const activeBeforeChange = secondSuggestions.docs.find((item) =>
  item.data().status === "active" && item.data().target?.primary?.id === "planner-card");
ok(activeBeforeChange, "active card suggestion exists");
await activeBeforeChange.ref.update({viewedAtMs: now + 2500, updatedAtMs: now + 2500});
await db.doc("planningBoards/planner-board/cards/planner-card")
  .update({updatedAtMs: now + 3000});
await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now + 3000, runId: "run-4", trigger: "test",
});
const refreshed = await activeBeforeChange.ref.get();
check(refreshed.data().viewedAtMs, now + 2500, "viewed state preserved on refresh");

await db.doc("planningBoards/planner-board/cards/planner-card")
  .update({columnId: "completed", updatedAtMs: now + 4000});
const invalidating = await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now + 4000, runId: "run-5", trigger: "test",
});
ok(invalidating.suggestionsInvalidated > 0, "stale active suggestion invalidated");
const invalidated = await activeBeforeChange.ref.get();
check(invalidated.data().status, "invalidated", "completed target invalidated");
check(invalidated.data().invalidationReason, "target_changed",
  "safe invalidation reason");

await db.doc(`users/${ownerUid}/settings/planner`).update({enabled: false});
const disabled = await generatePlannerSuggestions({
  firestore: db, ownerUid, nowMs: now + 5000, runId: "run-disabled", trigger: "test",
});
check(disabled.status, "skipped", "disabled planner skipped");
check(disabled.failureCode, "planner_disabled", "disabled code");

const run = await db.doc(`users/${ownerUid}/plannerGenerationRuns/run-1`).get();
check(run.data().status, "completed", "run metadata completed");
ok(!("snapshot" in run.data()), "full snapshot not persisted");
ok(!("candidates" in run.data()), "candidate payloads not persisted");
ok(run.data().sourceCounts, "safe source counts persisted");

console.log(`Planner generation QA passed: ${assertions} assertions.`);
