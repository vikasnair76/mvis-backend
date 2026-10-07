import {createHash, randomUUID} from "node:crypto";
import {FieldValue, Firestore, type DocumentData}
  from "firebase-admin/firestore";
import {expireTrustedPlannerSuggestion}
  from "./plannerSuggestionFoundation.js";
import {generatePlannerSuggestions, type PlannerGenerationResult}
  from "./plannerGeneration.js";
import {enqueuePlannerNotificationBatch} from "./plannerNotifications.js";

export const PLANNER_REQUEST_STATUSES = [
  "queued", "processing", "completed", "skipped", "failed", "dead_letter",
] as const;
export const PLANNER_REQUEST_TRIGGERS = [
  "manual", "scheduled", "source_change", "preference_change",
  "lifecycle_refresh", "retry", "test",
] as const;
export const PLANNER_REASON_CODES = [
  "manual_refresh", "scheduled_refresh", "goal_changed", "subtask_changed",
  "board_card_changed", "calendar_changed", "routine_changed",
  "routine_occurrence_changed", "membership_changed", "preferences_changed",
  "snooze_due", "expiration_due", "stale_validation",
] as const;
export type PlannerRequestStatus = typeof PLANNER_REQUEST_STATUSES[number];
export type PlannerRequestTrigger = typeof PLANNER_REQUEST_TRIGGERS[number];
export type PlannerReasonCode = typeof PLANNER_REASON_CODES[number];
export const PLANNER_REASON_MAX = 8;
export const PLANNER_REQUEST_BUCKET_MS = 5 * 60 * 1000;
export const PLANNER_MANUAL_COOLDOWN_MS = PLANNER_REQUEST_BUCKET_MS;
export const PLANNER_REQUEST_LIMIT = 25;
export const PLANNER_PROCESSING_CONCURRENCY = 5;
export const PLANNER_LEASE_MS = 10 * 60 * 1000;
export const PLANNER_MAX_ATTEMPTS = 5;
export const PLANNER_FANOUT_CAP = 50;
export const PLANNER_SCHEDULE_LIMIT = 25;
export const PLANNER_LIFECYCLE_LIMIT = 25;
export const PLANNER_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const validId = (value: unknown) => typeof value === "string" &&
  !!value.trim() && !value.includes("/") && value.length <= 200;
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const has = <T extends readonly string[]>(values: T, value: unknown):
value is T[number] => typeof value === "string" &&
  (values as readonly string[]).includes(value);
const stableHash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
export function getPlannerRequestBucket(atMs: number) {
  if (!Number.isFinite(atMs)) throw new Error("invalid_request_time");
  return String(Math.floor(atMs / PLANNER_REQUEST_BUCKET_MS));
}
const triggerClass = (trigger: PlannerRequestTrigger) =>
  trigger === "manual" ? "manual" : trigger === "scheduled" ? "scheduled" : "refresh";
