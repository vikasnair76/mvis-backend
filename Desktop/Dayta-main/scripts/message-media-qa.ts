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
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};
type MessageContext = Extract<
  MediaAttachmentContext,
  { type: "group_dm_message" | "group_conversation_message" }
>;
const contexts: MessageContext[] = [
  { type: "group_dm_message", groupId: "g", dmId: "dm", messageId: "m" },
  {
    type: "group_conversation_message",
    groupId: "g",
    conversationId: "conversation",
    messageId: "m",
  },
];
const attachment = (
  context: MessageContext,
  id: string,
  type: "image" | "gif" | "video",
  mimeType: string,
  extension: string
): MediaAttachmentDoc => {
  const prefix =
    context.type === "group_dm_message"
      ? `groupDmMedia/${context.groupId}/${context.dmId}/${context.messageId}`
      : `groupConversationMedia/${context.groupId}/${context.conversationId}/${context.messageId}`;
  return {
    id, type, storagePath: `${prefix}/user/${id}/original.${extension}`,
    downloadUrl: `https://example.test/${id}`, thumbnailUrl: null,
    externalUrl: null, mimeType, fileName: `file.${extension}`, sizeBytes: 100,
    width: 10, height: 10, durationMs: type === "video" ? 1000 : null,
    uploadedByUid: "user", createdAtMs: 1, provider: null,
    providerMediaId: null, title: null,
  };
};
const candidate = (type: "image" | "video", mimeType: string): LocalMediaAttachmentCandidate => ({
  localUri: "file:///candidate", type, mimeType, sizeBytes: 100,
  durationMs: type === "video" ? 1000 : null,
});

for (const context of contexts) {
  const image = attachment(context, "image", "image", "image/jpeg", "jpg");
  const gif = attachment(context, "gif", "gif", "image/gif", "gif");
  const video = attachment(context, "video", "video", "video/mp4", "mp4");
  const label = context.type;
  test(`${label} missing fields map empty`, () => assert.deepEqual(mapMediaAttachmentDocs(undefined, context), []));
  test(`${label} maps image`, () => assert.equal(mapMediaAttachmentDocs([image], context).length, 1));
  test(`${label} maps GIF`, () => assert.equal(mapMediaAttachmentDocs([gif], context).length, 1));
  test(`${label} maps MP4`, () => assert.equal(mapMediaAttachmentDocs([video], context).length, 1));
  test(`${label} preserves order`, () => assert.deepEqual(mapMediaAttachmentDocs([gif, image], context).map((x) => x.id), ["gif", "image"]));
  test(`${label} filters duplicate ids`, () => assert.equal(mapMediaAttachmentDocs([image, image], context).length, 1));
  test(`${label} rejects wrong group`, () => assert.equal(mapMediaAttachmentDocs([image], { ...context, groupId: "other" }).length, 0));
  test(`${label} rejects wrong message`, () => assert.equal(mapMediaAttachmentDocs([image], { ...context, messageId: "other" }).length, 0));
  test(`${label} rejects local URI metadata`, () => assert.equal(mapMediaAttachmentDocs([{ ...image, localUri: "file:///x" }], context).length, 0));
  test(`${label} policy max is four`, () => assert.equal(getMediaAttachmentPolicy(context.type).maxAttachments, 4));
  test(`${label} rejects fifth candidate`, () => assert.throws(() => validateMediaAttachmentCandidates(Array.from({ length: 5 }, () => candidate("image", "image/jpeg")), getMediaAttachmentPolicy(context.type))));
  test(`${label} rejects second video`, () => assert.throws(() => validateMediaAttachmentCandidates([candidate("video", "video/mp4"), candidate("video", "video/mp4")], getMediaAttachmentPolicy(context.type))));
  test(`${label} rejects unsupported MIME`, () => assert.throws(() => validateMediaAttachmentCandidates([candidate("image", "application/pdf")], getMediaAttachmentPolicy(context.type))));
}
console.log(`\nMessage media QA: ${passed} passed.`);
