import assert from "node:assert/strict";
import {
  buildTrustedPlannerSuggestionWrite,
} from "../functions/lib/plannerSuggestionFoundation.js";

const input = {
  ownerUid: "owner",
  scope: "personal",
  groupId: null,
  type: "schedule_work",
  target: {
    primary: { type: "subtask", id: "task", goalId: "goal" },
    related: [],
  },
  proposedAction: {
    type: "schedule_entity",
    target: { type: "subtask", id: "task", goalId: "goal" },
    proposedStartAtMs: 100,
    proposedEndAtMs: 200,
    timeZone: "UTC",
  },
  source: {
    type: "deterministic_rule",
    ruleId: "overdue",
    ruleVersion: 1,
    generatedBy: "server",
    inputFingerprint: "fingerprint",
    timeBucket: "2026-07-25",
  },
  title: "Title",
  summary: "Summary",
  rationale: "Rationale",
  evidence: [],
  priority: "high",
  confidence: { level: "high", score: 0.8 },
  generationRunId: "run",
  generatedAtMs: 1,
  expiresAtMs: null,
  snoozedUntilMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
};
const first = buildTrustedPlannerSuggestionWrite(input);
const second = buildTrustedPlannerSuggestionWrite({
  ...input,
  title: "Changed user-facing title",
  summary: "Changed summary",
});
assert.equal(first.id, second.id);
assert.equal(first.data.dedupeKey, second.data.dedupeKey);
assert.match(first.id, /^plannerSuggestion_[a-f0-9]{16}$/);
assert.equal(first.data.status, "active");
assert.equal(first.data.acceptedAtMs, null);
assert.equal(first.data.dismissedAtMs, null);
assert.equal(first.data.proposedAction.type, "schedule_entity");
assert.equal("rawPatch" in first.data, false);

console.log("Planner suggestion server foundation QA passed (8 checks).");
