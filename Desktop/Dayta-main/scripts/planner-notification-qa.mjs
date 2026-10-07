import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {
  claimPlannerNotificationRequest,
  enqueuePlannerNotificationBatch,
  getPlannerNotificationCandidates,
  getPlannerNotificationCopy,
  processPlannerNotificationClaim,
} from "../functions/lib/plannerNotifications.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const uid = "planner-notification-owner";
const now = Date.parse("2026-07-26T18:00:00Z");
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const preferences = {
  enabled: true, allowPersonalSuggestions: true, allowGroupSuggestions: true,
  notificationsEnabled: true, personalNotificationsEnabled: true,
  groupNotificationsEnabled: true, conflictNotificationsEnabled: true,
  opportunityNotificationsEnabled: true, hiddenSuggestionTypes: [],
  updatedAtMs: now,
};
const suggestion = (id, patch = {}) => ({
  id, ownerUid: uid, scope: "personal", groupId: null,
  status: "active", acceptedAtMs: null, dismissedAtMs: null,
  snoozedUntilMs: null, expiresAtMs: now + 86_400_000,
  notifiedAtMs: null, notificationBatchId: null,
  source: {ruleId: "open_window_scheduling_opportunity", ruleVersion: 1},
  createdAtMs: now, updatedAtMs: now, ...patch,
});

eq(getPlannerNotificationCopy([suggestion("one")]).body,
  "Planner found a new scheduling opportunity.", "single opportunity copy");
eq(getPlannerNotificationCopy([suggestion("one"), suggestion("two")]).body,
  "Planner found 2 new scheduling opportunities.", "batched opportunity copy");
eq(getPlannerNotificationCopy([suggestion("conflict", {
  source: {ruleId: "calendar_conflict", ruleVersion: 1},
})]).category, "conflict", "conflict category copy");

await Promise.all([
  db.doc(`users/${uid}`).set({uid, expoPushToken: "ExponentPushToken[test]"}),
  db.doc(`users/${uid}/settings/planner`).set(preferences),
  ...["one", "two", "three"].map((id) =>
    db.doc(`users/${uid}/plannerSuggestions/${id}`).set(suggestion(id))),
]);
const queued = await enqueuePlannerNotificationBatch({
  firestore: db, ownerUid: uid, generationRunId: "run-one",
  suggestionIds: ["one", "two", "three"], nowMs: now,
});
eq(queued.outcome, "queued", "one notification batch queued");
eq(queued.count, 3, "three suggestions batched");
const request = await db.doc(
  "plannerNotificationRequests/plannerNotification_run-one").get();
eq(request.data().suggestionCount, 3, "request stores bounded count");
eq(request.data().deepLink, "/planner", "request deep links to Planner");
const inbox = await db.doc(`users/${uid}/groupInbox/planner_run-one`).get();
ok(inbox.exists, "normal inbox item created");
eq(inbox.data().type, "planner", "inbox item identifies Planner");
eq(inbox.data().suggestionCount, 3, "one inbox item represents batch");
eq((await db.collection(`users/${uid}/groupInbox`)
  .where("type", "==", "planner").get()).size, 1,
"no per-suggestion inbox fanout");
for (const id of ["one", "two", "three"]) {
  const item = await db.doc(`users/${uid}/plannerSuggestions/${id}`).get();
  eq(item.data().notificationBatchId, request.id,
    `${id} receives deterministic batch marker`);
}
const duplicate = await enqueuePlannerNotificationBatch({
  firestore: db, ownerUid: uid, generationRunId: "run-one",
  suggestionIds: ["one", "two"], nowMs: now + 1,
});
eq(duplicate.outcome, "duplicate", "generation cycle cannot notify twice");
eq((await db.collection(`users/${uid}/groupInbox`)
  .where("type", "==", "planner").get()).size, 1,
"duplicate creates no second inbox item");