export function buildPlannerGenerationRequestIdentity(input: {
  ownerUid: string; requestedAtMs: number; trigger: PlannerRequestTrigger;
}) {
  if (!validId(input.ownerUid) || !has(PLANNER_REQUEST_TRIGGERS, input.trigger)) {
    throw new Error("invalid_generation_request");
  }
  const requestBucket = getPlannerRequestBucket(input.requestedAtMs);
  const dedupeKey = `${input.ownerUid}:${requestBucket}:${triggerClass(input.trigger)}`;
  return {requestBucket, dedupeKey: `plannerRequest_${stableHash(dedupeKey)}`,
    requestId: `plannerGeneration_${stableHash(dedupeKey)}`};
}
export function normalizePlannerReasonCodes(value: unknown): PlannerReasonCode[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is PlannerReasonCode =>
    has(PLANNER_REASON_CODES, item)))).sort().slice(0, PLANNER_REASON_MAX);
}
export interface PlannerGenerationRequestDoc {
  id: string; ownerUid: string; status: PlannerRequestStatus;
  trigger: PlannerRequestTrigger; reasonCodes: PlannerReasonCode[];
  requestBucket: string; dedupeKey: string; priority: "normal" | "high";
  requestedAtMs: number; notBeforeAtMs: number | null;
  processingAtMs: number | null; processingBy: string | null;
  leaseExpiresAtMs: number | null; completedAtMs: number | null;
  failedAtMs: number | null; nextAttemptAtMs: number | null;
  attemptCount: number; maxAttempts: number; generationRunId: string | null;
  resultCode: string | null; lastFailureCode: string | null;
  createdAtMs: number; updatedAtMs: number;
}
export function mapPlannerGenerationRequest(id: string,
  data: DocumentData): PlannerGenerationRequestDoc | null {
  if (!validId(id) || !validId(data.ownerUid) ||
    !has(PLANNER_REQUEST_STATUSES, data.status) ||
    !has(PLANNER_REQUEST_TRIGGERS, data.trigger)) return null;
  const requestedAtMs = finite(data.requestedAtMs);
  if (requestedAtMs == null || !validId(data.requestBucket) ||
    !validId(data.dedupeKey)) return null;
  return {
    id, ownerUid: data.ownerUid, status: data.status, trigger: data.trigger,
    reasonCodes: normalizePlannerReasonCodes(data.reasonCodes),
    requestBucket: data.requestBucket, dedupeKey: data.dedupeKey,
    priority: data.priority === "high" ? "high" : "normal", requestedAtMs,
    notBeforeAtMs: finite(data.notBeforeAtMs),
    processingAtMs: finite(data.processingAtMs),
    processingBy: validId(data.processingBy) ? data.processingBy : null,
    leaseExpiresAtMs: finite(data.leaseExpiresAtMs),
    completedAtMs: finite(data.completedAtMs), failedAtMs: finite(data.failedAtMs),
    nextAttemptAtMs: finite(data.nextAttemptAtMs),
    attemptCount: Math.max(0, Math.floor(finite(data.attemptCount) || 0)),
    maxAttempts: Math.max(1, Math.min(PLANNER_MAX_ATTEMPTS,
      Math.floor(finite(data.maxAttempts) || PLANNER_MAX_ATTEMPTS))),
    generationRunId: validId(data.generationRunId) ? data.generationRunId : null,
    resultCode: validId(data.resultCode) ? data.resultCode : null,
    lastFailureCode: validId(data.lastFailureCode) ? data.lastFailureCode : null,
    createdAtMs: finite(data.createdAtMs) || requestedAtMs,
    updatedAtMs: finite(data.updatedAtMs) || requestedAtMs,
  };
}
export async function enqueuePlannerGenerationRequest(firestore: Firestore, input: {
  ownerUid: string; trigger: PlannerRequestTrigger; reasonCodes: PlannerReasonCode[];
  priority?: "normal" | "high"; requestedAtMs: number; notBeforeAtMs?: number | null;
}) {
  if (!Number.isFinite(input.requestedAtMs)) throw new Error("invalid_request_time");
  const reasonCodes = normalizePlannerReasonCodes(input.reasonCodes);
  if (!reasonCodes.length) throw new Error("invalid_reason_codes");
  const identity = buildPlannerGenerationRequestIdentity(input);
  const ref = firestore.collection("plannerGenerationRequests").doc(identity.requestId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const current = mapPlannerGenerationRequest(snapshot.id, snapshot.data()!);
      if (!current) return {requestId: ref.id, outcome: "malformed" as const};
      if (["completed", "skipped", "dead_letter"].includes(current.status)) {
        return {requestId: ref.id, outcome: "terminal" as const};
      }
      transaction.update(ref, {
        reasonCodes: normalizePlannerReasonCodes([...current.reasonCodes, ...reasonCodes]),
        priority: current.priority === "high" || input.priority === "high" ?
          "high" : "normal",
        requestedAtMs: Math.min(current.requestedAtMs, input.requestedAtMs),
        notBeforeAtMs: current.notBeforeAtMs == null ? input.notBeforeAtMs ?? null :
          input.notBeforeAtMs == null ? current.notBeforeAtMs :
            Math.min(current.notBeforeAtMs, input.notBeforeAtMs),
        updatedAtMs: input.requestedAtMs, updatedAt: FieldValue.serverTimestamp(),
      });
      return {requestId: ref.id, outcome: "merged" as const};
    }
    const data: PlannerGenerationRequestDoc = {
      id: ref.id, ownerUid: input.ownerUid, status: "queued",
      trigger: input.trigger, reasonCodes, requestBucket: identity.requestBucket,
      dedupeKey: identity.dedupeKey, priority: input.priority || "normal",
      requestedAtMs: input.requestedAtMs,
      notBeforeAtMs: input.notBeforeAtMs ?? null, processingAtMs: null,
      processingBy: null, leaseExpiresAtMs: null, completedAtMs: null,
      failedAtMs: null, nextAttemptAtMs: null, attemptCount: 0,
      maxAttempts: PLANNER_MAX_ATTEMPTS, generationRunId: null,
      resultCode: null, lastFailureCode: null,
      createdAtMs: input.requestedAtMs, updatedAtMs: input.requestedAtMs,
    };
    transaction.create(ref, {...data, createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()});
    return {requestId: ref.id, outcome: "created" as const};
  });
}
export interface PlannerRequestClaim {
  requestId: string; leaseId: string; data: PlannerGenerationRequestDoc;
}
export function isPlannerRequestClaimable(data: PlannerGenerationRequestDoc,
  nowMs: number) {
  if ((data.notBeforeAtMs ?? 0) > nowMs || data.attemptCount >= data.maxAttempts) return false;
  if (data.status === "queued") return true;
  if (data.status === "failed") return (data.nextAttemptAtMs ?? Infinity) <= nowMs;
  return data.status === "processing" && (data.leaseExpiresAtMs ?? Infinity) <= nowMs;
}
export async function claimPlannerGenerationRequest(firestore: Firestore,
  requestId: string, nowMs: number, leaseId: string = randomUUID()):
