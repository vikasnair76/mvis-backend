import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {readFile} from "node:fs/promises";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc,
} from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url),
  "utf8");
const env = await initializeTestEnvironment({
  projectId: "dayta---goalsettingapp",
  firestore: {rules},
});
let checks = 0;
const pass = async (name, operation) => {
  await assertSucceeds(operation);
  checks += 1;
  console.log(`PASS ${name}`);
};
const deny = async (name, operation) => {
  await assertFails(operation);
  checks += 1;
  console.log(`PASS ${name}`);
};
const event = {
  schemaVersion: 1,
  groupId: "group-history-rules",
  eventType: "group_task_completed",
  category: "tasks",
  occurredAtMs: Date.parse("2026-07-26T16:00:00Z"),
  createdAtMs: Date.parse("2026-07-26T16:00:01Z"),
  entityType: "group_task",
  entityId: "task-1",
  parentEntityType: null,
  parentEntityId: null,
  sourceEventId: "task-transition-1",
  displayTitle: "Shared task",
  summary: null,
  actorUid: "member",
  actorDisplayName: "Member",
  creditedMemberUid: "member",
  creditedMemberDisplayName: "Member",
  visibility: "group_members",
  metadata: {kind: "group_task_completed", claimedByUid: "member"},
};

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "groups", "group-history-rules"), {
      ownerUserId: "owner", name: "History group",
    });
    await setDoc(doc(db, "groups", "other-history-group"), {
      ownerUserId: "other-owner", name: "Other group",
    });
    for (const [uid, role, status = "active"] of [
      ["owner", "owner"],
      ["admin", "admin"],
      ["moderator", "moderator"],
      ["member", "member"],
      ["viewer", "viewer"],
      ["removed", "member", "removed"],
      ["departed", "member", "removed"],
      ["blocked", "member"],
    ]) {
      await setDoc(doc(db, "groups", "group-history-rules", "members", uid),
        {uid, role, status});
    }
    await setDoc(doc(db, "groups", "group-history-rules", "blockedUsers",
      "blocked"), {uid: "blocked", blockedByUid: "owner"});
    await setDoc(doc(db, "groups", "group-history-rules", "invites",
      "invite-1"), {status: "pending", invitedEmail: "invited@example.com"});
    await setDoc(doc(db, "groups", "group-history-rules", "joinRequests",
      "requested"), {uid: "requested", status: "pending"});
    await setDoc(doc(db, "groups", "group-history-rules", "historyEvents",
      "event-1"), event);
    await setDoc(doc(db, "groups", "other-history-group", "historyEvents",
      "other-event"), {...event, groupId: "other-history-group"});
  });

  for (const uid of ["owner", "admin", "moderator", "member", "viewer"]) {
    const db = env.authenticatedContext(uid).firestore();
    await pass(`active ${uid} reads history`, getDoc(doc(
      db, "groups", "group-history-rules", "historyEvents", "event-1")));
  }
  for (const uid of [
    "invited", "requested", "removed", "departed", "blocked", "unrelated",
  ]) {
    const db = env.authenticatedContext(uid, {
      email: uid === "invited" ? "invited@example.com" : `${uid}@example.com`,
    }).firestore();
    await deny(`${uid} denied history`, getDoc(doc(
      db, "groups", "group-history-rules", "historyEvents", "event-1")));
  }
  await deny("signed-out user denied", getDoc(doc(
    env.unauthenticatedContext().firestore(),
    "groups", "group-history-rules", "historyEvents", "event-1")));
  await deny("cross-group read denied", getDoc(doc(
    env.authenticatedContext("member").firestore(),
    "groups", "other-history-group", "historyEvents", "other-event")));

  for (const uid of ["owner", "admin", "member", "viewer"]) {
    const db = env.authenticatedContext(uid).firestore();
    await deny(`${uid} client create denied`, setDoc(doc(
      db, "groups", "group-history-rules", "historyEvents", `forged-${uid}`),
    event));
  }
  await deny("admin client update denied", updateDoc(doc(
    env.authenticatedContext("admin").firestore(),
    "groups", "group-history-rules", "historyEvents", "event-1"),
  {summary: "Changed"}));
  await deny("owner client delete denied", deleteDoc(doc(
    env.authenticatedContext("owner").firestore(),
    "groups", "group-history-rules", "historyEvents", "event-1")));
  for (const uid of ["owner", "admin", "moderator", "member", "viewer"]) {
    await pass(`active ${uid} can group-query history`,
      getDocs(query(collection(
        env.authenticatedContext(uid).firestore(),
        "groups", "group-history-rules", "historyEvents"))));
  }

  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "groups", "group-history-rules",
      "members", "member"), {status: "removed"});
  });
  await deny("query after membership removal denied", getDocs(query(collection(
    env.authenticatedContext("member").firestore(),
    "groups", "group-history-rules", "historyEvents"))));

  console.log(`Group History rules QA passed (${checks} checks).`);
} finally {
  await env.cleanup();
}
