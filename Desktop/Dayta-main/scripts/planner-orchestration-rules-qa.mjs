import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {readFile} from "node:fs/promises";
import {deleteDoc, doc, getDoc, setDoc, updateDoc} from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "dayta---goalsettingapp", firestore: {rules},
});
let checks = 0;
const denied = async (name, operation) => {
  await assertFails(operation); checks += 1; console.log(`PASS ${name}`);
};
try {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "plannerGenerationRequests", "request"), {
      id: "request", ownerUid: "owner", status: "queued",
    });
    await setDoc(doc(context.firestore(), "plannerScheduleState", "owner"), {
      ownerUid: "owner", enabled: true, nextRefreshAtMs: 1,
    });
    await setDoc(doc(context.firestore(), "plannerNotificationRequests", "request"), {
      id: "request", ownerUid: "owner", status: "queued",
    });
    await setDoc(doc(context.firestore(), "users", "owner",
      "plannerMetrics", "summary"), {notificationBatchCount: 1});
  });
  const db = env.authenticatedContext("owner").firestore();
  for (const [collectionName, id] of [
    ["plannerGenerationRequests", "request"],
    ["plannerScheduleState", "owner"],
    ["plannerNotificationRequests", "request"],
  ]) {
    const ref = doc(db, collectionName, id);
    await denied(`${collectionName} read denied`, getDoc(ref));
    await denied(`${collectionName} create denied`,
      setDoc(doc(db, collectionName, "new"), {ownerUid: "owner"}));
    await denied(`${collectionName} update denied`, updateDoc(ref, {enabled: false}));
    await denied(`${collectionName} delete denied`, deleteDoc(ref));
  }
  const metrics = doc(db, "users", "owner", "plannerMetrics", "summary");
  await denied("plannerMetrics read denied", getDoc(metrics));
  await denied("plannerMetrics update denied",
    updateDoc(metrics, {notificationBatchCount: 2}));
  console.log(`Planner orchestration rules QA passed: ${checks} checks.`);
} finally {
  await env.cleanup();
}
