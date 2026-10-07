import {
  type DocumentData,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

export const GROUP_HISTORY_SCHEMA_VERSION = 1 as const;
export const GROUP_HISTORY_EVENT_DEFINITIONS = {
  shared_subtask_completed: {
    category: "goals",
    entityType: "subtask",
    parentEntityType: "goal",
  },
  group_task_completed: {
    category: "tasks",
    entityType: "group_task",
    parentEntityType: null,
  },
  group_routine_occurrence_completed: {
    category: "routines",
    entityType: "routine_occurrence",
    parentEntityType: "routine",
  },
} as const;

export type GroupHistoryEventType =
  keyof typeof GROUP_HISTORY_EVENT_DEFINITIONS;
export type GroupHistoryMetadata =
  | {kind: "shared_subtask_completed"; assignmentUid: string | null}
  | {kind: "group_task_completed"; claimedByUid: string | null}
  | {
    kind: "group_routine_occurrence_completed";
    participantCount: number;
  };
export type GroupHistoryWriteInput = {
  groupId: string;
  eventType: GroupHistoryEventType;
  entityId: string;
  parentEntityId: string | null;
  sourceEventId: string;
  occurredAtMs: number;
  createdAtMs?: number;
  displayTitle: string | null;
  summary?: string | null;
  actorUid: string | null;
  actorDisplayName: string | null;
  creditedMemberUid: string | null;
  creditedMemberDisplayName: string | null;
  metadata: GroupHistoryMetadata;
};
export type GroupHistoryWriteResult =
  | {status: "created"; eventType: GroupHistoryEventType}
  | {status: "already_exists"; eventType: GroupHistoryEventType}
  | {
    status: "conflict";
    eventType: GroupHistoryEventType;
    reason: "existing_event_mismatch";
  };
export type GroupHistoryRecordingErrorCode =
  | "invalid_group"
  | "tenancy_mismatch"
  | "invalid_source_identity"
  | "invalid_event"
  | "unsupported_source"
  | "source_read_failed"
  | "event_build_failed"
  | "event_conflict"
  | "event_write_failed";

export class GroupHistoryRecordingError extends Error {
  constructor(
    public readonly code: GroupHistoryRecordingErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "GroupHistoryRecordingError";
  }
}

const safeId = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 &&
  value.trim().length <= 500 && !value.includes("/") ? value.trim() : null;
const text = (value: unknown, maximum: number) => {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
};
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) &&
  value > 0 ? Math.trunc(value) : null;

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

export function buildTrustedGroupHistoryEventId(input: {
  groupId: string;
  eventType: GroupHistoryEventType;
  sourceEventId: string;
}) {
  const groupId = safeId(input.groupId);
  const sourceEventId = safeId(input.sourceEventId);
  if (!groupId || !sourceEventId ||
    !GROUP_HISTORY_EVENT_DEFINITIONS[input.eventType]) {
    throw new Error("invalid_source_identity");
  }
  return `group_history_${stableHash(
    `${groupId}:${input.eventType}:${sourceEventId}`
  )}`;
}

function normalizeMetadata(
  eventType: GroupHistoryEventType,
  metadata: GroupHistoryMetadata
): GroupHistoryMetadata {
  if (metadata.kind !== eventType) throw new Error("invalid_metadata");
  if (eventType === "shared_subtask_completed") {
    const assignmentUid = metadata.kind === eventType ?
      (metadata.assignmentUid == null ? null :
        safeId(metadata.assignmentUid)) : null;
    if (metadata.kind !== eventType ||
      (metadata.assignmentUid != null && !assignmentUid)) {
      throw new Error("invalid_metadata");
    }
    return {kind: eventType, assignmentUid};
  }
  if (eventType === "group_task_completed") {
    const claimedByUid = metadata.kind === eventType ?
      (metadata.claimedByUid == null ? null :
        safeId(metadata.claimedByUid)) : null;
    if (metadata.kind !== eventType ||
      (metadata.claimedByUid != null && !claimedByUid)) {
      throw new Error("invalid_metadata");
    }
    return {kind: eventType, claimedByUid};
  }
  if (metadata.kind !== eventType ||
    !Number.isInteger(metadata.participantCount) ||
    metadata.participantCount < 0 ||
    metadata.participantCount > 500) {
    throw new Error("invalid_metadata");
  }
  return {kind: eventType, participantCount: metadata.participantCount};
}

