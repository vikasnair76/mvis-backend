import type {Firestore} from "firebase-admin/firestore";
import {FieldValue} from "firebase-admin/firestore";
import type {Bucket} from "@google-cloud/storage";
import {defineSecret, defineString} from "firebase-functions/params";

export const FEEDBACK_EMAIL_TRIGGER_NAME = "processFeedbackEmailDelivery";
export const FEEDBACK_RECIPIENT_EMAIL = defineString(
  "FEEDBACK_RECIPIENT_EMAIL");
export const FEEDBACK_EMAIL_SENDER = defineString("FEEDBACK_EMAIL_SENDER");
export const FEEDBACK_EMAIL_PROVIDER_API_KEY = defineSecret(
  "FEEDBACK_EMAIL_PROVIDER_API_KEY");
export const FEEDBACK_EMAIL_MAX_ATTEMPTS = 5;
export const FEEDBACK_EMAIL_RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
export const FEEDBACK_SIGNED_LINK_TTL_DAYS = 7;
const CLAIM_LEASE_MS = 10 * 60 * 1000;

export type FeedbackEmailMessage = {
  to: string; from: string; replyTo: string | null;
  subject: string; text: string; html: null;
};
export interface FeedbackEmailProvider {
  send(message: FeedbackEmailMessage, idempotencyKey: string):
  Promise<{providerMessageId: string | null}>;
}
export class FeedbackDeliveryError extends Error {
  constructor(public readonly code: "invalid_configuration" |
    "provider_rejected" | "attachment_link_failure" | "retry_not_due") {
    super(code);
  }
}

export const isSafeFeedbackConfigurationEmail = (value: string) =>
  value.length <= 254 && !/[\r\n\u0000,;<>\s]/.test(value) &&
  !/^mailto:/i.test(value) &&
  !/^(test|todo|changeme|placeholder)@/i.test(value) &&
  /^[^@]+@[^@]+\.[^@]+$/.test(value);
const escapeLine = (value: unknown) =>
  typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
const typeLabel = (value: unknown) => value === "bug" ? "Bug" :
  value === "feature_request" ? "Feature Request" :
    value === "support" ? "Support" : "General";

export class ResendFeedbackEmailProvider implements FeedbackEmailProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim() || /^(test|todo|changeme|placeholder)$/i.test(
      apiKey.trim())) {
      throw new FeedbackDeliveryError("invalid_configuration");
    }
  }
  async send(message: FeedbackEmailMessage, idempotencyKey: string) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {"Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json", "Idempotency-Key": idempotencyKey},
      body: JSON.stringify({from: message.from, to: [message.to],
        reply_to: message.replyTo ?? undefined, subject: message.subject,
        text: message.text}),
    });
    if (!response.ok) throw new FeedbackDeliveryError("provider_rejected");
    const body = await response.json() as {id?: unknown};
    return {providerMessageId: typeof body.id === "string" ? body.id : null};
  }
}

export function buildFeedbackEmail(input: {
  submission: Record<string, unknown>; recipient: string; sender: string;
  attachmentLinks: string[];
}): FeedbackEmailMessage {
  if (!isSafeFeedbackConfigurationEmail(input.recipient) ||
    !isSafeFeedbackConfigurationEmail(input.sender)) {
    throw new FeedbackDeliveryError("invalid_configuration");
  }
  const data = input.submission;
  const allowContact = data.allowContact === true;
  const replyEmail = allowContact && typeof data.replyEmail === "string" &&
    isSafeFeedbackConfigurationEmail(data.replyEmail) ?
      data.replyEmail : null;
  if (allowContact && !replyEmail) {
    throw new FeedbackDeliveryError("invalid_configuration");
  }
  const label = typeLabel(data.type);
  const subjectText = typeof data.subject === "string" && data.subject.trim() ?
    data.subject.trim() : "No subject";
  const metadata = data.appMetadata && typeof data.appMetadata === "object" ?
    data.appMetadata as Record<string, unknown> : {};
  const lines = [
    `Type: ${label}`,
    `Subject: ${subjectText}`,
    `Submitted: ${new Date(Number(data.createdAtMs)).toISOString()}`,
    `Contact permitted: ${allowContact ? "Yes" : "No"}`,
  ];
  if (allowContact) {
    lines.push(`Reply email: ${replyEmail}`);
    if (typeof data.accountEmailSnapshot === "string") {
      lines.push(`Account email snapshot: ${data.accountEmailSnapshot}`);
    }
  }
  lines.push(`App version: ${escapeLine(metadata.appVersion) || "Unknown"}`,
    `Platform: ${escapeLine(metadata.platform) || "Unknown"}`,
    `Theme: ${escapeLine(metadata.themeId) || "Unknown"}`, "", "Message:",
    escapeLine(data.message), "", "Attachments:");
  if (input.attachmentLinks.length) {
    input.attachmentLinks.forEach((link, index) =>
      lines.push(`${index + 1}. ${link}`));
  } else {
    lines.push("None");
  }
  return {to: input.recipient, from: input.sender, replyTo: replyEmail,
    subject: `[Dayta Feedback] [${label}] ${subjectText}`.slice(0, 200),
    text: lines.join("\n"), html: null};
}

