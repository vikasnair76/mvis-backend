import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  FEEDBACK_MAX_SUBJECT_LENGTH,
  FEEDBACK_MAX_VIDEO_BYTES,
  FEEDBACK_TYPES,
  areEquivalentFeedbackRequests,
  buildFeedbackStoragePath,
  getFeedbackTypeEmailLabel,
  getFeedbackTypeLabel,
  isFeedbackType,
  isValidFeedbackId,
  normalizeFeedbackMessage,
  normalizeFeedbackReplyEmail,
  normalizeFeedbackSubject,
  resolveInitialFeedbackContact,
  validateFeedbackAttachments,
  validateFeedbackContactFields,
  type FeedbackAttachmentDoc,
  type SubmitFeedbackRequest,
} from "../services/feedback";

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
};
const image = (
  overrides: Partial<FeedbackAttachmentDoc> = {}
): FeedbackAttachmentDoc => ({
  id: "image1",
  kind: "image",
  storagePath: "feedback/user1/feedback1/image1",
  contentType: "image/jpeg",
  sizeBytes: 1024,
  width: 100,
  height: 100,
  durationMs: null,
  uploadedAtMs: 1,
  ...overrides,
});
const video = (
  overrides: Partial<FeedbackAttachmentDoc> = {}
): FeedbackAttachmentDoc => ({
  id: "video1",
  kind: "video",
  storagePath: "feedback/user1/feedback1/video1",
  contentType: "video/mp4",
  sizeBytes: 1024,
  width: 100,
  height: 100,
  durationMs: 1000,
  uploadedAtMs: 1,
  ...overrides,
});
const attachments = (items: FeedbackAttachmentDoc[]) =>
  validateFeedbackAttachments({
    uid: "user1",
    feedbackId: "feedback1",
    attachments: items,
  });

check("canonical feedback values and labels", () => {
  assert.deepEqual(FEEDBACK_TYPES,
    ["bug", "feature_request", "general", "support"]);
  for (const type of FEEDBACK_TYPES) {
    assert.equal(isFeedbackType(type), true);
    assert.ok(getFeedbackTypeLabel(type));
    assert.ok(getFeedbackTypeEmailLabel(type));
  }
  assert.equal(isFeedbackType("other"), false);
  assert.equal(isFeedbackType(null), false);
});

check("subject normalization and boundaries", () => {
  assert.deepEqual(normalizeFeedbackSubject(null), {ok: true, value: null});
  assert.deepEqual(normalizeFeedbackSubject("  "), {ok: true, value: null});
  assert.deepEqual(normalizeFeedbackSubject(" title "), {
    ok: true, value: "title",
  });
  assert.equal(normalizeFeedbackSubject("x".repeat(
    FEEDBACK_MAX_SUBJECT_LENGTH)).ok, true);
  assert.equal(normalizeFeedbackSubject("x".repeat(
    FEEDBACK_MAX_SUBJECT_LENGTH + 1)).ok, false);
  assert.equal(normalizeFeedbackSubject("a\nb").ok, false);
  assert.equal(normalizeFeedbackSubject("a\u0001b").ok, false);
});

check("message normalization retains safe line breaks", () => {
  assert.equal(normalizeFeedbackMessage("").ok, false);
  assert.equal(normalizeFeedbackMessage(" \n ").ok, false);
  assert.deepEqual(normalizeFeedbackMessage(" a\r\nb "), {
    ok: true, value: "a\nb",
  });
  assert.equal(normalizeFeedbackMessage("x".repeat(
    FEEDBACK_MAX_MESSAGE_LENGTH)).ok, true);
  assert.equal(normalizeFeedbackMessage("x".repeat(
    FEEDBACK_MAX_MESSAGE_LENGTH + 1)).ok, false);
  assert.equal(normalizeFeedbackMessage("a\u0000b").ok, false);
  assert.deepEqual(normalizeFeedbackMessage("<b>plain</b>"), {
    ok: true, value: "<b>plain</b>",
  });
});

check("reply email is one normalized injection-safe address", () => {
  assert.equal(normalizeFeedbackReplyEmail(" User@EXAMPLE.COM "),
    "User@example.com");
  for (const value of [
    "a", "a@localhost", "a@example.com,b@example.com",
    "Alice <a@example.com>", "mailto:a@example.com",
    "a@example.com\nBcc:x@example.com", "a@example.com\rBcc:x@example.com",
  ]) assert.equal(normalizeFeedbackReplyEmail(value), null);
  assert.equal(normalizeFeedbackReplyEmail(`${"x".repeat(245)}@example.com`),
    null);
});

check("contact defaults and consent canonicalization", () => {
  assert.deepEqual(resolveInitialFeedbackContact("A@EXAMPLE.COM"), {
    allowContact: true, replyEmail: "A@example.com",
  });
  assert.deepEqual(resolveInitialFeedbackContact(null), {
    allowContact: false, replyEmail: "",
  });
  assert.equal(validateFeedbackContactFields({
    allowContact: true, replyEmail: "",
  }).ok, false);
  assert.deepEqual(validateFeedbackContactFields({
    allowContact: false, replyEmail: "typed@example.com",
  }), {ok: true, value: {allowContact: false, replyEmail: null}});
});