Promise<PlannerRequestClaim | null> {
  const ref = firestore.collection("plannerGenerationRequests").doc(requestId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = mapPlannerGenerationRequest(snapshot.id, snapshot.data()!);
    if (!data) {
      transaction.update(ref, {status: "dead_letter",
        resultCode: "malformed_request", lastFailureCode: "malformed_request",
        failedAtMs: nowMs, processingBy: null, processingAtMs: null,
        leaseExpiresAtMs: null, nextAttemptAtMs: null, updatedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp()});
      return null;
    }
    if (!isPlannerRequestClaimable(data, nowMs)) return null;
    const attemptCount = data.attemptCount + 1;
    const generationRunId = `plannerRun_${stableHash(`${requestId}:${attemptCount}`)}`;
    transaction.update(ref, {status: "processing", processingAtMs: nowMs,
      processingBy: leaseId, leaseExpiresAtMs: nowMs + PLANNER_LEASE_MS,
      attemptCount, generationRunId, nextAttemptAtMs: null,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp()});
    return {requestId, leaseId, data: {...data, status: "processing",
      processingAtMs: nowMs, processingBy: leaseId,
      leaseExpiresAtMs: nowMs + PLANNER_LEASE_MS, attemptCount, generationRunId}};
  });
}
export function getPlannerRetryDelayMs(attemptCount: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(1, attemptCount),
    RETRY_DELAYS_MS.length) - 1];
}
async function finishPlannerClaim(firestore: Firestore, claim: PlannerRequestClaim,
  nowMs: number, patch: DocumentData) {
  const ref = firestore.collection("plannerGenerationRequests").doc(claim.requestId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data?.status !== "processing" ||
      data?.processingBy !== claim.leaseId) return false;
    transaction.update(ref, {...patch, processingBy: null, processingAtMs: null,
      leaseExpiresAtMs: null, updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp()});
    return true;
  });
}
export const classifyPlannerFailure = (code: string) =>
  ["missing_index", "unavailable", "deadline_exceeded", "resource_exhausted",
    "generation_failed"].includes(code) ? "retryable" : "terminal";
