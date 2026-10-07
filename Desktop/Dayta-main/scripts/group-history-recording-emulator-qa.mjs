import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {
  buildTrustedGroupHistoryEvent,
  buildTrustedGroupHistoryEventId,
  recordGroupHistoryEvent,
} from "../functions/lib/groupHistoryRecording.js";
import {
  groupHistoryDiagnostic,
  recordRoutineOccurrenceCompletion,
  recordSharedSubtaskCompletion,
} from "../functions/lib/groupHistoryLifecycle.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const now = Date.parse("2026-07-26T16:00:00Z");
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const identity = {
  groupId: "history-group",
  eventType: "shared_subtask_completed",
  sourceEventId: "subtask_progress:goal-a:subtask-a:progress-a",
};
const eventId = buildTrustedGroupHistoryEventId(identity);
eq(buildTrustedGroupHistoryEventId(identity), eventId,
  "same source retry has stable identity");
ok(buildTrustedGroupHistoryEventId({...identity, groupId: "other-group"}) !==
  eventId, "different group has different identity");
ok(buildTrustedGroupHistoryEventId({
  ...identity, sourceEventId: `${identity.sourceEventId}-2`,
}) !== eventId, "different occurrence has different identity");
ok(!eventId.includes("/") && eventId.length < 100,
  "identity is slash-safe and bounded");

const built = buildTrustedGroupHistoryEvent({
  ...identity,
  entityId: "subtask-a",
  parentEntityId: "goal-a",
  occurredAtMs: now,
  createdAtMs: now,
  displayTitle: "x".repeat(300),
  summary: null,
  actorUid: "actor",
  actorDisplayName: "Actor",
  creditedMemberUid: "assignee",
  creditedMemberDisplayName: "Assignee",
  metadata: {
    kind: "shared_subtask_completed",
    assignmentUid: "assignee",
  },
});
eq(built.displayTitle.length, 160, "trusted writer bounds title");
eq(built.summary, null, "trusted writer preserves null summary");
eq(built.visibility, "group_members", "visibility is canonical");
for (const prohibited of [
  "email", "description", "comment", "message", "url", "attachments",
]) {
  ok(!Object.keys(built).some((key) => key.toLowerCase().includes(prohibited)),
    `${prohibited} is absent from canonical payload`);
}

await Promise.all([
  db.doc("groups/history-group").set({name: "History Group"}),
  db.doc("groups/other-history-group").set({name: "Other Group"}),
  db.doc("goals/goal-a").set({
    userId: "goal-owner",
    visibility: "group_shared",
    sharedGroupIds: ["history-group"],
  }),
  db.doc("goals/goal-a/subtasks/subtask-a").set({
    goalId: "goal-a",
    title: "Shared work",
    completionMode: "binary",
    assignedToUid: "assignee",
    assignedToName: "Assigned member",
  }),
  db.doc("groups/history-group/sharedGoals/goal-a").set({
    goalId: "goal-a", groupId: "history-group", status: "active",
  }),
]);
const progress = {
  goalId: "goal-a",
  subtaskId: "subtask-a",
  kind: "completion",
  authorUid: "actor",
  authorName: "Completing member",
  authorEmail: "must-not-copy@example.com",
  previousValue: 0,
  resultingValue: 1,
  targetValue: 1,
  completed: true,
  comment: "must not copy",
  reverted: false,
  createdAtMs: now,
};
const created = await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-a",
  progress,
  nowMs: now + 10,
});
eq(created.status, "created", "shared subtask completion records");
const duplicate = await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-a",
  progress,
  nowMs: now + 20,
});
eq(duplicate.status, "already_exists", "duplicate trigger is a no-op");
const subtaskEvents = await db.collection(
  "groups/history-group/historyEvents").get();
eq(subtaskEvents.size, 1, "shared completion creates exactly one event");
const subtaskEvent = subtaskEvents.docs[0].data();
eq(subtaskEvent.groupId, "history-group", "payload tenancy matches path");
eq(subtaskEvent.eventType, "shared_subtask_completed",
  "shared event type is canonical");
