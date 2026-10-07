import { randomUUID } from "node:crypto";
import { Firestore, type DocumentData } from "firebase-admin/firestore";

export const ROUTINE_NOTIFICATION_BATCH_LIMIT = 25;
export const ROUTINE_NOTIFICATION_LEASE_MS = 10 * 60 * 1000;
export const ROUTINE_NOTIFICATION_MAX_ATTEMPTS = 3;
export const ROUTINE_NOTIFICATION_RETRY_MS = 5 * 60 * 1000;

export type RoutineNotificationClaim = {
  id: string;
  leaseId: string;
  data: DocumentData;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function claimRoutineNotificationRequest(
  firestore: Firestore,
  requestId: string,
  nowMs: number,
  leaseId = randomUUID()
): Promise<RoutineNotificationClaim | null> {
  const ref = firestore.collection("routineNotificationRequests").doc(requestId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    const status = data.status;
    const processingAtMs =
      typeof data.processingAtMs === "number" ? data.processingAtMs : null;
    const staleProcessing =
      status === "processing" &&
      processingAtMs != null &&
      processingAtMs <= nowMs - ROUTINE_NOTIFICATION_LEASE_MS;
    const nextRetryAtMs =
      typeof data.nextRetryAtMs === "number" ? data.nextRetryAtMs : 0;
    if (
      (status !== "queued" && !staleProcessing) ||
      nextRetryAtMs > nowMs
    ) {
      return null;
    }
    transaction.update(ref, {
      status: "processing",
      leaseId,
      processingAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    return { id: requestId, leaseId, data };
  });
}

async function isEligibleAtDelivery(
  firestore: Firestore,
  data: DocumentData
) {
  const groupId = text(data.groupId);
  const routineId = text(data.routineId);
  const occurrenceId = text(data.occurrenceId);
  const targetUid = text(data.targetUid);
  if (!groupId || !routineId || !occurrenceId || !targetUid) {
    return { eligible: false, reasonCode: "malformed_request" };
  }
  const [group, routine, occurrence, member, preference] = await Promise.all([
    firestore.collection("groups").doc(groupId).get(),
    firestore.collection("groupRoutines").doc(routineId).get(),
    firestore.collection("groupRoutineOccurrences").doc(occurrenceId).get(),
    firestore
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .doc(targetUid)
      .get(),
    firestore
      .collection("users")
      .doc(targetUid)
      .collection("groupNotificationPreferences")
      .doc(groupId)
      .get(),
  ]);
  if (!group.exists || !routine.exists || !occurrence.exists) {
    return { eligible: false, reasonCode: "missing_context" };
  }
  if (
    routine.data()?.groupId !== groupId ||
    occurrence.data()?.groupId !== groupId ||
    occurrence.data()?.routineId !== routineId
  ) {
    return { eligible: false, reasonCode: "mismatched_context" };
  }
  const memberData = member.data();
  if (memberData?.status !== "active" || memberData?.role === "viewer") {
    return { eligible: false, reasonCode: "recipient_ineligible" };
  }
  if (data.actorUid === targetUid) {
    return { eligible: false, reasonCode: "actor_excluded" };
  }
  const type = text(data.type);
  const assigned =
    Array.isArray(occurrence.data()?.participantUids) &&
    occurrence.data()!.participantUids.includes(targetUid);
  const expectedRecipient =
    type === "occurrence_completed" || type === "occurrence_skipped"
      ? routine.data()?.createdByUid === targetUid
      : type === "occurrence_reopened"
        ? assigned
        : assigned;
  if (!expectedRecipient) {
    return { eligible: false, reasonCode: "recipient_no_longer_assigned" };
  }
  const preferenceData = preference.data();
  if (
    preferenceData?.muted === true ||
    preferenceData?.categories?.activity === false
  ) {
    return { eligible: false, reasonCode: "preference_suppressed" };
  }
  return { eligible: true, reasonCode: null };
}

async function finishClaim(
  firestore: Firestore,
  claim: RoutineNotificationClaim,
  patch: DocumentData
) {
  const ref = firestore.collection("routineNotificationRequests").doc(claim.id);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (
      !snapshot.exists ||
      snapshot.data()?.status !== "processing" ||
      snapshot.data()?.leaseId !== claim.leaseId
    ) {
      return false;
    }
    transaction.update(ref, {
      ...patch,
      leaseId: null,
      processingAtMs: null,
    });
    return true;
  });
}

