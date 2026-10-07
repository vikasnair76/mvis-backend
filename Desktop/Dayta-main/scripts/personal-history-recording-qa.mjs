import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  buildTrustedPersonalHistoryEvent,
  buildTrustedPersonalHistoryEventId,
  recordPersonalHistoryEvent,
} from "../functions/lib/personalHistoryRecording.js";
import {
  classifyBoardCardHistoryEvent,
  classifyCalendarHistoryEvent,
  classifyGoalHistoryEvents,
  classifyMilestoneHistoryEvent,
  recordSubtaskCompletionHistory,
} from "../functions/lib/personalHistoryLifecycle.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const ownerUid = "personal-history-recording-owner";
const now = Date.parse("2026-07-26T15:00:00Z");
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

eq(buildTrustedPersonalHistoryEventId(ownerUid, "fact:1"),
  buildTrustedPersonalHistoryEventId(ownerUid, "fact:1"),
  "trusted IDs are deterministic");
const built = buildTrustedPersonalHistoryEvent({
  ownerUid, eventType: "goal_completed", entityId: "goal-1",
  occurredAtMs: now, displayTitle: "Finish launch",
  sourceEventId: "goal_completed:goal-1:1",
  metadata: {mode: "metric", count: 1, private: true, optional: null},
  createdAtMs: now,
});
eq(built.schemaVersion, 1, "writer enforces schema version one");
eq(built.category, "goal", "registry supplies canonical category");
eq(built.entityType, "goal", "registry supplies canonical entity type");
eq(Object.keys(built.metadata).length, 4, "primitive metadata retained");
assert.throws(() => buildTrustedPersonalHistoryEvent({
  ownerUid, eventType: "goal_completed", entityId: "goal-1",
  occurredAtMs: now, sourceEventId: "invalid",
  metadata: {nested: {secret: true}},
}), /invalid_metadata/);
checks += 1;

const goalCreated = classifyGoalHistoryEvents("goal-1", undefined, {
  userId: ownerUid, title: "Goal", createdAtMs: now, status: "active",
});
eq(goalCreated.map((item) => item.eventType), ["goal_created"],
  "goal creation classified once");
eq(classifyGoalHistoryEvents("goal-1", {status: "active"}, {
  userId: ownerUid, title: "Goal", createdAtMs: now,
  status: "completed", completedAtMs: now + 1,
}).map((item) => item.eventType), ["goal_completed"],
"only completion transition classified");
eq(classifyGoalHistoryEvents("goal-1", {status: "completed"}, {
  userId: ownerUid, title: "Edited", createdAtMs: now,
  status: "completed", completedAtMs: now + 1,
}).length, 0, "ordinary completed-goal edit is excluded");

ok(classifyCalendarHistoryEvent("event-1", undefined, {
  scope: "personal", ownerUid, createdByUid: ownerUid, title: "Focus",
  createdAtMs: now, archived: false, blocksTime: true,
}) != null, "manual personal calendar block classified");
for (const excluded of [
  {scope: "group", groupId: "group-1", ownerUid, createdByUid: ownerUid},
  {scope: "personal", ownerUid, createdByUid: ownerUid,
    plannerSuggestionId: "suggestion-1"},
  {scope: "personal", ownerUid, createdByUid: ownerUid, routineId: "routine-1"},
  {scope: "personal", ownerUid, createdByUid: ownerUid, blocksTime: false},
]) {
  eq(classifyCalendarHistoryEvent("excluded", undefined, {
    title: "Excluded", createdAtMs: now, archived: false, ...excluded,
  }), null, "non-manual/non-blocking/group calendar source excluded");
}
ok(classifyBoardCardHistoryEvent("board-1", "card-1",
  {columnId: "active"}, {columnId: "completed", ownerUid,
    title: "Card", updatedAtMs: now, groupId: null}) != null,
"personal terminal board transition classified");
eq(classifyBoardCardHistoryEvent("board-1", "card-1",
  {columnId: "ideas"}, {columnId: "active", ownerUid,
    title: "Card", updatedAtMs: now}), null,
"nonterminal board movement excluded");
eq(classifyBoardCardHistoryEvent("board-1", "card-1",
  {columnId: "active"}, {columnId: "done", ownerUid,
    title: "Card", updatedAtMs: now, groupId: "group-1"}), null,
"group board card excluded");
ok(classifyMilestoneHistoryEvent("goal-1", "milestone-1",
  {status: "active"}, {status: "completed", completedAtMs: now,
    title: "Ship"}, ownerUid) != null, "milestone completion classified");

