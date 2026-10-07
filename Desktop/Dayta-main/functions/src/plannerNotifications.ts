import {randomUUID} from "node:crypto";
import {FieldValue, Firestore, type DocumentData}
  from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

export const PLANNER_NOTIFICATION_BATCH_LIMIT = 25;
export const PLANNER_NOTIFICATION_MAX_SUGGESTIONS = 25;
export const PLANNER_NOTIFICATION_MAX_ATTEMPTS = 3;
export const PLANNER_NOTIFICATION_LEASE_MS = 10 * 60 * 1000;
export const PLANNER_NOTIFICATION_RETRY_MS = 5 * 60 * 1000;

export type PlannerNotificationMetric =
  | "planner_notification_sent" | "planner_notification_suppressed"
  | "planner_notification_batch" | "planner_notification_opened"
  | "planner_notification_duplicate"
  | "planner_notification_preference_disabled"
  | "planner_execution_notification_skipped";
export type PlannerNotificationClaim = {
  id: string; leaseId: string; data: DocumentData;
};
const text = (value: unknown) => typeof value === "string" &&
  value.trim() ? value.trim() : null;

function preferenceAllows(preferences: DocumentData | undefined,
  suggestion: DocumentData) {
  if (preferences?.enabled === false ||
    preferences?.notificationsEnabled === false) return false;
  if (suggestion.scope === "group" &&
    preferences?.groupNotificationsEnabled === false) return false;
  if (suggestion.scope !== "group" &&
    preferences?.personalNotificationsEnabled === false) return false;
  const ruleId = suggestion.source?.ruleId;
  if (["calendar_conflict", "routine_occurrence_conflict"].includes(ruleId) &&
    preferences?.conflictNotificationsEnabled === false) return false;
  if (ruleId === "open_window_scheduling_opportunity" &&
    preferences?.opportunityNotificationsEnabled === false) return false;
  return true;
}
function notifiable(data: DocumentData, nowMs: number) {
  return data.status === "active" &&
    (typeof data.expiresAtMs !== "number" || data.expiresAtMs > nowMs) &&
    data.snoozedUntilMs == null && data.acceptedAtMs == null &&
    data.dismissedAtMs == null && data.notifiedAtMs == null;
}
export function getPlannerNotificationCopy(suggestions: DocumentData[]) {
  const rules = new Set(suggestions.map((item) => item.source?.ruleId));
  if (rules.has("calendar_conflict") ||
    rules.has("routine_occurrence_conflict")) return {
    title: "Planner update",
    body: "Planner found scheduling conflicts that need review.",
    category: "conflict",
  };
  if (rules.size === 1 &&
    rules.has("open_window_scheduling_opportunity")) return {
    title: "Planner update",
    body: suggestions.length === 1 ?
      "Planner found a new scheduling opportunity." :
      `Planner found ${suggestions.length} new scheduling opportunities.`,
    category: "opportunity",
  };
  return {
    title: "Planner update",
    body: suggestions.length === 1 ?
      "Planner found a new planning suggestion." :
      `Planner found ${suggestions.length} new planning suggestions.`,
    category: "suggestions",
  };
}

