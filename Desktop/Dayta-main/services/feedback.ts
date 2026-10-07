export const FEEDBACK_SCHEMA_VERSION = 1 as const;
export const FEEDBACK_COLLECTION = "feedbackSubmissions";
export const FEEDBACK_STORAGE_ROOT = "feedback";
export const FEEDBACK_MAX_ID_LENGTH = 128;
export const FEEDBACK_MAX_SUBJECT_LENGTH = 120;
export const FEEDBACK_MAX_MESSAGE_LENGTH = 5000;
export const FEEDBACK_MAX_REPLY_EMAIL_LENGTH = 254;
export const FEEDBACK_MAX_ATTACHMENTS = 4;
export const FEEDBACK_MAX_IMAGES = 4;
export const FEEDBACK_MAX_VIDEOS = 1;
export const FEEDBACK_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const FEEDBACK_MAX_VIDEO_DURATION_MS = 30_000;
export const FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const FEEDBACK_SIGNED_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FEEDBACK_FORM_DEFAULT_TYPE = "general" as const;
export const FEEDBACK_FORM_DRAFT_CACHE_LIMIT = 6;
export const FEEDBACK_SUBMISSION_READY =
  process.env.EXPO_PUBLIC_FEEDBACK_SUBMISSION_ENABLED === "true";

export const FEEDBACK_TYPES = [
  "bug",
  "feature_request",
  "general",
  "support",
] as const;
export const FEEDBACK_SUBMISSION_STATUSES = [
  "submitted",
  "email_processing",
  "email_sent",
  "email_failed",
] as const;
export const FEEDBACK_ATTACHMENT_KINDS = ["image", "video"] as const;
export const FEEDBACK_PLATFORMS = [
  "ios", "android", "web", "unknown",
] as const;
export const FEEDBACK_ALLOWED_CONTENT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "video/mp4",
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackSubmissionStatus =
  (typeof FEEDBACK_SUBMISSION_STATUSES)[number];
export type FeedbackAttachmentKind =
  (typeof FEEDBACK_ATTACHMENT_KINDS)[number];
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number];
export type FeedbackAllowedContentType =
  (typeof FEEDBACK_ALLOWED_CONTENT_TYPES)[number];

export type FeedbackEmailErrorCode =
  | "provider_unavailable"
  | "provider_rejected"
  | "invalid_recipient_configuration"
  | "invalid_sender_configuration"
  | "attachment_link_failure"
  | "submission_invalid"
  | "rate_limited"
  | "unknown";

export type SubmitFeedbackErrorCode =
  | "unauthenticated"
  | "invalid_type"
  | "invalid_subject"
  | "invalid_message"
  | "invalid_reply_email"
  | "contact_email_required"
  | "invalid_feedback_id"
  | "too_many_attachments"
  | "attachment_too_large"
  | "unsupported_attachment"
  | "attachment_missing"
  | "rate_limited"
  | "submission_conflict"
  | "temporarily_unavailable"
  | "unknown";

export type FeedbackAttachmentDoc = {
  id: string;
  kind: FeedbackAttachmentKind;
  storagePath: string;
  contentType: FeedbackAllowedContentType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  uploadedAtMs: number;
};

export type FeedbackAppMetadata = {
  appVersion: string | null;
  buildVersion: string | null;
  platform: FeedbackPlatform;
  osVersion: string | null;
  locale: string | null;
  timezone: string | null;
  themeId: string | null;
};

export type FeedbackSubmissionDoc = {
  id: string;
  schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  type: FeedbackType;
  subject: string | null;
  message: string;
  submittedByUid: string;
  allowContact: boolean;
  replyEmail: string | null;
  accountEmailSnapshot: string | null;
  attachments: FeedbackAttachmentDoc[];
  attachmentCount: number;
  totalAttachmentBytes: number;
  appMetadata: FeedbackAppMetadata;
  status: FeedbackSubmissionStatus;
  createdAtMs: number;
  createdAt: unknown;
};

export type FeedbackEmailDeliveryDoc = {
  channel: "email";
  state: "pending" | "processing" | "sent" | "failed";
  attemptCount: number;
  claimToken: string | null;
  claimedAtMs: number | null;
  sentAtMs: number | null;
  failedAtMs: number | null;
  providerMessageId: string | null;
  lastErrorCode: FeedbackEmailErrorCode | null;
};

export type SubmitFeedbackRequest = {
  schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  feedbackId: string;
  type: FeedbackType;
  subject: string | null;
  message: string;
  allowContact: boolean;
  replyEmail: string | null;
  attachments: FeedbackAttachmentDoc[];
  appMetadata: FeedbackAppMetadata;
};

