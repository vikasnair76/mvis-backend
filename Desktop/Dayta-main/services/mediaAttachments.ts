import * as Crypto from "expo-crypto";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";
import { storage } from "./firebase";

export const MAX_MEDIA_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_GIF_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_DURATION_MS = 30_000;

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const ALLOWED_GIF_MIME_TYPES = ["image/gif"] as const;
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4"] as const;

export type MediaAttachmentType =
  | "image"
  | "gif"
  | "video"
  | "video_link";

export type MediaAttachmentContext =
  | { type: "progress"; goalId: string; subtaskId: string; progressEventId: string }
  | { type: "bulletin"; groupId: string; bulletinId: string }
  | { type: "bulletin_comment"; groupId: string; bulletinId: string; commentId: string }
  | { type: "shared_goal_comment"; groupId: string; goalId: string; commentId: string }
  | { type: "group_dm_message"; groupId: string; dmId: string; messageId: string }
  | { type: "group_conversation_message"; groupId: string; conversationId: string; messageId: string };

export type MediaAttachmentContextType = MediaAttachmentContext["type"];

export type ParsedMediaStoragePath =
  | ({ uploaderUid: string; attachmentId: string; extension: string } & MediaAttachmentContext);

export type MediaAttachmentPolicy = {
  maxAttachments: number;
  maxUploadedVideos: number;
  allowedTypes: readonly MediaAttachmentType[];
  maxImageBytes: number;
  maxGifBytes: number;
  maxVideoBytes: number;
  maxVideoDurationMs: number;
  allowEmptyBodyWithAttachment: boolean;
};

const UPLOAD_TYPES = ["image", "gif", "video"] as const;
export const MEDIA_ATTACHMENT_POLICIES: Record<MediaAttachmentContextType, MediaAttachmentPolicy> = {
  progress: { maxAttachments: 4, maxUploadedVideos: 1, allowedTypes: [...UPLOAD_TYPES, "video_link"], maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: false },
  bulletin: { maxAttachments: 4, maxUploadedVideos: 1, allowedTypes: [...UPLOAD_TYPES, "video_link"], maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: true },
  bulletin_comment: { maxAttachments: 2, maxUploadedVideos: 1, allowedTypes: UPLOAD_TYPES, maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: true },
  shared_goal_comment: { maxAttachments: 2, maxUploadedVideos: 1, allowedTypes: UPLOAD_TYPES, maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: true },
  group_dm_message: { maxAttachments: 4, maxUploadedVideos: 1, allowedTypes: UPLOAD_TYPES, maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: true },
  group_conversation_message: { maxAttachments: 4, maxUploadedVideos: 1, allowedTypes: UPLOAD_TYPES, maxImageBytes: MAX_IMAGE_BYTES, maxGifBytes: MAX_GIF_BYTES, maxVideoBytes: MAX_VIDEO_BYTES, maxVideoDurationMs: MAX_VIDEO_DURATION_MS, allowEmptyBodyWithAttachment: true },
};

export type MediaAttachmentDoc = {
  id: string;
  type: MediaAttachmentType;
  storagePath?: string | null;
  downloadUrl?: string | null;
  thumbnailUrl?: string | null;
  externalUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  uploadedByUid?: string | null;
  createdAtMs?: number | null;
  provider?: "youtube" | null;
  providerMediaId?: string | null;
  title?: string | null;
};

export type NormalizedVideoLink = {
  provider: "youtube";
  providerMediaId: string;
  externalUrl: string;
  thumbnailUrl: string;
  displayLabel: string;
};

