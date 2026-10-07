import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "dayta---goalsettingapp";
const [firestoreRules, storageRules] = await Promise.all([
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../storage.rules", import.meta.url), "utf8"),
]);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: firestoreRules }, storage: { rules: storageRules } });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const groupId = "storage-media-group";
const now = Date.now();
const context = env.authenticatedContext("member");
const storage = context.storage();
const metadata = (sessionId, overrides = {}) => ({
  contentType: "image/jpeg",
  customMetadata: {
    uploaderUid: "member", contextType: "bulletin_comment", uploadSessionId: sessionId,
    groupId, bulletinId: "bulletin1", commentId: "comment1", attachmentId: "attachment1",
    uploadedAtMs: String(now), ...overrides,
  },
});
const path = `bulletinCommentMedia/${groupId}/bulletin1/comment1/member/attachment1/original.jpg`;

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups", groupId), { name: "Group" });
    await setDoc(doc(db, "groups", groupId, "members", "member"), { uid: "member", role: "member", status: "active" });
    await setDoc(doc(db, "groups", groupId, "members", "viewer"), { uid: "viewer", role: "viewer", status: "active" });
    await setDoc(doc(db, "groups", groupId, "members", "removed"), { uid: "removed", role: "member", status: "removed" });
    await setDoc(doc(db, "groupDms", "dm1"), {
      groupId, participantUids: ["member", "viewer"], participantMap: { member: true, viewer: true },
    });
    await setDoc(doc(db, "groupConversations", "conversation1"), {
      groupId, memberUids: ["member", "viewer"], memberMap: { member: true, viewer: true }, archived: false,
    });
    await setDoc(doc(db, "groups", groupId, "bulletins", "bulletin1"), {
      groupId, hiddenByModeration: false, deletedByAuthor: false,
    });
    await setDoc(doc(db, "goals", "goal1"), { userId: "member", visibility: "private" });
    await setDoc(doc(db, "goals", "goal1", "subtasks", "task1"), { assignedToUid: "member" });
    await setDoc(doc(db, "mediaUploadSessions", "progress-active"), {
      id: "progress-active", uploaderUid: "member", contextType: "progress",
      groupId: null, goalId: "goal1", subtaskId: "task1",
      progressEventId: "event1", bulletinId: null, commentId: null,
      dmId: null, conversationId: null, messageId: null, status: "active",
      createdAtMs: now, expiresAtMs: now + 600_000, finalizedAtMs: null,
      cancelledAtMs: null, updatedAtMs: now, createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    for (const [id, status, expiresAtMs] of [
      ["active", "active", now + 600_000], ["expired", "active", now - 1],
      ["finalized", "finalized", now + 600_000], ["cancelled", "cancelled", now + 600_000],
    ]) await setDoc(doc(db, "mediaUploadSessions", id), {
      id, uploaderUid: "member", contextType: "bulletin_comment",
      groupId, goalId: null, subtaskId: null, progressEventId: null,
      bulletinId: "bulletin1", commentId: "comment1", dmId: null,
      conversationId: null, messageId: null, status,
      createdAtMs: now, expiresAtMs,
      finalizedAtMs: status === "finalized" ? now : null,
      cancelledAtMs: status === "cancelled" ? now : null,
      updatedAtMs: now, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "groups", groupId, "sharedGoals", "goalComment"), {
      groupId, goalId: "goalComment", status: "active", sharedByUid: "member",
    });
    await setDoc(doc(db, "mediaUploadSessions", "goal-active"), {
      id: "goal-active", uploaderUid: "member", contextType: "shared_goal_comment",
      groupId, goalId: "goalComment", subtaskId: null, progressEventId: null,
      bulletinId: null, commentId: "goalComment1", dmId: null,
      conversationId: null, messageId: null, status: "active",
      createdAtMs: now, expiresAtMs: now + 600_000, finalizedAtMs: null,
      cancelledAtMs: null, updatedAtMs: now, createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    for (const [id, contextType] of [
      ["dm-active", "group_dm_message"],
      ["conversation-active", "group_conversation_message"],
    ]) {
      await setDoc(doc(db, "mediaUploadSessions", id), {
        id, uploaderUid: "member", contextType, groupId,
        goalId: null, subtaskId: null, progressEventId: null, bulletinId: null,
        commentId: null, dmId: contextType === "group_dm_message" ? "dm1" : null,
        conversationId: contextType === "group_conversation_message" ? "conversation1" : null,
        messageId: "message1", status: "active", createdAtMs: now,
        expiresAtMs: now + 600_000, finalizedAtMs: null, cancelledAtMs: null,
        updatedAtMs: now, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    }
  });

  await check("matching active session upload succeeds", () => assertSucceeds(uploadBytes(ref(storage, path), new Uint8Array([1, 2, 3]), metadata("active"))));
  const progressPath = "progressMedia/member/goal1/task1/event1/progressAttachment/original.jpg";
  const progressMetadata = { contentType: "image/jpeg", customMetadata: { uploaderUid: "member", contextType: "progress", uploadSessionId: "progress-active", goalId: "goal1", subtaskId: "task1", progressEventId: "event1", attachmentId: "progressAttachment", uploadedAtMs: String(now) } };
  await check("session-backed progress upload succeeds", () => assertSucceeds(uploadBytes(ref(storage, progressPath), new Uint8Array([1]), progressMetadata)));
  await check("progress overwrite denied", () => assertFails(uploadBytes(ref(storage, progressPath), new Uint8Array([2]), progressMetadata)));
  await check("authorized group member reads upload", () => assertSucceeds(getBytes(ref(env.authenticatedContext("viewer").storage(), path))));
  await check("overwrite denied", () => assertFails(uploadBytes(ref(storage, path), new Uint8Array([4]), metadata("active"))));
  await check("wrong uploader denied", () => assertFails(uploadBytes(ref(env.authenticatedContext("viewer").storage(), path.replace("/member/", "/viewer/")), new Uint8Array([1]), metadata("active", { uploaderUid: "viewer" }))));
  await check("wrong parent denied", () => assertFails(uploadBytes(ref(storage, path.replace("comment1", "other")), new Uint8Array([1]), metadata("active"))));
  await check("expired session denied", () => assertFails(uploadBytes(ref(storage, path.replace("attachment1", "expiredAttachment")), new Uint8Array([1]), metadata("expired", { attachmentId: "expiredAttachment" }))));
  await check("finalized session denied", () => assertFails(uploadBytes(ref(storage, path.replace("attachment1", "finalAttachment")), new Uint8Array([1]), metadata("finalized", { attachmentId: "finalAttachment" }))));
  await check("cancelled session denied", () => assertFails(uploadBytes(ref(storage, path.replace("attachment1", "cancelAttachment")), new Uint8Array([1]), metadata("cancelled", { attachmentId: "cancelAttachment" }))));
  await check("mime mismatch denied", () => assertFails(uploadBytes(ref(storage, path.replace("attachment1", "pngAttachment")), new Uint8Array([1]), { ...metadata("active", { attachmentId: "pngAttachment" }), contentType: "image/png" })));
  await check("oversized image denied", () => assertFails(uploadBytes(ref(storage, path.replace("attachment1", "largeAttachment")), new Uint8Array(10 * 1024 * 1024 + 1), metadata("active", { attachmentId: "largeAttachment" }))));
  await check("arbitrary path denied", () => assertFails(uploadBytes(ref(storage, "arbitrary/member/file.jpg"), new Uint8Array([1]), metadata("active"))));
  await check("signed out denied", () => assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path.replace("attachment1", "signedout")), new Uint8Array([1]), metadata("active", { attachmentId: "signedout" }))));
  await check("uploader can delete own upload", () => assertSucceeds(deleteObject(ref(storage, path))));
  const goalPath = `sharedGoalCommentMedia/${groupId}/goalComment/goalComment1/member/goalAttachment/original.jpg`;
  const goalMetadata = {
    contentType: "image/jpeg",
    customMetadata: {
      uploaderUid: "member", contextType: "shared_goal_comment",
      uploadSessionId: "goal-active", groupId, goalId: "goalComment",
      commentId: "goalComment1", attachmentId: "goalAttachment",
      uploadedAtMs: String(now),
    },
  };
  await check("shared goal comment upload succeeds", () => assertSucceeds(uploadBytes(ref(storage, goalPath), new Uint8Array([1]), goalMetadata)));
  await check("shared goal wrong comment denied", () => assertFails(uploadBytes(ref(storage, goalPath.replace("goalComment1", "other")), new Uint8Array([1]), goalMetadata)));
  await check("shared goal authorized member reads", () => assertSucceeds(getBytes(ref(env.authenticatedContext("viewer").storage(), goalPath))));
  const messageCases = [
    {
      label: "DM", contextType: "group_dm_message", sessionId: "dm-active",
      path: `groupDmMedia/${groupId}/dm1/message1/member/messageAttachment/original.jpg`,
      parentKey: "dmId", parentId: "dm1",
    },
    {
      label: "conversation", contextType: "group_conversation_message",
      sessionId: "conversation-active",
      path: `groupConversationMedia/${groupId}/conversation1/message1/member/messageAttachment/original.jpg`,
      parentKey: "conversationId", parentId: "conversation1",
    },
  ];
  for (const item of messageCases) {
    const messageMetadata = {
      contentType: "image/jpeg",
      customMetadata: {
        uploaderUid: "member", contextType: item.contextType,
        uploadSessionId: item.sessionId, groupId, [item.parentKey]: item.parentId,
        messageId: "message1", attachmentId: "messageAttachment",
        uploadedAtMs: String(now),
      },
    };
    await check(`${item.label} matching session upload succeeds`, () =>
      assertSucceeds(uploadBytes(ref(storage, item.path), new Uint8Array([1]), messageMetadata)));
    await check(`${item.label} participant reads`, () =>
      assertSucceeds(getBytes(ref(env.authenticatedContext("viewer").storage(), item.path))));
    await check(`${item.label} nonparticipant denied read`, () =>
      assertFails(getBytes(ref(env.authenticatedContext("owner").storage(), item.path))));
    await check(`${item.label} wrong message denied`, () =>
      assertFails(uploadBytes(ref(storage, item.path.replace("message1", "other")), new Uint8Array([1]), messageMetadata)));
    await check(`${item.label} wrong uploader denied`, () =>
      assertFails(uploadBytes(ref(env.authenticatedContext("viewer").storage(), item.path.replace("/member/", "/viewer/")), new Uint8Array([1]), {
        ...messageMetadata,
        customMetadata: { ...messageMetadata.customMetadata, uploaderUid: "viewer" },
      })));
  }
} finally {
  console.log(`\nShared media Storage rules QA: ${passed} passed.`);
  await env.cleanup();
}