export function buildTrustedGroupHistoryEvent(
  input: GroupHistoryWriteInput
): DocumentData {
  const groupId = safeId(input.groupId);
  const entityId = safeId(input.entityId);
  const parentEntityId = input.parentEntityId == null ? null :
    safeId(input.parentEntityId);
  const sourceEventId = safeId(input.sourceEventId);
  const actorUid = input.actorUid == null ? null : safeId(input.actorUid);
  const creditedMemberUid = input.creditedMemberUid == null ? null :
    safeId(input.creditedMemberUid);
  const occurredAtMs = timestamp(input.occurredAtMs);
  const createdAtMs = timestamp(input.createdAtMs ?? Date.now());
  const displayTitle = text(input.displayTitle, 160);
  const summary = text(input.summary, 240);
  const actorDisplayName = text(input.actorDisplayName, 80);
  const creditedMemberDisplayName =
    text(input.creditedMemberDisplayName, 80);
  const definition = GROUP_HISTORY_EVENT_DEFINITIONS[input.eventType];
  if (!groupId || !entityId || !sourceEventId || !definition ||
    occurredAtMs == null || createdAtMs == null ||
    (input.parentEntityId != null && !parentEntityId) ||
    (definition.parentEntityType == null) !== (parentEntityId == null) ||
    (input.actorUid != null && !actorUid) ||
    (input.creditedMemberUid != null && !creditedMemberUid) ||
    displayTitle === undefined || summary === undefined ||
    actorDisplayName === undefined ||
    creditedMemberDisplayName === undefined) {
    throw new Error("invalid_event");
  }
  return {
    schemaVersion: GROUP_HISTORY_SCHEMA_VERSION,
    groupId,
    eventType: input.eventType,
    category: definition.category,
    occurredAtMs,
    createdAtMs,
    entityType: definition.entityType,
    entityId,
    parentEntityType: definition.parentEntityType,
    parentEntityId,
    sourceEventId,
    displayTitle,
    summary,
    actorUid,
    actorDisplayName,
    creditedMemberUid,
    creditedMemberDisplayName,
    visibility: "group_members",
    metadata: normalizeMetadata(input.eventType, input.metadata),
  };
}

function comparable(value: DocumentData) {
  const copy = {...value};
  delete copy.createdAtMs;
  return JSON.stringify(sortValue(copy));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)])
    );
  }
  return value;
}

export async function writeGroupHistoryEventTx(
  firestore: Firestore,
  transaction: Transaction,
  input: GroupHistoryWriteInput
): Promise<GroupHistoryWriteResult> {
  const eventId = buildTrustedGroupHistoryEventId(input);
  const candidate = buildTrustedGroupHistoryEvent(input);
  const eventRef = firestore.collection("groups").doc(input.groupId)
    .collection("historyEvents").doc(eventId);
  const existing = await transaction.get(eventRef);
  if (existing.exists) {
    if (comparable(existing.data()!) !== comparable(candidate)) {
      return {
        status: "conflict",
        eventType: input.eventType,
        reason: "existing_event_mismatch",
      };
    }
    return {status: "already_exists", eventType: input.eventType};
  }
  transaction.create(eventRef, candidate);
  return {status: "created", eventType: input.eventType};
}

export function recordGroupHistoryEvent(
  firestore: Firestore,
  input: GroupHistoryWriteInput
) {
  return firestore.runTransaction((transaction) =>
    writeGroupHistoryEventTx(firestore, transaction, input))
    .catch((error: unknown) => {
      if (error instanceof GroupHistoryRecordingError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("invalid_")) {
        throw new GroupHistoryRecordingError("event_build_failed", false);
      }
      throw new GroupHistoryRecordingError("event_write_failed", true);
    });
}