export type RoutinePushDeliveryResult =
  | { ok: true; receipt: unknown }
  | { ok: false; errorMessage: string; permanent?: boolean; receipt?: unknown };

export async function processRoutineNotificationClaim(
  firestore: Firestore,
  claim: RoutineNotificationClaim,
  options: {
    nowMs: number;
    send: (data: DocumentData, expoPushToken: string) => Promise<RoutinePushDeliveryResult>;
    validToken: (token: string) => boolean;
  }
) {
  const eligibility = await isEligibleAtDelivery(firestore, claim.data);
  if (!eligibility.eligible) {
    await finishClaim(firestore, claim, {
      status: "skipped",
      skippedAtMs: options.nowMs,
      reasonCode: eligibility.reasonCode,
      updatedAtMs: options.nowMs,
    });
    return { status: "skipped", reasonCode: eligibility.reasonCode };
  }
  const targetUid = text(claim.data.targetUid)!;
  const user = (await firestore.collection("users").doc(targetUid).get()).data();
  const token = text(user?.expoPushToken);
  if (!token || !options.validToken(token)) {
    await finishClaim(firestore, claim, {
      status: "failed",
      failedAtMs: options.nowMs,
      reasonCode: "invalid_push_token",
      errorMessage: "Missing or invalid Expo push token.",
      updatedAtMs: options.nowMs,
    });
    return { status: "failed", reasonCode: "invalid_push_token" };
  }
  const result = await options.send(claim.data, token);
  if (result.ok) {
    await finishClaim(firestore, claim, {
      status: "sent",
      sentAtMs: options.nowMs,
      ticket: result.receipt,
      errorMessage: null,
      reasonCode: null,
      updatedAtMs: options.nowMs,
    });
    return { status: "sent", reasonCode: null };
  }
  const attemptCount = (Number(claim.data.attemptCount) || 0) + 1;
  const terminal =
    result.permanent === true ||
    attemptCount >= ROUTINE_NOTIFICATION_MAX_ATTEMPTS;
  await finishClaim(firestore, claim, {
    status: terminal ? "failed" : "queued",
    attemptCount,
    failedAtMs: terminal ? options.nowMs : null,
    nextRetryAtMs: terminal
      ? null
      : options.nowMs + ROUTINE_NOTIFICATION_RETRY_MS,
    errorMessage: result.errorMessage,
    ticket: result.receipt ?? null,
    updatedAtMs: options.nowMs,
  });
  return { status: terminal ? "failed" : "queued", reasonCode: "send_failed" };
}

export async function getRoutineNotificationCandidates(
  firestore: Firestore,
  nowMs: number
) {
  const [queued, stale] = await Promise.all([
    firestore
      .collection("routineNotificationRequests")
      .where("status", "==", "queued")
      .orderBy("createdAtMs", "asc")
      .limit(ROUTINE_NOTIFICATION_BATCH_LIMIT)
      .get(),
    firestore
      .collection("routineNotificationRequests")
      .where("status", "==", "processing")
      .where(
        "processingAtMs",
        "<=",
        nowMs - ROUTINE_NOTIFICATION_LEASE_MS
      )
      .orderBy("processingAtMs", "asc")
      .limit(ROUTINE_NOTIFICATION_BATCH_LIMIT)
      .get(),
  ]);
  return Array.from(
    new Set([...queued.docs, ...stale.docs].map((item) => item.id))
  ).slice(0, ROUTINE_NOTIFICATION_BATCH_LIMIT);
}
