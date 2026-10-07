import assert from "node:assert/strict";

import {
  MEDIA_ATTACHMENT_POLICIES,
  buildContextMediaAttachmentStoragePath,
  buildMediaAttachmentStoragePath,
  buildMediaUploadMetadata,
  cancelMediaUploadAttempt,
  createMediaUploadAttempt,
  createVideoLinkAttachment,
  getMediaAttachmentPolicy,
  getMediaAttachmentCleanupPaths,
  isCurrentMediaUploadAttempt,
  mapMediaAttachmentDoc,
  mediaContextsEqual,
  parseMediaAttachmentStoragePath,
  validateLocalMediaCandidate,
  validateMediaAttachmentCandidates,
  validateMediaAttachmentContext,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentContext,
} from "../services/mediaAttachments";
import {
  MEDIA_UPLOAD_SESSION_MAX_TTL_MS,
  buildMediaUploadSession,
  isMediaUploadSessionExpired,
  mapMediaUploadSessionDoc,
} from "../services/mediaUploadSessions";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; }
};
const throws = (fn: () => void) => assert.throws(fn);

const contexts: MediaAttachmentContext[] = [
  { type: "progress", goalId: "goal1", subtaskId: "task1", progressEventId: "event1" },
  { type: "bulletin", groupId: "group1", bulletinId: "bulletin1" },
  { type: "bulletin_comment", groupId: "group1", bulletinId: "bulletin1", commentId: "comment1" },
  { type: "shared_goal_comment", groupId: "group1", goalId: "goal1", commentId: "comment1" },
  { type: "group_dm_message", groupId: "group1", dmId: "dm1", messageId: "message1" },
  { type: "group_conversation_message", groupId: "group1", conversationId: "conversation1", messageId: "message1" },
];
const namespaces = ["progressMedia", "bulletinMedia", "bulletinCommentMedia", "sharedGoalCommentMedia", "groupDmMedia", "groupConversationMedia"];
const image: LocalMediaAttachmentCandidate = { localUri: "file:///image.jpg", type: "image", mimeType: "image/jpeg", fileName: "image.jpg", sizeBytes: 100 };
const video: LocalMediaAttachmentCandidate = { localUri: "file:///video.mp4", type: "video", mimeType: "video/mp4", fileName: "video.mp4", sizeBytes: 100, durationMs: 1000 };

contexts.forEach((context) => test(`${context.type} context accepted`, () => validateMediaAttachmentContext(context)));
test("unknown context rejected", () => throws(() => validateMediaAttachmentContext({ type: "wat" } as never)));
test("blank context id rejected", () => throws(() => validateMediaAttachmentContext({ type: "bulletin", groupId: "", bulletinId: "b" })));
test("unsafe context id rejected", () => throws(() => validateMediaAttachmentContext({ type: "bulletin", groupId: "../g", bulletinId: "b" })));

contexts.forEach((context, index) => test(`${context.type} path round trip`, () => {
  const path = buildContextMediaAttachmentStoragePath({ uploaderUid: "user1", context, attachmentId: "attachment1", mimeType: "image/jpeg" });
  assert.equal(path.split("/")[0], namespaces[index]);
  const parsed = parseMediaAttachmentStoragePath(path);
  assert(parsed);
  assert.equal(parsed.uploaderUid, "user1");
  assert.equal(parsed.attachmentId, "attachment1");
  assert(mediaContextsEqual(parsed, context));
}));
test("legacy progress path exact", () => assert.equal(buildMediaAttachmentStoragePath({ uploaderUid: "user1", goalId: "goal1", subtaskId: "task1", progressEventId: "event1", attachmentId: "attachment1", mimeType: "image/jpeg" }), "progressMedia/user1/goal1/task1/event1/attachment1/original.jpg"));
test("mime extension exact", () => assert.match(buildContextMediaAttachmentStoragePath({ uploaderUid: "u", context: contexts[1], attachmentId: "a", mimeType: "video/mp4" }), /original\.mp4$/));
test("unsupported mime rejected", () => throws(() => buildContextMediaAttachmentStoragePath({ uploaderUid: "u", context: contexts[1], attachmentId: "a", mimeType: "text/plain" })));
[
  "progressMedia/u/g/t/e/a/original.jpg/extra",
  "progressMedia/u/g/t/e/original.jpg",
  "unknown/u/g/a/original.jpg",
  "bulletinMedia/g/../u/a/original.jpg",
  "bulletinMedia/g/b/u/a/original.exe",
  "bulletinMedia/g/b/u/a/not-original.jpg",
  "bulletinMedia/g%2Fb/b/u/a/original.jpg",
].forEach((path, index) => test(`malformed path ${index + 1} rejected`, () => assert.equal(parseMediaAttachmentStoragePath(path), null)));