eq(subtaskEvent.category, "goals", "shared category is canonical");
eq(subtaskEvent.entityType, "subtask", "shared entity is canonical");
eq(subtaskEvent.parentEntityId, "goal-a", "goal routing is stored");
eq(subtaskEvent.occurredAtMs, now, "source occurrence time is retained");
eq(subtaskEvent.actorUid, "actor", "proven actor is retained");
eq(subtaskEvent.creditedMemberUid, "assignee",
  "credited member remains separate");
ok(!JSON.stringify(subtaskEvent).includes("example.com") &&
  !JSON.stringify(subtaskEvent).includes("must not copy"),
"email and comment are not copied");

await db.doc(`groups/history-group/historyEvents/${subtaskEvents.docs[0].id}`)
  .update({summary: "conflicting"});
const conflict = await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-a",
  progress,
  nowMs: now + 30,
});
eq(conflict.status, "conflict", "existing mismatch returns conflict");
eq((await subtaskEvents.docs[0].ref.get()).data().summary, "conflicting",
  "conflict is never overwritten");

eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-unrelated",
  progress: {...progress, completed: false},
})).status, "skipped", "unrelated progress is skipped");
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-reverted",
  progress: {...progress, reverted: true},
})).status, "skipped", "already reverted source is skipped");
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-bad-time",
  progress: {...progress, createdAtMs: Number.NaN},
})).status, "skipped", "invalid occurrence time is skipped");
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "missing",
  subtaskId: "missing",
  progressEventId: "progress-missing",
  progress: {...progress, goalId: "missing", subtaskId: "missing"},
})).status, "skipped", "missing source parent is skipped");

await db.doc("goals/goal-ambiguous").set({
  userId: "owner",
  visibility: "group_shared",
  sharedGroupIds: ["history-group", "other-history-group"],
});
await db.doc("goals/goal-ambiguous/subtasks/subtask-a").set({
  title: "Ambiguous",
});
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-ambiguous",
  subtaskId: "subtask-a",
  progressEventId: "progress-ambiguous",
  progress: {
    ...progress,
    goalId: "goal-ambiguous",
    subtaskId: "subtask-a",
  },
})).reason, "ambiguous_group_tenancy",
"multi-group tenancy fails closed");

await db.doc("goals/personal-goal").set({
  userId: "owner", visibility: "private", sharedGroupIds: [],
});
await db.doc("goals/personal-goal/subtasks/subtask-a").set({
  title: "Personal",
});
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "personal-goal",
  subtaskId: "subtask-a",
  progressEventId: "progress-personal",
  progress: {
    ...progress, goalId: "personal-goal", subtaskId: "subtask-a",
  },
})).reason, "not_group_scoped", "personal subtask is skipped");

const countProgress = {
  ...progress,
  kind: "increment",
  previousValue: 4,
  resultingValue: 5,
  targetValue: 5,
};
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-count-final",
  progress: countProgress,
  nowMs: now + 40,
})).status, "created", "count mode records threshold completion only");
eq((await recordSharedSubtaskCompletion({
  firestore: db,
  goalId: "goal-a",
  subtaskId: "subtask-a",
  progressEventId: "progress-count-partial",
  progress: {...countProgress, previousValue: 2, resultingValue: 3,
    completed: false},
})).status, "skipped", "partial count increment is skipped");

await Promise.all([
  db.doc("groupRoutines/routine-a").set({
    id: "routine-a", groupId: "history-group", title: "Weekly review",
  }),
  db.doc("groupRoutineOccurrences/occurrence-a").set({
    id: "occurrence-a",
    groupId: "history-group",
    routineId: "routine-a",
    routineTitle: "Weekly review",
    executionStatus: "completed",
    executionRevision: 1,
    completedAtMs: now + 100,
    participantUids: ["credited", "actor"],
  }),
]);
const transition = {
  type: "occurrence_completed",
  groupId: "history-group",
  routineId: "routine-a",
  occurrenceId: "occurrence-a",
  fromStatus: "scheduled",
  toStatus: "completed",
  revision: 1,
  actorUid: "actor",
};
const routineOccurrence = (await db.doc(
  "groupRoutineOccurrences/occurrence-a").get()).data();
