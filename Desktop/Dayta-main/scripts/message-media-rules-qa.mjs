import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
const groupId = "message-media-group";
const dmId = "dm";
const conversationId = "conversation";
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`); };
const attachment = (kind, parentId, messageId, uploader = "member", id = "image", type = "image") => ({
  id, type,
  storagePath: `${kind === "dm" ? "groupDmMedia" : "groupConversationMedia"}/${groupId}/${parentId}/${messageId}/${uploader}/${id}/original.${type === "video" ? "mp4" : "jpg"}`,
  downloadUrl: "https://example.test/media", thumbnailUrl: null, externalUrl: null,
  mimeType: type === "video" ? "video/mp4" : "image/jpeg", fileName: type === "video" ? "media.mp4" : "media.jpg",
  sizeBytes: 100, width: 10, height: 10, durationMs: type === "video" ? 1000 : null,
  uploadedByUid: uploader, createdAtMs: 1, provider: null, providerMediaId: null, title: null,
});
const message = (kind, messageId, attachments = [], body = "") => ({
  [kind === "dm" ? "dmId" : "conversationId"]: kind === "dm" ? dmId : conversationId,
  groupId, body, senderUid: "member", senderName: "Member", senderEmail: null,
  replyTo: null, hiddenByModeration: false, deletedByAuthor: false,
  deletedAtMs: null, attachments, attachmentCount: attachments.length,
  createdAtMs: 1, updatedAtMs: 1, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
});

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups", groupId), { ownerUserId: "owner", name: "Group" });
    for (const [uid, role, status = "active"] of [
      ["owner", "owner"], ["member", "member"], ["other", "member"],
      ["removed", "member", "removed"], ["outsider", "member", "active"],
    ]) {
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status });
    }
    await setDoc(doc(db, "groupDms", dmId), {
      groupId, participantUids: ["member", "other"], participantMap: { member: true, other: true },
      createdByUid: "member", createdAtMs: 1, updatedAtMs: 1,
    });
    await setDoc(doc(db, "groupConversations", conversationId), {
      groupId, memberUids: ["member", "other"], memberMap: { member: true, other: true },
      createdByUid: "member", createdAtMs: 1, updatedAtMs: 1, archived: false,
    });
  });

  for (const [kind, parentId, collection] of [
    ["dm", dmId, "groupDms"], ["conversation", conversationId, "groupConversations"],
  ]) {
    const prefix = `${kind} `;
    const goodId = `${kind}-good`;
    const good = attachment(kind, parentId, goodId);
    const goodRef = doc(dbFor("member"), collection, parentId, "messages", goodId);
    await check(`${prefix}attachment-only create`, () => assertSucceeds(setDoc(goodRef, message(kind, goodId, [good]))));
    await check(`${prefix}text-only canonical create`, () => assertSucceeds(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-text`), message(kind, `${kind}-text`, [], "Text"))));
    await check(`${prefix}empty message denied`, () => assertFails(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-empty`), message(kind, `${kind}-empty`))));
    await check(`${prefix}cross-message path denied`, () => assertFails(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-wrong-message`), message(kind, `${kind}-wrong-message`, [good]))));
    await check(`${prefix}wrong uploader denied`, () => assertFails(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-wrong-uploader`), message(kind, `${kind}-wrong-uploader`, [attachment(kind, parentId, `${kind}-wrong-uploader`, "other")]))));
    await check(`${prefix}count mismatch denied`, () => assertFails(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-count`), { ...message(kind, `${kind}-count`, [attachment(kind, parentId, `${kind}-count`)]), attachmentCount: 0 })));
    const videos = [attachment(kind, parentId, `${kind}-videos`, "member", "v1", "video"), attachment(kind, parentId, `${kind}-videos`, "member", "v2", "video")];
    await check(`${prefix}second video denied`, () => assertFails(setDoc(doc(dbFor("member"), collection, parentId, "messages", `${kind}-videos`), message(kind, `${kind}-videos`, videos))));
    await check(`${prefix}text edit preserves media`, () => assertSucceeds(updateDoc(goodRef, { body: "Edited", editedByUid: "member", editedAtMs: 2, updatedAtMs: 2, updatedAt: Timestamp.fromMillis(2) })));
    await check(`${prefix}author cannot erase media`, () => assertFails(updateDoc(goodRef, { attachments: [], attachmentCount: 0, body: "Edited again", editedByUid: "member", editedAtMs: 3, updatedAtMs: 3 })));
    await check(`${prefix}outsider cannot read`, () => assertFails(getDoc(doc(dbFor("outsider"), collection, parentId, "messages", goodId))));
  }
} finally {
  console.log(`\nMessage media rules QA: ${passed} passed.`);
  await env.cleanup();
}