test("progress policy unchanged", () => assert.deepEqual([MEDIA_ATTACHMENT_POLICIES.progress.maxAttachments, MEDIA_ATTACHMENT_POLICIES.progress.maxUploadedVideos], [4, 1]));
test("bulletin policy correct", () => assert.equal(getMediaAttachmentPolicy("bulletin").maxAttachments, 4));
test("bulletin comment policy correct", () => assert.equal(getMediaAttachmentPolicy("bulletin_comment").maxAttachments, 2));
test("shared goal comment policy correct", () => assert.equal(getMediaAttachmentPolicy("shared_goal_comment").maxAttachments, 2));
test("dm policy correct", () => assert.equal(getMediaAttachmentPolicy("group_dm_message").maxAttachments, 4));
test("conversation policy correct", () => assert.equal(getMediaAttachmentPolicy("group_conversation_message").maxAttachments, 4));
test("disallowed video link policy enforced", () => assert(!MEDIA_ATTACHMENT_POLICIES.group_dm_message.allowedTypes.includes("video_link")));
test("attachment count enforced", () => throws(() => validateMediaAttachmentCandidates([image, image, image], MEDIA_ATTACHMENT_POLICIES.bulletin_comment)));
test("uploaded video count enforced", () => throws(() => validateMediaAttachmentCandidates([video, video], MEDIA_ATTACHMENT_POLICIES.bulletin_comment)));
test("size limit enforced", () => throws(() => validateLocalMediaCandidate({ ...image, sizeBytes: 11 * 1024 * 1024 })));
test("duration limit enforced", () => throws(() => validateLocalMediaCandidate({ ...video, durationMs: 30_001 })));