export async function enqueuePlannerNotificationBatch(input: {
  firestore: Firestore; ownerUid: string; generationRunId: string;
  suggestionIds: string[]; nowMs: number;
}) {
  const ids = Array.from(new Set(input.suggestionIds.filter((id) => text(id))))
    .slice(0, PLANNER_NOTIFICATION_MAX_SUGGESTIONS);
  if (!ids.length) {
    logger.info("planner_notification_suppressed", {
      ownerUid: input.ownerUid, generationRunId: input.generationRunId,
      reasonCode: "no_new_suggestions",
    });
    return {outcome: "suppressed" as const,
      reasonCode: "no_new_suggestions", count: 0};
  }
  const user = input.firestore.collection("users").doc(input.ownerUid);
  const request = input.firestore.collection("plannerNotificationRequests")
    .doc(`plannerNotification_${input.generationRunId}`);
  const inbox = user.collection("groupInbox")
    .doc(`planner_${input.generationRunId}`);
  const metric = user.collection("plannerMetrics").doc("summary");
  return input.firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(request);
    if (existing.exists) {
      transaction.set(metric, {notificationDuplicateCount: FieldValue.increment(1),
        updatedAtMs: input.nowMs, updatedAt: FieldValue.serverTimestamp()},
      {merge: true});
      logger.info("planner_notification_duplicate", {
        ownerUid: input.ownerUid, generationRunId: input.generationRunId,
      });
      return {outcome: "duplicate" as const,
        reasonCode: "generation_already_batched",
        count: Number(existing.data()?.suggestionCount) || 0};
    }
    const preferences = (await transaction.get(
      user.collection("settings").doc("planner"))).data();
    if (preferences?.enabled === false ||
      preferences?.notificationsEnabled === false) {
      transaction.set(metric, {
        notificationSuppressionCount: FieldValue.increment(1),
        updatedAtMs: input.nowMs, updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      logger.info("planner_notification_preference_disabled", {
        ownerUid: input.ownerUid, generationRunId: input.generationRunId,
      });
      return {outcome: "suppressed" as const,
        reasonCode: "preference_disabled", count: 0};
    }
    const snapshots = [];
    for (const id of ids) snapshots.push(await transaction.get(
      user.collection("plannerSuggestions").doc(id)));
    const eligible = snapshots.filter((snapshot) => snapshot.exists &&
      notifiable(snapshot.data()!, input.nowMs) &&
      preferenceAllows(preferences, snapshot.data()!));
    if (!eligible.length) {
      transaction.set(metric, {
        notificationSuppressionCount: FieldValue.increment(1),
        updatedAtMs: input.nowMs, updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      logger.info("planner_notification_suppressed", {
        ownerUid: input.ownerUid, generationRunId: input.generationRunId,
        reasonCode: "no_eligible_suggestions",
      });
      return {outcome: "suppressed" as const,
        reasonCode: "no_eligible_suggestions", count: 0};
    }
    const copy = getPlannerNotificationCopy(eligible.map((item) => item.data()!));
    const eligibleIds = eligible.map((item) => item.id);
    transaction.create(request, {
      id: request.id, ownerUid: input.ownerUid,
      generationRunId: input.generationRunId,
      suggestionIds: eligibleIds, suggestionCount: eligibleIds.length,
      category: copy.category, title: copy.title, body: copy.body,
      deepLink: "/planner", status: "queued", attemptCount: 0,
      leaseId: null, processingAtMs: null, nextAttemptAtMs: input.nowMs,
      createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(inbox, {
      id: inbox.id, uid: input.ownerUid, groupId: "", type: "planner",
      title: copy.title, body: copy.body, readAtMs: null,
      groupKey: `planner:${input.generationRunId}`,
      relatedEntityType: "planner", relatedEntityId: input.generationRunId,
      idempotencyKey: inbox.id, deepLink: "/planner", trustedPlanner: true,
      suggestionCount: eligibleIds.length,
      createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(metric, {
      notificationBatchCount: FieldValue.increment(1),
      suggestionsNotifiedCount: FieldValue.increment(eligibleIds.length),
      updatedAtMs: input.nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    for (const snapshot of eligible) transaction.update(snapshot.ref, {
      notifiedAtMs: input.nowMs, notificationBatchId: request.id,
      updatedAtMs: input.nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info("planner_notification_batch", {
      ownerUid: input.ownerUid, generationRunId: input.generationRunId,
      suggestionCount: eligibleIds.length, category: copy.category,
    });
    return {outcome: "queued" as const, reasonCode: null,
      count: eligibleIds.length, requestId: request.id};
  });
}

export async function getPlannerNotificationCandidates(
  firestore: Firestore, nowMs: number) {
  const snapshot = await firestore.collection("plannerNotificationRequests")
    .where("status", "in", ["queued", "processing"])
    .limit(PLANNER_NOTIFICATION_BATCH_LIMIT).get();
  return snapshot.docs.filter((item) => item.data().status === "queued" ?
    (Number(item.data().nextAttemptAtMs) || 0) <= nowMs :
    (Number(item.data().processingAtMs) || 0) <=
      nowMs - PLANNER_NOTIFICATION_LEASE_MS)
    .map((item) => item.id).sort();
}
export async function claimPlannerNotificationRequest(
  firestore: Firestore, requestId: string, nowMs: number,
  leaseId = randomUUID()): Promise<PlannerNotificationClaim | null> {
  const ref = firestore.collection("plannerNotificationRequests").doc(requestId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    const stale = data.status === "processing" &&
      (Number(data.processingAtMs) || 0) <=
        nowMs - PLANNER_NOTIFICATION_LEASE_MS;
    if ((data.status !== "queued" && !stale) ||
      (Number(data.nextAttemptAtMs) || 0) > nowMs) return null;
    transaction.update(ref, {status: "processing", leaseId,
      processingAtMs: nowMs,
      attemptCount: (Number(data.attemptCount) || 0) + 1,
      updatedAtMs: nowMs});
    return {id: requestId, leaseId, data};
  });
}
async function finish(firestore: Firestore, claim: PlannerNotificationClaim,
  patch: DocumentData) {
  const ref = firestore.collection("plannerNotificationRequests").doc(claim.id);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.status !== "processing" ||
      snapshot.data()?.leaseId !== claim.leaseId) return false;
    transaction.update(ref, {...patch, leaseId: null, processingAtMs: null,
      updatedAt: FieldValue.serverTimestamp()});
    return true;
  });
}
export async function processPlannerNotificationClaim(
  firestore: Firestore, claim: PlannerNotificationClaim, options: {
    nowMs: number; validToken: (token: string) => boolean;
    send: (data: DocumentData, token: string) => Promise<{
      ok: boolean; permanent?: boolean; receipt?: unknown;
    }>;
  }) {
  const ownerUid = text(claim.data.ownerUid);
  const ids = Array.isArray(claim.data.suggestionIds) ?
    claim.data.suggestionIds.map(text).filter(Boolean)
      .slice(0, PLANNER_NOTIFICATION_MAX_SUGGESTIONS) as string[] : [];
  if (!ownerUid || !ids.length) {
    await finish(firestore, claim, {status: "skipped",
      reasonCode: "malformed_request", skippedAtMs: options.nowMs,
      updatedAtMs: options.nowMs});
    return {status: "skipped" as const, reasonCode: "malformed_request"};
  }
  const user = firestore.collection("users").doc(ownerUid);
  const [profile, preferences] = await Promise.all([
    user.get(), user.collection("settings").doc("planner").get(),
  ]);
  if (preferences.data()?.enabled === false ||
    preferences.data()?.notificationsEnabled === false) {
    await finish(firestore, claim, {status: "skipped",
      reasonCode: "preference_disabled", skippedAtMs: options.nowMs,
      updatedAtMs: options.nowMs});
    return {status: "skipped" as const, reasonCode: "preference_disabled"};
  }
  const suggestions = await Promise.all(ids.map((id) =>
    user.collection("plannerSuggestions").doc(id).get()));
  const eligible = suggestions.filter((snapshot) => snapshot.exists &&
    snapshot.data()?.status === "active" &&
    (typeof snapshot.data()?.expiresAtMs !== "number" ||
      snapshot.data()!.expiresAtMs > options.nowMs) &&
    snapshot.data()?.snoozedUntilMs == null &&
    preferenceAllows(preferences.data(), snapshot.data()!));
  if (!eligible.length) {
    const acceptedCount = suggestions.filter((snapshot) =>
      snapshot.data()?.status === "accepted").length;
    if (acceptedCount) logger.info("planner_execution_notification_skipped", {
      ownerUid, requestId: claim.id, acceptedCount,
    });
    await finish(firestore, claim, {status: "skipped",
      reasonCode: "no_active_suggestions", skippedAtMs: options.nowMs,
      updatedAtMs: options.nowMs});
    return {status: "skipped" as const, reasonCode: "no_active_suggestions"};
  }
  const token = text(profile.data()?.expoPushToken);
  if (!token || !options.validToken(token)) {
    await finish(firestore, claim, {status: "skipped",
      reasonCode: "push_unavailable", skippedAtMs: options.nowMs,
      updatedAtMs: options.nowMs});
    return {status: "skipped" as const, reasonCode: "push_unavailable"};
  }
  const result = await options.send(claim.data, token);
  if (result.ok) {
    await finish(firestore, claim, {status: "sent", reasonCode: null,
      sentAtMs: options.nowMs, receipt: result.receipt ?? null,
      updatedAtMs: options.nowMs});
    return {status: "sent" as const, reasonCode: null};
  }
  const attempts = (Number(claim.data.attemptCount) || 0) + 1;
  const terminal = result.permanent === true ||
    attempts >= PLANNER_NOTIFICATION_MAX_ATTEMPTS;
  await finish(firestore, claim, {status: terminal ? "failed" : "queued",
    reasonCode: terminal ? "delivery_failed" : "retry_scheduled",
    failedAtMs: terminal ? options.nowMs : null,
    nextAttemptAtMs: terminal ? null :
      options.nowMs + PLANNER_NOTIFICATION_RETRY_MS,
    receipt: result.receipt ?? null, updatedAtMs: options.nowMs});
  return {status: terminal ? "failed" as const : "queued" as const,
    reasonCode: terminal ? "delivery_failed" : "retry_scheduled"};
}