export type LocalMediaAttachmentCandidate = {
  localUri: string;
  type: Exclude<MediaAttachmentType, "video_link">;
  mimeType: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

export type MediaUploadStatus =
  | "pending"
  | "preparing"
  | "uploading"
  | "uploaded"
  | "failed"
  | "cancelled";

export type MediaUploadItem = {
  id: string;
  candidate: LocalMediaAttachmentCandidate;
  status: MediaUploadStatus;
  progress: number;
  attachment?: MediaAttachmentDoc;
  errorCode?: MediaAttachmentErrorCode;
};

export type MediaAttachmentErrorCode =
  | "invalid_candidate"
  | "invalid_identifier"
  | "unsupported_mime"
  | "mime_mismatch"
  | "file_too_large"
  | "video_too_long"
  | "read_failed"
  | "upload_failed"
  | "cancelled";

export class MediaAttachmentError extends Error {
  constructor(
    public readonly code: MediaAttachmentErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MediaAttachmentError";
  }
}

export type UploadMediaAttachmentInput = {
  candidate: LocalMediaAttachmentCandidate;
  uploaderUid: string;
  goalId: string;
  subtaskId: string;
  progressEventId: string;
  attachmentId?: string;
  uploadSessionId?: string;
  onProgress?: (progress: number) => void;
};

export type UploadContextMediaAttachmentInput = {
  candidate: LocalMediaAttachmentCandidate;
  uploaderUid: string;
  context: MediaAttachmentContext;
  attachmentId?: string;
  uploadSessionId?: string;
  onProgress?: (progress: number) => void;
};

export type MediaUploadHandle = {
  attachmentId: string;
  storagePath: string;
  promise: Promise<MediaAttachmentDoc>;
  cancel: () => boolean;
};

export type UploadMediaAttachmentBatchItem = {
  attachmentId: string;
  candidate: LocalMediaAttachmentCandidate;
};

export type UploadMediaAttachmentBatchInput = {
  items: UploadMediaAttachmentBatchItem[];
  uploaderUid: string;
  goalId: string;
  subtaskId: string;
  progressEventId: string;
  uploadSessionId?: string;
  onItemProgress?: (attachmentId: string, progress: number) => void;
  onItemStatus?: (
    attachmentId: string,
    status: MediaUploadStatus,
    errorCode?: MediaAttachmentErrorCode
  ) => void;
};

export type UploadContextMediaAttachmentBatchInput = {
  items: UploadMediaAttachmentBatchItem[];
  uploaderUid: string;
  context: MediaAttachmentContext;
  uploadSessionId?: string;
  onItemProgress?: (attachmentId: string, progress: number) => void;
  onItemStatus?: UploadMediaAttachmentBatchInput["onItemStatus"];
};

export type MediaUploadBatchResult = {
  attachments: MediaAttachmentDoc[];
  cleanup: () => Promise<MediaCleanupResult>;
};

export type MediaUploadBatchHandle = {
  promise: Promise<MediaUploadBatchResult>;
  cancel: () => boolean;
};

export class MediaUploadBatchError extends MediaAttachmentError {
  constructor(
    code: MediaAttachmentErrorCode,
    message: string,
    public readonly attachmentId: string | null,
    public readonly cleanupResult: MediaCleanupResult
  ) {
    super(code, message);
    this.name = "MediaUploadBatchError";
  }
}

export type MediaCleanupResult = {
  deletedPaths: string[];
  alreadyMissingPaths: string[];
  failedPaths: string[];
};

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "video/mp4": ["mp4"],
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function hasInvalidOptionalNonnegativeNumber(
  data: Record<string, unknown>,
  key: string
): boolean {
  return (
    key in data &&
    data[key] != null &&
    (typeof data[key] !== "number" ||
      !Number.isFinite(data[key]) ||
      data[key] < 0)
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeVideoLink(
  rawUrl: string
): NormalizedVideoLink | null {
  const value = rawUrl.trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  ) {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if (pathParts[0] === "shorts") {
      videoId = pathParts[1] ?? null;
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    provider: "youtube",
    providerMediaId: videoId,
    externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    displayLabel: "YouTube video",
  };
}

export function createVideoLinkAttachment(input: {
  id?: string;
  rawUrl: string;
  createdByUid: string;
  createdAtMs?: number;
}): MediaAttachmentDoc {
  const normalized = normalizeVideoLink(input.rawUrl);
  if (!normalized || !input.createdByUid.trim()) {
    throw new MediaAttachmentError(
      "invalid_candidate",
      "Enter a valid YouTube video link."
    );
  }
  return {
    id: input.id ?? createMediaAttachmentId(),
    type: "video_link",
    storagePath: null,
    downloadUrl: null,
    thumbnailUrl: normalized.thumbnailUrl,
    externalUrl: normalized.externalUrl,
    mimeType: null,
    fileName: null,
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    uploadedByUid: input.createdByUid.trim(),
    createdAtMs: input.createdAtMs ?? Date.now(),
    provider: normalized.provider,
    providerMediaId: normalized.providerMediaId,
    title: normalized.displayLabel,
  };
}

function hasLocalUriField(data: Record<string, unknown>): boolean {
  return "localUri" in data || "uri" in data;
}

function isAllowedMimeForType(
  type: Exclude<MediaAttachmentType, "video_link">,
  mimeType: string
): boolean {
  if (type === "image") {
    return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
  }
  if (type === "gif") return mimeType === "image/gif";
  return (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

function maxBytesForType(
  type: Exclude<MediaAttachmentType, "video_link">,
  policy: MediaAttachmentPolicy = MEDIA_ATTACHMENT_POLICIES.progress
): number {
  if (type === "gif") return policy.maxGifBytes;
  if (type === "video") return policy.maxVideoBytes;
  return policy.maxImageBytes;
}

function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType]?.[0] ?? "";
}

function fileExtension(fileName?: string | null): string | null {
  const safeName = fileName?.trim().split(/[\\/]/).pop();
  if (!safeName?.includes(".")) return null;
  return safeName.split(".").pop()?.toLowerCase() ?? null;
}

function normalizeFileName(value: unknown): string | null {
  const name = nullableString(value)?.split(/[\\/]/).pop() ?? null;
  if (!name) return null;
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return sanitized || null;
}

function assertSafePathSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new MediaAttachmentError(
      "invalid_identifier",
      `${label} is not a valid media path identifier.`
    );
  }
  return segment;
}

export function validateMediaAttachmentContext(context: MediaAttachmentContext): void {
  if (!context || !MEDIA_ATTACHMENT_POLICIES[context.type]) {
    throw new MediaAttachmentError("invalid_identifier", "The media destination is invalid.");
  }
  for (const [key, value] of Object.entries(context)) {
    if (key !== "type") assertSafePathSegment(String(value), key);
  }
}

export function getMediaAttachmentPolicy(type: MediaAttachmentContextType): MediaAttachmentPolicy {
  const policy = MEDIA_ATTACHMENT_POLICIES[type];
  if (!policy) throw new MediaAttachmentError("invalid_identifier", "The media destination is invalid.");
  return policy;
}

export function parseMediaAttachmentStoragePath(value: string): ParsedMediaStoragePath | null {
  if (!value || value.includes("..") || /%2f|%5c/i.test(value)) return null;
  const p = value.split("/");
  const terminal = p[p.length - 1]?.match(/^original\.(jpg|png|webp|gif|mp4)$/);
  if (!terminal || p.some((segment) => !segment || (segment !== p[0] && segment !== p[p.length - 1] && !/^[A-Za-z0-9_-]+$/.test(segment)))) return null;
  const extension = terminal[1];
  if (p[0] === "progressMedia" && p.length === 7) return { type: "progress", uploaderUid: p[1], goalId: p[2], subtaskId: p[3], progressEventId: p[4], attachmentId: p[5], extension };
  if (p[0] === "bulletinMedia" && p.length === 6) return { type: "bulletin", groupId: p[1], bulletinId: p[2], uploaderUid: p[3], attachmentId: p[4], extension };
  if (p[0] === "bulletinCommentMedia" && p.length === 7) return { type: "bulletin_comment", groupId: p[1], bulletinId: p[2], commentId: p[3], uploaderUid: p[4], attachmentId: p[5], extension };
  if (p[0] === "sharedGoalCommentMedia" && p.length === 7) return { type: "shared_goal_comment", groupId: p[1], goalId: p[2], commentId: p[3], uploaderUid: p[4], attachmentId: p[5], extension };
  if (p[0] === "groupDmMedia" && p.length === 7) return { type: "group_dm_message", groupId: p[1], dmId: p[2], messageId: p[3], uploaderUid: p[4], attachmentId: p[5], extension };
  if (p[0] === "groupConversationMedia" && p.length === 7) return { type: "group_conversation_message", groupId: p[1], conversationId: p[2], messageId: p[3], uploaderUid: p[4], attachmentId: p[5], extension };
  return null;
}

export function normalizeMediaAttachmentType(
  value: unknown
): MediaAttachmentType | null {
  return value === "image" ||
    value === "gif" ||
    value === "video" ||
    value === "video_link"
    ? value
    : null;
}

export function normalizeLocalMediaCandidate(
  value: unknown
): LocalMediaAttachmentCandidate | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const type = normalizeMediaAttachmentType(data.type);
  const localUri = nullableString(data.localUri);
  const mimeType = nullableString(data.mimeType)?.toLowerCase() ?? null;
  if (!type || type === "video_link" || !localUri || !mimeType) return null;

  return {
    localUri,
    type,
    mimeType,
    fileName: normalizeFileName(data.fileName),
    sizeBytes: optionalNonnegativeNumber(data.sizeBytes),
    width: optionalNonnegativeNumber(data.width),
    height: optionalNonnegativeNumber(data.height),
    durationMs: optionalNonnegativeNumber(data.durationMs),
  };
}

