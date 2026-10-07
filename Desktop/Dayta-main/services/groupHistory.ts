export const GROUP_HISTORY_SCHEMA_VERSION = 1 as const;
export const GROUP_HISTORY_MAX_ID_LENGTH = 500;
export const GROUP_HISTORY_MAX_TITLE_LENGTH = 160;
export const GROUP_HISTORY_MAX_SUMMARY_LENGTH = 240;
export const GROUP_HISTORY_MAX_DISPLAY_NAME_LENGTH = 80;
export const GROUP_HISTORY_EVENT_ID_PREFIX = "group_history_";

export const GROUP_HISTORY_CATEGORIES = [
  "goals",
  "tasks",
  "routines",
] as const;

export const GROUP_HISTORY_ENTITY_TYPES = [
  "subtask",
  "group_task",
  "routine_occurrence",
  "goal",
  "routine",
] as const;

export const GROUP_HISTORY_EVENT_TYPES = [
  "shared_subtask_completed",
  "group_task_completed",
  "group_routine_occurrence_completed",
] as const;

export const GROUP_HISTORY_VISIBILITIES = ["group_members"] as const;

export type GroupHistoryCategory =
  (typeof GROUP_HISTORY_CATEGORIES)[number];
export type GroupHistoryEntityType =
  (typeof GROUP_HISTORY_ENTITY_TYPES)[number];
export type GroupHistoryEventType =
  (typeof GROUP_HISTORY_EVENT_TYPES)[number];
export type GroupHistoryVisibility =
  (typeof GROUP_HISTORY_VISIBILITIES)[number];

export type GroupHistoryMetadata =
  | {
    kind: "shared_subtask_completed";
    assignmentUid: string | null;
  }
  | {
    kind: "group_task_completed";
    claimedByUid: string | null;
  }
  | {
    kind: "group_routine_occurrence_completed";
    participantCount: number;
  };

export type GroupHistoryEvent = {
  id: string;
  schemaVersion: typeof GROUP_HISTORY_SCHEMA_VERSION;
  groupId: string;
  eventType: GroupHistoryEventType;
  category: GroupHistoryCategory;
  occurredAtMs: number;
  createdAtMs: number;
  entityType: GroupHistoryEntityType;
  entityId: string;
  parentEntityType: GroupHistoryEntityType | null;
  parentEntityId: string | null;
  sourceEventId: string;
  displayTitle: string | null;
  summary: string | null;
  actorUid: string | null;
  actorDisplayName: string | null;
  creditedMemberUid: string | null;
  creditedMemberDisplayName: string | null;
  visibility: GroupHistoryVisibility;
  metadata: GroupHistoryMetadata;
};

export type GroupHistoryArchitectureError =
  | "invalid_group"
  | "invalid_event_type"
  | "invalid_category"
  | "invalid_entity_type"
  | "invalid_timestamp"
  | "invalid_source_identity"
  | "invalid_actor"
  | "invalid_visibility"
  | "invalid_metadata"
  | "unsupported_schema"
  | "tenancy_mismatch"
  | "permission_denied"
  | "query_failed"
  | "write_failed";

type EventDefinition = {
  category: GroupHistoryCategory;
  entityType: GroupHistoryEntityType;
  parentEntityType: GroupHistoryEntityType | null;
};

export const GROUP_HISTORY_EVENT_DEFINITIONS: Record<
  GroupHistoryEventType,
  EventDefinition
> = {
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
};

const EVENT_KEYS = new Set([
  "schemaVersion", "groupId", "eventType", "category", "occurredAtMs",
  "createdAtMs", "entityType", "entityId", "parentEntityType",
  "parentEntityId", "sourceEventId", "displayTitle", "summary", "actorUid",
  "actorDisplayName", "creditedMemberUid", "creditedMemberDisplayName",
  "visibility", "metadata",
]);

function has<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" &&
    (values as readonly string[]).includes(value);
}

function safeId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= GROUP_HISTORY_MAX_ID_LENGTH &&
    !normalized.includes("/") ? normalized : null;
}

function boundedText(value: unknown, maximum: number) {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function nullableId(value: unknown) {
  return value == null ? null : safeId(value);
}

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ?
    value : null;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function normalizeGroupHistoryMetadata(
  eventType: GroupHistoryEventType,
  value: unknown
): GroupHistoryMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.kind !== eventType) return null;
  if (eventType === "shared_subtask_completed") {
    if (!exactKeys(data, ["kind", "assignmentUid"])) return null;
    const assignmentUid = nullableId(data.assignmentUid);
    if (data.assignmentUid != null && !assignmentUid) return null;
    return {kind: eventType, assignmentUid};
  }
  if (eventType === "group_task_completed") {
    if (!exactKeys(data, ["kind", "claimedByUid"])) return null;
    const claimedByUid = nullableId(data.claimedByUid);
    if (data.claimedByUid != null && !claimedByUid) return null;
    return {kind: eventType, claimedByUid};
  }
  if (!exactKeys(data, ["kind", "participantCount"]) ||
    typeof data.participantCount !== "number" ||
    !Number.isInteger(data.participantCount) ||
    data.participantCount < 0 ||
    data.participantCount > 500) return null;
  return {
    kind: "group_routine_occurrence_completed",
    participantCount: data.participantCount,
  };
}