export async function failPlannerGenerationClaim(firestore: Firestore,
  claim: PlannerRequestClaim, nowMs: number, failureCode: string) {
  const safeCode = validId(failureCode) ? failureCode : "generation_failed";
  const exhausted = claim.data.attemptCount >= claim.data.maxAttempts;
  const retryable = classifyPlannerFailure(safeCode) === "retryable" && !exhausted;
  return finishPlannerClaim(firestore, claim, nowMs, retryable ? {
    status: "failed", failedAtMs: nowMs, lastFailureCode: safeCode,
    resultCode: "generation_failed",
    nextAttemptAtMs: nowMs + getPlannerRetryDelayMs(claim.data.attemptCount),
  } : {status: "dead_letter", failedAtMs: nowMs,
    lastFailureCode: exhausted ? "attempts_exhausted" : safeCode,
    resultCode: exhausted ? "attempts_exhausted" : "generation_failed",
    nextAttemptAtMs: null});
}
export async function completePlannerGenerationClaim(firestore: Firestore,
  claim: PlannerRequestClaim, nowMs: number, result: PlannerGenerationResult) {
  const status = result.status === "skipped" ? "skipped" : "completed";
  return finishPlannerClaim(firestore, claim, nowMs, {
    status, completedAtMs: nowMs, failedAtMs: null, nextAttemptAtMs: null,
    resultCode: result.status === "skipped" ? result.failureCode || "disabled" :
      result.candidateCount ? "generated" : "no_candidates",
    lastFailureCode: null, suggestionsCreated: result.suggestionsCreated,
    suggestionsReused: result.suggestionsReused,
    suggestionsInvalidated: result.suggestionsInvalidated,
    candidateCount: result.candidateCount, truncated: result.truncated,
  });
}
export async function processPlannerGenerationClaim(firestore: Firestore,
  claim: PlannerRequestClaim, nowMs: number) {
  const user = await firestore.collection("users").doc(claim.data.ownerUid).get();
  if (!user.exists) {
    await finishPlannerClaim(firestore, claim, nowMs, {status: "skipped",
      completedAtMs: nowMs, resultCode: "user_missing"});
    return {status: "skipped" as const, resultCode: "user_missing"};
  }
  const preference = await firestore.collection("users").doc(claim.data.ownerUid)
    .collection("settings").doc("planner").get();
  if (preference.data()?.enabled === false) {
    await finishPlannerClaim(firestore, claim, nowMs, {status: "skipped",
      completedAtMs: nowMs, resultCode: "disabled"});
    await updatePlannerScheduleAfterRun(firestore, claim.data.ownerUid, nowMs,
      "disabled", false);
    return {status: "skipped" as const, resultCode: "disabled"};
  }
  const result = await generatePlannerSuggestions({firestore,
    ownerUid: claim.data.ownerUid, nowMs,
    runId: claim.data.generationRunId!,
    trigger: claim.data.trigger === "manual" ? "manual" :
      claim.data.trigger === "scheduled" ? "scheduled" :
        claim.data.trigger === "test" ? "test" : "source_change",
    requestId: claim.requestId, reasonCodes: claim.data.reasonCodes,
    attemptNumber: claim.data.attemptCount});
  if (result.status === "failed") {
    await failPlannerGenerationClaim(firestore, claim, nowMs,
      result.failureCode || "generation_failed");
    return {status: "failed" as const, resultCode: result.failureCode};
  }
  await completePlannerGenerationClaim(firestore, claim, nowMs, result);
  const notification = result.status === "completed" ?
    await enqueuePlannerNotificationBatch({
      firestore, ownerUid: claim.data.ownerUid,
      generationRunId: result.runId,
      suggestionIds: result.createdSuggestionIds ?? [], nowMs,
    }) : null;
  await updatePlannerScheduleAfterRun(firestore, claim.data.ownerUid, nowMs,
    result.status === "completed" ? "generated" : result.failureCode || "skipped", true);
  return {status: result.status, resultCode: result.failureCode, result,
    notification};
}
export async function getPlannerRequestCandidates(firestore: Firestore, nowMs: number) {
  const [queued, failed, stale] = await Promise.all([
    firestore.collection("plannerGenerationRequests").where("status", "==", "queued")
      .where("notBeforeAtMs", "<=", nowMs).orderBy("notBeforeAtMs", "asc")
      .limit(PLANNER_REQUEST_LIMIT).get(),
    firestore.collection("plannerGenerationRequests").where("status", "==", "failed")
      .where("nextAttemptAtMs", "<=", nowMs).orderBy("nextAttemptAtMs", "asc")
      .limit(PLANNER_REQUEST_LIMIT).get(),
    firestore.collection("plannerGenerationRequests").where("status", "==", "processing")
      .where("leaseExpiresAtMs", "<=", nowMs).orderBy("leaseExpiresAtMs", "asc")
      .limit(PLANNER_REQUEST_LIMIT).get(),
  ]);
  return Array.from(new Set([...queued.docs, ...failed.docs, ...stale.docs]
    .map((item) => item.id))).sort().slice(0, PLANNER_REQUEST_LIMIT);
}
export async function mapWithPlannerConcurrency<T>(items: T[], limit: number,
  work: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor; cursor += 1; await work(items[index]);
    }
  });
  await Promise.all(workers);
}
export async function scanPlannerGenerationRequests(firestore: Firestore,
  nowMs: number, invocationId: string) {
  const ids = await getPlannerRequestCandidates(firestore, nowMs);
  let claimed = 0; let completed = 0; let skipped = 0; let failed = 0;
  await mapWithPlannerConcurrency(ids, PLANNER_PROCESSING_CONCURRENCY, async (id) => {
    const claim = await claimPlannerGenerationRequest(firestore, id, nowMs,
      `${invocationId}_${stableHash(id)}`);
    if (!claim) return;
    claimed += 1;
    const result = await processPlannerGenerationClaim(firestore, claim, nowMs);
    if (result.status === "completed") completed += 1;
    else if (result.status === "skipped") skipped += 1;
    else failed += 1;
  });
  return {scanned: ids.length, claimed, completed, skipped, failed};
}

