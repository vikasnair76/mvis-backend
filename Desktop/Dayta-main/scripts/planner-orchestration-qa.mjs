import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {
  buildPlannerGenerationRequestIdentity,
  claimPlannerGenerationRequest,
  completePlannerGenerationClaim,
  enqueueDuePlannerScheduleStates,
  enqueuePlannerGenerationRequest,
  failPlannerGenerationClaim,
  getPlannerRequestBucket,
  getPlannerRetryDelayMs,
  isPlannerRequestClaimable,
  isPlannerSourceChangeMeaningful,
  mapPlannerGenerationRequest,
  normalizePlannerReasonCodes,
  reactivateTrustedPlannerSuggestion,
  scanPlannerSuggestionLifecycle,
  syncPlannerScheduleState,
  PLANNER_FANOUT_CAP,
  PLANNER_LEASE_MS,
  PLANNER_MAX_ATTEMPTS,
  PLANNER_REASON_MAX,
  PLANNER_REFRESH_INTERVAL_MS,
} from "../functions/lib/plannerOrchestration.js";
import {buildTrustedPlannerSuggestionWrite}
  from "../functions/lib/plannerSuggestionFoundation.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp({projectId: "dayta---goalsettingapp"});
const db = getFirestore();
const now = Date.parse("2026-07-25T18:00:00Z");
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

eq(getPlannerRequestBucket(now), getPlannerRequestBucket(now + 60_000), "same bucket");
const identity = buildPlannerGenerationRequestIdentity({
  ownerUid: "queue-owner", requestedAtMs: now, trigger: "source_change"});
eq(identity, buildPlannerGenerationRequestIdentity({
  ownerUid: "queue-owner", requestedAtMs: now, trigger: "preference_change"}),
"refresh trigger class coalesces");
ok(identity.requestId.startsWith("plannerGeneration_"), "safe request id");
ok(!identity.requestId.includes("/"), "Firestore safe");
ok(buildPlannerGenerationRequestIdentity({ownerUid: "other", requestedAtMs: now,
  trigger: "source_change"}).requestId !== identity.requestId, "owner identity");
ok(buildPlannerGenerationRequestIdentity({ownerUid: "queue-owner",
  requestedAtMs: now + 5 * 60_000, trigger: "source_change"}).requestId !==
  identity.requestId, "bucket identity");
eq(normalizePlannerReasonCodes(["goal_changed", "goal_changed", "bad"]),
  ["goal_changed"], "reason normalization");
eq(normalizePlannerReasonCodes(Array(20).fill("goal_changed")).length, 1,
  "reason dedupe");
ok(PLANNER_REASON_MAX === 8 && PLANNER_FANOUT_CAP === 50, "documented caps");
assert.throws(() => buildPlannerGenerationRequestIdentity({
  ownerUid: "bad/id", requestedAtMs: now, trigger: "manual"}), /invalid/); checks += 1;

eq(isPlannerSourceChangeMeaningful("goal", {description: "a", status: "active"},
  {description: "b", status: "active"}), false, "description ignored");
eq(isPlannerSourceChangeMeaningful("goal", {status: "active"},
  {status: "completed"}), true, "goal status relevant");
eq(isPlannerSourceChangeMeaningful("subtask", {dueAtMs: 1}, {dueAtMs: 2}),
  true, "subtask due relevant");
eq(isPlannerSourceChangeMeaningful("board_card", {columnId: "ideas"},
  {columnId: "active"}), true, "card column relevant");
eq(isPlannerSourceChangeMeaningful("calendar", {startAtMs: 1},
  {startAtMs: 2}), true, "calendar time relevant");
eq(isPlannerSourceChangeMeaningful("routine", {localStartTime: "09:00"},
  {localStartTime: "10:00"}), true, "routine schedule relevant");
eq(isPlannerSourceChangeMeaningful("occurrence", {executionStatus: "scheduled",
  note: "a"}, {executionStatus: "scheduled", note: "b"}), false, "note ignored");
eq(isPlannerSourceChangeMeaningful("membership", {status: "active"},
  {status: "removed"}), true, "membership relevant");
eq(isPlannerSourceChangeMeaningful("preferences", {enabled: true},
  {enabled: false}), true, "preference relevant");

await db.recursiveDelete(db.collection("plannerGenerationRequests"));
await db.recursiveDelete(db.collection("plannerScheduleState"));
const first = await enqueuePlannerGenerationRequest(db, {ownerUid: "queue-owner",
  trigger: "source_change", reasonCodes: ["goal_changed"], priority: "normal",
  requestedAtMs: now, notBeforeAtMs: now});
