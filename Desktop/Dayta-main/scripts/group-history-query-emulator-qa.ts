import {doc, setDoc} from "firebase/firestore";
import {type RulesTestEnvironment} from "@firebase/rules-unit-testing";
import * as firebaseService from "../services/firebase";
import {
  getGroupHistoryMonthPage,
  getGroupHistoryMonthSummary,
  GroupHistoryQueryError,
} from "../services/groupHistoryQueries";

const {qaTestEnv} = firebaseService as unknown as {
  qaTestEnv: RulesTestEnvironment;
};
let checks = 0;
const ok = (condition: unknown, name: string) => {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks += 1;
};
const base = {
  schemaVersion: 1, groupId: "group-query-emulator",
  eventType: "shared_subtask_completed", category: "goals",
  createdAtMs: Date.parse("2024-03-15T12:00:01Z"),
  entityType: "subtask", entityId: "subtask", parentEntityType: "goal",
  parentEntityId: "goal", sourceEventId: "source",
  displayTitle: "Deleted source snapshot", summary: null,
  actorUid: "member", actorDisplayName: "Member",
  creditedMemberUid: null, creditedMemberDisplayName: null,
  visibility: "group_members",
  metadata: {kind: "shared_subtask_completed", assignmentUid: null},
};
await qaTestEnv.withSecurityRulesDisabled(async (context) => {
  const adminDb = context.firestore();
  await setDoc(doc(adminDb, "groups", "group-query-emulator"),
    {ownerUserId: "owner", name: "Query"});
  for (const [uid, role] of [
    ["owner", "owner"], ["admin", "admin"], ["moderator", "moderator"],
    ["member", "member"], ["viewer", "viewer"], ["removed", "member"],
    ["blocked", "member"],
  ]) await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "members", uid), {uid, role, status: uid === "removed" ?
      "removed" : "active"});
  await setDoc(doc(adminDb, "groups", "group-query-emulator", "blockedUsers",
    "blocked"), {uid: "blocked"});
  for (const [id, iso] of [
    ["event-z", "2024-03-15T12:00:00Z"],
    ["event-y", "2024-03-15T12:00:00Z"],
    ["event-x", "2024-03-14T12:00:00Z"],
  ]) await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "historyEvents", id), {...base, occurredAtMs: Date.parse(iso),
    sourceEventId: id});
  await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "historyEvents", "previous"), {...base,
    occurredAtMs: Date.parse("2024-02-29T23:59:59Z")});
  await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "historyEvents", "next"), {...base,
    occurredAtMs: Date.parse("2024-04-01T00:00:00Z")});
  await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "historyEvents", "malformed"), {...base,
    occurredAtMs: Date.parse("2024-03-10T00:00:00Z"), category: "tasks"});
  await setDoc(doc(adminDb, "groups", "group-query-emulator",
    "historyEvents", "unsupported"), {...base,
    occurredAtMs: Date.parse("2024-03-09T00:00:00Z"), schemaVersion: 2});
});

const page1 = await getGroupHistoryMonthPage({
  groupId: "group-query-emulator", year: 2024, month: 3,
  timeZone: "UTC", pageSize: 2,
});
ok(page1.events.map((event) => event.id).join(",") === "event-z,event-y",
  "real query stable tie order");
const page2 = await getGroupHistoryMonthPage({
  groupId: "group-query-emulator", year: 2024, month: 3,
  timeZone: "UTC", pageSize: 2, cursor: page1.nextCursor,
});
ok(page2.events.length === 1 && page2.events[0].id === "event-x",
  "real query cursor and malformed refill");
ok(page2.skippedMalformedCount === 1 &&
  page2.skippedUnsupportedSchemaCount === 1, "real query skip accounting");
const summary = await getGroupHistoryMonthSummary({
  groupId: "group-query-emulator", year: 2024, month: 3, timeZone: "UTC",
});
ok(summary.complete && summary.summary.totalEvents === 3,
  "real full-month summary");
ok(summary.summary.activeLocalDayCount === 2, "real active local days");

await qaTestEnv.withSecurityRulesDisabled(async (context) =>
  setDoc(doc(context.firestore(), "groups", "group-query-emulator",
  "members", "owner"), {uid: "owner", role: "owner", status: "removed"}));
let denied = false;
try {
  await getGroupHistoryMonthPage({
    groupId: "group-query-emulator", year: 2024, month: 3,
    timeZone: "UTC", pageSize: 2, cursor: page1.nextCursor,
  });
} catch (error) {
  denied = error instanceof GroupHistoryQueryError &&
    error.code === "permission_denied";
}
ok(denied, "pagination after membership removal denied");

await qaTestEnv.cleanup();
console.log(`Group History query emulator QA passed (${checks} checks).`);