export interface PlannerScheduleStateDoc {
  ownerUid: string; enabled: boolean; nextRefreshAtMs: number;
  lastRequestedAtMs: number | null; lastStartedAtMs: number | null;
  lastCompletedAtMs: number | null; lastSuccessfulAtMs: number | null;
  lastResultCode: string | null; consecutiveFailureCount: number;
  shard: number; createdAtMs: number; updatedAtMs: number;
}
export const getPlannerShard = (uid: string) =>
  parseInt(stableHash(uid).slice(0, 8), 16) % 32;
export async function syncPlannerScheduleState(firestore: Firestore,
  ownerUid: string, enabled: boolean, nowMs: number) {
  if (!validId(ownerUid)) throw new Error("invalid_owner");
  const ref = firestore.collection("plannerScheduleState").doc(ownerUid);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    const createdAtMs = finite(current?.createdAtMs) || nowMs;
    transaction.set(ref, {ownerUid, enabled,
      nextRefreshAtMs: enabled ? Math.min(finite(current?.nextRefreshAtMs) ||
        nowMs, nowMs + PLANNER_REQUEST_BUCKET_MS) : nowMs + PLANNER_REFRESH_INTERVAL_MS,
      lastRequestedAtMs: finite(current?.lastRequestedAtMs),
      lastStartedAtMs: finite(current?.lastStartedAtMs),
      lastCompletedAtMs: finite(current?.lastCompletedAtMs),
      lastSuccessfulAtMs: finite(current?.lastSuccessfulAtMs),
      lastResultCode: validId(current?.lastResultCode) ? current!.lastResultCode : null,
      consecutiveFailureCount: Math.max(0, finite(current?.consecutiveFailureCount) || 0),
      shard: getPlannerShard(ownerUid), createdAtMs, updatedAtMs: nowMs,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()}, {merge: false});
  });
}
async function updatePlannerScheduleAfterRun(firestore: Firestore, ownerUid: string,
  nowMs: number, resultCode: string, success: boolean) {
  const ref = firestore.collection("plannerScheduleState").doc(ownerUid);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); if (!snapshot.exists) return;
    const data = snapshot.data()!;
    transaction.update(ref, {lastCompletedAtMs: nowMs,
      lastSuccessfulAtMs: success ? nowMs : data.lastSuccessfulAtMs ?? null,
      lastResultCode: resultCode,
      consecutiveFailureCount: success ? 0 :
        Math.max(0, Number(data.consecutiveFailureCount) || 0) + 1,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp()});
  });
}
export async function enqueueDuePlannerScheduleStates(firestore: Firestore, nowMs: number) {
  const snapshot = await firestore.collection("plannerScheduleState")
    .where("enabled", "==", true).where("nextRefreshAtMs", "<=", nowMs)
    .orderBy("nextRefreshAtMs", "asc").limit(PLANNER_SCHEDULE_LIMIT).get();
  let enqueued = 0;
  for (const document of snapshot.docs) {
    await firestore.runTransaction(async (transaction) => {
      const state = await transaction.get(document.ref);
      const data = state.data();
      if (!state.exists || data?.enabled !== true || data.nextRefreshAtMs > nowMs) return;
      const identity = buildPlannerGenerationRequestIdentity({ownerUid: document.id,
        requestedAtMs: nowMs, trigger: "scheduled"});
      const requestRef = firestore.collection("plannerGenerationRequests")
        .doc(identity.requestId);
      const request = await transaction.get(requestRef);
      if (!request.exists) {
        transaction.create(requestRef, {id: requestRef.id, ownerUid: document.id,
          status: "queued", trigger: "scheduled",
          reasonCodes: ["scheduled_refresh"], requestBucket: identity.requestBucket,
          dedupeKey: identity.dedupeKey, priority: "normal", requestedAtMs: nowMs,
          notBeforeAtMs: nowMs, processingAtMs: null, processingBy: null,
          leaseExpiresAtMs: null, completedAtMs: null, failedAtMs: null,
          nextAttemptAtMs: null, attemptCount: 0, maxAttempts: PLANNER_MAX_ATTEMPTS,
          generationRunId: null, resultCode: null, lastFailureCode: null,
          createdAtMs: nowMs, updatedAtMs: nowMs,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
        enqueued += 1;
      }
      transaction.update(document.ref, {nextRefreshAtMs: nowMs +
        PLANNER_REFRESH_INTERVAL_MS, lastRequestedAtMs: nowMs, updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp()});
    });
  }
  return {scanned: snapshot.size, enqueued};
}

export async function reactivateTrustedPlannerSuggestion(firestore: Firestore,
  ref: FirebaseFirestore.DocumentReference, nowMs: number) {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); if (!snapshot.exists) return "missing";
    const data = snapshot.data()!;
    if (data.status !== "snoozed") return "ineligible";
    if (finite(data.expiresAtMs) != null && data.expiresAtMs <= nowMs) return "expired";
    if ((finite(data.snoozedUntilMs) ?? Infinity) > nowMs) return "not_due";
    transaction.update(ref, {status: "active", snoozedUntilMs: null,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp()});
    return "reactivated";
  });
}
export async function scanPlannerSuggestionLifecycle(firestore: Firestore, nowMs: number) {
  const [expired, snoozed] = await Promise.all([
    firestore.collectionGroup("plannerSuggestions").where("status", "in",
      ["active", "snoozed"]).where("expiresAtMs", "<=", nowMs)
      .orderBy("expiresAtMs", "asc").limit(PLANNER_LIFECYCLE_LIMIT).get(),
    firestore.collectionGroup("plannerSuggestions").where("status", "==", "snoozed")
      .where("snoozedUntilMs", "<=", nowMs).orderBy("snoozedUntilMs", "asc")
      .limit(PLANNER_LIFECYCLE_LIMIT).get(),
  ]);
  let expirations = 0; let reactivated = 0;
  const refreshOwners = new Set<string>();
  const reactivatedByOwner = new Map<string, string[]>();
  for (const document of expired.docs) {
    const data = document.data();
    if (data.ownerUid !== document.ref.parent.parent?.id) continue;
    const result = await expireTrustedPlannerSuggestion(firestore,
      {ownerUid: data.ownerUid, suggestionId: document.id, nowMs});
    if (result === "expired") expirations += 1;
  }
  for (const document of snoozed.docs) {
    const data = document.data();
    if (data.ownerUid !== document.ref.parent.parent?.id) continue;
    if (finite(data.expiresAtMs) != null && data.expiresAtMs <= nowMs) continue;
    const result = await reactivateTrustedPlannerSuggestion(firestore,
      document.ref, nowMs);
    if (result === "reactivated") {
      reactivated += 1; refreshOwners.add(data.ownerUid);
      const ids = reactivatedByOwner.get(data.ownerUid) ?? [];
      ids.push(document.id);
      reactivatedByOwner.set(data.ownerUid, ids);
    }
  }
  for (const ownerUid of Array.from(refreshOwners).slice(0, PLANNER_LIFECYCLE_LIMIT)) {
    const lifecycleBucket = Math.floor(nowMs / (15 * 60 * 1000));
    const ownerHash = createHash("sha256").update(ownerUid)
      .digest("hex").slice(0, 12);
    await enqueuePlannerNotificationBatch({
      firestore, ownerUid,
      generationRunId: `lifecycle_${lifecycleBucket}_${ownerHash}`,
      suggestionIds: reactivatedByOwner.get(ownerUid) ?? [], nowMs,
    });
    await enqueuePlannerGenerationRequest(firestore, {ownerUid,
      trigger: "lifecycle_refresh", reasonCodes: ["snooze_due"],
      requestedAtMs: nowMs, notBeforeAtMs: nowMs});
  }
  return {expirationScanned: expired.size, snoozeScanned: snoozed.size,
    expirations, reactivated, refreshOwners: refreshOwners.size};
}