eq(first.outcome, "created", "new enqueue");
const merged = await enqueuePlannerGenerationRequest(db, {ownerUid: "queue-owner",
  trigger: "preference_change", reasonCodes: ["preferences_changed"], priority: "high",
  requestedAtMs: now + 1000, notBeforeAtMs: now + 1000});
eq(merged.requestId, first.requestId, "same bucket merged id");
eq(merged.outcome, "merged", "duplicate merged");
let request = await db.doc(`plannerGenerationRequests/${first.requestId}`).get();
eq(request.data().reasonCodes, ["goal_changed", "preferences_changed"],
  "reasons merged");
eq(request.data().priority, "high", "priority upgraded");
eq(request.data().attemptCount, 0, "attempt preserved");
ok(!JSON.stringify(request.data()).includes("title"), "no private content");

const claims = await Promise.all(["a", "b", "c"].map((lease) =>
  claimPlannerGenerationRequest(db, first.requestId, now + 2000, lease)));
eq(claims.filter(Boolean).length, 1, "one concurrent claim winner");
const claim = claims.find(Boolean);
eq(claim.data.attemptCount, 1, "attempt increments once");
eq(claim.data.leaseExpiresAtMs, now + 2000 + PLANNER_LEASE_MS, "lease duration");
eq(await claimPlannerGenerationRequest(db, first.requestId, now + 3000, "steal"),
  null, "active lease protected");
eq(await completePlannerGenerationClaim(db, {...claim, leaseId: "old"}, now + 4000,
  {runId: claim.data.generationRunId, status: "completed",
    suggestionsCreated: 0, suggestionsReused: 0, suggestionsInvalidated: 0,
    candidateCount: 0, truncated: false, failureCode: null}), false,
"old lease cannot complete");
eq(await completePlannerGenerationClaim(db, claim, now + 4000,
  {runId: claim.data.generationRunId, status: "completed",
    suggestionsCreated: 0, suggestionsReused: 0, suggestionsInvalidated: 0,
    candidateCount: 0, truncated: false, failureCode: null}), true,
"current lease completes");
eq(await claimPlannerGenerationRequest(db, first.requestId, now + 5000, "again"),
  null, "terminal not claimable");
eq((await enqueuePlannerGenerationRequest(db, {ownerUid: "queue-owner",
  trigger: "source_change", reasonCodes: ["goal_changed"], requestedAtMs: now + 2000,
  notBeforeAtMs: now + 2000})).outcome, "terminal", "terminal not reactivated");

const burst = await Promise.all(Array.from({length: 10}, (_, index) =>
  enqueuePlannerGenerationRequest(db, {ownerUid: "burst-owner",
    trigger: "source_change",
    reasonCodes: [index % 2 ? "subtask_changed" : "goal_changed"],
    requestedAtMs: now + 2000 + index, notBeforeAtMs: now + 2000})));
eq(new Set(burst.map((item) => item.requestId)).size, 1,
  "10-write burst coalesces");
const burstSnapshot = await db.doc(
  `plannerGenerationRequests/${burst[0].requestId}`).get();
eq(burstSnapshot.data().reasonCodes, ["goal_changed", "subtask_changed"],
  "parallel reason merge deterministic");

const future = await enqueuePlannerGenerationRequest(db, {ownerUid: "future-owner",
  trigger: "test", reasonCodes: ["goal_changed"], requestedAtMs: now,
  notBeforeAtMs: now + 10_000});
eq(await claimPlannerGenerationRequest(db, future.requestId, now, "future"),
  null, "future request excluded");
const retry = await enqueuePlannerGenerationRequest(db, {ownerUid: "retry-owner",
  trigger: "test", reasonCodes: ["goal_changed"], requestedAtMs: now,
  notBeforeAtMs: now});
const retryClaim = await claimPlannerGenerationRequest(db, retry.requestId, now, "retry");
eq(await failPlannerGenerationClaim(db, retryClaim, now + 100, "unavailable"),
  true, "retry scheduled");
request = await db.doc(`plannerGenerationRequests/${retry.requestId}`).get();
eq(request.data().status, "failed", "retry status");
eq(request.data().nextAttemptAtMs, now + 100 + getPlannerRetryDelayMs(1),
  "deterministic backoff");
