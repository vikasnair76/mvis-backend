import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {readFile} from "node:fs/promises";
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc,
  updateDoc, where,
} from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "dayta---goalsettingapp", firestore: {rules},
});
let checks = 0;
const pass = async (name, operation) => {
  await assertSucceeds(operation); checks += 1; console.log(`PASS ${name}`);
};
const deny = async (name, operation) => {
  await assertFails(operation); checks += 1; console.log(`PASS ${name}`);
};
const event = {
  ownerUid: "owner", occurredAtMs: Date.parse("2026-07-04T16:00:00Z"),
  eventType: "goal_completed", category: "goal", entityType: "goal",
  entityId: "goal-1", parentEntityId: null, displayTitle: "Goal",
  summary: "Goal completed.", metadata: {}, sourceEventId: "source-1",
  schemaVersion: 1, createdAtMs: Date.parse("2026-07-04T16:00:00Z"),
};
try {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", "owner",
      "historyEvents", "history-1"), event);
  });
  const owner = env.authenticatedContext("owner").firestore();
  const other = env.authenticatedContext("other").firestore();
  const ref = doc(owner, "users", "owner", "historyEvents", "history-1");
  await pass("owner reads personal history", getDoc(ref));
  await deny("other user denied", getDoc(doc(other, "users", "owner",
    "historyEvents", "history-1")));
  await deny("signed out denied", getDoc(doc(
    env.unauthenticatedContext().firestore(), "users", "owner",
    "historyEvents", "history-1")));
  await deny("client create denied", setDoc(doc(owner, "users", "owner",
    "historyEvents", "forged"), event));
  await deny("client update denied", updateDoc(ref, {summary: "Changed"}));
  await deny("client delete denied", deleteDoc(ref));
  await pass("owner month query succeeds", getDocs(query(
    collection(owner, "users", "owner", "historyEvents"),
    where("occurredAtMs", ">=", Date.parse("2026-07-01T00:00:00Z")),
    where("occurredAtMs", "<", Date.parse("2026-08-01T00:00:00Z")),
    orderBy("occurredAtMs", "desc"), limit(50)
  )));
  console.log(`Personal History rules QA passed (${checks} checks).`);
} finally {
  await env.cleanup();
}
