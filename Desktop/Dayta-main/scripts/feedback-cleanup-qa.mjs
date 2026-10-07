import assert from "node:assert/strict";
import {
  FEEDBACK_CLEANUP_CONCURRENCY,
  FEEDBACK_CLEANUP_MAX_OBJECTS,
  FEEDBACK_CLEANUP_PAGE_SIZE,
  FEEDBACK_ORPHAN_GRACE_MS,
  acquireFeedbackMaintenanceLease,
  classifyFeedbackOrphan,
  parseFeedbackObjectPath,
} from "../functions/lib/feedbackMaintenance.js";

let passed = 0;
const test = async (name, fn) => {
  await fn(); console.log(`PASS ${++passed} ${name}`);
};

await test("strict path parsing rejects malformed and nested paths", () => {
  assert.deepEqual(parseFeedbackObjectPath("feedback/u/f/a"),
    {uid: "u", feedbackId: "f", attachmentId: "a"});
  for (const path of ["feedback/u/f", "feedback/u/f/a/nested",
    "feedback/u/../a", "feedback/u/%2e%2e/a", "feedback/u /f/a", "/u/f/a"]) {
    assert.equal(parseFeedbackObjectPath(path), null);
  }
});
await test("orphan classification is conservative and time based", () => {
  const nowMs = 10 * FEEDBACK_ORPHAN_GRACE_MS;
  const identity = {uid: "u", feedbackId: "f", attachmentId: "a"};
  assert.equal(classifyFeedbackOrphan({identity, createdAtMs: nowMs - 1,
    nowMs, canonicalExists: false}), "recent");
  assert.equal(classifyFeedbackOrphan({identity,
    createdAtMs: nowMs - FEEDBACK_ORPHAN_GRACE_MS, nowMs,
    canonicalExists: true}), "finalized");
  assert.equal(classifyFeedbackOrphan({identity,
    createdAtMs: nowMs - FEEDBACK_ORPHAN_GRACE_MS, nowMs,
    canonicalExists: false}), "eligible");
  assert.equal(classifyFeedbackOrphan({identity, createdAtMs: null, nowMs,
    canonicalExists: false}), "invalid_age");
  assert.equal(classifyFeedbackOrphan({identity,
    createdAtMs: nowMs - FEEDBACK_ORPHAN_GRACE_MS, nowMs,
    canonicalExists: null}), "lookup_failed");
});
await test("cleanup work bounds are finite", () => {
  assert.equal(FEEDBACK_CLEANUP_PAGE_SIZE, 250);
  assert.equal(FEEDBACK_CLEANUP_MAX_OBJECTS, 2000);
  assert.equal(FEEDBACK_CLEANUP_CONCURRENCY, 5);
});
await test("maintenance lease blocks overlap and permits expiry recovery",
  async () => {
    let data = {};
    const ref = {};
    const firestore = {
      collection: () => ({doc: () => ref}),
      runTransaction: async (callback) => callback({
        get: async () => ({data: () => data}),
        set: (_ref, update) => { data = {...data, ...update}; },
      }),
    };
    assert.equal(await acquireFeedbackMaintenanceLease({
      firestore, operation: "orphanCleanup", owner: "one", nowMs: 100}), true);
    assert.equal(await acquireFeedbackMaintenanceLease({
      firestore, operation: "orphanCleanup", owner: "two", nowMs: 101}), false);
    assert.equal(await acquireFeedbackMaintenanceLease({
      firestore, operation: "orphanCleanup", owner: "two",
      nowMs: data.leaseExpiresAtMs}), true);
  });

console.log(`Feedback cleanup QA: ${passed} passed.`);
