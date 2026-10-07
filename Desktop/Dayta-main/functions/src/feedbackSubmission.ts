import {createHash} from "node:crypto";
import type {Auth} from "firebase-admin/auth";
import {FieldValue, Timestamp, type Firestore} from "firebase-admin/firestore";
import type {Bucket} from "@google-cloud/storage";

export const FEEDBACK_SUBMISSION_CALLABLE_NAME = "submitFeedback";
export const FEEDBACK_COLLECTION = "feedbackSubmissions";
export const FEEDBACK_RATE_LIMIT_COLLECTION = "feedbackRateLimits";
export const FEEDBACK_SCHEMA_VERSION = 1;
export const FEEDBACK_HOURLY_LIMIT = 5;
export const FEEDBACK_DAILY_LIMIT = 20;
const TYPES = ["bug", "feature_request", "general", "support"] as const;
const MIMES = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
const REQUEST_KEYS = ["schemaVersion", "feedbackId", "type", "subject",
  "message", "allowContact", "replyEmail", "attachments", "appMetadata"];
const ATTACHMENT_KEYS = ["id", "kind", "storagePath", "contentType",
  "sizeBytes", "width", "height", "durationMs", "uploadedAtMs"];
const APP_KEYS = ["appVersion", "buildVersion", "platform", "osVersion",
  "locale", "timezone", "themeId"];

export type FeedbackIntakeErrorCode = "unauthenticated" | "invalid_request" |
  "invalid_attachment" | "rate_limited" | "submission_conflict";
export class FeedbackIntakeError extends Error {
  constructor(public readonly code: FeedbackIntakeErrorCode) {
    super(code);
  }
}
type Attachment = {
  id: string; kind: "image" | "video"; storagePath: string;
  contentType: string; sizeBytes: number; width: number; height: number;
  durationMs: number | null; uploadedAtMs: number;
};
type NormalizedRequest = {
  schemaVersion: 1; feedbackId: string; type: typeof TYPES[number];
  subject: string | null; message: string; allowContact: boolean;
  replyEmail: string | null; attachments: Attachment[];
  appMetadata: Record<string, string | null>;
};
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const safeId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const nullableBounded = (value: unknown, max: number) =>
  value == null ? null : typeof value === "string" &&
    value.length <= max ? value : undefined;
const normalizeEmail = (value: unknown) => {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || email.length > 254 || /[\r\n\u0000,;<>\s]/.test(email) ||
    /^mailto:/i.test(email)) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    !domain.includes(".") || !domain.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return `${local}@${domain}`;
};

