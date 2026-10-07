import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const app = initializeApp(
  { projectId: "dayta---goalsettingapp" },
  `routine-concurrency-${Date.now()}`
);
const db = getFirestore(app);
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

function rollup(statuses) {
  const counts = { pending: 0, completed: 0, skipped: 0, excused: 0 };
  for (const status of statuses) counts[status] += 1;
  const resolved = counts.pending === 0;
  const executionStatus = !resolved
    ? statuses.some((status) => status !== "pending")
      ? "in_progress"
      : "scheduled"
    : counts.completed > 0
      ? "completed"
      : counts.skipped > 0
        ? "skipped"
        : "completed";
  return { counts, executionStatus };
}

async function seed(id, participantCount) {
  const participantUids = Array.from(
    { length: participantCount },
    (_, index) => `${id}-p${index}`
  );
  await db.doc(`groupRoutineOccurrences/${id}`).set({
    id,
    groupId: "race-group",
    routineId: "race-routine",
    status: "scheduled",
    participantUids,
    participantCount,
    pendingParticipantCount: participantCount,
    completedParticipantCount: 0,
    skippedParticipantCount: 0,
    excusedParticipantCount: 0,
    executionStatus: "scheduled",
    executionRevision: 0,
  });
  await Promise.all(
    participantUids.map((uid) =>
      db.doc(`groupRoutineOccurrences/${id}/participants/${uid}`).set({
        id: uid,
        uid,
        groupId: "race-group",
        routineId: "race-routine",
        occurrenceId: id,
        status: "pending",
        statusRevision: 0,
        note: null,
      })
    )
  );
  return participantUids;
}

async function transition(id, uid, status, actorUid = uid, note) {
  return db.runTransaction(async (transaction) => {
    const occurrenceRef = db.doc(`groupRoutineOccurrences/${id}`);
    const occurrenceSnapshot = await transaction.get(occurrenceRef);
    const occurrence = occurrenceSnapshot.data();
    if (occurrence.status === "cancelled") throw new Error("cancelled");
    if (!occurrence.participantUids.includes(uid)) throw new Error("unassigned");
    const refs = occurrence.participantUids.map((participantUid) =>
      db.doc(`groupRoutineOccurrences/${id}/participants/${participantUid}`)
    );
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const participants = snapshots.map((snapshot) => snapshot.data());
    const current = participants.find((item) => item.uid === uid);
    if (current.status === status && (note === undefined || note === current.note)) {
      return { changed: false };
    }
    const statuses = participants.map((item) =>
      item.uid === uid ? status : item.status
    );
    const next = rollup(statuses);
    const executionChanged =
      next.executionStatus !== occurrence.executionStatus;
    transaction.update(refs[occurrence.participantUids.indexOf(uid)], {
      status,
      statusRevision:
        current.status === status
          ? current.statusRevision
          : current.statusRevision + 1,
      note: note === undefined ? current.note : note,
      updatedByUid: actorUid,
    });
    transaction.update(occurrenceRef, {
      pendingParticipantCount: next.counts.pending,
      completedParticipantCount: next.counts.completed,
      skippedParticipantCount: next.counts.skipped,
      excusedParticipantCount: next.counts.excused,
      executionStatus: next.executionStatus,
      executionRevision:
        occurrence.executionRevision + (executionChanged ? 1 : 0),
      executionUpdatedByUid: actorUid,
      executionParticipantUid: uid,
    });
    return { changed: true };
  });
}

async function assertConsistent(id) {
  const occurrence = (
    await db.doc(`groupRoutineOccurrences/${id}`).get()
  ).data();
  const participants = (
    await db.collection(`groupRoutineOccurrences/${id}/participants`).get()
  ).docs.map((item) => item.data());
  const actual = rollup(participants.map((item) => item.status));
  const stored = [
    occurrence.pendingParticipantCount,
    occurrence.completedParticipantCount,
    occurrence.skippedParticipantCount,
    occurrence.excusedParticipantCount,
  ];
  check(stored.every((value) => value >= 0), `${id}: counters nonnegative`);
  check(
    stored.reduce((sum, value) => sum + value, 0) ===
      occurrence.participantCount,
    `${id}: counter total`
  );
  check(
    occurrence.pendingParticipantCount === actual.counts.pending &&
      occurrence.completedParticipantCount === actual.counts.completed &&
      occurrence.skippedParticipantCount === actual.counts.skipped &&
      occurrence.excusedParticipantCount === actual.counts.excused,
    `${id}: participant documents match counters`
  );
  check(
    occurrence.executionStatus === actual.executionStatus,
    `${id}: execution rollup matches`
  );
  check(
    new Set(participants.map((item) => item.uid)).size === participants.length,
    `${id}: participant documents unique`
  );
  return { occurrence, participants };
}

