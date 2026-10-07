import assert from "node:assert/strict";
import {
  createVideoLinkAttachment,
  getMediaAttachmentPolicy,
  mapMediaAttachmentDoc,
  validateMediaAttachmentCandidates,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentDoc,
} from "../services/mediaAttachments";
import {
  bulletinRemovedAttachments,
  mapBulletinAttachments,
  mapLegacyBulletinAttachments,
} from "../services/bulletinMedia";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; }
};
const context = { type: "bulletin" as const, groupId: "group1", bulletinId: "bulletin1" };
const uploaded = (id: string, type: "image" | "gif" | "video", mimeType: string, extension: string): MediaAttachmentDoc => ({
  id, type, storagePath: `bulletinMedia/group1/bulletin1/user1/${id}/original.${extension}`,
  downloadUrl: `https://example.test/${id}`, thumbnailUrl: null, externalUrl: null,
  mimeType, fileName: `file.${extension}`, sizeBytes: 100, width: null, height: null,
  durationMs: type === "video" ? 1000 : null, uploadedByUid: "user1", createdAtMs: 1,
  provider: null, providerMediaId: null, title: null,
});
const image = uploaded("image1", "image", "image/jpeg", "jpg");
const gif = uploaded("gif1", "gif", "image/gif", "gif");
const video = uploaded("video1", "video", "video/mp4", "mp4");
const youtube = createVideoLinkAttachment({ id: "youtube1", rawUrl: "https://youtu.be/dQw4w9WgXcQ", createdByUid: "user1", createdAtMs: 1 });

test("image attachment maps", () => assert(mapMediaAttachmentDoc(image, context)));
test("GIF attachment maps", () => assert(mapMediaAttachmentDoc(gif, context)));
test("video attachment maps", () => assert(mapMediaAttachmentDoc(video, context)));
test("YouTube attachment maps", () => assert(mapMediaAttachmentDoc(youtube)));
test("mixed attachments map", () => assert.equal(mapBulletinAttachments({ groupId: "group1", bulletinId: "bulletin1", authorUid: "user1", createdAtMs: 1, attachments: [image, gif, video, youtube], imageUrls: [], videoUrls: [] }).length, 4));
test("maximum count policy", () => assert.equal(getMediaAttachmentPolicy("bulletin").maxAttachments, 4));
test("maximum video policy", () => assert.equal(getMediaAttachmentPolicy("bulletin").maxUploadedVideos, 1));
const candidate = (type: "image" | "video", mimeType: string): LocalMediaAttachmentCandidate => ({ localUri: "file:///x", type, mimeType, fileName: type === "video" ? "x.mp4" : "x.jpg", sizeBytes: 10, durationMs: type === "video" ? 1000 : null });
test("too many candidates rejected", () => assert.throws(() => validateMediaAttachmentCandidates([candidate("image", "image/jpeg"), candidate("image", "image/jpeg"), candidate("image", "image/jpeg"), candidate("image", "image/jpeg"), candidate("image", "image/jpeg")], getMediaAttachmentPolicy("bulletin"))));
test("two uploaded videos rejected", () => assert.throws(() => validateMediaAttachmentCandidates([candidate("video", "video/mp4"), candidate("video", "video/mp4")], getMediaAttachmentPolicy("bulletin"))));
test("invalid MIME rejected", () => assert.throws(() => validateMediaAttachmentCandidates([candidate("image", "text/plain")], getMediaAttachmentPolicy("bulletin"))));
test("oversized file rejected", () => assert.throws(() => validateMediaAttachmentCandidates([{ ...candidate("image", "image/jpeg"), sizeBytes: 11 * 1024 * 1024 }], getMediaAttachmentPolicy("bulletin"))));
test("long video rejected", () => assert.throws(() => validateMediaAttachmentCandidates([{ ...candidate("video", "video/mp4"), durationMs: 30_001 }], getMediaAttachmentPolicy("bulletin"))));
test("legacy image maps", () => assert.equal(mapLegacyBulletinAttachments("b", "u", 1, ["https://example.test/old.jpg"], []).length, 1));
test("legacy YouTube maps", () => assert.equal(mapLegacyBulletinAttachments("b", "u", 1, [], ["https://youtu.be/dQw4w9WgXcQ"]).length, 1));
test("legacy malformed URL rejected", () => assert.equal(mapLegacyBulletinAttachments("b", "u", 1, ["file:///old.jpg"], []).length, 0));
test("canonical attachments win over legacy", () => assert.equal(mapBulletinAttachments({ groupId: "group1", bulletinId: "bulletin1", authorUid: "u", createdAtMs: 1, attachments: [image], imageUrls: ["https://example.test/old.jpg"], videoUrls: [] })[0].id, "image1"));
test("edit remove diff", () => assert.deepEqual(bulletinRemovedAttachments([image, gif], [gif]).map((item) => item.id), ["image1"]));
test("edit keep has no cleanup", () => assert.equal(bulletinRemovedAttachments([image], [image]).length, 0));
test("wrong bulletin path rejected", () => assert.equal(mapMediaAttachmentDoc(image, { ...context, bulletinId: "other" }), null));
test("wrong group path rejected", () => assert.equal(mapMediaAttachmentDoc(image, { ...context, groupId: "other" }), null));
test("duplicate canonical IDs filtered", () => assert.equal(mapBulletinAttachments({ groupId: "group1", bulletinId: "bulletin1", authorUid: "u", createdAtMs: 1, attachments: [image, image], imageUrls: [], videoUrls: [] }).length, 1));

console.log(`\nBulletin media QA: ${passed} passed.`);
