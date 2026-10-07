import assert from "node:assert/strict";
import {
  PLANNER_ACTIVE_QUERY_LIMIT,
  PLANNER_HISTORY_QUERY_LIMIT,
  PLANNER_SUGGESTION_EVIDENCE_MAX_COUNT,
  PLANNER_SUGGESTION_MAX_SNOOZE_MS,
  PLANNER_SUGGESTION_RELATED_TARGET_MAX_COUNT,
  PLANNER_SUGGESTION_STATUSES,
  PLANNER_SUGGESTION_TYPES,
  buildPlannerInputFingerprint,
  buildPlannerSuggestionDedupeKey,
  buildPlannerSuggestionId,
  canTransitionPlannerSuggestionStatus,
  getDefaultPlannerPreferences,
  getEffectivePlannerSuggestionStatus,
  getPlannerSuggestionTargetRoute,
  mapPlannerPreferencesDoc,
  mapPlannerSuggestionDoc,
  normalizePlannerEntityRef,
  normalizePlannerProposedAction,
  normalizePlannerSuggestionEvidence,
  sortPlannerSuggestionsForDisplay,
  type PlannerSuggestionDoc,
  type PlannerSuggestionTarget,
  type PlannerProposedAction,
} from "../services/plannerSuggestions";

let checks = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks += 1;
};
const primary = {
  type: "subtask" as const,
  id: "subtask-1",
  goalId: "goal-1",
  ownerUid: "owner",
  groupId: null,
  boardId: null,
  routineId: null,
};
const target: PlannerSuggestionTarget = { primary, related: [] };
const action: PlannerProposedAction = {
  type: "schedule_entity",
  target: primary,
  proposedStartAtMs: 2_000,
  proposedEndAtMs: 3_000,
  timeZone: "UTC",
};
const fixture = (patch: Record<string, unknown> = {}) => ({
  ownerUid: "owner",
  scope: "personal",
  groupId: null,
  type: "schedule_work",
  status: "active",
  priority: "high",
  confidence: { level: "high", score: 0.8 },
  title: "Schedule overdue work",
  summary: "This work has no scheduled time.",
  rationale: "This subtask is overdue and has no scheduled time.",
  evidence: [
    {
      kind: "overdue",
      label: "Overdue by 3 days",
      valueText: null,
      valueNumber: 3,
      sourceRef: primary,
    },
  ],
  target,
  proposedAction: action,
  source: {
    type: "manual_fixture",
    ruleId: "overdue-unscheduled",
    ruleVersion: 1,
    generatedBy: "server",
    inputFingerprint: "input-1",
    timeBucket: "2026-07-25",
  },
  dedupeKey: "planner_123",
  generationRunId: null,
  generatedAtMs: 1_000,
  expiresAtMs: 10_000,
  snoozedUntilMs: null,
  viewedAtMs: null,
  actedAtMs: null,
  acceptedAtMs: null,
  dismissedAtMs: null,
  dismissalReason: null,
  expiredAtMs: null,
  archivedAtMs: null,
  invalidatedAtMs: null,
  invalidationReason: null,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
  ...patch,
});

check(PLANNER_SUGGESTION_TYPES.length === 10, "types bounded");
check(PLANNER_SUGGESTION_STATUSES.length === 7, "statuses bounded");
check(PLANNER_SUGGESTION_EVIDENCE_MAX_COUNT === 5, "evidence bounded");
check(PLANNER_SUGGESTION_RELATED_TARGET_MAX_COUNT === 5, "related bounded");
check(PLANNER_ACTIVE_QUERY_LIMIT === 50, "active query bounded");
check(PLANNER_HISTORY_QUERY_LIMIT === 25, "history query bounded");
check(PLANNER_SUGGESTION_MAX_SNOOZE_MS === 7_776_000_000, "snooze bounded");

