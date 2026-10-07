import assert from "node:assert/strict";
import {FeedbackIntakeError, handleSubmitFeedback, normalizeFeedbackRequest,
  verifyFeedbackAttachments} from "../functions/lib/feedbackSubmission.js";

class Ref {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  async get() { return this.db.snap(this.path); }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
}
class FakeDb {
  constructor() { this.data = new Map(); }
  collection(name) { return new Collection(this, name); }
  snap(path) { const value = this.data.get(path);
    return {exists: value !== undefined, data: () => value}; }
  async runTransaction(fn) {
    const tx = {
      get: async (ref) => this.snap(ref.path),
      set: (ref, value, options) => this.data.set(ref.path,
        options?.merge ? {...(this.data.get(ref.path) ?? {}), ...value} : value),
      create: (ref, value) => {
        if (this.data.has(ref.path)) throw new Error("exists");
        this.data.set(ref.path, value);
      },
      update: (ref, value) => this.data.set(ref.path,
        {...(this.data.get(ref.path) ?? {}), ...value}),
    };
    return fn(tx);
  }
}
const appMetadata = {appVersion: "1", buildVersion: "1",
  platform: "android", osVersion: "1", locale: "en", timezone: "UTC",
  themeId: "daytaGold"};
const request = (overrides = {}) => ({schemaVersion: 1,
  feedbackId: "feedback1", type: "general", subject: null,
  message: "Hello", allowContact: true, replyEmail: "User@EXAMPLE.COM",
  attachments: [], appMetadata, ...overrides});
const auth = {getUser: async () => ({email: "Account@EXAMPLE.COM"})};
const bucket = {file: () => ({getMetadata: async () => {
  throw new Error("missing");
}})};
let n = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS ${++n} ${name}`); };
const rejects = async (code, fn) => assert.rejects(fn,
  (error) => error instanceof FeedbackIntakeError && error.code === code);

await test("signed-out rejected", () => rejects("unauthenticated", () =>
  handleSubmitFeedback({uid: null, data: request(), firestore: new FakeDb(),
    auth, bucket})));
await test("unknown fields and wrong schema rejected", async () => {
  assert.throws(() => normalizeFeedbackRequest({...request(), recipient: "x"}),
    FeedbackIntakeError);
  assert.throws(() => normalizeFeedbackRequest(request({schemaVersion: 2})),
    FeedbackIntakeError);
});
await test("email and content validation repeated server-side", async () => {
  assert.throws(() => normalizeFeedbackRequest(request({replyEmail: "a@x.com\nBcc:x"})),
    FeedbackIntakeError);
  assert.throws(() => normalizeFeedbackRequest(request({message: " "})),
    FeedbackIntakeError);
});
await test("valid intake, duplicate, and conflict", async () => {
  const db = new FakeDb();
  const input = {uid: "user1", data: request(), firestore: db, auth, bucket,
    nowMs: 1000};
  assert.equal((await handleSubmitFeedback(input)).alreadyExisted, false);
  const stored = db.data.get("feedbackSubmissions/feedback1");
  assert.equal(stored.submittedByUid, "user1");
  assert.equal(stored.accountEmailSnapshot, "Account@example.com");
  assert.equal(stored.status, "submitted");
  assert.equal((await handleSubmitFeedback(input)).alreadyExisted, true);
  await rejects("submission_conflict", () => handleSubmitFeedback(
    {...input, data: request({message: "different"})}));
});
await test("hour rate boundary rejected without consuming duplicate quota", async () => {
  const db = new FakeDb();
  db.data.set("feedbackRateLimits/user1_hour_0", {count: 5});
  await rejects("rate_limited", () => handleSubmitFeedback({uid: "user1",
    data: request(), firestore: db, auth, bucket, nowMs: 1000}));
});
await test("attachment path and trusted metadata verified", async () => {
  const attachment = {id: "a1", kind: "image",
    storagePath: "feedback/user1/feedback1/a1", contentType: "image/jpeg",
    sizeBytes: 10, width: 2, height: 3, durationMs: null, uploadedAtMs: 4};
  const normalized = normalizeFeedbackRequest(request({attachments: [attachment]}));
  const goodBucket = {file: (path) => ({getMetadata: async () => [{
    contentType: "image/jpeg", size: "10", metadata: {ownerUid: "user1",
      feedbackId: "feedback1", attachmentId: "a1", kind: "image",
      sizeBytes: "10", width: "2", height: "3", durationMs: "",
      uploadedAtMs: "4"}, path} ]})};
  await verifyFeedbackAttachments(goodBucket, "user1", normalized);
  await rejects("invalid_attachment", () => verifyFeedbackAttachments(
    goodBucket, "user2", normalized));
});
console.log(`Feedback intake QA: ${n} passed.`);