const sourceEventId = "concurrent_fact:one";
const results = await Promise.all(Array.from({length: 10}, () =>
  recordPersonalHistoryEvent(db, {
    ownerUid, eventType: "goal_completed", entityId: "goal-concurrent",
    occurredAtMs: now, displayTitle: "Concurrent goal", sourceEventId,
    createdAtMs: now,
  })));
eq(results.filter((item) => item.status === "created").length, 1,
  "ten concurrent writes create one event");
eq(results.filter((item) => item.status === "duplicate").length, 9,
  "nine concurrent retries are deterministic no-ops");
const snapshot = await db.collection(`users/${ownerUid}/historyEvents`)
  .where("sourceEventId", "==", sourceEventId).get();
eq(snapshot.size, 1, "one canonical history document exists");
await assert.rejects(() => recordPersonalHistoryEvent(db, {
  ownerUid, eventType: "goal_completed", entityId: "different-goal",
  occurredAtMs: now, displayTitle: "Collision", sourceEventId,
  createdAtMs: now,
}), /identity_collision/);
checks += 1;
const stored = snapshot.docs[0].data();
ok(!("description" in stored) && !("comments" in stored) &&
  !("email" in stored) && !("pushToken" in stored) &&
  !("media" in stored), "history contains no prohibited payload fields");

await Promise.all([
  db.doc("goals/subtask-goal").set({
    userId: ownerUid, title: "Parent", status: "active", createdAtMs: now,
  }),
  db.doc("goals/subtask-goal/subtasks/subtask-1").set({
    goalId: "subtask-goal", title: "Do the work", frequency: "daily",
    completionMode: "binary",
  }),
]);
const firstSubtask = await recordSubtaskCompletionHistory({
  firestore: db, goalId: "subtask-goal", subtaskId: "subtask-1",
  completionId: "2026-07-26", before: undefined,
  after: {
    userId: ownerUid, completedAtMs: now,
    latestProgressEventId: "progress-first",
  },
});
eq(firstSubtask?.status, "created", "first subtask completion recorded");
eq((await recordSubtaskCompletionHistory({
  firestore: db, goalId: "subtask-goal", subtaskId: "subtask-1",
  completionId: "2026-07-26", before: undefined,
  after: {
    userId: ownerUid, completedAtMs: now,
    latestProgressEventId: "progress-first",
  },
}))?.status, "duplicate", "subtask trigger retry is a no-op");
eq(await recordSubtaskCompletionHistory({
  firestore: db, goalId: "subtask-goal", subtaskId: "subtask-1",
  completionId: "2026-07-26",
  before: {userId: ownerUid, completedAtMs: now,
    latestProgressEventId: "progress-first"},
  after: undefined,
}), null, "undo does not delete or create history");
eq((await recordSubtaskCompletionHistory({
  firestore: db, goalId: "subtask-goal", subtaskId: "subtask-1",
  completionId: "2026-07-26", before: undefined,
  after: {
    userId: ownerUid, completedAtMs: now + 10,
    latestProgressEventId: "progress-second",
  },
}))?.status, "created", "legitimate re-completion has a new fact identity");
eq((await db.collection(`users/${ownerUid}/historyEvents`)
  .where("entityId", "==", "subtask-1").get()).size, 2,
"undo and re-completion preserve two historical completion facts");

console.log(`Personal history recording QA passed (${checks} checks).`);