check("safe IDs and deterministic private path", () => {
  assert.equal(isValidFeedbackId("abc_123-Z"), true);
  for (const id of ["", "/", ".", "..", " a", "a ", "../x", "a/b",
    "x".repeat(129)]) assert.equal(isValidFeedbackId(id), false);
  assert.equal(buildFeedbackStoragePath({
    uid: "user1", feedbackId: "feedback1", attachmentId: "image1",
  }), "feedback/user1/feedback1/image1");
});

check("attachment count, media, ownership, and metadata boundaries", () => {
  assert.equal(attachments([]).ok, true);
  assert.equal(attachments([image()]).ok, true);
  assert.equal(attachments([video()]).ok, true);
  assert.equal(attachments([image(), image({
    id: "image2",
    storagePath: "feedback/user1/feedback1/image2",
  }), image({
    id: "image3",
    storagePath: "feedback/user1/feedback1/image3",
  }), image({
    id: "image4",
    storagePath: "feedback/user1/feedback1/image4",
  }), image({
    id: "image5",
    storagePath: "feedback/user1/feedback1/image5",
  })]).ok, false);
  assert.equal(attachments([video(), video({
    id: "video2",
    storagePath: "feedback/user1/feedback1/video2",
  })]).ok, false);
  assert.equal(attachments([image({contentType: "image/gif" as never})]).ok,
    false);
  assert.equal(attachments([image({
    sizeBytes: FEEDBACK_MAX_IMAGE_BYTES + 1,
  })]).ok, false);
  assert.equal(attachments([video({
    sizeBytes: FEEDBACK_MAX_VIDEO_BYTES + 1,
  })]).ok, false);
  assert.equal(attachments([video({sizeBytes: FEEDBACK_MAX_VIDEO_BYTES}),
    image()]).ok, false);
  assert.equal(attachments([image(), image()]).ok, false);
  assert.equal(attachments([image({
    storagePath: "feedback/user2/feedback1/image1",
  })]).ok, false);
  assert.equal(attachments([image({
    storagePath: "feedback/user1/feedback2/image1",
  })]).ok, false);
  assert.equal(attachments([image({width: null})]).ok, false);
});

check("submission equality is stable and attachment order is non-semantic", () => {
  const firstImage = image();
  const secondImage = image({
    id: "image2",
    storagePath: "feedback/user1/feedback1/image2",
  });
  const request: SubmitFeedbackRequest = {
    schemaVersion: 1,
    feedbackId: "feedback1",
    type: "bug",
    subject: "Subject",
    message: "Message",
    allowContact: true,
    replyEmail: "user@example.com",
    attachments: [firstImage, secondImage],
    appMetadata: {
      appVersion: "1", buildVersion: "1", platform: "android",
      osVersion: "1", locale: "en", timezone: "UTC", themeId: null,
    },
  };
  assert.equal(areEquivalentFeedbackRequests(request, request), true);
  assert.equal(areEquivalentFeedbackRequests(request, {
    ...request, attachments: [secondImage, firstImage],
  }), true);
  assert.equal(areEquivalentFeedbackRequests(request, {
    ...request, message: "Different",
  }), false);
});

check("client request excludes trusted and delivery fields", () => {
  const source = readFileSync("services/feedback.ts", "utf8");
  const request = source.match(
    /export type SubmitFeedbackRequest = \{([\s\S]*?)\n\};/
  )?.[1] ?? "";
  for (const forbidden of [
    "submittedByUid", "accountEmailSnapshot", "recipient", "sender",
    "status", "createdAt", "providerMessageId",
  ]) assert.equal(request.includes(forbidden), false);
});

check("trusted delivery architecture is explicit and provider-neutral", () => {
  const intake = readFileSync("functions/src/feedbackSubmission.ts", "utf8");
  const delivery = readFileSync(
    "functions/src/feedbackEmailDelivery.ts", "utf8");
  assert.match(intake, /input\.auth\.getUser/);
  assert.match(intake, /runTransaction/);
  assert.match(intake, /requestFingerprint/);
  assert.match(delivery, /interface FeedbackEmailProvider/);
  assert.match(delivery, /runTransaction/);
  assert.match(delivery, /Idempotency-Key/);
  assert.match(delivery, /FEEDBACK_EMAIL_MAX_ATTEMPTS = 5/);
  assert.match(delivery, /FEEDBACK_RECIPIENT_EMAIL/);
  assert.doesNotMatch(`${intake}\n${delivery}`, /gmail|smtp|sendgrid|postmark/i);
});

check("decision document exists and records production destination", () => {
  const doc = readFileSync(
    "docs/feedback-8b8-architecture-delivery-contract.md", "utf8");
  assert.match(doc, /reviewa782@gmail\.com/);
  assert.match(doc, /callable/i);
  assert.match(doc, /Firestore-triggered/i);
  assert.match(doc, /allowContact = false/);
});

console.log(`feedback architecture QA passed (${checks} groups)`);
