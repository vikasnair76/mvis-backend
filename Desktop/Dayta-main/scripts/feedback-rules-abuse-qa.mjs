import {assertFails, initializeTestEnvironment}
  from "@firebase/rules-unit-testing";
import {readFile} from "node:fs/promises";
import {deleteDoc, doc, getDoc, setDoc, updateDoc} from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url),
  "utf8");
const env = await initializeTestEnvironment({projectId, firestore: {rules}});
let passed = 0;
const deny = async (name, action) => {
  await assertFails(action()); passed++; console.log(`PASS ${name}`);
};
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "feedbackSubmissions/feedback1"), {
      submittedByUid: "author", message: "private", status: "submitted",
    });
    await setDoc(doc(db,
      "feedbackSubmissions/feedback1/deliveries/email"),
    {state: "processing", attemptCount: 1});
    await setDoc(doc(db, "feedbackRateLimits/author_hour_1"), {count: 5});
    await setDoc(doc(db, "feedbackOperations/orphanCleanup"), {
      leaseOwner: "opaque",
    });
  });
  const signedOut = env.unauthenticatedContext().firestore();
  const author = env.authenticatedContext("author").firestore();
  const other = env.authenticatedContext("other").firestore();
  const admin = env.authenticatedContext("admin", {admin: true}).firestore();
  const moderator = env.authenticatedContext(
    "moderator", {moderator: true}).firestore();
  const canonical = (db) => doc(db, "feedbackSubmissions/feedback1");
  for (const [name, db] of [["signed out", signedOut], ["author", author],
    ["other", other], ["admin role", admin], ["moderator role", moderator]]) {
    await deny(`${name} canonical read denied`, () => getDoc(canonical(db)));
  }
  await deny("author canonical create denied", () => setDoc(
    doc(author, "feedbackSubmissions/forged"), {status: "submitted"}));
  for (const field of ["message", "replyEmail", "status", "createdAtMs"]) {
    await deny(`author canonical ${field} update denied`, () =>
      updateDoc(canonical(author), {[field]: "forged"}));
  }
  await deny("author canonical delete denied", () =>
    deleteDoc(canonical(author)));
  const delivery = doc(author,
    "feedbackSubmissions/feedback1/deliveries/email");
  await deny("delivery read denied", () => getDoc(delivery));
  await deny("delivery create denied", () => setDoc(doc(author,
    "feedbackSubmissions/feedback1/deliveries/forged"), {state: "sent"}));
  await deny("delivery status update denied", () =>
    updateDoc(delivery, {state: "sent"}));
  await deny("delivery attempt reset denied", () =>
    updateDoc(delivery, {attemptCount: 0}));
  await deny("delivery provider id update denied", () =>
    updateDoc(delivery, {providerMessageId: "forged"}));
  const rate = doc(author, "feedbackRateLimits/author_hour_1");
  await deny("rate read denied", () => getDoc(rate));
  await deny("rate create denied", () => setDoc(
    doc(author, "feedbackRateLimits/forged"), {count: 0}));
  await deny("rate lower denied", () => updateDoc(rate, {count: 0}));
  await deny("rate delete denied", () => deleteDoc(rate));
  const operation = doc(author, "feedbackOperations/orphanCleanup");
  await deny("maintenance read denied", () => getDoc(operation));
  await deny("maintenance lease create denied", () => setDoc(
    doc(author, "feedbackOperations/forged"), {leaseOwner: "client"}));
  await deny("maintenance checkpoint update denied", () =>
    updateDoc(operation, {continuationToken: "client"}));
  console.log(`Feedback Firestore rules abuse QA: ${passed} passed.`);
} finally {
  await env.cleanup();
}
