import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  FEEDBACK_FORM_DEFAULT_TYPE,
  FEEDBACK_FORM_DRAFT_CACHE_LIMIT,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  FEEDBACK_MAX_SUBJECT_LENGTH,
  clearAllFeedbackFormDraftsForQa,
  createInitialFeedbackFormDraft,
  getFeedbackFormDraftCacheSizeForQa,
  isFeedbackDraftMeaningful,
  normalizeCachedFeedbackFormDraft,
  restoreFeedbackFormDraft,
  saveFeedbackFormDraft,
  validateFeedbackFormDraft,
} from "../services/feedback";

let count = 0;
const test = (name: string, run: () => void) => {
  run();
  console.log(`ok ${++count} - ${name}`);
};
const valid = createInitialFeedbackFormDraft("User@EXAMPLE.COM");

test("initial values follow nullable Auth email", () => {
  assert.deepEqual(valid, {type: FEEDBACK_FORM_DEFAULT_TYPE, subject: "",
    message: "", allowContact: true, replyEmail: "User@example.com",
    replyEmailTouched: false});
  assert.equal(createInitialFeedbackFormDraft(null).allowContact, false);
  assert.equal(createInitialFeedbackFormDraft("invalid").replyEmail, "");
  assert.equal(createInitialFeedbackFormDraft(" a@EXAMPLE.COM ").replyEmail,
    "a@example.com");
});

test("subject and message use canonical validation", () => {
  assert.equal(validateFeedbackFormDraft({...valid, message: "message"}).ok,
    true);
  assert.equal(validateFeedbackFormDraft({...valid, message: " "}).ok, false);
  assert.equal(validateFeedbackFormDraft({...valid,
    message: "x".repeat(FEEDBACK_MAX_MESSAGE_LENGTH)}).ok, true);
  assert.equal(validateFeedbackFormDraft({...valid,
    message: "x".repeat(FEEDBACK_MAX_MESSAGE_LENGTH + 1)}).ok, false);
  assert.equal(validateFeedbackFormDraft({...valid, message: "a\u0000b"}).ok,
    false);
  assert.equal(validateFeedbackFormDraft({...valid, message: "a\nb"}).ok,
    true);
  assert.equal(validateFeedbackFormDraft({...valid, message: "m",
    subject: "x".repeat(FEEDBACK_MAX_SUBJECT_LENGTH)}).ok, true);
  assert.equal(validateFeedbackFormDraft({...valid, message: "m",
    subject: "x".repeat(FEEDBACK_MAX_SUBJECT_LENGTH + 1)}).ok, false);
  assert.equal(validateFeedbackFormDraft({...valid, message: "m",
    subject: "a\nb"}).ok, false);
});

test("contact validation is consent-aware and injection-safe", () => {
  assert.equal(validateFeedbackFormDraft({...valid, message: "m",
    replyEmail: "edited@example.com", replyEmailTouched: true}).ok, true);
  for (const replyEmail of ["", "invalid", "a@example.com,b@example.com",
    "a@example.com\nBcc:x@example.com"]) {
    assert.equal(validateFeedbackFormDraft({...valid, message: "m",
      replyEmail}).ok, false);
  }
  const disabled = validateFeedbackFormDraft({...valid, message: "m",
    allowContact: false, replyEmail: "invalid"});
  assert.equal(disabled.ok, true);
  if (disabled.ok) assert.equal(disabled.value.replyEmail, null);
});

test("dirty state and reset defaults are deterministic", () => {
  assert.equal(isFeedbackDraftMeaningful(valid, valid), false);
  for (const patch of [
    {type: "bug" as const}, {subject: "s"}, {message: "m"},
    {allowContact: false}, {replyEmail: "other@example.com"},
  ]) assert.equal(isFeedbackDraftMeaningful({...valid, ...patch}, valid), true);
  assert.equal(isFeedbackDraftMeaningful(
    createInitialFeedbackFormDraft("User@EXAMPLE.COM"), valid), false);
});

test("draft restoration isolates accounts and preserves edits", () => {
  clearAllFeedbackFormDraftsForQa();
  const edited = {...valid, message: "private", replyEmail: "edit@example.com",
    replyEmailTouched: true};
  saveFeedbackFormDraft("user1", edited, valid);
  assert.deepEqual(restoreFeedbackFormDraft("user1"), edited);
  assert.equal(restoreFeedbackFormDraft("user2"), null);
  const sameUidAfterRefresh = restoreFeedbackFormDraft("user1");
  assert.equal(sameUidAfterRefresh?.replyEmail, "edit@example.com");
});

test("cache is bounded and empty defaults are not retained", () => {
  clearAllFeedbackFormDraftsForQa();
  for (let i = 0; i <= FEEDBACK_FORM_DRAFT_CACHE_LIMIT; i++) {
    const initial = createInitialFeedbackFormDraft(`u${i}@example.com`);
    saveFeedbackFormDraft(`user${i}`, {...initial, message: `${i}`}, initial);
  }
  assert.equal(getFeedbackFormDraftCacheSizeForQa(),
    FEEDBACK_FORM_DRAFT_CACHE_LIMIT);
  assert.equal(restoreFeedbackFormDraft("user0"), null);
  saveFeedbackFormDraft("empty", valid, valid);
  assert.equal(restoreFeedbackFormDraft("empty"), null);
});

test("cached payload is validated and server fields are ignored", () => {
  const cached = normalizeCachedFeedbackFormDraft({...valid,
    submittedByUid: "forged", status: "email_sent", errors: {message: "x"}});
  assert.deepEqual(cached, valid);
  assert.equal(normalizeCachedFeedbackFormDraft({...valid, type: "unknown"}),
    null);
  assert.equal(normalizeCachedFeedbackFormDraft({...valid, message: 4}), null);
});

test("UI structure is gated, accessible, and uses the trusted submission service", () => {
  const settings = readFileSync("app/(tabs)/settings.tsx", "utf8");
  const screen = readFileSync("app/settings/feedback.tsx", "utf8");
  assert.match(settings, /Feedback & Support/);
  assert.match(settings, /settings\/feedback/);
  assert.match(screen, /title: "Feedback & Support"/);
  assert.match(screen, /keyboardType="email-address"/);
  assert.match(screen, /autoCapitalize="none"/);
  assert.match(screen, /accessibilityState=\{\{selected\}\}/);
  assert.match(screen, /FEEDBACK_SUBMISSION_READY/);
  assert.match(screen, /submitFeedbackRequest/);
  assert.match(screen, /Feedback received/);
  assert.doesNotMatch(screen, /httpsCallable|addDoc|setDoc|uploadBytes/);
  assert.doesNotMatch(screen, /reviewa782|Feedback sent|console\./);
});

console.log(`feedback form QA passed (${count} groups)`);
