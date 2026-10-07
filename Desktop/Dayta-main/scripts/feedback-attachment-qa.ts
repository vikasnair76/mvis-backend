import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_VIDEO_BYTES,
  FEEDBACK_MAX_VIDEO_DURATION_MS, buildFeedbackStoragePath}
  from "../services/feedback";
import {applyFeedbackUploadUpdate, createEmptyFeedbackAttachmentDraft,
  ensureFeedbackId, normalizeFeedbackAttachmentMime,
  saveFeedbackAttachmentDraft, restoreFeedbackAttachmentDraft,
  clearFeedbackAttachmentCacheForQa, toFeedbackAttachmentClaim,
  validateFeedbackPickerCandidate, type FeedbackAttachmentDraftItem}
  from "../services/feedbackAttachments";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn(); console.log(`ok ${++n} - ${name}`);
};
const candidate = (overrides: Record<string, unknown> = {}) => ({
  kind: "image" as const, localUri: "file:///image.jpg",
  contentType: "image/jpeg", sizeBytes: 100, width: 10, height: 10,
  durationMs: null, ...overrides,
});
const item = (overrides: Partial<FeedbackAttachmentDraftItem> = {}):
FeedbackAttachmentDraftItem => ({
  id: "attachment1", kind: "image", localUri: "file:///image.jpg",
  previewUri: "file:///image.jpg", contentType: "image/jpeg", sizeBytes: 100,
  width: 10, height: 10, durationMs: null, storagePath: null,
  uploadedAtMs: null, progress: 0, status: "ready", attemptId: null,
  errorCode: null, ...overrides,
});

test("MIME allowlist and aliases are explicit", () => {
  assert.equal(normalizeFeedbackAttachmentMime("image/jpg"), "image/jpeg");
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateFeedbackPickerCandidate(candidate({contentType: type}),
      []).ok, true);
  }
  assert.equal(validateFeedbackPickerCandidate(candidate({kind: "video",
    localUri: "file:///v.mp4", contentType: "video/mp4", durationMs: 1000}),
  []).ok, true);
  for (const type of ["image/heic", "image/heif", "image/svg+xml",
    "application/pdf", "application/octet-stream", "audio/mpeg"]) {
    assert.equal(validateFeedbackPickerCandidate(candidate({contentType: type}),
      []).ok, false);
  }
});

test("size and video duration boundaries", () => {
  assert.equal(validateFeedbackPickerCandidate(candidate({
    sizeBytes: FEEDBACK_MAX_IMAGE_BYTES}), []).ok, true);
  assert.equal(validateFeedbackPickerCandidate(candidate({
    sizeBytes: FEEDBACK_MAX_IMAGE_BYTES + 1}), []).ok, false);
  const video = {kind: "video", localUri: "file:///v.mp4",
    contentType: "video/mp4", width: 10, height: 10};
  assert.equal(validateFeedbackPickerCandidate(candidate({...video,
    sizeBytes: FEEDBACK_MAX_VIDEO_BYTES,
    durationMs: FEEDBACK_MAX_VIDEO_DURATION_MS}), []).ok, true);
  assert.equal(validateFeedbackPickerCandidate(candidate({...video,
    sizeBytes: FEEDBACK_MAX_VIDEO_BYTES + 1, durationMs: 1000}), []).ok, false);
  assert.equal(validateFeedbackPickerCandidate(candidate({...video,
    sizeBytes: 100, durationMs: FEEDBACK_MAX_VIDEO_DURATION_MS + 1}), []).ok,
  false);
  assert.equal(validateFeedbackPickerCandidate(candidate({...video,
    sizeBytes: 100, durationMs: null}), []).ok, false);
});

