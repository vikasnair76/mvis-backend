import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, getDoc, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
const groupId = "bulletin-media-group";
const bulletinId = "bulletin1";
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const attachment = {
  id: "image1", type: "image",
  storagePath: `bulletinMedia/${groupId}/${bulletinId}/moderator/image1/original.jpg`,
  downloadUrl: "https://example.test/image.jpg", thumbnailUrl: null, externalUrl: null,
  mimeType: "image/jpeg", fileName: "image.jpg", sizeBytes: 100,
  width: null, height: null, durationMs: null, uploadedByUid: "moderator",
  createdAtMs: 1, provider: null, providerMediaId: null, title: null,
};
const bulletin = {
  groupId, title: "Media bulletin", body: "Body", attachments: [attachment],
  attachmentCount: 1, authorUid: "moderator", authorName: "Moderator",
  authorEmail: null, createdAtMs: 1, updatedAtMs: 1,
  createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
  hiddenByModeration: false, hiddenAtMs: null, hiddenByUid: null,
  hiddenByName: null, hiddenReason: null, hiddenReportId: null,
  deletedByAuthor: false, deletedAtMs: null,
};

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups", groupId), { ownerUserId: "owner", name: "Group" });
    for (const [uid, role] of [["owner", "owner"], ["moderator", "moderator"], ["member", "member"], ["viewer", "viewer"]])
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status: "active" });
  });
  const ref = doc(dbFor("moderator"), "groups", groupId, "bulletins", bulletinId);
  await check("moderator creates canonical media bulletin", () => assertSucceeds(setDoc(ref, bulletin)));
  await check("viewer reads media bulletin", () => assertSucceeds(getDoc(doc(dbFor("viewer"), "groups", groupId, "bulletins", bulletinId))));
  await check("member cannot create bulletin", () => assertFails(setDoc(doc(dbFor("member"), "groups", groupId, "bulletins", "member-post"), { ...bulletin, attachments: [], attachmentCount: 0 })));
  await check("viewer cannot create bulletin", () => assertFails(setDoc(doc(dbFor("viewer"), "groups", groupId, "bulletins", "viewer-post"), { ...bulletin, attachments: [], attachmentCount: 0 })));
  await check("malformed attachment path denied", () => assertFails(setDoc(doc(dbFor("moderator"), "groups", groupId, "bulletins", "bad"), { ...bulletin, attachments: [{ ...attachment, storagePath: "arbitrary/file.jpg" }] })));
  await check("attachment count mismatch denied", () => assertFails(setDoc(doc(dbFor("moderator"), "groups", groupId, "bulletins", "bad-count"), { ...bulletin, attachmentCount: 2 })));
  await check("moderator removes attachment", () => assertSucceeds(updateDoc(ref, { attachments: [], attachmentCount: 0, updatedAtMs: 2, updatedAt: Timestamp.fromMillis(2) })));
  await check("viewer cannot edit bulletin", () => assertFails(updateDoc(doc(dbFor("viewer"), "groups", groupId, "bulletins", bulletinId), { title: "No" })));
  await check("moderator soft deletes bulletin", () => assertSucceeds(updateDoc(ref, { deletedByAuthor: true, deletedAtMs: 3, updatedAtMs: 3, updatedAt: Timestamp.fromMillis(3) })));
  await check("client physical delete remains outside integration", () => assertSucceeds(getDoc(ref)));
} finally {
  console.log(`\nBulletin media rules QA: ${passed} passed.`);
  await env.cleanup();
}