eq((await recordRoutineOccurrenceCompletion({
  firestore: db, transition, occurrence: routineOccurrence, nowMs: now + 110,
})).status, "created", "routine completion records");
eq((await recordRoutineOccurrenceCompletion({
  firestore: db, transition, occurrence: routineOccurrence, nowMs: now + 120,
})).status, "already_exists", "routine retry is idempotent");
const routineEventQuery = await db.collection(
  "groups/history-group/historyEvents")
  .where("eventType", "==", "group_routine_occurrence_completed").get();
eq(routineEventQuery.size, 1, "routine retry creates one event");
const routineEvent = routineEventQuery.docs[0].data();
eq(routineEvent.parentEntityId, "routine-a",
  "routine parent routing is stored");
eq(routineEvent.actorUid, "actor", "routine actor is source-backed");
eq(routineEvent.creditedMemberUid, null,
  "routine rollup does not invent individual credit");
eq(routineEvent.metadata.participantCount, 2,
  "routine stores bounded factual participant count");

const occurrenceB = {
  ...routineOccurrence,
  id: "occurrence-b",
  completedAtMs: now + 200,
};
const transitionB = {
  ...transition,
  occurrenceId: "occurrence-b",
};
eq((await recordRoutineOccurrenceCompletion({
  firestore: db, transition: transitionB, occurrence: occurrenceB,
  nowMs: now + 210,
})).status, "created", "different routine occurrence is distinct");
eq((await recordRoutineOccurrenceCompletion({
  firestore: db,
  transition: {...transition, type: "occurrence_reopened",
    fromStatus: "completed", toStatus: "scheduled", revision: 2},
  occurrence: {...routineOccurrence, executionStatus: "scheduled",
    executionRevision: 2},
})).status, "skipped", "routine reopen creates no history event");

await db.doc("groupRoutineOccurrences/occurrence-a").delete();
ok((await routineEventQuery.docs[0].ref.get()).exists,
  "source deletion does not delete routine history");
await db.doc("goals/goal-a/subtasks/subtask-a").update({title: "Renamed"});
eq((await subtaskEvents.docs[0].ref.get()).data().displayTitle, "Shared work",
  "source rename does not mutate historical snapshot");

const diagnostic = groupHistoryDiagnostic({
  sourceKind: "shared_subtask",
  result: {status: "skipped", reason: "ambiguous_group_tenancy"},
});
for (const forbidden of [
  "groupId", "eventId", "sourceEventId", "actorUid", "displayTitle",
]) {
  ok(!(forbidden in diagnostic), `diagnostic excludes ${forbidden}`);
}

const indexSource = await readFile(
  new URL("../functions/src/index.ts", import.meta.url), "utf8");
const recordingSource = await readFile(
  new URL("../functions/src/groupHistoryRecording.ts", import.meta.url),
  "utf8");
ok(indexSource.includes("onDocumentCreated") &&
  indexSource.includes("retry: true"),
"trusted create trigger has retry enabled");
ok(recordingSource.includes("transaction.create(eventRef, candidate)") &&
  !recordingSource.includes("{merge: true}"),
"writer uses create-if-absent without merge");
ok(!indexSource.includes("recordGroupTaskGroupHistory") &&
  !indexSource.includes("group_board_card_completed"),
"deferred writers remain inactive");

const direct = await recordGroupHistoryEvent(db, {
  groupId: "history-group",
  eventType: "group_task_completed",
  entityId: "task-fixture",
  parentEntityId: null,
  sourceEventId: "qa-only-transition",
  occurredAtMs: now,
  createdAtMs: now,
  displayTitle: "QA-only writer fixture",
  summary: null,
  actorUid: "actor",
  actorDisplayName: null,
  creditedMemberUid: "claimant",
  creditedMemberDisplayName: null,
  metadata: {kind: "group_task_completed", claimedByUid: "claimant"},
});
eq(direct.status, "created",
  "generic trusted writer supports registered task event contract");

console.log(`Group History recording QA passed (${checks} checks).`);