export function normalizeFeedbackRequest(value: unknown): NormalizedRequest {
  if (!value || typeof value !== "object" ||
    !exactKeys(value as Record<string, unknown>, REQUEST_KEYS)) {
    throw new FeedbackIntakeError("invalid_request");
  }
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || !safeId(data.feedbackId) ||
    !TYPES.includes(data.type as typeof TYPES[number]) ||
    typeof data.allowContact !== "boolean") {
    throw new FeedbackIntakeError("invalid_request");
  }
  const subjectRaw = nullableBounded(data.subject, 120);
  const subject = typeof subjectRaw === "string" ? subjectRaw.trim() : subjectRaw;
  if (subjectRaw === undefined || (subject && /[\r\n\u0000-\u001f]/.test(subject))) {
    throw new FeedbackIntakeError("invalid_request");
  }
  if (typeof data.message !== "string") {
    throw new FeedbackIntakeError("invalid_request");
  }
  const message = data.message.replace(/\r\n?/g, "\n").trim();
  if (!message || message.length > 5000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    throw new FeedbackIntakeError("invalid_request");
  }
  const replyEmail = data.allowContact ? normalizeEmail(data.replyEmail) : null;
  if (data.allowContact && !replyEmail) {
    throw new FeedbackIntakeError("invalid_request");
  }
  if (!Array.isArray(data.attachments) || data.attachments.length > 4 ||
    !data.appMetadata || typeof data.appMetadata !== "object" ||
    !exactKeys(data.appMetadata as Record<string, unknown>, APP_KEYS)) {
    throw new FeedbackIntakeError("invalid_request");
  }
  const app = data.appMetadata as Record<string, unknown>;
  const appMetadata: Record<string, string | null> = {};
  for (const key of APP_KEYS) {
    const normalized = nullableBounded(app[key], 128);
    if (normalized === undefined) throw new FeedbackIntakeError("invalid_request");
    appMetadata[key] = normalized;
  }
  if (!["ios", "android", "web", "unknown"].includes(
    appMetadata.platform ?? "")) throw new FeedbackIntakeError("invalid_request");
  const seen = new Set<string>();
  let images = 0; let videos = 0; let total = 0;
  const attachments = data.attachments.map((raw): Attachment => {
    if (!raw || typeof raw !== "object" ||
      !exactKeys(raw as Record<string, unknown>, ATTACHMENT_KEYS)) {
      throw new FeedbackIntakeError("invalid_attachment");
    }
    const a = raw as Record<string, unknown>;
    if (!safeId(a.id) || seen.has(a.id) ||
      (a.kind !== "image" && a.kind !== "video") ||
      typeof a.contentType !== "string" || !MIMES.includes(a.contentType) ||
      !Number.isInteger(a.sizeBytes) || (a.sizeBytes as number) <= 0 ||
      !Number.isFinite(a.width) || (a.width as number) <= 0 ||
      !Number.isFinite(a.height) || (a.height as number) <= 0 ||
      !Number.isFinite(a.uploadedAtMs) || (a.uploadedAtMs as number) <= 0) {
      throw new FeedbackIntakeError("invalid_attachment");
    }
    seen.add(a.id);
    if (a.kind === "image") {
      images++;
      if (!a.contentType.startsWith("image/") ||
        (a.sizeBytes as number) > 10 * 1024 * 1024 ||
        a.durationMs != null) throw new FeedbackIntakeError("invalid_attachment");
    } else {
      videos++;
      if (a.contentType !== "video/mp4" ||
        (a.sizeBytes as number) > 50 * 1024 * 1024 ||
        !Number.isFinite(a.durationMs) || (a.durationMs as number) <= 0 ||
        (a.durationMs as number) > 30000) {
        throw new FeedbackIntakeError("invalid_attachment");
      }
    }
    total += a.sizeBytes as number;
    return a as Attachment;
  });
  if (images > 4 || videos > 1 || total > 50 * 1024 * 1024) {
    throw new FeedbackIntakeError("invalid_attachment");
  }
  return {schemaVersion: 1, feedbackId: data.feedbackId, type: data.type as
    typeof TYPES[number], subject: subject || null, message,
  allowContact: data.allowContact, replyEmail, attachments:
    attachments.sort((a, b) => a.id.localeCompare(b.id)), appMetadata};
}

export const fingerprintFeedbackRequest = (request: NormalizedRequest) =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");

export async function verifyFeedbackAttachments(
  bucket: Bucket, uid: string, request: NormalizedRequest
) {
  for (const attachment of request.attachments) {
    const expectedPath =
      `feedback/${uid}/${request.feedbackId}/${attachment.id}`;
    if (attachment.storagePath !== expectedPath) {
      throw new FeedbackIntakeError("invalid_attachment");
    }
    let metadata;
    try {
      [metadata] = await bucket.file(expectedPath).getMetadata();
    } catch {
      throw new FeedbackIntakeError("invalid_attachment");
    }
    const custom = metadata.metadata ?? {};
    if (metadata.contentType !== attachment.contentType ||
      Number(metadata.size) !== attachment.sizeBytes ||
      custom.ownerUid !== uid || custom.feedbackId !== request.feedbackId ||
      custom.attachmentId !== attachment.id ||
      custom.kind !== attachment.kind ||
      Number(custom.sizeBytes) !== attachment.sizeBytes ||
      Number(custom.width) !== attachment.width ||
      Number(custom.height) !== attachment.height ||
      Number(custom.uploadedAtMs) !== attachment.uploadedAtMs ||
      (attachment.durationMs == null ? custom.durationMs !== "" :
        Number(custom.durationMs) !== attachment.durationMs)) {
      throw new FeedbackIntakeError("invalid_attachment");
    }
  }
}

