import * as Crypto from "expo-crypto";
import {deleteObject, ref, uploadBytesResumable, type UploadTask}
  from "firebase/storage";
import {storage} from "./firebase";
import {
  FEEDBACK_ALLOWED_CONTENT_TYPES,
  FEEDBACK_MAX_ATTACHMENTS,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES,
  FEEDBACK_MAX_VIDEO_BYTES,
  FEEDBACK_MAX_VIDEO_DURATION_MS,
  FEEDBACK_MAX_VIDEOS,
  buildFeedbackStoragePath,
  isValidFeedbackId,
  type FeedbackAllowedContentType,
  type FeedbackAttachmentDoc,
  type FeedbackAttachmentKind,
} from "./feedback";

export const FEEDBACK_UPLOAD_CONCURRENCY = 2;
export const FEEDBACK_ATTACHMENT_CACHE_LIMIT = 6;
const normalizeProgress = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export const FEEDBACK_ATTACHMENT_MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/x-png": "image/png",
  "video/mpeg4": "video/mp4",
};

export type FeedbackAttachmentLocalStatus =
  | "ready" | "uploading" | "uploaded" | "failed" | "canceling";
export type FeedbackAttachmentErrorCode =
  | "unsupported_media" | "file_too_large" | "video_too_long"
  | "too_many_attachments" | "duplicate_attachment" | "invalid_metadata"
  | "read_failed" | "upload_failed" | "cancelled" | "interrupted";
export type FeedbackAttachmentDraftItem = {
  id: string;
  kind: FeedbackAttachmentKind;
  localUri: string;
  previewUri: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  storagePath: string | null;
  uploadedAtMs: number | null;
  progress: number;
  status: FeedbackAttachmentLocalStatus;
  attemptId: string | null;
  errorCode: FeedbackAttachmentErrorCode | null;
};
export type FeedbackAttachmentDraft = {
  feedbackId: string | null;
  items: FeedbackAttachmentDraftItem[];
};
export type FeedbackPickerCandidate = {
  kind: FeedbackAttachmentKind;
  localUri: string;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};
export type FeedbackUploadHandle = {
  promise: Promise<FeedbackAttachmentDoc>;
  cancel: () => boolean;
};

const cache = new Map<string, FeedbackAttachmentDraft>();
export const createFeedbackMediaId = () =>
  Crypto.randomUUID().replace(/-/g, "");
export const createEmptyFeedbackAttachmentDraft = (): FeedbackAttachmentDraft =>
  ({feedbackId: null, items: []});
export const ensureFeedbackId = (value: string | null) =>
  value && isValidFeedbackId(value) ? value : createFeedbackMediaId();
export const normalizeFeedbackAttachmentMime = (value: unknown) => {
  if (typeof value !== "string") return null;
  const mime = value.trim().toLowerCase();
  return FEEDBACK_ATTACHMENT_MIME_ALIASES[mime] ?? mime;
};
export const getFeedbackAttachmentErrorMessage = (
  code: FeedbackAttachmentErrorCode
) => {
  if (code === "file_too_large") return "This attachment is too large.";
  if (code === "video_too_long") return "Videos must be 30 seconds or shorter.";
  if (code === "too_many_attachments") {
    return "You can attach up to 4 images or one short video.";
  }
  if (code === "duplicate_attachment") {
    return "This attachment is already selected.";
  }
  if (code === "unsupported_media") {
    return "Choose a JPEG, PNG, WebP, or MP4 file.";
  }
  if (code === "cancelled") return "Upload canceled.";
  if (code === "interrupted") return "Upload interrupted. Tap Retry.";
  return "This attachment could not be uploaded. Please try again.";
};

