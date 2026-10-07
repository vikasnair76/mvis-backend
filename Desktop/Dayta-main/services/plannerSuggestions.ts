import {
  collection,
  getDocs,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  startAfter,
  type DocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { PlanningPriority } from "./planning";

export const PLANNER_SUGGESTION_TYPES = [
  "schedule_work",
  "reschedule_work",
  "resolve_conflict",
  "prioritize_work",
  "split_work",
  "surface_neglected_work",
  "move_board_card",
  "adjust_deadline",
  "routine_timing",
  "focus_block",
] as const;
export const PLANNER_SUGGESTION_STATUSES = [
  "active",
  "accepted",
  "dismissed",
  "snoozed",
  "expired",
  "invalidated",
  "archived",
] as const;
export const PLANNER_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const PLANNER_ENTITY_TYPES = [
  "goal",
  "milestone",
  "subtask",
  "board",
  "board_card",
  "calendar_event",
  "routine",
  "routine_occurrence",
] as const;
export const PLANNER_EVIDENCE_KINDS = [
  "due_date",
  "overdue",
  "calendar_gap",
  "calendar_conflict",
  "workload",
  "priority",
  "inactivity",
  "routine_history",
  "completion_pattern",
  "dependency",
  "assignment",
] as const;
export const PLANNER_ACTION_TYPES = [
  "schedule_entity",
  "reschedule_entity",
  "set_priority",
  "set_due_date",
  "move_board_card",
  "create_focus_block",
  "review_entity",
] as const;
export const PLANNER_INVALIDATION_REASONS = [
  "target_missing",
  "target_completed",
  "target_archived",
  "target_rescheduled",
  "target_changed",
  "permission_lost",
  "group_membership_removed",
  "conflict_resolved",
  "expired",
  "superseded",
] as const;
export const PLANNER_DISMISSAL_REASONS = [
  "not_relevant",
  "already_handled",
  "bad_timing",
  "dont_suggest_again",
  "other",
] as const;

export const PLANNER_SUGGESTION_TITLE_MAX_LENGTH = 120;
export const PLANNER_SUGGESTION_SUMMARY_MAX_LENGTH = 240;
export const PLANNER_SUGGESTION_RATIONALE_MAX_LENGTH = 500;
export const PLANNER_SUGGESTION_EVIDENCE_MAX_COUNT = 5;
export const PLANNER_SUGGESTION_RELATED_TARGET_MAX_COUNT = 5;
export const PLANNER_HIDDEN_TYPES_MAX_COUNT = 10;
export const PLANNER_SUGGESTION_MAX_SNOOZE_MS = 90 * 24 * 60 * 60 * 1000;
export const PLANNER_ACTIVE_QUERY_LIMIT = 50;
export const PLANNER_HISTORY_QUERY_LIMIT = 25;

export type PlannerSuggestionType = (typeof PLANNER_SUGGESTION_TYPES)[number];
export type PlannerSuggestionStatus =
  (typeof PLANNER_SUGGESTION_STATUSES)[number];
export type PlannerConfidenceLevel =
  (typeof PLANNER_CONFIDENCE_LEVELS)[number];
export type PlannerEntityType = (typeof PLANNER_ENTITY_TYPES)[number];
export type PlannerEvidenceKind = (typeof PLANNER_EVIDENCE_KINDS)[number];
export type PlannerInvalidationReason =
  (typeof PLANNER_INVALIDATION_REASONS)[number];
export type PlannerDismissalReason =
  (typeof PLANNER_DISMISSAL_REASONS)[number];

export type PlannerEntityRef = {
  type: PlannerEntityType;
  id: string;
  ownerUid?: string | null;
  groupId?: string | null;
  goalId?: string | null;
  boardId?: string | null;
  routineId?: string | null;
};
export type PlannerSuggestionEvidence = {
  kind: PlannerEvidenceKind;
  label: string;
  valueText?: string | null;
  valueNumber?: number | null;
  sourceRef?: PlannerEntityRef | null;
};
export type PlannerSuggestionTarget = {
  primary: PlannerEntityRef;
  related: PlannerEntityRef[];
};
export type PlannerProposedAction =
  | { type: "schedule_entity"; target: PlannerEntityRef; proposedStartAtMs: number; proposedEndAtMs: number | null; timeZone: string | null }
  | { type: "reschedule_entity"; target: PlannerEntityRef; existingStartAtMs: number | null; proposedStartAtMs: number; proposedEndAtMs: number | null; timeZone: string | null }
  | { type: "set_priority"; target: PlannerEntityRef; proposedPriority: PlanningPriority }
  | { type: "set_due_date"; target: PlannerEntityRef; proposedDueAtMs: number }
  | { type: "move_board_card"; target: PlannerEntityRef; boardId: string; proposedColumnId: string }
  | { type: "create_focus_block"; proposedStartAtMs: number; proposedEndAtMs: number; linkedTargets: PlannerEntityRef[] }
  | { type: "review_entity"; target: PlannerEntityRef };
export type PlannerSuggestionSource = {
  type: "deterministic_rule" | "manual_fixture" | "system_repair";
  ruleId: string;
  ruleVersion: number;
  generatedBy: "client" | "server";
  inputFingerprint: string | null;
  timeBucket: string | null;
};
export type PlannerSuggestionDoc = {
  id: string;
  ownerUid: string;
  scope: "personal" | "group";
  groupId: string | null;
  type: PlannerSuggestionType;
  status: PlannerSuggestionStatus;
  priority: PlanningPriority;
  confidence: { level: PlannerConfidenceLevel; score: number | null };
  title: string;
  summary: string;
  rationale: string;
  evidence: PlannerSuggestionEvidence[];
  target: PlannerSuggestionTarget;
  proposedAction: PlannerProposedAction;
  source: PlannerSuggestionSource;
  dedupeKey: string;
  generationRunId: string | null;
  generatedAtMs: number;
  expiresAtMs: number | null;
  snoozedUntilMs: number | null;
  viewedAtMs: number | null;
  actedAtMs: number | null;
  acceptedAtMs: number | null;
  acceptedByUid: string | null;
  executionResult: {
    code: string;
    targetType: "calendar_event" | null;
    targetId: string | null;
    completedAtMs: number | null;
  } | null;
  dismissedAtMs: number | null;
  dismissalReason: PlannerDismissalReason | null;
  expiredAtMs: number | null;
  archivedAtMs: number | null;
  invalidatedAtMs: number | null;
  invalidationReason: PlannerInvalidationReason | null;
  notifiedAtMs: number | null;
  notificationBatchId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
export type PlannerPreferencesDoc = {
  enabled: boolean;
  allowPersonalSuggestions: boolean;
  allowGroupSuggestions: boolean;
  notificationsEnabled: boolean;
  personalNotificationsEnabled: boolean;
  groupNotificationsEnabled: boolean;
  conflictNotificationsEnabled: boolean;
  opportunityNotificationsEnabled: boolean;
  hiddenSuggestionTypes: PlannerSuggestionType[];
  updatedAtMs: number;
};
export type PlannerGenerationRunDoc = {
  id: string;
  ownerUid: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  trigger: "manual" | "scheduled" | "source_change" | "test";
  ruleVersion: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  suggestionsCreated: number;
  suggestionsReused: number;
  suggestionsInvalidated: number;
  failureCode: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

const has = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === "string" && (values as readonly string[]).includes(value);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const safeId = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 500 && !value.includes("/")
    ? value.trim()
    : null;
const optionalId = (value: unknown) => (value == null ? null : safeId(value));
const boundedText = (value: unknown, maximum: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= maximum
    ? value.trim()
    : null;

export const normalizePlannerSuggestionType = (value: unknown) =>
  has(PLANNER_SUGGESTION_TYPES, value) ? value : null;
export const normalizePlannerSuggestionStatus = (value: unknown) =>
  has(PLANNER_SUGGESTION_STATUSES, value) ? value : null;
export const normalizePlannerSuggestionPriority = (value: unknown): PlanningPriority =>
  value === "low" || value === "high" ? value : "medium";
export const normalizePlannerInvalidationReason = (value: unknown) =>
  has(PLANNER_INVALIDATION_REASONS, value) ? value : null;
export const normalizePlannerDismissalReason = (value: unknown) =>
  has(PLANNER_DISMISSAL_REASONS, value) ? value : null;

export function normalizePlannerEntityRef(value: unknown): PlannerEntityRef | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const type = has(PLANNER_ENTITY_TYPES, data.type) ? data.type : null;
  const id = safeId(data.id);
  if (!type || !id) return null;
  const ref: PlannerEntityRef = {
    type,
    id,
    ownerUid: optionalId(data.ownerUid),
    groupId: optionalId(data.groupId),
    goalId: optionalId(data.goalId),
    boardId: optionalId(data.boardId),
    routineId: optionalId(data.routineId),
  };
  if (type === "subtask" && !ref.goalId) return null;
  if (type === "board_card" && !ref.boardId) return null;
  if (type === "routine_occurrence" && (!ref.groupId || !ref.routineId)) return null;
  return ref;
}

export function normalizePlannerSuggestionEvidence(value: unknown) {
  if (!Array.isArray(value) || value.length > PLANNER_SUGGESTION_EVIDENCE_MAX_COUNT) return null;
  const mapped: PlannerSuggestionEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const data = item as Record<string, unknown>;
    const kind = has(PLANNER_EVIDENCE_KINDS, data.kind) ? data.kind : null;
    const label = boundedText(data.label, 160);
    const sourceRef = data.sourceRef == null ? null : normalizePlannerEntityRef(data.sourceRef);
    if (!kind || !label || (data.sourceRef != null && !sourceRef)) return null;
    mapped.push({
      kind,
      label,
      valueText: data.valueText == null ? null : boundedText(data.valueText, 160),
      valueNumber: finite(data.valueNumber),
      sourceRef,
    });
  }
  return mapped;
}

export function normalizePlannerProposedAction(value: unknown): PlannerProposedAction | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const type = has(PLANNER_ACTION_TYPES, data.type) ? data.type : null;
  if (!type) return null;
  const target = normalizePlannerEntityRef(data.target);
  if (type === "review_entity" && target) return { type, target };
  if (type === "set_priority" && target) {
    if (!["low", "medium", "high"].includes(String(data.proposedPriority))) return null;
    return { type, target, proposedPriority: data.proposedPriority as PlanningPriority };
  }
  if (type === "set_due_date" && target && finite(data.proposedDueAtMs) != null)
    return { type, target, proposedDueAtMs: finite(data.proposedDueAtMs)! };
  if (type === "move_board_card" && target?.type === "board_card") {
    const boardId = safeId(data.boardId);
    const proposedColumnId = safeId(data.proposedColumnId);
    return boardId && proposedColumnId ? { type, target, boardId, proposedColumnId } : null;
  }
  if (type === "schedule_entity" && target && finite(data.proposedStartAtMs) != null)
    return { type, target, proposedStartAtMs: finite(data.proposedStartAtMs)!, proposedEndAtMs: finite(data.proposedEndAtMs), timeZone: data.timeZone == null ? null : boundedText(data.timeZone, 100) };
  if (type === "reschedule_entity" && target && finite(data.proposedStartAtMs) != null)
    return { type, target, existingStartAtMs: finite(data.existingStartAtMs), proposedStartAtMs: finite(data.proposedStartAtMs)!, proposedEndAtMs: finite(data.proposedEndAtMs), timeZone: data.timeZone == null ? null : boundedText(data.timeZone, 100) };
  if (type === "create_focus_block") {
    const start = finite(data.proposedStartAtMs);
    const end = finite(data.proposedEndAtMs);
    if (start == null || end == null || end <= start || !Array.isArray(data.linkedTargets) || data.linkedTargets.length > 5) return null;
    const linkedTargets = data.linkedTargets.map(normalizePlannerEntityRef);
    return linkedTargets.every(Boolean) ? { type, proposedStartAtMs: start, proposedEndAtMs: end, linkedTargets: linkedTargets as PlannerEntityRef[] } : null;
  }
  return null;
}

export function mapPlannerSuggestionDoc(id: string, value: Record<string, unknown>): PlannerSuggestionDoc | null {
  const ownerUid = safeId(value.ownerUid);
  const type = normalizePlannerSuggestionType(value.type);
  const status = normalizePlannerSuggestionStatus(value.status);
  const title = boundedText(value.title, PLANNER_SUGGESTION_TITLE_MAX_LENGTH);
  const summary = boundedText(value.summary, PLANNER_SUGGESTION_SUMMARY_MAX_LENGTH);
  const rationale = boundedText(value.rationale, PLANNER_SUGGESTION_RATIONALE_MAX_LENGTH);
  const primary = normalizePlannerEntityRef((value.target as Record<string, unknown> | undefined)?.primary);
  const relatedRaw = (value.target as Record<string, unknown> | undefined)?.related;
  const related = Array.isArray(relatedRaw) && relatedRaw.length <= PLANNER_SUGGESTION_RELATED_TARGET_MAX_COUNT ? relatedRaw.map(normalizePlannerEntityRef) : [];
  const evidence = normalizePlannerSuggestionEvidence(value.evidence);
  const proposedAction = normalizePlannerProposedAction(value.proposedAction);
  const source = value.source as Record<string, unknown> | undefined;
  const dedupeKey = safeId(value.dedupeKey);
  const generatedAtMs = finite(value.generatedAtMs);
  const createdAtMs = finite(value.createdAtMs);
  const updatedAtMs = finite(value.updatedAtMs);
  if (!ownerUid || !type || !status || !title || !summary || !rationale || !primary || related.some((item) => !item) || !evidence || !proposedAction || !source || !dedupeKey || generatedAtMs == null || createdAtMs == null || updatedAtMs == null) return null;
  const scope = value.scope === "group" ? "group" : "personal";
  const groupId = optionalId(value.groupId);
  if ((scope === "group") !== !!groupId) return null;
  const sourceType = ["deterministic_rule", "manual_fixture", "system_repair"].includes(String(source.type)) ? source.type as PlannerSuggestionSource["type"] : null;
  const ruleId = safeId(source.ruleId);
  const ruleVersion = finite(source.ruleVersion);
  if (!sourceType || !ruleId || ruleVersion == null || !["client", "server"].includes(String(source.generatedBy))) return null;
  return {
    id, ownerUid, scope, groupId, type, status,
    priority: normalizePlannerSuggestionPriority(value.priority),
    confidence: {
      level: has(PLANNER_CONFIDENCE_LEVELS, (value.confidence as Record<string, unknown> | undefined)?.level) ? (value.confidence as { level: PlannerConfidenceLevel }).level : "medium",
      score: Math.max(0, Math.min(1, finite((value.confidence as Record<string, unknown> | undefined)?.score) ?? 0.5)),
    },
    title, summary, rationale, evidence,
    target: { primary, related: related as PlannerEntityRef[] },
    proposedAction,
    source: { type: sourceType, ruleId, ruleVersion, generatedBy: source.generatedBy as "client" | "server", inputFingerprint: optionalId(source.inputFingerprint), timeBucket: optionalId(source.timeBucket) },
    dedupeKey, generationRunId: optionalId(value.generationRunId), generatedAtMs,
    expiresAtMs: finite(value.expiresAtMs), snoozedUntilMs: finite(value.snoozedUntilMs),
    viewedAtMs: finite(value.viewedAtMs), actedAtMs: finite(value.actedAtMs),
    acceptedAtMs: finite(value.acceptedAtMs),
    acceptedByUid: optionalId(value.acceptedByUid),
    executionResult: value.executionResult &&
      typeof value.executionResult === "object" ? {
        code: boundedText(
          (value.executionResult as Record<string, unknown>).code, 80
        ) ?? "unknown",
        targetType:
          (value.executionResult as Record<string, unknown>).targetType ===
          "calendar_event" ? "calendar_event" : null,
        targetId: optionalId(
          (value.executionResult as Record<string, unknown>).targetId
        ),
        completedAtMs: finite(
          (value.executionResult as Record<string, unknown>).completedAtMs
        ),
      } : null,
    dismissedAtMs: finite(value.dismissedAtMs),
    dismissalReason: normalizePlannerDismissalReason(value.dismissalReason),
    expiredAtMs: finite(value.expiredAtMs),
    archivedAtMs: finite(value.archivedAtMs), invalidatedAtMs: finite(value.invalidatedAtMs),
    invalidationReason: normalizePlannerInvalidationReason(value.invalidationReason),
    notifiedAtMs: finite(value.notifiedAtMs),
    notificationBatchId: optionalId(value.notificationBatchId),
    createdAtMs, updatedAtMs,
    createdAt: value.createdAt as Timestamp | undefined,
    updatedAt: value.updatedAt as Timestamp | undefined,
  };
}

export function canTransitionPlannerSuggestionStatus(from: PlannerSuggestionStatus, to: PlannerSuggestionStatus) {
  if (from === to) return true;
  if (from === "active") return ["accepted", "dismissed", "snoozed", "expired", "invalidated", "archived"].includes(to);
  if (from === "snoozed") return ["active", "accepted", "dismissed", "expired", "invalidated", "archived"].includes(to);
  return to === "archived" && from !== "archived";
}
export function getEffectivePlannerSuggestionStatus(suggestion: PlannerSuggestionDoc, nowMs: number): PlannerSuggestionStatus {
  if (!Number.isFinite(nowMs)) throw new Error("Current time must be finite.");
  if (!["active", "snoozed"].includes(suggestion.status)) return suggestion.status;
  if (suggestion.expiresAtMs != null && suggestion.expiresAtMs <= nowMs) return "expired";
  if (suggestion.status === "snoozed" && suggestion.snoozedUntilMs != null && suggestion.snoozedUntilMs > nowMs) return "snoozed";
  return "active";
}
export const isPlannerSuggestionExpired = (item: PlannerSuggestionDoc, nowMs: number) =>
  getEffectivePlannerSuggestionStatus(item, nowMs) === "expired";
export const isPlannerSuggestionActionable = (item: PlannerSuggestionDoc, nowMs: number) =>
  getEffectivePlannerSuggestionStatus(item, nowMs) === "active";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function stableHash(value: unknown) {
  const input = JSON.stringify(canonical(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second ^ input.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
export function buildPlannerSuggestionDedupeKey(input: {
  ownerUid: string; scope: "personal" | "group"; groupId?: string | null;
  type: PlannerSuggestionType; target: PlannerSuggestionTarget;
  proposedAction: PlannerProposedAction; ruleId: string; ruleVersion: number;
  timeBucket?: string | null;
}) {
  const identityRef = (ref: PlannerEntityRef) => ({
    type: ref.type,
    id: ref.id,
    ownerUid: ref.ownerUid ?? null,
    groupId: ref.groupId ?? null,
    goalId: ref.goalId ?? null,
    boardId: ref.boardId ?? null,
    routineId: ref.routineId ?? null,
  });
  const action = input.proposedAction;
  const actionIdentity =
    action.type === "create_focus_block"
      ? {
          type: action.type,
          proposedStartAtMs: action.proposedStartAtMs,
          proposedEndAtMs: action.proposedEndAtMs,
          linkedTargets: action.linkedTargets.map(identityRef),
        }
      : {
          type: action.type,
          target: identityRef(action.target),
          proposedStartAtMs:
            "proposedStartAtMs" in action ? action.proposedStartAtMs : null,
          proposedEndAtMs:
            "proposedEndAtMs" in action ? action.proposedEndAtMs : null,
          existingStartAtMs:
            "existingStartAtMs" in action ? action.existingStartAtMs : null,
          timeZone: "timeZone" in action ? action.timeZone : null,
          proposedPriority:
            "proposedPriority" in action ? action.proposedPriority : null,
          proposedDueAtMs:
            "proposedDueAtMs" in action ? action.proposedDueAtMs : null,
          boardId: "boardId" in action ? action.boardId : null,
          proposedColumnId:
            "proposedColumnId" in action ? action.proposedColumnId : null,
        };
  return `planner_${stableHash({
    ownerUid: input.ownerUid,
    scope: input.scope,
    groupId: input.groupId ?? null,
    type: input.type,
    target: {
      primary: identityRef(input.target.primary),
      related: input.target.related.map(identityRef),
    },
    proposedAction: actionIdentity,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    timeBucket: input.timeBucket ?? null,
  })}`;
}
export const buildPlannerSuggestionId = (dedupeKey: string) =>
  `plannerSuggestion_${stableHash(dedupeKey)}`;
export const buildPlannerInputFingerprint = (relevantState: Record<string, unknown>) =>
  `plannerInput_${stableHash(relevantState)}`;

export function getPlannerSuggestionTargetRoute(ref: PlannerEntityRef): string | null {
  const id = safeId(ref.id);
  if (!id) return null;
  if (ref.type === "goal" || ref.type === "milestone") return `/goal/${encodeURIComponent(id)}`;
  if (ref.type === "subtask" && ref.goalId) return `/goal/${encodeURIComponent(ref.goalId)}?highlightSubtaskId=${encodeURIComponent(id)}`;
  if (ref.type === "board" || ref.type === "board_card") {
    const boardId = ref.type === "board" ? id : ref.boardId;
    return boardId ? `/board/${encodeURIComponent(boardId)}` : null;
  }
  if (ref.type === "routine" && ref.groupId) return `/group/${encodeURIComponent(ref.groupId)}/routines`;
  if (ref.type === "routine_occurrence" && ref.groupId) return `/group/${encodeURIComponent(ref.groupId)}/routine-occurrence/${encodeURIComponent(id)}`;
  if (ref.type === "calendar_event") return ref.groupId ? `/group/${encodeURIComponent(ref.groupId)}/calendar` : "/calendar";
  return null;
}

export function getDefaultPlannerPreferences(): PlannerPreferencesDoc {
  return {
    enabled: true, allowPersonalSuggestions: true, allowGroupSuggestions: true,
    notificationsEnabled: true, personalNotificationsEnabled: true,
    groupNotificationsEnabled: true, conflictNotificationsEnabled: true,
    opportunityNotificationsEnabled: true, hiddenSuggestionTypes: [],
    updatedAtMs: 0,
  };
}
export function mapPlannerPreferencesDoc(value: Record<string, unknown> | undefined): PlannerPreferencesDoc {
  const defaults = getDefaultPlannerPreferences();
  if (!value) return defaults;
  const hidden = Array.isArray(value.hiddenSuggestionTypes)
    ? Array.from(new Set(value.hiddenSuggestionTypes.filter((item): item is PlannerSuggestionType => has(PLANNER_SUGGESTION_TYPES, item)))).slice(0, PLANNER_HIDDEN_TYPES_MAX_COUNT)
    : [];
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    allowPersonalSuggestions: typeof value.allowPersonalSuggestions === "boolean" ? value.allowPersonalSuggestions : defaults.allowPersonalSuggestions,
    allowGroupSuggestions: typeof value.allowGroupSuggestions === "boolean" ? value.allowGroupSuggestions : defaults.allowGroupSuggestions,
    notificationsEnabled: typeof value.notificationsEnabled === "boolean" ?
      value.notificationsEnabled : defaults.notificationsEnabled,
    personalNotificationsEnabled:
      typeof value.personalNotificationsEnabled === "boolean" ?
        value.personalNotificationsEnabled :
        defaults.personalNotificationsEnabled,
    groupNotificationsEnabled:
      typeof value.groupNotificationsEnabled === "boolean" ?
        value.groupNotificationsEnabled : defaults.groupNotificationsEnabled,
    conflictNotificationsEnabled:
      typeof value.conflictNotificationsEnabled === "boolean" ?
        value.conflictNotificationsEnabled :
        defaults.conflictNotificationsEnabled,
    opportunityNotificationsEnabled:
      typeof value.opportunityNotificationsEnabled === "boolean" ?
        value.opportunityNotificationsEnabled :
        defaults.opportunityNotificationsEnabled,
    hiddenSuggestionTypes: hidden,
    updatedAtMs: finite(value.updatedAtMs) ?? 0,
  };
}

function suggestionRef(ownerUid: string, suggestionId: string) {
  const owner = safeId(ownerUid); const id = safeId(suggestionId);
  if (!owner || !id) throw new Error("Valid owner and suggestion IDs are required.");
  return doc(db, "users", owner, "plannerSuggestions", id);
}
async function transitionSuggestion(ownerUid: string, suggestionId: string, to: PlannerSuggestionStatus, nowMs: number, extra: Record<string, unknown> = {}) {
  void ownerUid; void nowMs; void extra;
  const action = to === "dismissed" ? "dismiss" :
    to === "archived" ? "archive" : null;
  if (!action) throw new Error("Invalid suggestion transition.");
  const callable = httpsCallable<
    {suggestionId: string; action: "dismiss" | "archive"; reason?: unknown},
    {suggestionId: string; status: PlannerSuggestionStatus}
  >(functions, "mutatePlannerSuggestion");
  return (await callable({
    suggestionId, action,
    ...(action === "dismiss" ? {reason: extra.dismissalReason ?? null} : {}),
  })).data;
}
export const dismissPlannerSuggestion = (input: { ownerUid: string; suggestionId: string; reason?: PlannerDismissalReason | null; nowMs?: number }) => {
  const nowMs = input.nowMs ?? Date.now();
  return transitionSuggestion(input.ownerUid, input.suggestionId, "dismissed", nowMs, { dismissedAtMs: nowMs, dismissalReason: input.reason ?? null, actedAtMs: nowMs, snoozedUntilMs: null });
};
export async function snoozePlannerSuggestion(input: { ownerUid: string; suggestionId: string; snoozedUntilMs: number; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(input.snoozedUntilMs) || input.snoozedUntilMs <= nowMs || input.snoozedUntilMs > nowMs + PLANNER_SUGGESTION_MAX_SNOOZE_MS) throw new Error("Snooze time is outside the allowed range.");
  void input.ownerUid;
  const callable = httpsCallable<
    {suggestionId: string; action: "snooze"; snoozedUntilMs: number},
    {suggestionId: string; status: PlannerSuggestionStatus}
  >(functions, "mutatePlannerSuggestion");
  return (await callable({
    suggestionId: input.suggestionId,
    action: "snooze",
    snoozedUntilMs: input.snoozedUntilMs,
  })).data;
}
export const archivePlannerSuggestion = (input: { ownerUid: string; suggestionId: string; nowMs?: number }) => {
  const nowMs = input.nowMs ?? Date.now();
  return transitionSuggestion(input.ownerUid, input.suggestionId, "archived", nowMs, { archivedAtMs: nowMs });
};
export async function markPlannerSuggestionViewed(input: { ownerUid: string; suggestionId: string; nowMs?: number }) {
  void input.ownerUid; void input.nowMs;
  const callable = httpsCallable<
    {suggestionId: string; action: "view"},
    {suggestionId: string; status: PlannerSuggestionStatus}
  >(functions, "mutatePlannerSuggestion");
  await callable({suggestionId: input.suggestionId, action: "view"});
}
export async function updatePlannerPreferences(ownerUid: string, patch: Partial<Omit<PlannerPreferencesDoc, "updatedAtMs">>, nowMs = Date.now()) {
  const current = mapPlannerPreferencesDoc({ ...getDefaultPlannerPreferences(), ...patch, updatedAtMs: nowMs });
  await setDoc(doc(db, "users", ownerUid, "settings", "planner"), { ...current, updatedAt: serverTimestamp() }, { merge: false });
}
export function subscribePlannerPreferences(ownerUid: string, onNext: (value: PlannerPreferencesDoc) => void, onError?: (error: unknown) => void): Unsubscribe {
  return onSnapshot(doc(db, "users", ownerUid, "settings", "planner"), (snapshot) => onNext(mapPlannerPreferencesDoc(snapshot.data())), onError);
}
export function subscribePlannerSuggestion(ownerUid: string, suggestionId: string, onNext: (value: PlannerSuggestionDoc | null) => void, onError?: (error: unknown) => void): Unsubscribe {
  return onSnapshot(suggestionRef(ownerUid, suggestionId), (snapshot) => onNext(snapshot.exists() ? mapPlannerSuggestionDoc(snapshot.id, snapshot.data()) : null), onError);
}
export function subscribeActivePlannerSuggestions(ownerUid: string, onNext: (value: PlannerSuggestionDoc[]) => void, onError?: (error: unknown) => void, nowMs = Date.now()): Unsubscribe {
  const q = query(collection(db, "users", ownerUid, "plannerSuggestions"), where("status", "in", ["active", "snoozed"]), orderBy("generatedAtMs", "desc"), limit(PLANNER_ACTIVE_QUERY_LIMIT));
  let cached: PlannerSuggestionDoc[] = [];
  let currentNowMs = nowMs;
  const emit = () => onNext(sortPlannerSuggestionsForDisplay(cached.filter((item) => isPlannerSuggestionActionable(item, currentNowMs))));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    cached = snapshot.docs.map((item) => mapPlannerSuggestionDoc(item.id, item.data())).filter((item): item is PlannerSuggestionDoc => !!item);
    emit();
  }, onError);
  const timer = setInterval(() => { currentNowMs = Date.now(); emit(); }, 60_000);
  return () => { clearInterval(timer); unsubscribe(); };
}
export function subscribeSnoozedPlannerSuggestions(ownerUid: string, onNext: (value: PlannerSuggestionDoc[]) => void, onError?: (error: unknown) => void, nowMs = Date.now()): Unsubscribe {
  const q = query(collection(db, "users", ownerUid, "plannerSuggestions"), where("status", "==", "snoozed"), orderBy("generatedAtMs", "desc"), limit(PLANNER_ACTIVE_QUERY_LIMIT));
  let cached: PlannerSuggestionDoc[] = [];
  let currentNowMs = nowMs;
  const emit = () => onNext(cached.filter((item) => getEffectivePlannerSuggestionStatus(item, currentNowMs) === "snoozed"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    cached = snapshot.docs.map((item) => mapPlannerSuggestionDoc(item.id, item.data())).filter((item): item is PlannerSuggestionDoc => !!item);
    emit();
  }, onError);
  const timer = setInterval(() => { currentNowMs = Date.now(); emit(); }, 60_000);
  return () => { clearInterval(timer); unsubscribe(); };
}
export type PlannerSuggestionHistoryPage = {
  items: PlannerSuggestionDoc[];
  cursor: DocumentSnapshot | null;
  hasMore: boolean;
};
export async function getPlannerSuggestionHistoryPage(ownerUid: string, cursor?: DocumentSnapshot | null, pageSize = 25): Promise<PlannerSuggestionHistoryPage> {
  const safeSize = Math.max(1, Math.min(25, Math.floor(pageSize)));
  const constraints = [
    where("status", "in", ["accepted", "dismissed", "expired", "invalidated", "archived"]),
    orderBy("updatedAtMs", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(safeSize + 1),
  ];
  const snapshot = await getDocs(query(collection(db, "users", ownerUid, "plannerSuggestions"), ...constraints));
  const selected = snapshot.docs.slice(0, safeSize);
  return {
    items: selected.map((item) => mapPlannerSuggestionDoc(item.id, item.data())).filter((item): item is PlannerSuggestionDoc => !!item),
    cursor: selected[selected.length - 1] ?? null,
    hasMore: snapshot.size > safeSize,
  };
}
export async function requestPlannerRefresh() {
  const callable = httpsCallable<Record<string, never>, {
    accepted: boolean; requestId?: string; deduplicated?: boolean; reasonCode?: string;
  }>(functions, "requestPlannerRefresh");
  const response = await callable({});
  return response.data;
}

export type PlannerExecutionResultCode =
  | "applied" | "already_applied" | "already_processing"
  | "suggestion_not_found" | "suggestion_not_active"
  | "suggestion_expired" | "suggestion_snoozed" | "suggestion_terminal"
  | "unsupported_action" | "unsupported_action_version"
  | "target_missing" | "target_archived" | "permission_lost"
  | "stale_evidence" | "time_window_no_longer_available"
  | "calendar_conflict_detected" | "validation_failed"
  | "retryable_backend_error" | "planner_disabled";
export type PlannerExecutionResult = {
  ok: boolean;
  status: PlannerExecutionResultCode;
  suggestionId: string;
  targetType?: "calendar_event";
  targetId?: string;
};
export function canExecutePlannerSuggestion(
  suggestion: PlannerSuggestionDoc,
  nowMs = Date.now()
) {
  const action = suggestion.proposedAction;
  return getEffectivePlannerSuggestionStatus(suggestion, nowMs) === "active" &&
    suggestion.scope === "personal" &&
    suggestion.groupId == null &&
    action.type === "schedule_entity" &&
    ["goal", "subtask", "board_card"].includes(action.target.type) &&
    action.target.groupId == null &&
    suggestion.source.ruleId === "open_window_scheduling_opportunity" &&
    suggestion.source.ruleVersion === 1;
}
export async function executePlannerSuggestion(
  suggestionId: string
): Promise<PlannerExecutionResult> {
  const id = safeId(suggestionId);
  if (!id) throw new Error("A valid suggestion ID is required.");
  const callable = httpsCallable<{suggestionId: string}, PlannerExecutionResult>(
    functions, "executePlannerSuggestion"
  );
  return (await callable({suggestionId: id})).data;
}
export async function recordPlannerNotificationOpened(
  generationRunId: string
) {
  const id = safeId(generationRunId);
  if (!id) return;
  const callable = httpsCallable<{generationRunId: string}, {recorded: boolean}>(
    functions, "recordPlannerNotificationOpened"
  );
  await callable({generationRunId: id});
}
export function subscribeRecentPlannerSuggestionHistory(ownerUid: string, onNext: (value: PlannerSuggestionDoc[]) => void, onError?: (error: unknown) => void): Unsubscribe {
  const q = query(collection(db, "users", ownerUid, "plannerSuggestions"), where("status", "in", ["accepted", "dismissed", "expired", "invalidated", "archived"]), orderBy("updatedAtMs", "desc"), limit(PLANNER_HISTORY_QUERY_LIMIT));
  return onSnapshot(q, (snapshot) => onNext(snapshot.docs.map((item) => mapPlannerSuggestionDoc(item.id, item.data())).filter((item): item is PlannerSuggestionDoc => !!item)), onError);
}
export function sortPlannerSuggestionsForDisplay(items: PlannerSuggestionDoc[]) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...items].sort((a, b) => rank[a.priority] - rank[b.priority] || b.generatedAtMs - a.generatedAtMs || a.id.localeCompare(b.id));
}