eq(await claimPlannerGenerationRequest(db, retry.requestId,
  request.data().nextAttemptAtMs - 1, "early"), null, "early retry excluded");
ok(await claimPlannerGenerationRequest(db, retry.requestId,
  request.data().nextAttemptAtMs, "due"), "due retry claim");
eq(getPlannerRetryDelayMs(99), 60 * 60_000, "backoff capped");

const malformed = mapPlannerGenerationRequest("x", {ownerUid: "x", status: "wat",
  trigger: "test", requestBucket: "1", dedupeKey: "x", requestedAtMs: now});
eq(malformed, null, "malformed mapping rejected");
eq(PLANNER_MAX_ATTEMPTS, 5, "attempt bound");
eq(isPlannerRequestClaimable({...claim.data, status: "dead_letter"}, now + 99_000),
  false, "dead letter terminal");

await syncPlannerScheduleState(db, "schedule-owner", true, now);
let state = await db.doc("plannerScheduleState/schedule-owner").get();
eq(state.data().enabled, true, "enabled schedule state");
ok(state.data().nextRefreshAtMs <= now + 5 * 60_000, "near-term refresh");
const scheduled = await enqueueDuePlannerScheduleStates(db, now + 5 * 60_000);
eq(scheduled.scanned, 1, "due schedule bounded");
eq(scheduled.enqueued, 1, "scheduled enqueue atomic");
state = await db.doc("plannerScheduleState/schedule-owner").get();
eq(state.data().nextRefreshAtMs, now + 5 * 60_000 + PLANNER_REFRESH_INTERVAL_MS,
  "schedule advanced");
eq((await enqueueDuePlannerScheduleStates(db, now + 5 * 60_000)).enqueued, 0,
  "duplicate scheduler no enqueue");
await syncPlannerScheduleState(db, "schedule-owner", false, now + 10_000);
state = await db.doc("plannerScheduleState/schedule-owner").get();
eq(state.data().enabled, false, "disabled schedule state");

const suggestion = (ownerUid, id, status, snoozedUntilMs, expiresAtMs) => {
  const target = {type: "goal", id: `target-${id}`, ownerUid};
  const write = buildTrustedPlannerSuggestionWrite({ownerUid, scope: "personal",
    groupId: null, type: "schedule_work", priority: "medium",
    confidence: {level: "high", score: 0.8}, title: "Safe fixture",
    summary: "Safe summary", rationale: "Safe rationale",
    evidence: [{kind: "due_date", label: "Due", valueNumber: now}],
    target: {primary: target, related: []},
    proposedAction: {type: "review_entity", target},
    source: {type: "manual_fixture", ruleId: "fixture", ruleVersion: 1,
      generatedBy: "server", inputFingerprint: "input", timeBucket: "bucket"},
    generationRunId: null, generatedAtMs: now - 1000, expiresAtMs,
    createdAtMs: now - 1000, updatedAtMs: now - 1000});
  return {ref: db.doc(`users/${ownerUid}/plannerSuggestions/${id}`),
    data: {...write.data, id, status, snoozedUntilMs,
      viewedAtMs: now - 500, dedupeKey: `fixture-${id}`}};
};
const expired = suggestion("life-owner", "expired", "active", null, now);
const snoozed = suggestion("life-owner", "snoozed", "snoozed", now, now + 10_000);
const futureSuggestion = suggestion("life-owner", "future", "snoozed", now + 10_000,
  now + 20_000);
await Promise.all([expired.ref.set(expired.data), snoozed.ref.set(snoozed.data),
  futureSuggestion.ref.set(futureSuggestion.data)]);
const life = await scanPlannerSuggestionLifecycle(db, now);
eq(life.expirations, 1, "expiration persisted");
eq(life.reactivated, 1, "snooze reactivated");
eq((await expired.ref.get()).data().status, "expired", "active expired");
const reactivated = await snoozed.ref.get();
eq(reactivated.data().status, "active", "due snooze active");
eq(reactivated.data().snoozedUntilMs, null, "snooze timestamp cleared");
eq(reactivated.data().viewedAtMs, now - 500, "viewed state preserved");
eq((await futureSuggestion.ref.get()).data().status, "snoozed", "future snooze unchanged");
eq((await scanPlannerSuggestionLifecycle(db, now)).reactivated, 0,
  "lifecycle idempotent");
eq(await reactivateTrustedPlannerSuggestion(db, expired.ref, now),
  "ineligible", "terminal not reactivated");

console.log(`Planner orchestration QA passed: ${checks} checks.`);
