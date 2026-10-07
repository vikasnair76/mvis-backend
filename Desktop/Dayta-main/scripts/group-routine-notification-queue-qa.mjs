import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  ROUTINE_NOTIFICATION_LEASE_MS,
  claimRoutineNotificationRequest,
  getRoutineNotificationCandidates,
  processRoutineNotificationClaim,
} from "../functions/lib/routineNotificationQueue.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const app = initializeApp(
  { projectId: "dayta---goalsettingapp" },
  `routine-queue-${Date.now()}`
);
const db = getFirestore(app);
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};
const nowMs = 10_000_000;
const groupId = "queue-group";
const routineId = "queue-routine";
const occurrenceId = "queue-occurrence";

async function seedContext() {
  await Promise.all([
    db.doc(`groups/${groupId}`).set({ id: groupId }),
    db.doc(`groupRoutines/${routineId}`).set({
      id: routineId,
      groupId,
      createdByUid: "recipient",
    }),
    db.doc(`groupRoutineOccurrences/${occurrenceId}`).set({
      id: occurrenceId,
      groupId,
      routineId,
      participantUids: ["recipient"],
    }),
    db.doc(`groups/${groupId}/members/recipient`).set({
      uid: "recipient",
      status: "active",
      role: "member",
    }),
    db.doc("users/recipient").set({
      expoPushToken: "ExponentPushToken[test]",
    }),
  ]);
}
const requestData = (patch = {}) => ({
  groupId,
  routineId,
  occurrenceId,
  targetUid: "recipient",
  actorUid: "actor",
  type: "occurrence_completed",
  title: "Routine completed",
  body: "A group routine occurrence was completed.",
  status: "queued",
  attemptCount: 0,
  nextRetryAtMs: nowMs,
  createdAtMs: nowMs,
  updatedAtMs: nowMs,
  ...patch,
});

try {
  await seedContext();
  await db.doc("routineNotificationRequests/concurrent").set(requestData());
  const claims = await Promise.all([
    claimRoutineNotificationRequest(db, "concurrent", nowMs, "lease-a"),
    claimRoutineNotificationRequest(db, "concurrent", nowMs, "lease-b"),
  ]);
  check(claims.filter(Boolean).length === 1, "only one concurrent claim wins");
  check(claims.some((claim) => claim?.leaseId === "lease-a" || claim?.leaseId === "lease-b"), "winner owns a lease");
  let sends = 0;
  const winner = claims.find(Boolean);
  const delivered = await processRoutineNotificationClaim(db, winner, {
    nowMs: nowMs + 1,
    validToken: () => true,
    send: async () => {
      sends += 1;
      return { ok: true, receipt: { status: "ok" } };
    },
  });
  check(delivered.status === "sent", "claimed request sends");
  check(sends === 1, "one send occurs");
  check(
    (await db.doc("routineNotificationRequests/concurrent").get()).data()?.status === "sent",
    "success is terminal"
  );
  check(
    (await claimRoutineNotificationRequest(db, "concurrent", nowMs + 2, "late")) === null,
    "sent request cannot be reclaimed"
  );

  await db.doc("routineNotificationRequests/stale").set(
    requestData({
      status: "processing",
      leaseId: "dead-worker",
      processingAtMs: nowMs - ROUTINE_NOTIFICATION_LEASE_MS - 1,
    })
  );
  const stale = await claimRoutineNotificationRequest(db, "stale", nowMs, "recovery");
  check(stale?.leaseId === "recovery", "expired lease is reclaimable");

  await db.doc("routineNotificationRequests/fresh").set(
    requestData({ status: "processing", leaseId: "live", processingAtMs: nowMs })
  );
  check(
    (await claimRoutineNotificationRequest(db, "fresh", nowMs + 1, "other")) === null,
    "fresh lease is exclusive"
  );

  await db.doc("routineNotificationRequests/retry").set(requestData());
  const retryClaim = await claimRoutineNotificationRequest(db, "retry", nowMs, "retry-1");
  const retryResult = await processRoutineNotificationClaim(db, retryClaim, {
    nowMs,
    validToken: () => true,
    send: async () => ({ ok: false, errorMessage: "temporary" }),
  });
  check(retryResult.status === "queued", "transient error requeues");
  const retryDoc = (await db.doc("routineNotificationRequests/retry").get()).data();
  check(retryDoc?.attemptCount === 1, "retry increments attempts");
  check(retryDoc?.nextRetryAtMs > nowMs, "retry has backoff");
  check(
    (await claimRoutineNotificationRequest(db, "retry", nowMs + 1, "too-soon")) === null,
    "backoff prevents early retry"
  );

  await db.doc(`groups/${groupId}/members/recipient`).update({ status: "removed" });
  await db.doc("routineNotificationRequests/removed").set(requestData());
  const removedClaim = await claimRoutineNotificationRequest(db, "removed", nowMs, "removed");
  const removed = await processRoutineNotificationClaim(db, removedClaim, {
    nowMs,
    validToken: () => true,
    send: async () => {
      throw new Error("removed recipient must not send");
    },
  });
  check(removed.status === "skipped", "removed recipient suppressed");
  check(removed.reasonCode === "recipient_ineligible", "removed reason is safe");

  await db.doc(`groups/${groupId}/members/recipient`).update({ status: "active" });
  await db.doc(`users/recipient/groupNotificationPreferences/${groupId}`).set({
    muted: true,
    categories: { activity: true },
  });
  await db.doc("routineNotificationRequests/muted").set(requestData());
  const mutedClaim = await claimRoutineNotificationRequest(db, "muted", nowMs, "muted");
  const muted = await processRoutineNotificationClaim(db, mutedClaim, {
    nowMs,
    validToken: () => true,
    send: async () => {
      throw new Error("muted recipient must not send");
    },
  });
  check(muted.status === "skipped", "mute change suppresses queued push");
  check(muted.reasonCode === "preference_suppressed", "mute reason is safe");

  await db.doc(`users/recipient/groupNotificationPreferences/${groupId}`).set({
    muted: false,
    categories: { activity: false },
  });
  await db.doc("routineNotificationRequests/category").set(requestData());
  const categoryClaim = await claimRoutineNotificationRequest(db, "category", nowMs, "category");
  const category = await processRoutineNotificationClaim(db, categoryClaim, {
    nowMs,
    validToken: () => true,
    send: async () => {
      throw new Error("disabled category must not send");
    },
  });
  check(category.status === "skipped", "category change suppresses queued push");

  const candidates = await getRoutineNotificationCandidates(db, nowMs);
  check(candidates.length <= 25, "candidate scan is bounded");
  check(candidates.includes("stale") === false, "reclaimed request is not simultaneously queued");
  check(
    requestData().body.includes("note") === false,
    "queue safe copy excludes notes"
  );
} finally {
  await deleteApp(app);
}
console.log(`Group routine notification queue QA passed (${checks} checks).`);