export function validateLocalMediaCandidate(
  candidate: LocalMediaAttachmentCandidate,
  policy: MediaAttachmentPolicy = MEDIA_ATTACHMENT_POLICIES.progress
): void {
  if (!candidate.localUri.trim()) {
    throw new MediaAttachmentError(
      "invalid_candidate",
      "The selected media file is unavailable."
    );
  }

  if (!policy.allowedTypes.includes(candidate.type) || !isAllowedMimeForType(candidate.type, candidate.mimeType)) {
    throw new MediaAttachmentError(
      "unsupported_mime",
      "This media format is not supported."
    );
  }

  const extension = fileExtension(candidate.fileName);
  if (candidate.type === "video" && extension !== "mp4") {
    throw new MediaAttachmentError(
      "mime_mismatch",
      "Choose an MP4 video with a matching .mp4 file name."
    );
  }
  if (
    extension &&
    !MIME_EXTENSIONS[candidate.mimeType]?.includes(extension)
  ) {
    throw new MediaAttachmentError(
      "mime_mismatch",
      "The file name and media format do not match."
    );
  }

  for (const value of [
    candidate.sizeBytes,
    candidate.width,
    candidate.height,
    candidate.durationMs,
  ]) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new MediaAttachmentError(
        "invalid_candidate",
        "The selected media metadata is invalid."
      );
    }
  }

  if (
    candidate.sizeBytes != null &&
    candidate.sizeBytes > maxBytesForType(candidate.type, policy)
  ) {
    throw new MediaAttachmentError(
      "file_too_large",
      "The selected media file is too large."
    );
  }

  if (
    candidate.type === "video" &&
    (candidate.sizeBytes == null ||
      candidate.sizeBytes <= 0 ||
      candidate.durationMs == null ||
      candidate.durationMs <= 0)
  ) {
    throw new MediaAttachmentError(
      "invalid_candidate",
      "The selected video size and duration must be available."
    );
  }

  if (
    candidate.type === "video" &&
    candidate.durationMs! > policy.maxVideoDurationMs
  ) {
    throw new MediaAttachmentError(
      "video_too_long",
      "The selected video is longer than 30 seconds."
    );
  }
}