export function validateFeedbackPickerCandidate(
  candidate: FeedbackPickerCandidate,
  existing: readonly FeedbackAttachmentDraftItem[]
): {ok: true; item: FeedbackAttachmentDraftItem} |
  {ok: false; code: FeedbackAttachmentErrorCode} {
  const mime = normalizeFeedbackAttachmentMime(candidate.contentType);
  if (!candidate.localUri.trim() ||
    !mime ||
    !(FEEDBACK_ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime) ||
    (candidate.kind === "image" && !mime.startsWith("image/")) ||
    (candidate.kind === "video" && mime !== "video/mp4")) {
    return {ok: false, code: "unsupported_media"};
  }
  const size = candidate.sizeBytes;
  if (!Number.isFinite(size) || !size || size <= 0) {
    return {ok: false, code: "invalid_metadata"};
  }
  const width = candidate.width;
  const height = candidate.height;
  if (!Number.isFinite(width) || !width || width <= 0 ||
    !Number.isFinite(height) || !height || height <= 0) {
    return {ok: false, code: "invalid_metadata"};
  }
  if ((candidate.kind === "image" && size > FEEDBACK_MAX_IMAGE_BYTES) ||
    (candidate.kind === "video" && size > FEEDBACK_MAX_VIDEO_BYTES)) {
    return {ok: false, code: "file_too_large"};
  }
  if (candidate.kind === "video" &&
    (!Number.isFinite(candidate.durationMs) || !candidate.durationMs ||
      candidate.durationMs <= 0)) {
    return {ok: false, code: "invalid_metadata"};
  }
  if (candidate.kind === "video" &&
    candidate.durationMs! > FEEDBACK_MAX_VIDEO_DURATION_MS) {
    return {ok: false, code: "video_too_long"};
  }
  if (existing.some((item) => item.localUri === candidate.localUri)) {
    return {ok: false, code: "duplicate_attachment"};
  }
  const imageCount = existing.filter((item) => item.kind === "image").length;
  const videoCount = existing.filter((item) => item.kind === "video").length;
  const total = existing.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  if (existing.length >= FEEDBACK_MAX_ATTACHMENTS ||
    (candidate.kind === "image" && imageCount >= FEEDBACK_MAX_IMAGES) ||
    (candidate.kind === "video" && videoCount >= FEEDBACK_MAX_VIDEOS) ||
    total + size > FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES) {
    return {ok: false, code: "too_many_attachments"};
  }
  return {ok: true, item: {
    id: createFeedbackMediaId(), kind: candidate.kind,
    localUri: candidate.localUri, previewUri: candidate.localUri,
    contentType: mime, sizeBytes: size, width, height,
    durationMs: candidate.kind === "video" ? candidate.durationMs : null,
    storagePath: null, uploadedAtMs: null, progress: 0, status: "ready",
    attemptId: null, errorCode: null,
  }};
}

export function applyFeedbackUploadUpdate(
  item: FeedbackAttachmentDraftItem,
  attemptId: string,
  update: {type: "progress"; progress: number} |
    {type: "success"; claim: FeedbackAttachmentDoc} |
    {type: "failure"; code: FeedbackAttachmentErrorCode}
) {
  if (item.attemptId !== attemptId || item.status === "canceling") return item;
  if (update.type === "progress") {
    return {...item, progress: normalizeProgress(update.progress)};
  }
  if (update.type === "failure") {
    return {...item, status: "failed" as const, errorCode: update.code,
      attemptId: null};
  }
  return {...item, status: "uploaded" as const, progress: 1,
    storagePath: update.claim.storagePath,
    uploadedAtMs: update.claim.uploadedAtMs, attemptId: null, errorCode: null};
}

export function toFeedbackAttachmentClaim(
  item: FeedbackAttachmentDraftItem,
  expected: {uid: string; feedbackId: string}
): FeedbackAttachmentDoc | null {
  const mime = normalizeFeedbackAttachmentMime(item.contentType);
  if (item.status !== "uploaded" || !item.storagePath || !item.uploadedAtMs ||
    !mime || !(FEEDBACK_ALLOWED_CONTENT_TYPES as readonly string[])
      .includes(mime) || !item.sizeBytes || !item.width || !item.height ||
    (item.kind === "video" && !item.durationMs) ||
    item.storagePath !== buildFeedbackStoragePath({uid: expected.uid,
      feedbackId: expected.feedbackId, attachmentId: item.id})) return null;
  return {id: item.id, kind: item.kind, storagePath: item.storagePath,
    contentType: mime as FeedbackAllowedContentType,
    sizeBytes: item.sizeBytes, width: item.width, height: item.height,
    durationMs: item.kind === "video" ? item.durationMs : null,
    uploadedAtMs: item.uploadedAtMs};
}
export const toFeedbackAttachmentClaims = (
  items: readonly FeedbackAttachmentDraftItem[],
  expected: {uid: string; feedbackId: string}
) => items.map((item) => toFeedbackAttachmentClaim(item, expected))
  .filter((item): item is FeedbackAttachmentDoc => !!item);