check(normalizePlannerEntityRef(primary)?.id === "subtask-1", "subtask ref maps");
check(normalizePlannerEntityRef({ type: "subtask", id: "x" }) === null, "subtask needs goal");
check(normalizePlannerEntityRef({ type: "board_card", id: "x" }) === null, "card needs board");
check(normalizePlannerEntityRef({ type: "goal", id: "bad/id" }) === null, "unsafe id rejected");
check(normalizePlannerEntityRef({ type: "unknown", id: "x" }) === null, "unknown ref rejected");
check(normalizePlannerProposedAction(action)?.type === "schedule_entity", "schedule action maps");
check(normalizePlannerProposedAction({ ...action, proposedStartAtMs: NaN }) === null, "nonfinite action rejected");
check(normalizePlannerProposedAction({ type: "raw_patch", target: primary }) === null, "raw mutation rejected");
check(normalizePlannerSuggestionEvidence(fixture().evidence)?.length === 1, "evidence maps");
check(normalizePlannerSuggestionEvidence(Array(6).fill(fixture().evidence[0])) === null, "too much evidence rejected");

const mapped = mapPlannerSuggestionDoc("suggestion-1", fixture());
check(mapped?.title === "Schedule overdue work", "canonical mapper");
check(mapped?.confidence.score === 0.8, "confidence maps");
check(mapPlannerSuggestionDoc("bad", fixture({ title: "" })) === null, "blank title filtered");
check(mapPlannerSuggestionDoc("bad", fixture({ ownerUid: "" })) === null, "missing owner filtered");
check(mapPlannerSuggestionDoc("bad", fixture({ scope: "group", groupId: null })) === null, "group context required");
check(mapPlannerSuggestionDoc("bad", fixture({ proposedAction: { command: "delete" } })) === null, "command rejected");
check(mapPlannerSuggestionDoc("bad", fixture({ evidence: Array(6).fill(fixture().evidence[0]) })) === null, "oversized evidence filtered");

for (const to of ["accepted", "dismissed", "snoozed", "expired", "invalidated", "archived"] as const)
  check(canTransitionPlannerSuggestionStatus("active", to), `active to ${to}`);
check(canTransitionPlannerSuggestionStatus("snoozed", "active"), "due snooze can reactivate");
check(canTransitionPlannerSuggestionStatus("snoozed", "accepted"), "due snooze can be accepted");
check(canTransitionPlannerSuggestionStatus("accepted", "archived"), "accepted archives");
check(!canTransitionPlannerSuggestionStatus("accepted", "active"), "accepted cannot reactivate");
check(!canTransitionPlannerSuggestionStatus("dismissed", "active"), "dismissed cannot reactivate");
check(!canTransitionPlannerSuggestionStatus("invalidated", "active"), "invalidated cannot reactivate");
check(canTransitionPlannerSuggestionStatus("active", "active"), "same status idempotent");

check(getEffectivePlannerSuggestionStatus(mapped!, 2_000) === "active", "active effective");
check(getEffectivePlannerSuggestionStatus(mapped!, 10_000) === "expired", "expiration boundary");
check(getEffectivePlannerSuggestionStatus({ ...mapped!, status: "snoozed", snoozedUntilMs: 5_000 }, 4_999) === "snoozed", "future snooze");
check(getEffectivePlannerSuggestionStatus({ ...mapped!, status: "snoozed", snoozedUntilMs: 5_000 }, 5_000) === "active", "snooze boundary");
check(getEffectivePlannerSuggestionStatus({ ...mapped!, status: "accepted" }, 20_000) === "accepted", "accepted terminal");
check(getEffectivePlannerSuggestionStatus({ ...mapped!, status: "archived" }, 20_000) === "archived", "archived terminal");

