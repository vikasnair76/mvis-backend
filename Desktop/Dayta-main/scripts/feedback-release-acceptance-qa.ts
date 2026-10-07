import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn(); console.log(`PASS ${++passed} ${name}`);
};
const read = (path: string) => readFileSync(path, "utf8");

check("all trusted Function exports are present", () => {
  const source = read("functions/src/index.ts");
  for (const name of ["submitFeedback", "processFeedbackEmailDelivery",
    "cleanupAbandonedFeedbackAttachmentsScheduled",
    "reconcileStuckFeedbackDeliveriesScheduled"]) {
    assert.match(source, new RegExp(`export const ${name}`));
  }
});
check("all focused package scripts are present", () => {
  const packageJson = JSON.parse(read("package.json"));
  for (const name of ["test:feedback-architecture", "test:feedback-form",
    "test:feedback-attachments", "test:feedback-intake",
    "test:feedback-delivery", "test:feedback-rules-abuse",
    "test:feedback-cleanup", "test:feedback-contract-drift",
    "test:feedback-storage-rules", "test:feedback-release-acceptance"]) {
    assert.equal(typeof packageJson.scripts[name], "string");
  }
});
check("production submission gate defaults disabled", () => {
  assert.match(read("services/feedback.ts"),
    /EXPO_PUBLIC_FEEDBACK_SUBMISSION_ENABLED === "true"/);
  const eas = JSON.parse(read("eas.json"));
  assert.equal(eas.build.production.env
    .EXPO_PUBLIC_FEEDBACK_SUBMISSION_ENABLED, "false");
});
check("provider configuration remains server-only", () => {
  const client = `${read("app/settings/feedback.tsx")}\n${
    read("services/feedbackSubmission.ts")}`;
  assert.doesNotMatch(client,
    /FEEDBACK_EMAIL_PROVIDER_API_KEY|FEEDBACK_RECIPIENT_EMAIL|reviewa782/);
});
check("rules preserve canonical privacy and finalization", () => {
  const firestore = read("firestore.rules");
  const storage = read("storage.rules");
  assert.match(firestore, /match \/feedbackSubmissions\/\{feedbackId\}/);
  assert.match(firestore, /allow read, create, update, delete: if false/);
  assert.match(storage, /match \/feedback\/\{ownerUid\}\/\{feedbackId\}/);
  assert.match(storage, /allow read: if false/);
  assert.match(storage, /!firestore\.exists/);
});
check("maintenance schedules and resources match the contract", () => {
  const source = read("functions/src/index.ts");
  assert.match(source, /schedule: "30 3 \* \* \*"/);
  assert.match(source, /schedule: "every 15 minutes"/);
  assert.match(source, /memory: "512MiB"/);
  assert.match(source, /maxInstances: 1/);
});
check("delivery bounds and identity remain stable", () => {
  const source = read("functions/src/feedbackEmailDelivery.ts");
  assert.match(source, /FEEDBACK_EMAIL_MAX_ATTEMPTS = 5/);
  assert.match(source, /FEEDBACK_SIGNED_LINK_TTL_DAYS = 7/);
  assert.match(source, /\$\{input\.feedbackId\}:email:v1/);
});
check("release documentation distinguishes blocked gates and rollback", () => {
  const acceptance = read("docs/checklists/feedback-release-acceptance.md");
  const release = read("docs/feedback-8b8-6-release-acceptance.md");
  assert.match(acceptance, /Evidence:/);
  assert.match(release, /BLOCKED/);
  assert.match(release, /Rollback sequence/);
});
check("feedback client has no public URL or content logging", () => {
  const client = `${read("services/feedback.ts")}\n${
    read("services/feedbackAttachments.ts")}\n${
    read("app/settings/feedback.tsx")}`;
  assert.doesNotMatch(client, /getDownloadURL|console\./);
});

console.log(`Feedback release acceptance QA: ${passed} passed.`);
