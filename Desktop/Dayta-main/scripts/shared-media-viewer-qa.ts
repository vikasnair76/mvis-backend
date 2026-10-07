import assert from "node:assert/strict";
import {
  clampMediaViewerIndex,
  getViewableMediaAttachments,
  mediaAttachmentAccessibilityType,
} from "../components/media/mediaViewerHelpers";
import type { MediaAttachmentDoc } from "../services/mediaAttachments";

const base = {
  storagePath: "bulletinMedia/group/post/user/attachment/original.jpg",
  uploadedByUid: "user",
  sizeBytes: 100,
  width: 100,
  height: 100,
  durationMs: null,
  fileName: null,
  thumbnailUrl: null,
  externalUrl: null,
  provider: null,
  providerMediaId: null,
  title: null,
} as const;

function image(id: string, url = "https://example.test/image.jpg"): MediaAttachmentDoc {
  return { ...base, id, type: "image", mimeType: "image/jpeg", downloadUrl: url };
}

let passed = 0;
function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("preserves canonical order", () => {
  assert.deepEqual(getViewableMediaAttachments([image("a"), image("b")]).map((x) => x.id), ["a", "b"]);
});
check("deduplicates ids", () => assert.equal(getViewableMediaAttachments([image("a"), image("a")]).length, 1));
check("rejects HTTP display url", () => assert.equal(getViewableMediaAttachments([image("a", "http://example.test/a")]).length, 0));
check("rejects malformed display url", () => assert.equal(getViewableMediaAttachments([image("a", "not-a-url")]).length, 0));
check("accepts GIF", () => {
  assert.equal(getViewableMediaAttachments([{ ...image("gif"), type: "gif", mimeType: "image/gif" }]).length, 1);
});
check("accepts uploaded video", () => {
  assert.equal(getViewableMediaAttachments([{ ...image("video"), type: "video", mimeType: "video/mp4" }]).length, 1);
});
check("accepts HTTPS YouTube link", () => {
  const item = { ...image("youtube"), type: "video_link", storagePath: null, downloadUrl: null, mimeType: null, externalUrl: "https://www.youtube.com/watch?v=abcdefghijk", provider: "youtube" } as MediaAttachmentDoc;
  assert.equal(getViewableMediaAttachments([item]).length, 1);
});
check("rejects non-YouTube video link", () => {
  const item = { ...image("other"), type: "video_link", storagePath: null, downloadUrl: null, mimeType: null, externalUrl: "https://example.test/video", provider: "other" } as unknown as MediaAttachmentDoc;
  assert.equal(getViewableMediaAttachments([item]).length, 0);
});
check("clamps negative index", () => assert.equal(clampMediaViewerIndex(-2, 4), 0));
check("clamps high index", () => assert.equal(clampMediaViewerIndex(8, 4), 3));
check("truncates fractional index", () => assert.equal(clampMediaViewerIndex(2.8, 4), 2));
check("handles empty index", () => assert.equal(clampMediaViewerIndex(2, 0), 0));
check("handles non-finite index", () => assert.equal(clampMediaViewerIndex(Number.NaN, 4), 0));
check("image accessibility type", () => assert.equal(mediaAttachmentAccessibilityType(image("a")), "image"));
check("GIF accessibility type", () => assert.equal(mediaAttachmentAccessibilityType({ ...image("a"), type: "gif" }), "GIF"));
check("video accessibility type", () => assert.equal(mediaAttachmentAccessibilityType({ ...image("a"), type: "video" }), "video"));

console.log(`\nShared media viewer QA: ${passed} passed.`);