try {
  let uids = await seed("two-complete", 2);
  await Promise.all(uids.map((uid) => transition("two-complete", uid, "completed")));
  let result = await assertConsistent("two-complete");
  check(result.occurrence.completedParticipantCount === 2, "two completions preserved");
  check(result.occurrence.executionRevision === 2, "final rollup increments once");

  uids = await seed("three-complete", 3);
  await Promise.all(uids.map((uid) => transition("three-complete", uid, "completed")));
  result = await assertConsistent("three-complete");
  check(result.occurrence.completedParticipantCount === 3, "three completions preserved");

  uids = await seed("mixed", 2);
  await Promise.all([
    transition("mixed", uids[0], "completed"),
    transition("mixed", uids[1], "skipped"),
  ]);
  result = await assertConsistent("mixed");
  check(
    result.occurrence.completedParticipantCount === 1 &&
      result.occurrence.skippedParticipantCount === 1 &&
      result.occurrence.executionStatus === "completed",
    "complete plus skip rollup"
  );

  uids = await seed("all-skip", 3);
  await Promise.all(uids.map((uid) => transition("all-skip", uid, "skipped")));
  result = await assertConsistent("all-skip");
  check(result.occurrence.executionStatus === "skipped", "all skip rollup");

  uids = await seed("duplicate", 2);
  await Promise.all([
    transition("duplicate", uids[0], "completed"),
    transition("duplicate", uids[0], "completed"),
    transition("duplicate", uids[1], "completed"),
  ]);
  result = await assertConsistent("duplicate");
  check(result.participants[0].statusRevision === 1, "duplicate status increments once");

  uids = await seed("participant-manager", 1);
  await Promise.all([
    transition("participant-manager", uids[0], "completed"),
    transition("participant-manager", uids[0], "excused", "manager"),
  ]);
  result = await assertConsistent("participant-manager");
  check(["completed", "excused"].includes(result.participants[0].status), "participant-manager race valid");
  check(result.participants[0].statusRevision >= 1, "participant-manager revision monotonic");

  uids = await seed("two-managers", 1);
  await Promise.all([
    transition("two-managers", uids[0], "completed", "manager-a"),
    transition("two-managers", uids[0], "excused", "manager-b"),
  ]);
  result = await assertConsistent("two-managers");
  check(result.participants[0].statusRevision >= 1, "two-manager revision valid");
  check(result.participants[0].statusRevision <= 2, "two-manager revision has no jump");

  uids = await seed("note-only", 1);
  await transition("note-only", uids[0], "pending", uids[0], "hello");
  result = await assertConsistent("note-only");
  check(result.participants[0].statusRevision === 0, "note-only preserves revision");
  check(result.occurrence.executionRevision === 0, "counter-only preserves execution revision");

  for (const size of [10, 25, 50]) {
    const id = `stress-${size}`;
    uids = await seed(id, size);
    for (let index = 0; index < uids.length; index += 1) {
      const status = index % 5 === 0 ? "skipped" : "completed";
      await transition(id, uids[index], status);
      await assertConsistent(id);
    }
    result = await assertConsistent(id);
    check(result.participants.every((item) => item.statusRevision === 1), `${size}: revisions exact`);
  }

  await db.doc("groupRoutineOccurrences/no-participant").set({
    id: "no-participant",
    status: "scheduled",
    participantUids: [],
    participantCount: 0,
    executionStatus: "scheduled",
    executionRevision: 0,
  });
  const direct = (status, actorUid) =>
    db.runTransaction(async (transaction) => {
      const ref = db.doc("groupRoutineOccurrences/no-participant");
      const snapshot = await transaction.get(ref);
      const current = snapshot.data();
      if (current.executionStatus === status) return;
      transaction.update(ref, {
        executionStatus: status,
        executionRevision: current.executionRevision + 1,
        executionUpdatedByUid: actorUid,
      });
    });
  await Promise.all([direct("completed", "manager-a"), direct("skipped", "manager-b")]);
  const noParticipant = (
    await db.doc("groupRoutineOccurrences/no-participant").get()
  ).data();
  check(["completed", "skipped"].includes(noParticipant.executionStatus), "no-participant race has valid state");
  check(noParticipant.executionRevision >= 1 && noParticipant.executionRevision <= 2, "no-participant revisions sequential");
} finally {
  await deleteApp(app);
}

console.log(`Group routine concurrency QA passed (${checks} checks).`);