const identity = {
  ownerUid: "owner",
  scope: "personal" as const,
  groupId: null,
  type: "schedule_work" as const,
  target,
  proposedAction: action,
  ruleId: "rule",
  ruleVersion: 1,
  timeBucket: "day-1",
};
const key = buildPlannerSuggestionDedupeKey(identity);
check(key === buildPlannerSuggestionDedupeKey(identity), "identity deterministic");
check(key === buildPlannerSuggestionDedupeKey({ ...identity }), "copy excluded");
check(key !== buildPlannerSuggestionDedupeKey({ ...identity, ownerUid: "other" }), "owner changes identity");
check(key !== buildPlannerSuggestionDedupeKey({ ...identity, ruleVersion: 2 }), "rule changes identity");
check(key !== buildPlannerSuggestionDedupeKey({ ...identity, timeBucket: "day-2" }), "bucket changes identity");
check(key !== buildPlannerSuggestionDedupeKey({ ...identity, proposedAction: { ...action, proposedStartAtMs: 4_000 } }), "time changes identity");
check(/^plannerSuggestion_[a-f0-9]{16}$/.test(buildPlannerSuggestionId(key)), "safe suggestion id");
check(buildPlannerInputFingerprint({ dueAtMs: 1, priority: "high" }) === buildPlannerInputFingerprint({ priority: "high", dueAtMs: 1 }), "fingerprint canonical");
check(buildPlannerInputFingerprint({ dueAtMs: 1 }) !== buildPlannerInputFingerprint({ dueAtMs: 2 }), "relevant source change");

check(getPlannerSuggestionTargetRoute({ type: "goal", id: "g" }) === "/goal/g", "goal route");
check(getPlannerSuggestionTargetRoute(primary)?.includes("highlightSubtaskId"), "subtask route");
check(getPlannerSuggestionTargetRoute({ type: "board_card", id: "c", boardId: "b" }) === "/board/b", "card parent route");
check(getPlannerSuggestionTargetRoute({ type: "calendar_event", id: "e" }) === "/calendar", "personal calendar route");
check(getPlannerSuggestionTargetRoute({ type: "calendar_event", id: "e", groupId: "g" }) === "/group/g/calendar", "group calendar route");
check(getPlannerSuggestionTargetRoute({ type: "routine", id: "r", groupId: "g" }) === "/group/g/routines", "routine route");
check(getPlannerSuggestionTargetRoute({ type: "routine_occurrence", id: "o", groupId: "g", routineId: "r" }) === "/group/g/routine-occurrence/o", "occurrence route");

const defaults = getDefaultPlannerPreferences();
check(defaults.enabled && defaults.allowPersonalSuggestions && defaults.allowGroupSuggestions, "preference defaults");
check(defaults.notificationsEnabled && defaults.personalNotificationsEnabled &&
  defaults.groupNotificationsEnabled && defaults.conflictNotificationsEnabled &&
  defaults.opportunityNotificationsEnabled, "notification preference defaults");
check(mapPlannerPreferencesDoc(undefined).hiddenSuggestionTypes.length === 0, "missing preferences safe");
check(mapPlannerPreferencesDoc({ hiddenSuggestionTypes: ["schedule_work", "invalid", "schedule_work"] }).hiddenSuggestionTypes.length === 1, "hidden types normalized");

const sorted = sortPlannerSuggestionsForDisplay([
  { ...mapped!, id: "medium", priority: "medium", generatedAtMs: 5 },
  { ...mapped!, id: "high", priority: "high", generatedAtMs: 1 },
  { ...mapped!, id: "low", priority: "low", generatedAtMs: 10 },
] as PlannerSuggestionDoc[]);
check(sorted.map((item) => item.id).join(",") === "high,medium,low", "stable priority sort");
check(JSON.stringify(fixture()).includes("expoPushToken") === false, "no push token");
check(JSON.stringify(fixture()).includes("downloadUrl") === false, "no media url");
check(JSON.stringify(fixture()).includes("note") === false, "no notes");
check(JSON.stringify(fixture()).includes("message") === false, "no messages");

console.log(`Planner suggestion foundation QA passed (${checks} checks).`);
