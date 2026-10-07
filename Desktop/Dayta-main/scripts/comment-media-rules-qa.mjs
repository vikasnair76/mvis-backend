import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
const groupId = "comment-media-group";
const bulletinId = "bulletin";
const goalId = "goal";
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`); };
const canonical = (path, id = "image") => ({
  id, type: "image", storagePath: path, downloadUrl: "https://example.test/image",
  thumbnailUrl: null, externalUrl: null, mimeType: "image/jpeg", fileName: "image.jpg",
  sizeBytes: 100, width: 10, height: 10, durationMs: null, uploadedByUid: "member",
  createdAtMs: 1, provider: null, providerMediaId: null, title: null,
});
const comment = (parentKey, parentId, attachments = []) => ({
  groupId, [parentKey]: parentId, body: attachments.length ? "" : "Text",
  authorUid: "member", authorName: "Member", authorEmail: null,
  createdAtMs: 1, updatedAtMs: 1, createdAt: Timestamp.fromMillis(1),
  updatedAt: Timestamp.fromMillis(1), hiddenByModeration: false,
  hiddenAtMs: null, hiddenByUid: null, hiddenByName: null,
  hiddenReason: null, hiddenReportId: null, attachments,
  attachmentCount: attachments.length,
});

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups", groupId), { ownerUserId: "owner", name: "Group" });
    for (const [uid, role, status = "active"] of [["owner", "owner"], ["member", "member"], ["viewer", "viewer"], ["removed", "member", "removed"]]) {
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status });
    }
    await setDoc(doc(db, "groups", groupId, "bulletins", bulletinId), {
      groupId, authorUid: "owner", title: "Bulletin", body: "Body",
      hiddenByModeration: false, deletedByAuthor: false,
    });
    await setDoc(doc(db, "groups", groupId, "sharedGoals", goalId), {
      groupId, goalId, sharedByUid: "owner", status: "active",
    });
  });
  const bulletinCommentId = "bc";
  const bulletinAttachment = canonical(`bulletinCommentMedia/${groupId}/${bulletinId}/${bulletinCommentId}/member/image/original.jpg`);
  const bulletinRef = doc(dbFor("member"), "groups", groupId, "bulletins", bulletinId, "comments", bulletinCommentId);
  await check("member creates bulletin attachment-only comment", () => assertSucceeds(setDoc(bulletinRef, comment("bulletinId", bulletinId, [bulletinAttachment]))));
  await check("viewer preserves existing bulletin comment policy", () => assertSucceeds(setDoc(doc(dbFor("viewer"), "groups", groupId, "bulletins", bulletinId, "comments", "viewer"), { ...comment("bulletinId", bulletinId), authorUid: "viewer" })));
  await check("removed member denied bulletin comment", () => assertFails(setDoc(doc(dbFor("removed"), "groups", groupId, "bulletins", bulletinId, "comments", "removed"), { ...comment("bulletinId", bulletinId), authorUid: "removed" })));
  await check("cross bulletin path denied", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "bulletins", bulletinId, "comments", "bad-parent"), comment("bulletinId", bulletinId, [{ ...bulletinAttachment, storagePath: bulletinAttachment.storagePath.replace(`/${bulletinId}/`, "/other/") }]))));
  await check("cross bulletin comment path denied", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "bulletins", bulletinId, "comments", "bad-comment"), comment("bulletinId", bulletinId, [bulletinAttachment]))));
  await check("bulletin count mismatch denied", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "bulletins", bulletinId, "comments", "bad-count"), { ...comment("bulletinId", bulletinId), attachmentCount: 1 })));

  const goalCommentId = "gc";
  const goalAttachment = canonical(`sharedGoalCommentMedia/${groupId}/${goalId}/${goalCommentId}/member/image/original.jpg`);
  const goalRef = doc(dbFor("member"), "groups", groupId, "sharedGoals", goalId, "comments", goalCommentId);
  await check("member creates goal attachment-only comment", () => assertSucceeds(setDoc(goalRef, comment("goalId", goalId, [goalAttachment]))));
  await check("goal cross comment path denied", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "sharedGoals", goalId, "comments", "bad-comment"), comment("goalId", goalId, [goalAttachment]))));
  await check("goal count mismatch denied", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "sharedGoals", goalId, "comments", "bad-count"), { ...comment("goalId", goalId), attachmentCount: 1 })));
  await check("author text edit preserves attachments", () => assertSucceeds(updateDoc(goalRef, { body: "Updated", updatedAtMs: 2 })));
  await check("author cannot erase attachments in text edit", () => assertFails(updateDoc(goalRef, { attachments: [], attachmentCount: 0 })));
  await check("removed member denied goal comment", () => assertFails(setDoc(doc(dbFor("removed"), "groups", groupId, "sharedGoals", goalId, "comments", "removed"), { ...comment("goalId", goalId), authorUid: "removed" })));
} finally {
  console.log(`\nComment media rules QA: ${passed} passed.`);
  await env.cleanup();
}