const candidates = await getPlannerNotificationCandidates(db, now);
ok(candidates.includes(request.id), "queued batch is delivery candidate");
const claim = await claimPlannerNotificationRequest(
  db, request.id, now, "lease-one");
ok(claim, "batch claimed once");
eq(await claimPlannerNotificationRequest(db, request.id, now, "lease-two"),
  null, "active claim suppresses duplicate worker");
let sends = 0;
const delivery = await processPlannerNotificationClaim(db, claim, {
  nowMs: now, validToken: () => true,
  send: async (data, token) => {
    sends += 1;
    eq(data.suggestionCount, 3, "one push contains batch count");
    eq(token, "ExponentPushToken[test]", "registered token used");
    return {ok: true, receipt: {id: "ticket"}};
  },
});
eq(delivery.status, "sent", "eligible batch sent");
eq(sends, 1, "one push for three suggestions");

await db.doc(`users/${uid}/plannerSuggestions/accepted`).set(
  suggestion("accepted"));
await enqueuePlannerNotificationBatch({firestore: db, ownerUid: uid,
  generationRunId: "run-accepted", suggestionIds: ["accepted"], nowMs: now});
await db.doc(`users/${uid}/plannerSuggestions/accepted`)
  .update({status: "accepted", acceptedAtMs: now + 1});
const acceptedClaim = await claimPlannerNotificationRequest(db,
  "plannerNotification_run-accepted", now + 2, "accepted-lease");
const acceptedResult = await processPlannerNotificationClaim(
  db, acceptedClaim, {nowMs: now + 2, validToken: () => true,
    send: async () => { throw new Error("accepted suggestion must not send"); }});
eq(acceptedResult.reasonCode, "no_active_suggestions",
  "accepted suggestion suppressed at delivery");

await db.doc(`users/${uid}/plannerSuggestions/snoozed`).set(
  suggestion("snoozed", {status: "snoozed", snoozedUntilMs: now + 60_000}));
eq((await enqueuePlannerNotificationBatch({firestore: db, ownerUid: uid,
  generationRunId: "run-snoozed", suggestionIds: ["snoozed"], nowMs: now}))
  .outcome, "suppressed", "snoozed suggestion not notified");
await db.doc(`users/${uid}/plannerSuggestions/snoozed`)
  .update({status: "active", snoozedUntilMs: null});
eq((await enqueuePlannerNotificationBatch({firestore: db, ownerUid: uid,
  generationRunId: "lifecycle-reactivated",
  suggestionIds: ["snoozed"], nowMs: now + 60_000})).outcome,
"queued", "never-notified suggestion batches after reactivation");
await db.doc(`users/${uid}/settings/planner`)
  .update({notificationsEnabled: false});
await db.doc(`users/${uid}/plannerSuggestions/disabled`).set(
  suggestion("disabled"));
eq((await enqueuePlannerNotificationBatch({firestore: db, ownerUid: uid,
  generationRunId: "run-disabled", suggestionIds: ["disabled"], nowMs: now}))
  .reasonCode, "preference_disabled", "preference disables notifications");

const source = readFileSync("functions/src/plannerNotifications.ts", "utf8");
const root = readFileSync("app/_layout.tsx", "utf8");
const inboxSource = readFileSync("app/(tabs)/inbox.tsx", "utf8");
ok(!source.includes("messages") && !source.includes("comments") &&
  !source.includes("pushTokens") && !source.includes("media"),
"notification pipeline reads no forbidden private sources");
ok(root.includes("notificationType === \"planner_suggestion_batch\"") &&
  root.includes("router.push(\"/planner\""), "push tap opens Planner only");
ok(inboxSource.includes("item.type === \"planner\"") &&
  inboxSource.includes("router.push(\"/planner\""),
"inbox item opens Planner");
ok(!source.includes("proposedAction") && !source.includes("evidence"),
"queue and logs omit planner payload and evidence");

console.log(`Planner notification QA passed (${checks} checks).`);