export async function handleSubmitFeedback(input: {
  uid: string | null; data: unknown; firestore: Firestore; auth: Auth;
  bucket: Bucket; nowMs?: number;
}) {
  if (!input.uid) throw new FeedbackIntakeError("unauthenticated");
  const request = normalizeFeedbackRequest(input.data);
  const fingerprint = fingerprintFeedbackRequest(request);
  const canonicalRef = input.firestore.collection(FEEDBACK_COLLECTION)
    .doc(request.feedbackId);
  const existing = await canonicalRef.get();
  if (existing.exists) {
    if (existing.data()?.submittedByUid === input.uid &&
      existing.data()?.requestFingerprint === fingerprint) {
      return {feedbackId: request.feedbackId, accepted: true as const,
        alreadyExisted: true};
    }
    throw new FeedbackIntakeError("submission_conflict");
  }
  const authUser = await input.auth.getUser(input.uid);
  const accountEmailSnapshot = authUser.email ?
    normalizeEmail(authUser.email) : null;
  await verifyFeedbackAttachments(input.bucket, input.uid, request);
  const nowMs = input.nowMs ?? Date.now();
  const hourBucket = Math.floor(nowMs / 3_600_000);
  const dayBucket = Math.floor(nowMs / 86_400_000);
  const hourRef = input.firestore.collection(FEEDBACK_RATE_LIMIT_COLLECTION)
    .doc(`${input.uid}_hour_${hourBucket}`);
  const dayRef = input.firestore.collection(FEEDBACK_RATE_LIMIT_COLLECTION)
    .doc(`${input.uid}_day_${dayBucket}`);
  return input.firestore.runTransaction(async (transaction) => {
    const [current, hour, day] = await Promise.all([
      transaction.get(canonicalRef), transaction.get(hourRef),
      transaction.get(dayRef),
    ]);
    if (current.exists) {
      if (current.data()?.submittedByUid === input.uid &&
        current.data()?.requestFingerprint === fingerprint) {
        return {feedbackId: request.feedbackId, accepted: true as const,
          alreadyExisted: true};
      }
      throw new FeedbackIntakeError("submission_conflict");
    }
    if ((hour.data()?.count ?? 0) >= FEEDBACK_HOURLY_LIMIT ||
      (day.data()?.count ?? 0) >= FEEDBACK_DAILY_LIMIT) {
      throw new FeedbackIntakeError("rate_limited");
    }
    transaction.set(hourRef, {ownerUid: input.uid, kind: "hour",
      bucket: hourBucket, count: FieldValue.increment(1), updatedAtMs: nowMs,
      expiresAtMs: (hourBucket + 2) * 3_600_000,
      expiresAt: Timestamp.fromMillis((hourBucket + 2) * 3_600_000)},
    {merge: true});
    transaction.set(dayRef, {ownerUid: input.uid, kind: "day",
      bucket: dayBucket, count: FieldValue.increment(1), updatedAtMs: nowMs,
      expiresAtMs: (dayBucket + 2) * 86_400_000,
      expiresAt: Timestamp.fromMillis((dayBucket + 2) * 86_400_000)},
    {merge: true});
    transaction.create(canonicalRef, {...request,
      submittedByUid: input.uid, accountEmailSnapshot,
      attachmentCount: request.attachments.length,
      totalAttachmentBytes: request.attachments.reduce(
        (sum, item) => sum + item.sizeBytes, 0),
      status: "submitted", requestFingerprint: fingerprint,
      createdAtMs: nowMs, createdAt: FieldValue.serverTimestamp()});
    return {feedbackId: request.feedbackId, accepted: true as const,
      alreadyExisted: false};
  });
}