const signatures: Record<string, string[]> = {
  goal: ["userId", "ownerUid", "status", "archived", "dueAtMs", "priority",
    "sharedGroupId", "lastActivityAtMs", "updatedAtMs"],
  subtask: ["userId", "ownerUid", "completed", "firstCompletedAtMs", "archived",
    "dueAtMs", "scheduledStartAtMs", "scheduledEndAtMs", "scheduledDayKey",
    "priority", "assignedToUid", "groupId", "sharedGroupId"],
  board_card: ["ownerUid", "groupId", "boardId", "columnId", "archived",
    "priority", "dueAtMs", "assignedToUid", "linkedItemType", "linkedItemId"],
  calendar: ["ownerUid", "groupId", "startAtMs", "endAtMs", "sortStartMs",
    "sortEndMs", "status", "archived", "blocksTime", "sourceType",
    "sourceOccurrenceId"],
  routine: ["groupId", "status", "frequency", "interval", "weekdays",
    "monthlyMode", "dayOfMonth", "weekOfMonth", "weekdayOfMonth",
    "localStartTime", "durationMinutes", "timezone", "startDate", "endDate",
    "participantUids"],
  occurrence: ["groupId", "routineId", "startAtMs", "endAtMs", "status",
    "executionStatus", "participantUids", "calendarProjectionId"],
  membership: ["groupId", "uid", "status", "role"],
  preferences: ["enabled", "allowPersonalSuggestions", "allowGroupSuggestions",
    "hiddenSuggestionTypes"],
};
export function isPlannerSourceChangeMeaningful(kind: keyof typeof signatures,
  before: DocumentData | undefined, after: DocumentData | undefined) {
  if (!before || !after) return true;
  return JSON.stringify(signatures[kind].map((field) => before[field] ?? null)) !==
    JSON.stringify(signatures[kind].map((field) => after[field] ?? null));
}
export async function getPlannerGroupRecipients(firestore: Firestore, groupId: string,
  targetedUids: string[] = []) {
  const targeted = Array.from(new Set(targetedUids.filter(validId))).slice(0, PLANNER_FANOUT_CAP);
  if (targeted.length) {
    const valid: string[] = [];
    for (const batch of Array.from({length: Math.ceil(targeted.length / 10)},
      (_, index) => targeted.slice(index * 10, index * 10 + 10))) {
      const snapshot = await firestore.collection("groupMemberships")
        .where("groupId", "==", groupId).where("uid", "in", batch)
        .where("status", "==", "active").limit(PLANNER_FANOUT_CAP + 1).get();
      valid.push(...snapshot.docs.filter((item) => item.data().role !== "viewer")
        .map((item) => item.data().uid));
    }
    return Array.from(new Set(valid)).sort().slice(0, PLANNER_FANOUT_CAP);
  }
  const snapshot = await firestore.collection("groupMemberships")
    .where("groupId", "==", groupId).where("status", "==", "active")
    .limit(PLANNER_FANOUT_CAP + 1).get();
  if (snapshot.size > PLANNER_FANOUT_CAP) return [];
  return snapshot.docs.filter((item) => item.data().role !== "viewer")
    .map((item) => item.data().uid).filter(validId).sort();
}
export async function enqueuePlannerSourceChange(firestore: Firestore, input: {
  kind: keyof typeof signatures; before?: DocumentData; after?: DocumentData;
  reasonCode: PlannerReasonCode; nowMs: number;
}) {
  if (!isPlannerSourceChangeMeaningful(input.kind, input.before, input.after)) {
    return {meaningful: false, recipients: 0};
  }
  const data = input.after || input.before || {};
  if (input.kind === "calendar" && data.sourceType === "group_routine") {
    return {meaningful: false, recipients: 0};
  }
  if (input.kind === "occurrence") {
    const startAtMs = finite(data.startAtMs);
    if (startAtMs == null || startAtMs < input.nowMs - 14 * 86_400_000 ||
      startAtMs > input.nowMs + 14 * 86_400_000) {
      return {meaningful: false, recipients: 0};
    }
  }
  const groupId = validId(data.groupId) ? data.groupId :
    validId(data.sharedGroupId) ? data.sharedGroupId : null;
  const participantUids = Array.isArray(data.participantUids) ?
    data.participantUids.slice(0, PLANNER_FANOUT_CAP) : [];
  const direct = [data.assignedToUid, data.userId, data.ownerUid, ...participantUids]
    .filter(validId) as string[];
  const recipients = input.kind === "membership" && validId(data.uid) ?
    [data.uid] : groupId ?
    await getPlannerGroupRecipients(firestore, groupId, direct) :
    Array.from(new Set(direct)).slice(0, 1);
  for (const ownerUid of recipients) {
    await enqueuePlannerGenerationRequest(firestore, {ownerUid,
      trigger: input.kind === "preferences" ? "preference_change" : "source_change",
      reasonCodes: [input.reasonCode], requestedAtMs: input.nowMs,
      notBeforeAtMs: input.nowMs});
  }
  return {meaningful: true, recipients: recipients.length};
}