test("counts, combined bytes, duplicates, and metadata are bounded", () => {
  const images = [1, 2, 3, 4].map((i) => item({id: `a${i}`,
    localUri: `file:///${i}.jpg`, sizeBytes: 100}));
  assert.equal(validateFeedbackPickerCandidate(candidate(), images).ok, false);
  assert.equal(validateFeedbackPickerCandidate(candidate({kind: "video",
    localUri: "file:///v.mp4", contentType: "video/mp4", durationMs: 1000}),
  [item({id: "v", kind: "video", localUri: "file:///old.mp4",
    contentType: "video/mp4", durationMs: 1000})]).ok, false);
  assert.equal(validateFeedbackPickerCandidate(candidate(), [item()]).ok,
    false);
  assert.equal(validateFeedbackPickerCandidate(candidate({width: 0}), []).ok,
    false);
  assert.equal(validateFeedbackPickerCandidate(candidate({height: -1}), []).ok,
    false);
  assert.equal(validateFeedbackPickerCandidate(candidate({width: NaN}), []).ok,
    false);
  assert.equal(validateFeedbackPickerCandidate(candidate({kind: "video",
    localUri: "file:///v.mp4", contentType: "video/mp4",
    sizeBytes: FEEDBACK_MAX_VIDEO_BYTES - 1, durationMs: 1000}),
  [item({sizeBytes: 2})]).ok, false);
});

test("stale attempts and progress are safe", () => {
  const uploading = item({status: "uploading", attemptId: "new"});
  assert.equal(applyFeedbackUploadUpdate(uploading, "old",
    {type: "progress", progress: 1}), uploading);
  assert.equal(applyFeedbackUploadUpdate(uploading, "new",
    {type: "progress", progress: 2}).progress, 1);
  assert.equal(applyFeedbackUploadUpdate({...uploading, status: "canceling"},
    "new", {type: "failure", code: "upload_failed"}).status, "canceling");
});

test("claims require uploaded state and exact private path", () => {
  const path = buildFeedbackStoragePath({uid: "user1",
    feedbackId: "feedback1", attachmentId: "attachment1"});
  const uploaded = item({status: "uploaded", storagePath: path,
    uploadedAtMs: 1, progress: 1});
  const claim = toFeedbackAttachmentClaim(uploaded,
    {uid: "user1", feedbackId: "feedback1"});
  assert.ok(claim);
  assert.deepEqual(Object.keys(claim!).sort(), ["contentType", "durationMs",
    "height", "id", "kind", "sizeBytes", "storagePath", "uploadedAtMs",
    "width"].sort());
  assert.equal(toFeedbackAttachmentClaim(item(), {uid: "user1",
    feedbackId: "feedback1"}), null);
  assert.equal(toFeedbackAttachmentClaim({...uploaded,
    storagePath: "feedback/user2/feedback1/attachment1"},
  {uid: "user1", feedbackId: "feedback1"}), null);
});

test("feedback identity and restoration are stable and interrupted-safe", () => {
  const id = ensureFeedbackId(null);
  assert.equal(ensureFeedbackId(id), id);
  assert.deepEqual(createEmptyFeedbackAttachmentDraft(),
    {feedbackId: null, items: []});
  clearFeedbackAttachmentCacheForQa();
  saveFeedbackAttachmentDraft("user1", {feedbackId: id,
    items: [item({status: "uploading", attemptId: "attempt"})]});
  const restored = restoreFeedbackAttachmentDraft("user1");
  assert.equal(restored?.feedbackId, id);
  assert.equal(restored?.items[0].status, "failed");
  assert.equal(restored?.items[0].errorCode, "interrupted");
  assert.equal(restored?.items[0].attemptId, null);
  assert.equal(restoreFeedbackAttachmentDraft("user2"), null);
});

test("UI and service contain no transmission or public URL behavior", () => {
  const screen = readFileSync("app/settings/feedback.tsx", "utf8");
  const service = readFileSync("services/feedbackAttachments.ts", "utf8");
  assert.match(screen, /Add Attachment/);
  assert.match(screen, /requestMediaLibraryPermissionsAsync/);
  assert.match(screen, /accessibilityRole="progressbar"/);
  assert.doesNotMatch(screen, /requestCameraPermissions|microphone|httpsCallable|setDoc/);
  assert.doesNotMatch(`${screen}\n${service}`,
    /getDownloadURL|downloadToken|base64|reviewa782|Feedback sent|console\./i);
});

console.log(`feedback attachment QA passed (${n} groups)`);