export type SubmitFeedbackResponse = {
  feedbackId: string;
  accepted: true;
  alreadyExisted: boolean;
};

export type FeedbackValidationResult<T> =
  | {ok: true; value: T}
  | {ok: false; code: SubmitFeedbackErrorCode};

export type FeedbackFormDraft = {
  type: FeedbackType;
  subject: string;
  message: string;
  allowContact: boolean;
  replyEmail: string;
  replyEmailTouched: boolean;
};

export type FeedbackFormErrors = {
  type?: string;
  subject?: string;
  message?: string;
  replyEmail?: string;
};

export type NormalizedFeedbackFormDraft = {
  type: FeedbackType;
  subject: string | null;
  message: string;
  allowContact: boolean;
  replyEmail: string | null;
};

export type FeedbackFormValidationResult =
  | {
    ok: true;
    value: NormalizedFeedbackFormDraft;
    errors: Record<string, never>;
  }
  | {ok: false; value: null; errors: FeedbackFormErrors};

const feedbackDraftCache = new Map<string, FeedbackFormDraft>();

export function createInitialFeedbackFormDraft(
  authEmail: string | null
): FeedbackFormDraft {
  const contact = resolveInitialFeedbackContact(authEmail);
  return {
    type: FEEDBACK_FORM_DEFAULT_TYPE,
    subject: "",
    message: "",
    allowContact: contact.allowContact,
    replyEmail: contact.replyEmail,
    replyEmailTouched: false,
  };
}

export function normalizeCachedFeedbackFormDraft(
  value: unknown
): FeedbackFormDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<FeedbackFormDraft>;
  if (!isFeedbackType(draft.type) ||
    typeof draft.subject !== "string" ||
    draft.subject.length > FEEDBACK_MAX_SUBJECT_LENGTH ||
    typeof draft.message !== "string" ||
    draft.message.length > FEEDBACK_MAX_MESSAGE_LENGTH ||
    typeof draft.allowContact !== "boolean" ||
    typeof draft.replyEmail !== "string" ||
    draft.replyEmail.length > FEEDBACK_MAX_REPLY_EMAIL_LENGTH ||
    typeof draft.replyEmailTouched !== "boolean") return null;
  return {
    type: draft.type,
    subject: draft.subject,
    message: draft.message,
    allowContact: draft.allowContact,
    replyEmail: draft.replyEmail,
    replyEmailTouched: draft.replyEmailTouched,
  };
}

export function isFeedbackDraftMeaningful(
  draft: FeedbackFormDraft,
  initialDraft: FeedbackFormDraft
) {
  return draft.type !== initialDraft.type ||
    !!draft.subject.trim() ||
    !!draft.message.trim() ||
    draft.allowContact !== initialDraft.allowContact ||
    draft.replyEmail !== initialDraft.replyEmail;
}

export function validateFeedbackFormDraft(
  draft: FeedbackFormDraft
): FeedbackFormValidationResult {
  const errors: FeedbackFormErrors = {};
  if (!isFeedbackType(draft.type)) {
    errors.type = "Please choose a feedback type.";
  }
  const subject = normalizeFeedbackSubject(draft.subject);
  if (!subject.ok) {
    errors.subject = "Keep the subject to 120 characters on one line.";
  }
  const message = normalizeFeedbackMessage(draft.message);
  if (!message.ok) {
    errors.message = draft.message.trim().length >
      FEEDBACK_MAX_MESSAGE_LENGTH ?
      "Your message is too long." : "Please add a message.";
  }
  const contact = validateFeedbackContactFields(draft);
  if (!contact.ok) {
    errors.replyEmail = "Please enter a valid reply email.";
  }
  if (Object.keys(errors).length || !subject.ok || !message.ok || !contact.ok) {
    return {ok: false, value: null, errors};
  }
  return {
    ok: true,
    value: {
      type: draft.type,
      subject: subject.value,
      message: message.value,
      allowContact: contact.value.allowContact,
      replyEmail: contact.value.replyEmail,
    },
    errors: {},
  };
}

export function restoreFeedbackFormDraft(uid: string) {
  const cached = feedbackDraftCache.get(uid);
  if (!cached) return null;
  feedbackDraftCache.delete(uid);
  feedbackDraftCache.set(uid, cached);
  return {...cached};
}

