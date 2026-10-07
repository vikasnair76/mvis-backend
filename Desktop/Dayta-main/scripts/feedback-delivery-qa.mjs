import assert from "node:assert/strict";
import {buildFeedbackEmail, createFeedbackAttachmentLinks,
  claimFeedbackDelivery,
  processFeedbackDelivery} from "../functions/lib/feedbackEmailDelivery.js";

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
  constructor(submission) {
    this.data = new Map([["feedbackSubmissions/f1", submission]]);
  }
  collection(name) { return new Collection(this, name); }
  snap(path) { const value = this.data.get(path);
    return {exists: value !== undefined, data: () => value}; }
  async runTransaction(fn) {
    const tx = {get: async (ref) => this.snap(ref.path),
      set: (ref, value, options) => this.data.set(ref.path,
        options?.merge ? {...(this.data.get(ref.path) ?? {}), ...value} : value),
      update: (ref, value) => this.data.set(ref.path,
        {...(this.data.get(ref.path) ?? {}), ...value})};
    return fn(tx);
  }
}
const submission = {type: "bug", subject: "Broken", message: "<plain>",
  allowContact: true, replyEmail: "reply@example.com",
  accountEmailSnapshot: "account@example.com", createdAtMs: 1000,
  appMetadata: {appVersion: "1", platform: "android", themeId: "daytaGold"},
  attachments: [{storagePath: "feedback/u/f1/a1"}], status: "submitted"};
const bucket = {file: (path) => ({getSignedUrl: async ({expires}) =>
  [`https://signed.invalid/${path}?expires=${expires}`]})};
let n = 0;
const test = async (name, fn) => { await fn(); console.log(`PASS ${++n} ${name}`); };

await test("trusted headers and structured plain text", async () => {
  const message = buildFeedbackEmail({submission,
    recipient: "reviewa782@gmail.com", sender: "support@dayta.test",
    attachmentLinks: ["https://signed.invalid/link"]});
  assert.equal(message.to, "reviewa782@gmail.com");
  assert.equal(message.replyTo, "reply@example.com");
  assert.match(message.subject, /^\[Dayta Feedback\] \[Bug\] Broken$/);
  assert.match(message.text, /<plain>/);
  assert.equal(message.html, null);
});
await test("contact-off omits both user emails and Reply-To", async () => {
  const message = buildFeedbackEmail({submission: {...submission,
    allowContact: false, replyEmail: null}, recipient: "to@example.com",
  sender: "from@example.com", attachmentLinks: []});
  assert.equal(message.replyTo, null);
  assert.doesNotMatch(message.text, /reply@example|account@example/);
});
await test("header injection and placeholder configuration are rejected",
  async () => {
    for (const recipient of ["a@example.com\nBcc:x@example.com",
      "a@example.com,b@example.com", "mailto:a@example.com",
      "placeholder@example.com", "A <a@example.com>"]) {
      assert.throws(() => buildFeedbackEmail({submission, recipient,
        sender: "from@example.com", attachmentLinks: []}));
    }
  });
await test("signed links are seven-day and not persisted by helper", async () => {
  const links = await createFeedbackAttachmentLinks(bucket, submission, 1000);
  assert.equal(links.length, 1);
  assert.match(links[0], /expires=604801000/);
});
await test("provider success and duplicate trigger send once", async () => {
  const db = new FakeDb(submission);
  const keys = [];
  const provider = {send: async (_message, key) => {
    keys.push(key); return {providerMessageId: "provider1"};
  }};
  const input = {firestore: db, bucket, provider, feedbackId: "f1",
    eventId: "event1", recipient: "to@example.com",
    sender: "from@example.com", nowMs: 2000};
  assert.equal((await processFeedbackDelivery(input)).status, "sent");
  assert.equal((await processFeedbackDelivery(input)).status, "sent");
  assert.deepEqual(keys, ["f1:email:v1"]);
  assert.equal(db.data.get("feedbackSubmissions/f1").status, "email_sent");
});
await test("provider failure records bounded retry and reuses idempotency", async () => {
  const db = new FakeDb(submission);
  const keys = [];
  let fail = true;
  const provider = {send: async (_message, key) => {
    keys.push(key);
    if (fail) throw new Error("provider");
    return {providerMessageId: null};
  }};
  const input = {firestore: db, bucket, provider, feedbackId: "f1",
    eventId: "event1", recipient: "to@example.com",
    sender: "from@example.com", nowMs: 1000};
  await assert.rejects(() => processFeedbackDelivery(input));
  const delivery = db.data.get("feedbackSubmissions/f1/deliveries/email");
  assert.equal(delivery.state, "failed");
  assert.equal(delivery.attemptCount, 1);
  fail = false;
  assert.equal((await processFeedbackDelivery({...input,
    nowMs: 61_000})).status, "sent");
  assert.deepEqual(keys, ["f1:email:v1", "f1:email:v1"]);
});
await test("active competing claim is blocked and expired claim recoverable",
  async () => {
    const db = new FakeDb(submission);
    db.data.set("feedbackSubmissions/f1/deliveries/email", {
      state: "processing", attemptCount: 1, claimToken: "first",
      claimedAtMs: 1000,
    });
    assert.equal((await claimFeedbackDelivery({firestore: db,
      feedbackId: "f1", claimToken: "second", nowMs: 2000})).status,
    "claimed_elsewhere");
    const recovered = await claimFeedbackDelivery({firestore: db,
      feedbackId: "f1", claimToken: "second", nowMs: 700_001});
    assert.deepEqual(recovered, {status: "claimed", attempt: 2});
  });
console.log(`Feedback delivery QA: ${n} passed.`);
