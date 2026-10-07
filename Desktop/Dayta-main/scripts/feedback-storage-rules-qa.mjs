import {assertFails, assertSucceeds, initializeTestEnvironment}
  from "@firebase/rules-unit-testing";
import {readFile} from "node:fs/promises";
import {doc, setDoc} from "firebase/firestore";
import {deleteObject, getBytes, ref, uploadBytes} from "firebase/storage";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../storage.rules", import.meta.url),
  "utf8");
const firestoreRules = await readFile(
  new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({projectId,
  firestore: {rules: firestoreRules}, storage: {rules}});
let passed = 0;
const check = async (name, fn) => {
  await fn(); passed++; console.log(`PASS ${name}`);
};
const path = "feedback/user1/feedback1/attachment1";
const metadata = (contentType = "image/jpeg", overrides = {}) => ({
  contentType,
  customMetadata: {ownerUid: "user1", feedbackId: "feedback1",
    attachmentId: "attachment1", kind: contentType.startsWith("video/") ?
      "video" : "image", sizeBytes: "1", width: "1", height: "1",
    durationMs: contentType.startsWith("video/") ? "1" : "",
    uploadedAtMs: "1", ...overrides},
});
try {
  const owner = env.authenticatedContext("user1").storage();
  const other = env.authenticatedContext("user2").storage();
  const signedOut = env.unauthenticatedContext().storage();
  await check("signed out create denied", () => assertFails(uploadBytes(
    ref(signedOut, path), new Uint8Array([1]), metadata())));
  await check("wrong UID create denied", () => assertFails(uploadBytes(
    ref(other, path), new Uint8Array([1]), metadata())));
  await check("owner JPEG create accepted", () => assertSucceeds(uploadBytes(
    ref(owner, path), new Uint8Array([1]), metadata())));
  await check("public read denied", () => assertFails(getBytes(
    ref(signedOut, path))));
  await check("owner read denied", () => assertFails(getBytes(
    ref(owner, path))));
  await check("cross-user read denied", () => assertFails(getBytes(
    ref(other, path))));
  await check("overwrite denied", () => assertFails(uploadBytes(
    ref(owner, path), new Uint8Array([1]), metadata())));
  await check("cross-user delete denied", () => assertFails(deleteObject(
    ref(other, path))));
  await check("owner cleanup delete accepted", () => assertSucceeds(
    deleteObject(ref(owner, path))));
  await check("unsupported MIME denied", () => assertFails(uploadBytes(
    ref(owner, path), new Uint8Array([1]), metadata("application/pdf"))));
  await check("JPEG at limit accepted", async () => {
    const exactPath = "feedback/user1/feedback1/exactImage";
    await assertSucceeds(uploadBytes(ref(owner, exactPath),
      new Uint8Array(10 * 1024 * 1024), {contentType: "image/jpeg",
        customMetadata: {ownerUid: "user1", feedbackId: "feedback1",
          attachmentId: "exactImage", kind: "image",
          sizeBytes: String(10 * 1024 * 1024), width: "1", height: "1",
          durationMs: "", uploadedAtMs: "1"}}));
    await assertSucceeds(deleteObject(ref(owner, exactPath)));
  });
  await check("oversized JPEG denied", () => assertFails(uploadBytes(
    ref(owner, "feedback/user1/feedback1/largeImage"),
    new Uint8Array(10 * 1024 * 1024 + 1), {contentType: "image/jpeg",
      customMetadata: {ownerUid: "user1", feedbackId: "feedback1",
        attachmentId: "largeImage", kind: "image", sizeBytes: "1",
        width: "1", height: "1", durationMs: "", uploadedAtMs: "1"}})));
  await check("wrong metadata denied", () => assertFails(uploadBytes(
    ref(owner, path), new Uint8Array([1]), metadata("image/jpeg",
      {feedbackId: "other"}))));
  await check("unexpected metadata denied", () => assertFails(uploadBytes(
    ref(owner, "feedback/user1/feedback1/unexpected"),
    new Uint8Array([1]), metadata("image/jpeg",
      {attachmentId: "unexpected", email: "private@example.com"}))));
  await check("nested arbitrary path denied", () => assertFails(uploadBytes(
    ref(owner, `${path}/nested`), new Uint8Array([1]), metadata())));
  await check("allowed MP4 accepted", () => assertSucceeds(uploadBytes(
    ref(owner, "feedback/user1/feedback1/video1"), new Uint8Array([1]),
    {contentType: "video/mp4", customMetadata: {ownerUid: "user1",
      feedbackId: "feedback1", attachmentId: "video1", kind: "video",
      sizeBytes: "1", width: "1", height: "1", durationMs: "1",
      uploadedAtMs: "1"}})));
  await check("owner delete after finalization denied", async () => {
    const finalPath = "feedback/user1/finalized/finalAttachment";
    await assertSucceeds(uploadBytes(ref(owner, finalPath),
      new Uint8Array([1]), metadata("image/jpeg", {
        feedbackId: "finalized", attachmentId: "finalAttachment",
      })));
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(),
        "feedbackSubmissions/finalized"), {submittedByUid: "user1"});
    });
    await assertFails(deleteObject(ref(owner, finalPath)));
  });
  await check("oversized MP4 denied", () => assertFails(uploadBytes(
    ref(owner, "feedback/user1/feedback1/largeVideo"),
    new Uint8Array(50 * 1024 * 1024 + 1), {contentType: "video/mp4",
      customMetadata: {ownerUid: "user1", feedbackId: "feedback1",
        attachmentId: "largeVideo", kind: "video", sizeBytes: "1",
        width: "1", height: "1", durationMs: "1", uploadedAtMs: "1"}})));
} finally {
  console.log(`Feedback Storage rules QA: ${passed} passed.`);
  await env.cleanup();
}
