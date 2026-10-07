import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  getRoutineActivityId,
  getRoutineInboxId,
  getRoutinePushRequestId,
  getRoutineTransitionEventId,
  processRoutineTransition,
} from "../functions/lib/groupRoutineTransitionSideEffects.js";

const require = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({ projectId: "dayta-routine-transition-qa" });
const db = getFirestore();
await db.recursiveDelete(db.collection("routineTransitionEvents"));

const groupId = "transition-group";
const routineId = "transition-routine";
const occurrenceId = "transition-occurrence";
const transition = {
  type: "occurrence_completed",
  groupId,
  routineId,
  occurrenceId,
  fromStatus: "in_progress",
  toStatus: "completed",
  revision: 1,
  actorUid: "actor",
};
await Promise.all([
  db.doc(`groups/${groupId}`).set({ id: groupId }),
  db.doc(`groupRoutines/${routineId}`).set({
    id: routineId,
    groupId,
    createdByUid: "creator",
  }),
  db.doc(`groupRoutineOccurrences/${occurrenceId}`).set({
    id: occurrenceId,
    groupId,
    routineId,
    participantUids: ["actor", "creator"],
    executionStatus: "completed",
    executionRevision: 1,
  }),
  db.doc(`groups/${groupId}/members/actor`).set({
    uid: "actor",
    role: "member",
    status: "active",
  }),
  db.doc(`groups/${groupId}/members/creator`).set({
    uid: "creator",
    role: "owner",
    status: "active",
  }),
  db.doc(`groupRoutineOccurrences/${occurrenceId}/participants/creator`).set({
    id: "creator",
    uid: "creator",
    groupId,
    routineId,
    occurrenceId,
    status: "excused",
    statusRevision: 1,
  }),
]);

const [first, duplicate] = await Promise.all([
  processRoutineTransition(db, transition, { nowMs: 1000 }),
  processRoutineTransition(db, transition, { nowMs: 1000 }),
]);
assert.deepEqual(
  new Set([first.status, duplicate.status]),
  new Set(["processed", "duplicate"])
);
const eventId = getRoutineTransitionEventId(transition);
const [ledger, activity, inbox, push] = await Promise.all([
  db.doc(`routineTransitionEvents/${eventId}`).get(),
  db.doc(`groups/${groupId}/activity/${getRoutineActivityId(eventId)}`).get(),
  db.doc(`users/creator/groupInbox/${getRoutineInboxId(eventId, "creator")}`).get(),
  db.doc(`routineNotificationRequests/${getRoutinePushRequestId(eventId, "creator")}`).get(),
]);
assert.equal(ledger.data()?.status, "processed");
assert.equal(activity.data()?.transitionEventId, eventId);
assert.equal(inbox.data()?.trustedRoutine, true);
assert.equal(inbox.data()?.relatedEntityType, "routine_occurrence");
assert.equal(push.data()?.status, "queued");
assert.equal(inbox.data()?.body.includes("note"), false);

await db.doc(`users/creator/groupNotificationPreferences/${groupId}`).set({
  muted: true,
  categories: { activity: true },
});
const skippedTransition = {
  ...transition,
  type: "occurrence_skipped",
  fromStatus: "completed",
  toStatus: "skipped",
  revision: 2,
};
await db.doc(`groupRoutineOccurrences/${occurrenceId}`).update({
  executionStatus: "skipped",
  executionRevision: 2,
});
const mutedResult = await processRoutineTransition(db, skippedTransition, {
  nowMs: 2000,
});
assert.equal(mutedResult.inboxRecipientCount, 0);
assert.equal(mutedResult.pushRequestCount, 0);

const unauthorized = {
  type: "participant_excused",
  groupId,
  routineId,
  occurrenceId,
  participantUid: "creator",
  fromStatus: "pending",
  toStatus: "excused",
  revision: 1,
  actorUid: "actor",
};
const unauthorizedResult = await processRoutineTransition(db, unauthorized, {
  nowMs: 3000,
});
assert.equal(unauthorizedResult.status, "skipped");
assert.equal(unauthorizedResult.reasonCode, "actor_unauthorized");

await Promise.all([
  db.doc(`groups/${groupId}/members/manager`).set({
    uid: "manager",
    role: "admin",
    status: "active",
  }),
  db.doc(`groups/${groupId}/members/target`).set({
    uid: "target",
    role: "member",
    status: "active",
  }),
  db.doc(`groupRoutineOccurrences/${occurrenceId}`).update({
    participantUids: ["actor", "creator", "target"],
  }),
  db.doc(`groupRoutineOccurrences/${occurrenceId}/participants/target`).set({
    id: "target",
    uid: "target",
    groupId,
    routineId,
    occurrenceId,
    status: "excused",
    statusRevision: 1,
  }),
]);
const managerTransition = {
  type: "participant_excused",
  groupId,
  routineId,
  occurrenceId,
  participantUid: "target",
  fromStatus: "pending",
  toStatus: "excused",
  revision: 1,
  actorUid: "manager",
};
const managerResults = await Promise.all([
  processRoutineTransition(db, managerTransition, { nowMs: 4000 }),
  processRoutineTransition(db, managerTransition, { nowMs: 4000 }),
]);
assert.deepEqual(
  new Set(managerResults.map((item) => item.status)),
  new Set(["processed", "duplicate"])
);
const managerEventId = getRoutineTransitionEventId(managerTransition);
assert.equal(
  (
    await db.doc(
      `groups/${groupId}/adminLogs/routineAdmin_${managerEventId}`
    ).get()
  ).data()?.transitionEventId,
  undefined
);
assert.equal(
  (
    await db.doc(
      `groups/${groupId}/adminLogs/routineAdmin_${managerEventId}`
    ).get()
  ).data()?.metadata?.transitionEventId,
  managerEventId
);
assert.equal(
  (
    await db.doc(
      `users/target/groupInbox/${getRoutineInboxId(managerEventId, "target")}`
    ).get()
  ).data()?.trustedRoutine,
  true
);

const mismatched = {
  ...skippedTransition,
  type: "occurrence_completed",
  fromStatus: "in_progress",
  toStatus: "completed",
};
const mismatchedResult = await processRoutineTransition(db, mismatched, {
  nowMs: 5000,
});
assert.equal(mismatchedResult.status, "skipped");
assert.equal(mismatchedResult.reasonCode, "stale_or_mismatched_context");

const missingResult = await processRoutineTransition(
  db,
  {
    ...transition,
    occurrenceId: "missing-occurrence",
    revision: 7,
  },
  { nowMs: 6000 }
);
assert.equal(missingResult.status, "skipped");
assert.equal(missingResult.reasonCode, "missing_occurrence");

const atomicRef = db.doc("routineTransitionEvents/forced-failure");
await assert.rejects(
  db.runTransaction(async (transaction) => {
    transaction.set(atomicRef, { status: "processed" });
    transaction.set(
      db.doc(`groups/${groupId}/activity/forced-failure`),
      { type: "occurrence_completed" }
    );
    throw new Error("injected_before_commit");
  })
);
assert.equal((await atomicRef.get()).exists, false);
assert.equal(
  (await db.doc(`groups/${groupId}/activity/forced-failure`).get()).exists,
  false
);

console.log("Group routine transition runtime QA passed (25 checks).");