export function validateMediaAttachmentCandidates(
  candidates: LocalMediaAttachmentCandidate[],
  policy: MediaAttachmentPolicy = MEDIA_ATTACHMENT_POLICIES.progress
): void {
  if (candidates.length > policy.maxAttachments) {
    throw new MediaAttachmentError(
      "invalid_candidate",
      `You can attach up to ${policy.maxAttachments} files.`
    );
  }
  let videos = 0;
  candidates.forEach((candidate) => {
    validateLocalMediaCandidate(candidate, policy);
    if (candidate.type === "video" && ++videos > policy.maxUploadedVideos) {
      throw new MediaAttachmentError("invalid_candidate", "Only one uploaded video can be attached.");
    }
  });
}

export function mapMediaAttachmentDoc(
  value: unknown,
  expectedContext?: MediaAttachmentContext
): MediaAttachmentDoc | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (hasLocalUriField(data)) return null;

  const id = nullableString(data.id);
  const type = normalizeMediaAttachmentType(data.type);
  if (!id || !type) return null;
  if (
    ["sizeBytes", "width", "height", "durationMs", "createdAtMs"].some((key) =>
      hasInvalidOptionalNonnegativeNumber(data, key)
    ) ||
    ("thumbnailUrl" in data &&
      data.thumbnailUrl != null &&
      !isHttpsUrl(data.thumbnailUrl))
  ) {
    return null;
  }

  const common = {
    id,
    type,
    thumbnailUrl: isHttpsUrl(data.thumbnailUrl) ? data.thumbnailUrl : null,
    fileName: normalizeFileName(data.fileName),
    sizeBytes: optionalNonnegativeNumber(data.sizeBytes),
    width: optionalNonnegativeNumber(data.width),
    height: optionalNonnegativeNumber(data.height),
    durationMs: optionalNonnegativeNumber(data.durationMs),
    createdAtMs: optionalNonnegativeNumber(data.createdAtMs),
    provider: data.provider === "youtube" ? ("youtube" as const) : null,
    providerMediaId: nullableString(data.providerMediaId),
    title: nullableString(data.title),
  };

  if (type === "video_link") {
    const linkOwnerUid = nullableString(data.uploadedByUid);
    if (!isHttpsUrl(data.externalUrl) || !linkOwnerUid) {
      return null;
    }
    const normalized = normalizeVideoLink(data.externalUrl);
    if (
      !normalized ||
      common.provider !== normalized.provider ||
      common.providerMediaId !== normalized.providerMediaId ||
      common.title !== normalized.displayLabel ||
      common.thumbnailUrl !== normalized.thumbnailUrl ||
      data.storagePath != null ||
      data.downloadUrl != null ||
      data.mimeType != null ||
      data.fileName != null ||
      data.sizeBytes != null ||
      data.width != null ||
      data.height != null ||
      data.durationMs != null
    ) {
      return null;
    }
    return {
      ...common,
      storagePath: null,
      downloadUrl: null,
      externalUrl: data.externalUrl,
      mimeType: null,
      uploadedByUid: linkOwnerUid,
    };
  }

  const storagePath = nullableString(data.storagePath);
  const uploadedByUid = nullableString(data.uploadedByUid);
  const mimeType = nullableString(data.mimeType)?.toLowerCase() ?? null;
  if (
    !storagePath ||
    !parseMediaAttachmentStoragePath(storagePath) ||
    !uploadedByUid ||
    !mimeType ||
    !isAllowedMimeForType(type, mimeType)
  ) {
    return null;
  }

  const parsedPath = parseMediaAttachmentStoragePath(storagePath)!;
  const expectedExtension = extensionForMime(mimeType);
  if (
    parsedPath.uploaderUid !== uploadedByUid ||
    parsedPath.attachmentId !== id ||
    parsedPath.extension !== expectedExtension ||
    (expectedContext && !mediaContextsEqual(parsedPath, expectedContext)) ||
    data.externalUrl != null ||
    data.provider != null ||
    data.providerMediaId != null ||
    data.title != null ||
    ("downloadUrl" in data &&
      data.downloadUrl != null &&
      !isHttpsUrl(data.downloadUrl)) ||
    (common.sizeBytes != null &&
      common.sizeBytes > maxBytesForType(type)) ||
    (type === "video" &&
      common.durationMs != null &&
      common.durationMs > MAX_VIDEO_DURATION_MS)
  ) {
    return null;
  }

  return {
    ...common,
    storagePath,
    downloadUrl: isHttpsUrl(data.downloadUrl) ? data.downloadUrl : null,
    externalUrl: null,
    mimeType,
    uploadedByUid,
  };
}

