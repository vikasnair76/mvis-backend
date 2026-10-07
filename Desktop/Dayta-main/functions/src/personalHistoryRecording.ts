import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

export const PERSONAL_HISTORY_EVENT_DEFINITIONS = {
  goal_created: {category: "goal", entityType: "goal"},
  goal_completed: {category: "goal", entityType: "goal"},
  goal_archived: {category: "goal", entityType: "goal"},
  goal_restored: {category: "goal", entityType: "goal"},
  subtask_completed: {category: "subtask", entityType: "subtask"},
  planner_suggestion_applied: {
    category: "planner", entityType: "planner_suggestion",
  },
  planner_calendar_block_created: {
    category: "planner", entityType: "calendar_event",
  },
  calendar_block_created: {category: "calendar", entityType: "calendar_event"},
  planning_board_card_completed: {
    category: "board", entityType: "planning_board_card",
  },
  routine_completed: {category: "routine", entityType: "routine_occurrence"},
  milestone_completed: {category: "milestone", entityType: "milestone"},
} as const;

export type PersonalHistoryEventType =
  keyof typeof PERSONAL_HISTORY_EVENT_DEFINITIONS;
export type PersonalHistoryMetadataValue = string | number | boolean | null;
export type PersonalHistoryWriteInput = {
  ownerUid: string;
  eventType: PersonalHistoryEventType;
  entityId: string;
  parentEntityId?: string | null;
  occurredAtMs: number;
  displayTitle?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  sourceEventId: string;
  createdAtMs?: number;
};
export type PersonalHistoryWriteResult = {
  eventId: string;
  status: "created" | "duplicate";
};

const safeId = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 &&
  value.length <= 500 && !value.includes("/") ? value.trim() : null;
const safeText = (value: unknown, maximum: number) =>
  value == null ? null :
    typeof value === "string" && value.trim().length <= maximum ?
      value.trim() || null : null;
const finiteTimestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ?
    value : null;

export function normalizeTrustedHistoryMetadata(
  value: Record<string, unknown> | undefined
): Record<string, PersonalHistoryMetadataValue> {
  if (!value) return {};
  const entries = Object.entries(value);
  if (entries.length > 10) throw new Error("personal_history_invalid_metadata");
  const normalized: Record<string, PersonalHistoryMetadataValue> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 40 ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error("personal_history_invalid_metadata");
    }
    if (item == null) normalized[key] = null;
    else if (typeof item === "boolean") normalized[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) {
      normalized[key] = item;
    } else if (typeof item === "string" && item.length <= 160) {
      normalized[key] = item;
    } else {
      throw new Error("personal_history_invalid_metadata");
    }
  }
  return normalized;
}

function stableHash(value: string) {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second ^ value.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}` +
    `${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildTrustedPersonalHistoryEventId(
  ownerUid: string,
  sourceEventId: string
) {
  const owner = safeId(ownerUid);
  const source = safeId(sourceEventId);
  if (!owner || !source) throw new Error("personal_history_invalid_identity");
  return `history_${stableHash(`${owner}:${source}`)}`;
}

export function buildTrustedPersonalHistoryEvent(
  input: PersonalHistoryWriteInput
): DocumentData {
  const ownerUid = safeId(input.ownerUid);
  const entityId = safeId(input.entityId);
  const sourceEventId = safeId(input.sourceEventId);
  const parentEntityId = input.parentEntityId == null ? null :
    safeId(input.parentEntityId);
  const occurredAtMs = finiteTimestamp(input.occurredAtMs);
  const createdAtMs = finiteTimestamp(input.createdAtMs ?? Date.now());
  const displayTitle = safeText(input.displayTitle, 160);
  const summary = safeText(input.summary, 240);
  const definition = PERSONAL_HISTORY_EVENT_DEFINITIONS[input.eventType];
  if (!ownerUid || !entityId || !sourceEventId || !definition ||
    occurredAtMs == null || createdAtMs == null ||
    (input.parentEntityId != null && !parentEntityId) ||
    (input.displayTitle != null && !displayTitle) ||
    (input.summary != null && !summary)) {
    throw new Error("personal_history_invalid_source");
  }
  return {
    ownerUid,
    occurredAtMs,
    eventType: input.eventType,
    category: definition.category,
    entityType: definition.entityType,
    entityId,
    parentEntityId,
    displayTitle,
    summary,
    metadata: normalizeTrustedHistoryMetadata(input.metadata),
    sourceEventId,
    schemaVersion: 1,
    createdAtMs,
    createdAt: FieldValue.serverTimestamp(),
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

function comparable(value: DocumentData) {
  const copy = {...value};
  delete copy.createdAt;
  delete copy.createdAtMs;
  return JSON.stringify(sortValue(copy));
}

export async function writePersonalHistoryEventTx(
  firestore: Firestore,
  transaction: Transaction,
  input: PersonalHistoryWriteInput
): Promise<PersonalHistoryWriteResult> {
  const eventId = buildTrustedPersonalHistoryEventId(
    input.ownerUid, input.sourceEventId);
  const eventRef = firestore.collection("users").doc(input.ownerUid)
    .collection("historyEvents").doc(eventId);
  const candidate = buildTrustedPersonalHistoryEvent(input);
  const existing = await transaction.get(eventRef);
  if (existing.exists) {
    if (comparable(existing.data()!) !== comparable(candidate)) {
      throw new Error("personal_history_identity_collision");
    }
    return {eventId, status: "duplicate"};
  }
  transaction.create(eventRef, candidate);
  return {eventId, status: "created"};
}

export async function recordPersonalHistoryEvent(
  firestore: Firestore,
  input: PersonalHistoryWriteInput
): Promise<PersonalHistoryWriteResult> {
  return firestore.runTransaction((transaction) =>
    writePersonalHistoryEventTx(firestore, transaction, input));
}