export function saveFeedbackFormDraft(
  uid: string,
  draft: FeedbackFormDraft,
  initialDraft: FeedbackFormDraft
) {
  if (!isValidFeedbackId(uid)) return;
  if (!isFeedbackDraftMeaningful(draft, initialDraft)) {
    feedbackDraftCache.delete(uid);
    return;
  }
  feedbackDraftCache.delete(uid);
  feedbackDraftCache.set(uid, {...draft});
  while (feedbackDraftCache.size > FEEDBACK_FORM_DRAFT_CACHE_LIMIT) {
    const oldest = feedbackDraftCache.keys().next().value;
    if (typeof oldest !== "string") break;
    feedbackDraftCache.delete(oldest);
  }
}

export function clearFeedbackFormDraft(uid: string) {
  feedbackDraftCache.delete(uid);
}

export function clearAllFeedbackFormDraftsForQa() {
  feedbackDraftCache.clear();
}

export function getFeedbackFormDraftCacheSizeForQa() {
  return feedbackDraftCache.size;
}

function comparableFeedbackRequest(request: SubmitFeedbackRequest) {
  return {
    ...request,
    attachments: [...request.attachments].sort((a, b) =>
      a.id.localeCompare(b.id)),
  };
}

export function areEquivalentFeedbackRequests(
  left: SubmitFeedbackRequest,
  right: SubmitFeedbackRequest
) {
  return JSON.stringify(comparableFeedbackRequest(left)) ===
    JSON.stringify(comparableFeedbackRequest(right));
}

const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug report",
  feature_request: "Feature request",
  general: "General feedback",
  support: "Support request",
};
const FEEDBACK_TYPE_EMAIL_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature_request: "Feature Request",
  general: "General",
  support: "Support",
};

const has = <T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] => typeof value === "string" &&
  (values as readonly string[]).includes(value);

export function isFeedbackType(value: unknown): value is FeedbackType {
  return has(FEEDBACK_TYPES, value);
}

export function normalizeFeedbackType(value: unknown): FeedbackType | null {
  return isFeedbackType(value) ? value : null;
}

export function getFeedbackTypeLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_LABELS[type];
}

export function getFeedbackTypeEmailLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_EMAIL_LABELS[type];
}

export function isValidFeedbackId(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim() ||
    !value || value.length > FEEDBACK_MAX_ID_LENGTH ||
    value === "." || value === "..") return false;
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function hasUnsafeTextControl(value: string, allowLineBreaks: boolean) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || code === 127) return true;
    if (code < 32 && character !== "\t" &&
      !(allowLineBreaks && character === "\n")) return true;
  }
  return false;
}

export function normalizeFeedbackSubject(
  value: unknown
): FeedbackValidationResult<string | null> {
  if (value == null) return {ok: true, value: null};
  if (typeof value !== "string") return {ok: false, code: "invalid_subject"};
  const normalized = value.trim();
  if (!normalized) return {ok: true, value: null};
  if (normalized.length > FEEDBACK_MAX_SUBJECT_LENGTH ||
    /[\r\n]/.test(normalized) ||
    hasUnsafeTextControl(normalized, false)) {
    return {ok: false, code: "invalid_subject"};
  }
  return {ok: true, value: normalized};
}

export function normalizeFeedbackMessage(
  value: unknown
): FeedbackValidationResult<string> {
  if (typeof value !== "string") return {ok: false, code: "invalid_message"};
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized ||
    normalized.length > FEEDBACK_MAX_MESSAGE_LENGTH ||
    hasUnsafeTextControl(normalized, true)) {
    return {ok: false, code: "invalid_message"};
  }
  return {ok: true, value: normalized};
}

export function normalizeFeedbackReplyEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > FEEDBACK_MAX_REPLY_EMAIL_LENGTH ||
    /[\r\n\u0000,;<>]/.test(normalized) ||
    /^mailto:/i.test(normalized) ||
    /\s/.test(normalized)) return null;
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at !== normalized.indexOf("@")) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1).toLowerCase();
  if (!local || local.length > 64 || !domain || domain.length > 253 ||
    local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    !domain.includes(".") ||
    !domain.split(".").every((label) =>
      !!label && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return `${local}@${domain}`;
}

export function isValidFeedbackReplyEmail(value: string) {
  return normalizeFeedbackReplyEmail(value) != null;
}

export function resolveInitialFeedbackReplyEmail(
  authEmail: string | null
) {
  return normalizeFeedbackReplyEmail(authEmail) ?? "";
}

export function resolveInitialFeedbackContact(
  authEmail: string | null
) {
  const replyEmail = resolveInitialFeedbackReplyEmail(authEmail);
  return {allowContact: !!replyEmail, replyEmail};
}

export function validateFeedbackContactFields(input: {
  allowContact: boolean;
  replyEmail: unknown;
}): FeedbackValidationResult<{
  allowContact: boolean;
  replyEmail: string | null;
}> {
  if (!input.allowContact) {
    return {ok: true, value: {allowContact: false, replyEmail: null}};
  }
  if (typeof input.replyEmail !== "string" || !input.replyEmail.trim()) {
    return {ok: false, code: "contact_email_required"};
  }
  const replyEmail = normalizeFeedbackReplyEmail(input.replyEmail);
  return replyEmail ?
    {ok: true, value: {allowContact: true, replyEmail}} :
    {ok: false, code: "invalid_reply_email"};
}

export function buildFeedbackStoragePath(input: {
  uid: string;
  feedbackId: string;
  attachmentId: string;
}) {
  if (![input.uid, input.feedbackId, input.attachmentId]
    .every(isValidFeedbackId)) throw new Error("invalid_feedback_id");
  return [
    FEEDBACK_STORAGE_ROOT,
    input.uid,
    input.feedbackId,
    input.attachmentId,
  ].join("/");
}

export function validateFeedbackAttachments(input: {
  uid: string;
  feedbackId: string;
  attachments: readonly FeedbackAttachmentDoc[];
}): FeedbackValidationResult<FeedbackAttachmentDoc[]> {
  if (!isValidFeedbackId(input.uid) ||
    !isValidFeedbackId(input.feedbackId)) {
    return {ok: false, code: "invalid_feedback_id"};
  }
  if (input.attachments.length > FEEDBACK_MAX_ATTACHMENTS) {
    return {ok: false, code: "too_many_attachments"};
  }
  const seen = new Set<string>();
  let images = 0;
  let videos = 0;
  let totalBytes = 0;
  for (const attachment of input.attachments) {
    if (!isValidFeedbackId(attachment.id) || seen.has(attachment.id)) {
      return {ok: false, code: "unsupported_attachment"};
    }
    seen.add(attachment.id);
    if (!has(FEEDBACK_ATTACHMENT_KINDS, attachment.kind) ||
      !has(FEEDBACK_ALLOWED_CONTENT_TYPES, attachment.contentType) ||
      !Number.isInteger(attachment.sizeBytes) || attachment.sizeBytes <= 0 ||
      !Number.isFinite(attachment.uploadedAtMs) ||
      attachment.uploadedAtMs <= 0 ||
      attachment.storagePath !== buildFeedbackStoragePath({
        uid: input.uid,
        feedbackId: input.feedbackId,
        attachmentId: attachment.id,
      })) return {ok: false, code: "unsupported_attachment"};
    if (attachment.kind === "image") {
      images += 1;
      if (!attachment.contentType.startsWith("image/") ||
        attachment.sizeBytes > FEEDBACK_MAX_IMAGE_BYTES ||
        attachment.width == null || attachment.width <= 0 ||
        attachment.height == null || attachment.height <= 0 ||
        attachment.durationMs != null) {
        return {ok: false, code: attachment.sizeBytes >
          FEEDBACK_MAX_IMAGE_BYTES ?
          "attachment_too_large" : "unsupported_attachment"};
      }
    } else {
      videos += 1;
      if (attachment.contentType !== "video/mp4" ||
        attachment.sizeBytes > FEEDBACK_MAX_VIDEO_BYTES ||
        attachment.durationMs == null || attachment.durationMs <= 0 ||
        attachment.durationMs > FEEDBACK_MAX_VIDEO_DURATION_MS) {
        return {ok: false, code: attachment.sizeBytes >
          FEEDBACK_MAX_VIDEO_BYTES ?
          "attachment_too_large" : "unsupported_attachment"};
      }
    }
    totalBytes += attachment.sizeBytes;
  }
  if (images > FEEDBACK_MAX_IMAGES || videos > FEEDBACK_MAX_VIDEOS) {
    return {ok: false, code: "too_many_attachments"};
  }
  if (totalBytes > FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES) {
    return {ok: false, code: "attachment_too_large"};
  }
  return {ok: true, value: [...input.attachments]};
}

export function getSubmitFeedbackErrorMessage(
  code: SubmitFeedbackErrorCode
) {
  if (code === "invalid_reply_email" ||
    code === "contact_email_required") {
    return "Please enter a valid reply email.";
  }
  if (code === "rate_limited") {
    return "You have sent several feedback messages recently. " +
      "Please try again later.";
  }
  if (code === "invalid_message") return "Please enter your feedback.";
  if (code === "too_many_attachments") {
    return "Please remove one or more attachments.";
  }
  if (code === "attachment_too_large" ||
    code === "unsupported_attachment" ||
    code === "attachment_missing") {
    return "One of the attachments cannot be submitted.";
  }
  return "Feedback could not be sent right now. Please try again.";
}