export async function createFeedbackAttachmentLinks(
  bucket: Bucket, submission: Record<string, unknown>, nowMs: number
) {
  const attachments = Array.isArray(submission.attachments) ?
    submission.attachments as Record<string, unknown>[] : [];
  try {
    return await Promise.all(attachments.map(async (attachment) => {
      if (typeof attachment.storagePath !== "string") {
        throw new Error("invalid");
      }
      const [url] = await bucket.file(attachment.storagePath).getSignedUrl({
        action: "read",
        expires: nowMs + FEEDBACK_SIGNED_LINK_TTL_DAYS * 86_400_000,
      });
      return url;
    }));
  } catch {
    throw new FeedbackDeliveryError("attachment_link_failure");
  }
}

type ClaimResult = {status: "claimed"; attempt: number} |
  {status: "sent" | "claimed_elsewhere" | "exhausted"};
export async function claimFeedbackDelivery(input: {
  firestore: Firestore; feedbackId: string; claimToken: string; nowMs: number;
}): Promise<ClaimResult> {
  const submissionRef = input.firestore.collection("feedbackSubmissions")
    .doc(input.feedbackId);
  const deliveryRef = submissionRef.collection("deliveries").doc("email");
  return input.firestore.runTransaction(async (transaction) => {
    const delivery = await transaction.get(deliveryRef);
    const data = delivery.data() ?? {};
    const attempts = Number(data.attemptCount ?? 0);
    if (data.state === "sent") return {status: "sent"};
    if (attempts >= FEEDBACK_EMAIL_MAX_ATTEMPTS) return {status: "exhausted"};
    if (data.state === "processing" &&
      data.claimToken !== input.claimToken &&
      Number(data.claimedAtMs ?? 0) > input.nowMs - CLAIM_LEASE_MS) {
      return {status: "claimed_elsewhere"};
    }
    if (data.state === "failed" &&
      Number(data.nextRetryAtMs ?? 0) > input.nowMs) {
      throw new FeedbackDeliveryError("retry_not_due");
    }
    const attempt = data.state === "processing" &&
      data.claimToken === input.claimToken ? attempts : attempts + 1;
    transaction.set(deliveryRef, {channel: "email", state: "processing",
      attemptCount: attempt, claimToken: input.claimToken,
      claimedAtMs: input.nowMs, sentAtMs: null, failedAtMs: null,
      providerMessageId: null, lastErrorCode: null,
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    transaction.update(submissionRef, {status: "email_processing",
      emailClaimedAtMs: input.nowMs, emailAttemptCount: attempt});
    return {status: "claimed", attempt};
  });
}

export async function processFeedbackDelivery(input: {
  firestore: Firestore; bucket: Bucket; provider: FeedbackEmailProvider;
  feedbackId: string; eventId: string; recipient: string; sender: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const claim = await claimFeedbackDelivery({firestore: input.firestore,
    feedbackId: input.feedbackId, claimToken: input.eventId, nowMs});
  if (claim.status !== "claimed") return claim;
  const ref = input.firestore.collection("feedbackSubmissions")
    .doc(input.feedbackId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return {status: "exhausted" as const};
  const submission = snapshot.data()!;
  try {
    const links = await createFeedbackAttachmentLinks(
      input.bucket, submission, nowMs);
    const message = buildFeedbackEmail({submission,
      recipient: input.recipient, sender: input.sender,
      attachmentLinks: links});
    const result = await input.provider.send(message,
      `${input.feedbackId}:email:v1`);
    await input.firestore.runTransaction(async (transaction) => {
      transaction.set(ref.collection("deliveries").doc("email"), {
        state: "sent", sentAtMs: nowMs, claimToken: null,
        providerMessageId: result.providerMessageId,
        lastErrorCode: null, updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      transaction.update(ref, {status: "email_sent",
        emailSentAtMs: nowMs, emailFailedAtMs: null});
    });
    return {status: "sent" as const};
  } catch (error) {
    const code = error instanceof FeedbackDeliveryError ?
      error.code : "provider_rejected";
    const final = claim.attempt >= FEEDBACK_EMAIL_MAX_ATTEMPTS ||
      code === "invalid_configuration";
    const delay = FEEDBACK_EMAIL_RETRY_DELAYS_MINUTES[
      Math.min(claim.attempt - 1,
        FEEDBACK_EMAIL_RETRY_DELAYS_MINUTES.length - 1)] * 60_000;
    await input.firestore.runTransaction(async (transaction) => {
      transaction.set(ref.collection("deliveries").doc("email"), {
        state: "failed", failedAtMs: nowMs, claimToken: null,
        lastErrorCode: code, nextRetryAtMs: final ? null : nowMs + delay,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      transaction.update(ref, {status: "email_failed",
        emailFailedAtMs: nowMs});
    });
    if (!final) throw error;
    return {status: "exhausted" as const};
  }
}
