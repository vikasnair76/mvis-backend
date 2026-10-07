import type {Bucket, File} from "@google-cloud/storage";
import {FieldValue, type Firestore} from "firebase-admin/firestore";
import {
  FEEDBACK_EMAIL_MAX_ATTEMPTS,
  type FeedbackEmailProvider,
  processFeedbackDelivery,
} from "./feedbackEmailDelivery.js";

export const FEEDBACK_ORPHAN_GRACE_MS = 7 * 86_400_000;
export const FEEDBACK_CLEANUP_PAGE_SIZE = 250;
export const FEEDBACK_CLEANUP_MAX_OBJECTS = 2000;
export const FEEDBACK_CLEANUP_CONCURRENCY = 5;
export const FEEDBACK_MAINTENANCE_LEASE_MS = 30 * 60_000;
export const FEEDBACK_DELIVERY_STUCK_MS = 15 * 60_000;
export const FEEDBACK_DELIVERY_RECONCILE_LIMIT = 100;

export type FeedbackMaintenanceErrorCode =
  "lease_unavailable" | "storage_list_failed" | "storage_metadata_failed" |
  "invalid_storage_path" | "canonical_lookup_failed" |
  "storage_delete_failed" | "checkpoint_write_failed" |
  "delivery_query_failed" | "delivery_reconcile_failed" |
  "configuration_invalid" | "unknown";

export type FeedbackObjectIdentity = {
  uid: string; feedbackId: string; attachmentId: string;
};
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function parseFeedbackObjectPath(path: string):
FeedbackObjectIdentity | null {
  const parts = path.split("/");
  if (parts.length !== 4 || parts[0] !== "feedback" ||
    parts.slice(1).some((part) => !SAFE_ID.test(part))) return null;
  return {uid: parts[1], feedbackId: parts[2], attachmentId: parts[3]};
}

export function classifyFeedbackOrphan(input: {
  identity: FeedbackObjectIdentity | null;
  createdAtMs: number | null;
  nowMs: number;
  canonicalExists: boolean | null;
}) {
  if (!input.identity) return "malformed" as const;
  if (!Number.isFinite(input.createdAtMs) || !input.createdAtMs ||
    input.createdAtMs > input.nowMs) return "invalid_age" as const;
  if (input.nowMs - input.createdAtMs < FEEDBACK_ORPHAN_GRACE_MS) {
    return "recent" as const;
  }
  if (input.canonicalExists == null) return "lookup_failed" as const;
  return input.canonicalExists ? "finalized" as const : "eligible" as const;
}

export async function acquireFeedbackMaintenanceLease(input: {
  firestore: Firestore; operation: string; owner: string; nowMs: number;
}) {
  const ref = input.firestore.collection("feedbackOperations")
    .doc(input.operation);
  return input.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    if (Number(data.leaseExpiresAtMs ?? 0) > input.nowMs &&
      data.leaseOwner !== input.owner) return false;
    transaction.set(ref, {leaseOwner: input.owner,
      leaseExpiresAtMs: input.nowMs + FEEDBACK_MAINTENANCE_LEASE_MS,
      lastStartedAtMs: input.nowMs,
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    return true;
  });
}

async function mapBounded<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({
    length: Math.min(FEEDBACK_CLEANUP_CONCURRENCY, items.length),
  }, async () => {
    while (next < items.length) await worker(items[next++]);
  }));
}

export async function cleanupAbandonedFeedbackAttachments(input: {
  firestore: Firestore; bucket: Bucket; owner: string; nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const leased = await acquireFeedbackMaintenanceLease({firestore:
    input.firestore, operation: "orphanCleanup", owner: input.owner, nowMs});
  if (!leased) return {status: "lease_unavailable" as const};
  const stats = {inspected: 0, deleted: 0, recent: 0, finalized: 0,
    malformed: 0, errors: 0};
  let pageToken: string | undefined;
  try {
    do {
      let files: File[]; let nextQuery: {pageToken?: string} | null;
      try {
        [files, nextQuery] = await input.bucket.getFiles({prefix: "feedback/",
          maxResults: Math.min(FEEDBACK_CLEANUP_PAGE_SIZE,
            FEEDBACK_CLEANUP_MAX_OBJECTS - stats.inspected),
          autoPaginate: false, pageToken});
      } catch {
        stats.errors++; break;
      }
      await mapBounded(files, async (file) => {
        stats.inspected++;
        const identity = parseFeedbackObjectPath(file.name);
        if (!identity) { stats.malformed++; return; }
        let createdAtMs: number | null = null;
        try {
          const [metadata] = await file.getMetadata();
          createdAtMs = Date.parse(String(metadata.timeCreated ?? ""));
        } catch { stats.errors++; return; }
        if (!Number.isFinite(createdAtMs)) { stats.errors++; return; }
        if (nowMs - createdAtMs < FEEDBACK_ORPHAN_GRACE_MS) {
          stats.recent++; return;
        }
        let canonical;
        try {
          canonical = await input.firestore.collection("feedbackSubmissions")
            .doc(identity.feedbackId).get();
        } catch { stats.errors++; return; }
        if (canonical.exists) { stats.finalized++; return; }
        try {
          await file.delete({ignoreNotFound: true}); stats.deleted++;
        } catch { stats.errors++; }
      });
      pageToken = nextQuery?.pageToken;
    } while (pageToken && stats.inspected < FEEDBACK_CLEANUP_MAX_OBJECTS);
  } finally {
    await input.firestore.collection("feedbackOperations").doc("orphanCleanup")
      .set({leaseOwner: null, leaseExpiresAtMs: 0,
        lastCompletedAtMs: Date.now(), lastRunStatus:
          stats.errors ? "completed_with_errors" : "completed",
        ...stats, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
  }
  return {status: "completed" as const, ...stats};
}

export async function reconcileStuckFeedbackDeliveries(input: {
  firestore: Firestore; bucket: Bucket; provider: FeedbackEmailProvider;
  recipient: string; sender: string; owner: string; nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const leased = await acquireFeedbackMaintenanceLease({firestore:
    input.firestore, operation: "deliveryReconciliation",
  owner: input.owner, nowMs});
  if (!leased) return {status: "lease_unavailable" as const};
  let recovered = 0; let skipped = 0; let errors = 0;
  try {
    const snapshot = await input.firestore.collectionGroup("deliveries")
      .where("state", "==", "processing")
      .where("claimedAtMs", "<=", nowMs - FEEDBACK_DELIVERY_STUCK_MS)
      .limit(FEEDBACK_DELIVERY_RECONCILE_LIMIT).get();
    for (const delivery of snapshot.docs) {
      const data = delivery.data();
      if (delivery.id !== "email" ||
        Number(data.attemptCount ?? 0) >= FEEDBACK_EMAIL_MAX_ATTEMPTS) {
        skipped++; continue;
      }
      const submissionRef = delivery.ref.parent.parent;
      if (!submissionRef) { skipped++; continue; }
      try {
        const result = await processFeedbackDelivery({
          firestore: input.firestore, bucket: input.bucket,
          provider: input.provider, feedbackId: submissionRef.id,
          eventId: `reconcile-${delivery.createTime.toMillis()}`,
          recipient: input.recipient, sender: input.sender, nowMs,
        });
        if (result.status === "sent") recovered++; else skipped++;
      } catch { errors++; }
    }
  } finally {
    await input.firestore.collection("feedbackOperations")
      .doc("deliveryReconciliation").set({leaseOwner: null,
        leaseExpiresAtMs: 0, lastCompletedAtMs: Date.now(), recovered,
        skipped, errors, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
  }
  return {status: "completed" as const, recovered, skipped, errors};
}