const canonical = {
  id: "attachment1", type: "image", storagePath: "bulletinMedia/group1/bulletin1/user1/attachment1/original.jpg",
  downloadUrl: "https://example.test/a", thumbnailUrl: null, externalUrl: null, mimeType: "image/jpeg",
  fileName: "a.jpg", sizeBytes: 100, width: null, height: null, durationMs: null,
  uploadedByUid: "user1", createdAtMs: 1, provider: null, providerMediaId: null, title: null,
};
test("canonical attachment maps", () => assert(mapMediaAttachmentDoc(canonical, contexts[1])));
test("legacy progress attachment maps", () => assert(mapMediaAttachmentDoc({ ...canonical, storagePath: "progressMedia/user1/goal1/task1/event1/attachment1/original.jpg" }, contexts[0])));
test("cross context rejected", () => assert.equal(mapMediaAttachmentDoc(canonical, contexts[4]), null));
test("cross group rejected", () => assert.equal(mapMediaAttachmentDoc(canonical, { type: "bulletin", groupId: "group2", bulletinId: "bulletin1" }), null));
test("wrong parent rejected", () => assert.equal(mapMediaAttachmentDoc(canonical, { type: "bulletin", groupId: "group1", bulletinId: "bulletin2" }), null));
test("wrong uploader rejected", () => assert.equal(mapMediaAttachmentDoc({ ...canonical, uploadedByUid: "user2" }, contexts[1]), null));
test("wrong attachment id rejected", () => assert.equal(mapMediaAttachmentDoc({ ...canonical, id: "attachment2" }, contexts[1]), null));
test("mime path mismatch rejected", () => assert.equal(mapMediaAttachmentDoc({ ...canonical, mimeType: "image/png" }, contexts[1]), null));
test("video link unchanged", () => assert(createVideoLinkAttachment({ rawUrl: "https://youtu.be/dQw4w9WgXcQ", createdByUid: "u" })));
test("uploaded provider fields rejected", () => assert.equal(mapMediaAttachmentDoc({ ...canonical, provider: "youtube" }, contexts[1]), null));
test("local uri rejected", () => assert.equal(mapMediaAttachmentDoc({ ...canonical, localUri: "file:///a" }, contexts[1]), null));
test("recognized cleanup path accepted", () => assert.deepEqual(getMediaAttachmentCleanupPaths([canonical as never], contexts[1]), [canonical.storagePath]));
test("unknown cleanup path rejected", () => assert.deepEqual(getMediaAttachmentCleanupPaths([{ ...canonical, storagePath: "arbitrary/file" } as never]), []));
test("cross context cleanup rejected", () => assert.deepEqual(getMediaAttachmentCleanupPaths([canonical as never], contexts[4]), []));
test("duplicate cleanup path deduplicated", () => assert.equal(getMediaAttachmentCleanupPaths([canonical as never, canonical as never]).length, 1));
test("video link has no cleanup path", () => assert.deepEqual(getMediaAttachmentCleanupPaths([createVideoLinkAttachment({ rawUrl: "https://youtu.be/dQw4w9WgXcQ", createdByUid: "u" })]), []));

contexts.forEach((context) => test(`${context.type} metadata exact`, () => {
  const metadata = buildMediaUploadMetadata({ uploaderUid: "user1", context, attachmentId: "attachment1", uploadSessionId: context.type === "progress" ? undefined : "session1" });
  assert.equal(metadata.contextType, context.type);
  assert(!Object.values(metadata).includes(undefined as never));
}));

test("current attempt accepted", () => { const a = createMediaUploadAttempt(); assert(isCurrentMediaUploadAttempt(a, a)); });
test("stale attempt rejected", () => assert(!isCurrentMediaUploadAttempt(createMediaUploadAttempt(), createMediaUploadAttempt())));
test("cancelled attempt rejected", () => { const a = createMediaUploadAttempt(); cancelMediaUploadAttempt(a); assert(!isCurrentMediaUploadAttempt(a, a)); });
test("attempt ids differ", () => assert.notEqual(createMediaUploadAttempt().id, createMediaUploadAttempt().id));

const session = buildMediaUploadSession({ id: "session1", uploaderUid: "user1", context: contexts[1], nowMs: 1000 });
test("session default expiration", () => assert.equal(session.expiresAtMs, 901000));
test("session mapper accepts canonical", () => assert(mapMediaUploadSessionDoc(session, "session1")));
test("session document id mismatch rejected", () => assert.equal(mapMediaUploadSessionDoc(session, "other"), null));
test("expired session helper", () => assert(isMediaUploadSessionExpired(session, session.expiresAtMs)));
test("maximum expiration accepted", () => assert(buildMediaUploadSession({ id: "s", uploaderUid: "u", context: contexts[1], nowMs: 1, ttlMs: MEDIA_UPLOAD_SESSION_MAX_TTL_MS })));
test("over maximum expiration rejected", () => throws(() => buildMediaUploadSession({ id: "s", uploaderUid: "u", context: contexts[1], ttlMs: MEDIA_UPLOAD_SESSION_MAX_TTL_MS + 1 })));
test("invalid lifecycle shape rejected", () => assert.equal(mapMediaUploadSessionDoc({ ...session, status: "finalized", finalizedAtMs: null }), null));
test("unknown session field rejected", () => assert.equal(mapMediaUploadSessionDoc({ ...session, surprise: true }), null));

console.log(`\nShared media infrastructure QA: ${passed} passed, ${process.exitCode ? 1 : 0} failed.`);