export function mediaContextsEqual(a: MediaAttachmentContext, b: MediaAttachmentContext): boolean {
  if (a.type !== b.type) return false;
  const clean = (value: MediaAttachmentContext) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "uploaderUid" && key !== "attachmentId" && key !== "extension"));
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b));
}

export function mapMediaAttachmentDocs(
  values: unknown,
  expectedContext?: MediaAttachmentContext
): MediaAttachmentDoc[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const mapped: MediaAttachmentDoc[] = [];

  for (const value of values) {
    const attachment = mapMediaAttachmentDoc(value, expectedContext);
    if (!attachment || seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    mapped.push(attachment);
    if (
      mapped.length >=
      (expectedContext
        ? getMediaAttachmentPolicy(expectedContext.type).maxAttachments
        : MAX_MEDIA_ATTACHMENTS)
    ) break;
  }
  return mapped;
}

export function createMediaAttachmentId(): string {
  return Crypto.randomUUID().replace(/-/g, "");
}

export type MediaUploadAttempt = { id: string; cancelled: boolean };

export function createMediaUploadAttempt(): MediaUploadAttempt {
  return { id: createMediaAttachmentId(), cancelled: false };
}

export function cancelMediaUploadAttempt(attempt: MediaUploadAttempt): void {
  attempt.cancelled = true;
}

export function isCurrentMediaUploadAttempt(
  callbackAttempt: MediaUploadAttempt,
  currentAttempt: MediaUploadAttempt | null
): boolean {
  return !!currentAttempt &&
    !callbackAttempt.cancelled &&
    callbackAttempt.id === currentAttempt.id;
}

export function normalizeMediaUploadProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function buildContextMediaAttachmentStoragePath(input: {
  uploaderUid: string;
  context: MediaAttachmentContext;
  attachmentId: string;
  mimeType: string;
}): string {
  const uploaderUid = assertSafePathSegment(input.uploaderUid, "Uploader ID");
  validateMediaAttachmentContext(input.context);
  const attachmentId = assertSafePathSegment(input.attachmentId, "Attachment ID");
  const extension = extensionForMime(input.mimeType);
  if (!extension) throw new MediaAttachmentError("unsupported_mime", "This file type is not supported.");
  const c = input.context;
  if (c.type === "progress") return ["progressMedia", uploaderUid, c.goalId, c.subtaskId, c.progressEventId, attachmentId, `original.${extension}`].join("/");
  if (c.type === "bulletin") return ["bulletinMedia", c.groupId, c.bulletinId, uploaderUid, attachmentId, `original.${extension}`].join("/");
  if (c.type === "bulletin_comment") return ["bulletinCommentMedia", c.groupId, c.bulletinId, c.commentId, uploaderUid, attachmentId, `original.${extension}`].join("/");
  if (c.type === "shared_goal_comment") return ["sharedGoalCommentMedia", c.groupId, c.goalId, c.commentId, uploaderUid, attachmentId, `original.${extension}`].join("/");
  if (c.type === "group_dm_message") return ["groupDmMedia", c.groupId, c.dmId, c.messageId, uploaderUid, attachmentId, `original.${extension}`].join("/");
  return ["groupConversationMedia", c.groupId, c.conversationId, c.messageId, uploaderUid, attachmentId, `original.${extension}`].join("/");
}

export function buildMediaAttachmentStoragePath(input: {
  uploaderUid: string;
  goalId: string;
  subtaskId: string;
  progressEventId: string;
  attachmentId: string;
  mimeType: string;
}): string {
  return buildContextMediaAttachmentStoragePath({
    uploaderUid: input.uploaderUid,
    context: { type: "progress", goalId: input.goalId, subtaskId: input.subtaskId, progressEventId: input.progressEventId },
    attachmentId: input.attachmentId,
    mimeType: input.mimeType,
  });
}

export function buildMediaUploadMetadata(input: {
  uploaderUid: string;
  context: MediaAttachmentContext;
  attachmentId: string;
  uploadSessionId?: string;
}): Record<string, string> {
  validateMediaAttachmentContext(input.context);
  const metadata: Record<string, string> = {
    uploaderUid: assertSafePathSegment(input.uploaderUid, "Uploader ID"),
    contextType: input.context.type,
    attachmentId: assertSafePathSegment(input.attachmentId, "Attachment ID"),
    uploadedAtMs: String(Date.now()),
  };
  for (const [key, value] of Object.entries(input.context)) if (key !== "type") metadata[key] = value;
  if (input.uploadSessionId) metadata.uploadSessionId = assertSafePathSegment(input.uploadSessionId, "Upload session ID");
  return metadata;
}

export function uploadContextMediaAttachment(
  input: UploadContextMediaAttachmentInput
): MediaUploadHandle {
  const policy = getMediaAttachmentPolicy(input.context.type);
  validateLocalMediaCandidate(input.candidate, policy);
  const attachmentId = input.attachmentId ?? createMediaAttachmentId();
  const storagePath = buildContextMediaAttachmentStoragePath({
    uploaderUid: input.uploaderUid,
    context: input.context,
    attachmentId,
    mimeType: input.candidate.mimeType,
  });

  let uploadTask: UploadTask | null = null;
  let cancelledBeforeUpload = false;

  const promise = (async (): Promise<MediaAttachmentDoc> => {
    input.onProgress?.(0);
    let blob: Blob;
    try {
      const response = await fetch(input.candidate.localUri);
      if (!response.ok) throw new Error("Local media read failed.");
      blob = await response.blob();
    } catch {
      if (cancelledBeforeUpload) {
        throw new MediaAttachmentError("cancelled", "Upload cancelled.");
      }
      console.error("[MediaAttachments] media preparation failed");
      throw new MediaAttachmentError(
        "read_failed",
        "The selected media could not be prepared."
      );
    }

    if (cancelledBeforeUpload) {
      throw new MediaAttachmentError("cancelled", "Upload cancelled.");
    }
    if (blob.size > maxBytesForType(input.candidate.type, policy)) {
      throw new MediaAttachmentError(
        "file_too_large",
        "The selected media file is too large."
      );
    }
    if (blob.size <= 0) {
      throw new MediaAttachmentError(
        "invalid_candidate",
        "The selected media file is empty."
      );
    }
    if (blob.type && blob.type !== input.candidate.mimeType) {
      throw new MediaAttachmentError(
        "mime_mismatch",
        "The selected file format did not match its metadata."
      );
    }

    const objectRef = ref(storage, storagePath);
    uploadTask = uploadBytesResumable(objectRef, blob, {
      contentType: input.candidate.mimeType,
      customMetadata: buildMediaUploadMetadata({ uploaderUid: input.uploaderUid, context: input.context, attachmentId, uploadSessionId: input.uploadSessionId }),
    });

    await new Promise<void>((resolve, reject) => {
      uploadTask?.on(
        "state_changed",
        (snapshot) => {
          const progress =
            snapshot.totalBytes > 0
              ? snapshot.bytesTransferred / snapshot.totalBytes
              : 0;
          input.onProgress?.(normalizeMediaUploadProgress(progress));
        },
        (error) => {
          if (error.code === "storage/canceled") {
            reject(new MediaAttachmentError("cancelled", "Upload cancelled."));
            return;
          }
          console.error("[MediaAttachments] upload failed", error.code);
          reject(
            new MediaAttachmentError(
              "upload_failed",
              "The media upload failed."
            )
          );
        },
        resolve
      );
    });

    input.onProgress?.(1);
    let downloadUrl: string;
    try {
      downloadUrl = await getDownloadURL(objectRef);
    } catch {
      console.error("[MediaAttachments] download URL lookup failed");
      try {
        await deleteObject(objectRef);
      } catch (cleanupError) {
        const cleanupCode =
          cleanupError &&
          typeof cleanupError === "object" &&
          "code" in cleanupError
            ? String(cleanupError.code)
            : "";
        console.error("[MediaAttachments] cleanup failed", {
          path: storagePath,
          code: cleanupCode,
        });
      }
      throw new MediaAttachmentError(
        "upload_failed",
        "The uploaded media could not be finalized."
      );
    }
    return {
      id: attachmentId,
      type: input.candidate.type,
      storagePath,
      downloadUrl,
      thumbnailUrl: null,
      externalUrl: null,
      mimeType: input.candidate.mimeType,
      fileName: normalizeFileName(input.candidate.fileName),
      sizeBytes: blob.size,
      width: input.candidate.width ?? null,
      height: input.candidate.height ?? null,
      durationMs: input.candidate.durationMs ?? null,
      uploadedByUid: input.uploaderUid,
      createdAtMs: Date.now(),
      provider: null,
      providerMediaId: null,
      title: null,
    };
  })();

  return {
    attachmentId,
    storagePath,
    promise,
    cancel: () => {
      if (uploadTask) return uploadTask.cancel();
      cancelledBeforeUpload = true;
      return true;
    },
  };
}

export function uploadMediaAttachment(input: UploadMediaAttachmentInput): MediaUploadHandle {
  return uploadContextMediaAttachment({
    candidate: input.candidate,
    uploaderUid: input.uploaderUid,
    context: { type: "progress", goalId: input.goalId, subtaskId: input.subtaskId, progressEventId: input.progressEventId },
    uploadSessionId: input.uploadSessionId,
    attachmentId: input.attachmentId,
    onProgress: input.onProgress,
  });
}

export function uploadMediaAttachmentBatch(
  input: UploadMediaAttachmentBatchInput
): MediaUploadBatchHandle {
  return uploadContextMediaAttachmentBatch({
    items: input.items,
    uploaderUid: input.uploaderUid,
    context: { type: "progress", goalId: input.goalId, subtaskId: input.subtaskId, progressEventId: input.progressEventId },
    uploadSessionId: input.uploadSessionId,
    onItemProgress: input.onItemProgress,
    onItemStatus: input.onItemStatus,
  });
}

export function uploadContextMediaAttachmentBatch(
  input: UploadContextMediaAttachmentBatchInput
): MediaUploadBatchHandle {
  const policy = getMediaAttachmentPolicy(input.context.type);
  if (input.items.length > policy.maxAttachments) {
    throw new MediaAttachmentError(
      "invalid_candidate",
      `You can attach up to ${policy.maxAttachments} files.`
    );
  }
  const ids = new Set<string>();
  let videoCount = 0;
  for (const item of input.items) {
    if (ids.has(item.attachmentId)) {
      throw new MediaAttachmentError(
        "invalid_candidate",
        "Duplicate attachment IDs are not allowed."
      );
    }
    ids.add(item.attachmentId);
    validateLocalMediaCandidate(item.candidate, policy);
    if (item.candidate.type === "video" && ++videoCount > policy.maxUploadedVideos) {
      throw new MediaAttachmentError(
        "invalid_candidate",
        "Only one uploaded video can be attached."
      );
    }
  }

  let activeUpload: MediaUploadHandle | null = null;
  let cancelled = false;
  const uploaded: MediaAttachmentDoc[] = [];

  const promise = (async (): Promise<MediaUploadBatchResult> => {
    for (const item of input.items) {
      if (cancelled) {
        const cleanupResult = await deleteMediaAttachmentObjects(uploaded, input.context);
        throw new MediaUploadBatchError(
          "cancelled",
          "Upload cancelled.",
          item.attachmentId,
          cleanupResult
        );
      }

      input.onItemStatus?.(item.attachmentId, "preparing");
      try {
        activeUpload = uploadContextMediaAttachment({
          candidate: item.candidate,
          uploaderUid: input.uploaderUid,
          context: input.context,
          uploadSessionId: input.uploadSessionId,
          attachmentId: item.attachmentId,
          onProgress: (progress) => {
            input.onItemStatus?.(item.attachmentId, "uploading");
            input.onItemProgress?.(item.attachmentId, progress);
          },
        });
        const attachment = await activeUpload.promise;
        uploaded.push(attachment);
        input.onItemProgress?.(item.attachmentId, 1);
        input.onItemStatus?.(item.attachmentId, "uploaded");
      } catch (error) {
        const mediaError =
          error instanceof MediaAttachmentError
            ? error
            : new MediaAttachmentError(
                "upload_failed",
                "The media upload failed."
              );
        input.onItemStatus?.(
          item.attachmentId,
          mediaError.code === "cancelled" ? "cancelled" : "failed",
          mediaError.code
        );
        const cleanupResult = await deleteMediaAttachmentObjects(uploaded, input.context);
        throw new MediaUploadBatchError(
          mediaError.code,
          mediaError.message,
          item.attachmentId,
          cleanupResult
        );
      } finally {
        activeUpload = null;
      }
    }

    return {
      attachments: [...uploaded],
      cleanup: () => deleteMediaAttachmentObjects(uploaded, input.context),
    };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      return activeUpload?.cancel() ?? true;
    },
  };
}

export async function deleteMediaAttachmentObject(
  attachment: MediaAttachmentDoc
): Promise<MediaCleanupResult> {
  return deleteMediaAttachmentObjects([attachment]);
}

export async function deleteMediaAttachmentObjects(
  attachments: MediaAttachmentDoc[],
  expectedContext?: MediaAttachmentContext
): Promise<MediaCleanupResult> {
  const result: MediaCleanupResult = {
    deletedPaths: [],
    alreadyMissingPaths: [],
    failedPaths: [],
  };
  const paths = getMediaAttachmentCleanupPaths(attachments, expectedContext);

  await Promise.all(
    paths.map(async (path) => {
      try {
        await deleteObject(ref(storage, path));
        result.deletedPaths.push(path);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        if (code === "storage/object-not-found") {
          result.alreadyMissingPaths.push(path);
          return;
        }
        console.error("[MediaAttachments] cleanup failed", { path, code });
        result.failedPaths.push(path);
      }
    })
  );
  return result;
}

export function getMediaAttachmentCleanupPaths(
  attachments: MediaAttachmentDoc[],
  expectedContext?: MediaAttachmentContext
): string[] {
  return [
    ...new Set(
      attachments
        .filter((attachment) => attachment.type !== "video_link")
        .map((attachment) => attachment.storagePath?.trim())
        .filter(
          (path): path is string =>
            !!path &&
            !!parseMediaAttachmentStoragePath(path) &&
            (!expectedContext ||
              mediaContextsEqual(parseMediaAttachmentStoragePath(path)!, expectedContext))
        )
    ),
  ];
}
