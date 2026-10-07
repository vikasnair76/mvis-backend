import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, intake, delivery, maintenance, storage, firestore, doc, index] =
  await Promise.all([
    read("services/feedback.ts"), read("functions/src/feedbackSubmission.ts"),
    read("functions/src/feedbackEmailDelivery.ts"),
    read("functions/src/feedbackMaintenance.ts"), read("storage.rules"),
    read("firestore.rules"),
    read("docs/feedback-8b8-5-rules-abuse-cleanup.md"),
    read("functions/src/index.ts"),
  ]);
let passed = 0;
const check = (name, fn) => {
  fn(); console.log(`PASS ${++passed} ${name}`);
};
check("schema version remains one across client and callable", () => {
  assert.match(client, /FEEDBACK_SCHEMA_VERSION = 1/);
  assert.match(intake, /FEEDBACK_SCHEMA_VERSION = 1/);
});
check("attachment counts and media limits agree", () => {
  assert.match(client, /FEEDBACK_MAX_ATTACHMENTS = 4/);
  assert.match(intake, /attachments\.length > 4/);
  assert.match(intake, /videos > 1/);
  assert.match(storage, /10 \* 1024 \* 1024/);
  assert.match(storage, /50 \* 1024 \* 1024/);
});
check("delivery identity, retries, and links remain bounded", () => {
  assert.match(delivery, /\$\{input\.feedbackId\}:email:v1/);
  assert.match(delivery, /FEEDBACK_EMAIL_MAX_ATTEMPTS = 5/);
  assert.match(delivery, /FEEDBACK_SIGNED_LINK_TTL_DAYS = 7/);
});
check("all server-only collections are explicitly denied", () => {
  for (const collection of ["feedbackSubmissions", "feedbackRateLimits",
    "feedbackOperations", "feedbackCleanup"]) {
    assert.match(firestore, new RegExp(`match /${collection}`));
  }
});
check("cleanup bounds and seven-day grace are documented", () => {
  assert.match(maintenance, /FEEDBACK_CLEANUP_MAX_OBJECTS = 2000/);
  assert.match(maintenance, /FEEDBACK_CLEANUP_CONCURRENCY = 5/);
  assert.match(doc, /seven-day/i);
});
check("production recipient is absent from client code", () => {
  assert.doesNotMatch(client, /reviewa782@gmail\.com/);
  assert.doesNotMatch(client, /FEEDBACK_RECIPIENT_EMAIL/);
});
check("feedback logging and persistence remain privacy safe", () => {
  const calls = index.match(
    /logger\.(?:info|warn)\("feedback_[\s\S]*?\}\);/g) ?? [];
  for (const call of calls) {
    for (const forbidden of ["feedbackId:", "uid:", "replyEmail:",
      "accountEmail:", "subject:", "message:", "storagePath:",
      "attachmentId:", "signedUrl:", "recipient:", "sender:"]) {
      assert.equal(call.includes(forbidden), false);
    }
  }
  assert.doesNotMatch(`${intake}\n${delivery}\n${maintenance}`,
    /signedUrl\s*:/);
});
console.log(`Feedback contract drift QA: ${passed} passed.`);
