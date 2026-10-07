import assert from "node:assert/strict";
import {
  getMediaAttachmentPolicy,
  mapMediaAttachmentDocs,
  validateMediaAttachmentCandidates,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentContext,
  type MediaAttachmentDoc,
} from "../services/mediaAttachments";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

type CommentContext = Extract<
  MediaAttachmentContext,
  { type: "bulletin_comment" | "shared_goal_comment" }
>;
const contexts: CommentContext[] = [
  { type: "bulletin_comment", groupId: "g", bulletinId: "b", commentId: "c" },
  { type: "shared_goal_comment", groupId: "g", goalId: "goal", commentId: "c" },
];
function attachment(
  context: CommentContext,
  id: string,
  type: "image" | "gif" | "video",
  mimeType: string,
  extension: string
): MediaAttachmentDoc {
  const prefix =
    context.type === "bulletin_comment"
      ? `bulletinCommentMedia/${context.groupId}/${context.bulletinId}/${context.commentId}`
      : `sharedGoalCommentMedia/${context.groupId}/${context.goalId}/${context.commentId}`;
  return {
    id,
    type,
    storagePath: `${prefix}/user/${id}/original.${extension}`,
    downloadUrl: `https://example.test/${id}`,
    thumbnailUrl: null,
    externalUrl: null,
    mimeType,
    fileName: `file.${extension}`,
    sizeBytes: 100,
    width: 100,
    height: 100,
    durationMs: type === "video" ? 1_000 : null,
    uploadedByUid: "user",
    createdAtMs: 1,
    provider: null,
    providerMediaId: null,
    title: null,
  };
}
const candidate = (type: "image" | "video", mimeType: string): LocalMediaAttachmentCandidate => ({
  localUri: "file:///candidate",
  type,
  mimeType,
  fileName: type === "video" ? "x.mp4" : "x.jpg",
  sizeBytes: 100,
  durationMs: type === "video" ? 1_000 : null,
});

for (const context of contexts) {
  const label = context.type;
  const image = attachment(context, "image", "image", "image/jpeg", "jpg");
  const gif = attachment(context, "gif", "gif", "image/gif", "gif");
  const video = attachment(context, "video", "video", "video/mp4", "mp4");
  test(`${label} missing attachments maps empty`, () => assert.deepEqual(mapMediaAttachmentDocs(undefined, context), []));
  test(`${label} image maps`, () => assert.equal(mapMediaAttachmentDocs([image], context).length, 1));
  test(`${label} GIF maps`, () => assert.equal(mapMediaAttachmentDocs([gif], context).length, 1));
  test(`${label} MP4 maps`, () => assert.equal(mapMediaAttachmentDocs([video], context).length, 1));
  test(`${label} preserves order`, () => assert.deepEqual(mapMediaAttachmentDocs([gif, image], context).map((x) => x.id), ["gif", "image"]));
  test(`${label} duplicate id filtered`, () => assert.equal(mapMediaAttachmentDocs([image, image], context).length, 1));
  test(`${label} wrong group rejected`, () => assert.equal(mapMediaAttachmentDocs([image], { ...context, groupId: "other" }).length, 0));
  test(`${label} wrong comment rejected`, () => assert.equal(mapMediaAttachmentDocs([image], { ...context, commentId: "other" }).length, 0));
  test(`${label} local URI rejected`, () => assert.equal(mapMediaAttachmentDocs([{ ...image, localUri: "file:///x" }], context).length, 0));
  test(`${label} max two policy`, () => assert.equal(getMediaAttachmentPolicy(context.type).maxAttachments, 2));
  test(`${label} over limit rejected`, () => assert.throws(() => validateMediaAttachmentCandidates([candidate("image", "image/jpeg"), candidate("image", "image/jpeg"), candidate("image", "image/jpeg")], getMediaAttachmentPolicy(context.type))));
  test(`${label} two videos rejected`, () => assert.throws(() => validateMediaAttachmentCandidates([candidate("video", "video/mp4"), candidate("video", "video/mp4")], getMediaAttachmentPolicy(context.type))));
  test(`${label} unsupported MIME rejected`, () => assert.throws(() => validateMediaAttachmentCandidates([candidate("image", "application/pdf")], getMediaAttachmentPolicy(context.type))));
}

console.log(`\nComment media QA: ${passed} passed.`);