export function uploadFeedbackAttachment(input: {
  uid: string; feedbackId: string; item: FeedbackAttachmentDraftItem;
  attemptId: string; onProgress: (value: number) => void;
}): FeedbackUploadHandle {
  if (!isValidFeedbackId(input.uid) || !isValidFeedbackId(input.feedbackId) ||
    !isValidFeedbackId(input.item.id) || !input.item.contentType) {
    throw new Error("invalid_feedback_attachment");
  }
  const storagePath = buildFeedbackStoragePath({uid: input.uid,
    feedbackId: input.feedbackId, attachmentId: input.item.id});
  const contentType = input.item.contentType;
  let task: UploadTask | null = null;
  let canceled = false;
  const promise = (async () => {
    let blob: Blob;
    try {
      const response = await fetch(input.item.localUri);
      if (!response.ok) throw new Error("read_failed");
      blob = await response.blob();
    } catch {
      throw new Error(canceled ? "cancelled" : "read_failed");
    }
    if (canceled) throw new Error("cancelled");
    if (blob.size !== input.item.sizeBytes ||
      (blob.type && normalizeFeedbackAttachmentMime(blob.type) !==
        contentType)) throw new Error("invalid_metadata");
    const objectRef = ref(storage, storagePath);
    const uploadedAtMs = Date.now();
    task = uploadBytesResumable(objectRef, blob, {
      contentType,
      customMetadata: {ownerUid: input.uid, feedbackId: input.feedbackId,
        attachmentId: input.item.id, kind: input.item.kind,
        sizeBytes: String(input.item.sizeBytes),
        width: String(input.item.width),
        height: String(input.item.height),
        durationMs: input.item.durationMs == null ? "" :
          String(input.item.durationMs),
        uploadedAtMs: String(uploadedAtMs)},
    });
    await new Promise<void>((resolve, reject) => task?.on("state_changed",
      (snapshot) => input.onProgress(snapshot.totalBytes ?
        snapshot.bytesTransferred / snapshot.totalBytes : 0),
      (error) => reject(new Error(error.code === "storage/canceled" ?
        "cancelled" : "upload_failed")), resolve));
    return {id: input.item.id, kind: input.item.kind, storagePath,
      contentType: contentType as FeedbackAllowedContentType,
      sizeBytes: blob.size, width: input.item.width,
      height: input.item.height, durationMs: input.item.durationMs,
      uploadedAtMs};
  })();
  return {promise, cancel: () => task ? task.cancel() : (canceled = true)};
}

export async function cleanupFeedbackAttachment(input: {
  uid: string; feedbackId: string; attachmentId: string;
}) {
  const path = buildFeedbackStoragePath(input);
  try {
    await deleteObject(ref(storage, path));
    return "deleted" as const;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ?
      String(error.code) : "";
    return code === "storage/object-not-found" ? "missing" as const :
      "failed" as const;
  }
}

export function saveFeedbackAttachmentDraft(
  uid: string, draft: FeedbackAttachmentDraft
) {
  if (!isValidFeedbackId(uid)) return;
  if (!draft.items.length && !draft.feedbackId) {
    cache.delete(uid);
    return;
  }
  const normalized = {feedbackId: draft.feedbackId,
    items: draft.items.map((item) => item.status === "uploading" ||
      item.status === "canceling" ? {...item, status: "failed" as const,
        attemptId: null, errorCode: "interrupted" as const} :
      {...item, attemptId: null})};
  cache.delete(uid);
  cache.set(uid, normalized);
  while (cache.size > FEEDBACK_ATTACHMENT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}
export function restoreFeedbackAttachmentDraft(uid: string) {
  const value = cache.get(uid);
  return value ? {feedbackId: value.feedbackId,
    items: value.items.map((item) => ({...item}))} : null;
}
export const clearFeedbackAttachmentDraft = (uid: string) => cache.delete(uid);
export const clearFeedbackAttachmentCacheForQa = () => cache.clear();