export function mapGroupHistoryEventDoc(
  pathGroupId: string,
  eventId: string,
  value: unknown
): GroupHistoryEvent | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if (!Object.keys(data).every((key) => EVENT_KEYS.has(key))) return null;
    const authoritativeGroupId = safeId(pathGroupId);
    const id = safeId(eventId);
    const groupId = safeId(data.groupId);
    if (!authoritativeGroupId || !id || !groupId ||
      groupId !== authoritativeGroupId ||
      data.schemaVersion !== GROUP_HISTORY_SCHEMA_VERSION) return null;
    const eventType = has(GROUP_HISTORY_EVENT_TYPES, data.eventType) ?
      data.eventType : null;
    const category = has(GROUP_HISTORY_CATEGORIES, data.category) ?
      data.category : null;
    const entityType = has(GROUP_HISTORY_ENTITY_TYPES, data.entityType) ?
      data.entityType : null;
    const parentEntityType = data.parentEntityType == null ? null :
      has(GROUP_HISTORY_ENTITY_TYPES, data.parentEntityType) ?
        data.parentEntityType : undefined;
    const visibility = has(GROUP_HISTORY_VISIBILITIES, data.visibility) ?
      data.visibility : null;
    const entityId = safeId(data.entityId);
    const parentEntityId = nullableId(data.parentEntityId);
    const sourceEventId = safeId(data.sourceEventId);
    const actorUid = nullableId(data.actorUid);
    const creditedMemberUid = nullableId(data.creditedMemberUid);
    const occurredAtMs = finiteTimestamp(data.occurredAtMs);
    const createdAtMs = finiteTimestamp(data.createdAtMs);
    const displayTitle = boundedText(
      data.displayTitle, GROUP_HISTORY_MAX_TITLE_LENGTH);
    const summary = boundedText(
      data.summary, GROUP_HISTORY_MAX_SUMMARY_LENGTH);
    const actorDisplayName = boundedText(
      data.actorDisplayName, GROUP_HISTORY_MAX_DISPLAY_NAME_LENGTH);
    const creditedMemberDisplayName = boundedText(
      data.creditedMemberDisplayName,
      GROUP_HISTORY_MAX_DISPLAY_NAME_LENGTH
    );
    if (!eventType || !category || !entityType ||
      parentEntityType === undefined || !visibility || !entityId ||
      !sourceEventId ||
      occurredAtMs == null || createdAtMs == null ||
      (data.parentEntityId != null && !parentEntityId) ||
      (data.actorUid != null && !actorUid) ||
      (data.creditedMemberUid != null && !creditedMemberUid) ||
      displayTitle === undefined || summary === undefined ||
      actorDisplayName === undefined ||
      creditedMemberDisplayName === undefined) return null;
    const definition = GROUP_HISTORY_EVENT_DEFINITIONS[eventType];
    if (definition.category !== category ||
      definition.entityType !== entityType ||
      definition.parentEntityType !== parentEntityType ||
      (parentEntityType == null) !== (parentEntityId == null)) return null;
    const metadata = normalizeGroupHistoryMetadata(eventType, data.metadata);
    if (!metadata) return null;
    return {
      id,
      schemaVersion: GROUP_HISTORY_SCHEMA_VERSION,
      groupId,
      eventType,
      category,
      occurredAtMs,
      createdAtMs,
      entityType,
      entityId,
      parentEntityType,
      parentEntityId,
      sourceEventId,
      displayTitle,
      summary,
      actorUid,
      actorDisplayName,
      creditedMemberUid,
      creditedMemberDisplayName,
      visibility,
      metadata,
    };
  } catch {
    return null;
  }
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

export function buildGroupHistoryEventId(input: {
  groupId: string;
  eventType: GroupHistoryEventType;
  sourceEventId: string;
}) {
  const groupId = safeId(input.groupId);
  const sourceEventId = safeId(input.sourceEventId);
  if (!groupId || !sourceEventId ||
    !has(GROUP_HISTORY_EVENT_TYPES, input.eventType)) {
    throw new Error("invalid_source_identity");
  }
  return `${GROUP_HISTORY_EVENT_ID_PREFIX}${stableHash(
    `${groupId}:${input.eventType}:${sourceEventId}`
  )}`;
}

export function getGroupHistoryCollectionPath(groupId: string) {
  const normalized = safeId(groupId);
  if (!normalized) throw new Error("invalid_group");
  return `groups/${normalized}/historyEvents`;
}

export function getGroupHistoryEventPath(groupId: string, eventId: string) {
  const normalizedEventId = safeId(eventId);
  if (!normalizedEventId) throw new Error("invalid_source_identity");
  return `${getGroupHistoryCollectionPath(groupId)}/${normalizedEventId}`;
}
