import {type Timestamp} from "firebase/firestore";
import {DateTime, IANAZone} from "luxon";

export const PERSONAL_HISTORY_CATEGORIES = [
  "goal", "subtask", "planner", "calendar", "board", "routine",
  "milestone", "system",
] as const;
export const PERSONAL_HISTORY_ENTITY_TYPES = [
  "goal", "subtask", "planner_suggestion", "calendar_event",
  "planning_board_card", "routine_occurrence", "milestone",
] as const;
export const PERSONAL_HISTORY_EVENT_TYPES = [
  "goal_created", "goal_completed", "goal_archived", "goal_restored",
  "subtask_completed", "planner_suggestion_applied",
  "planner_calendar_block_created", "calendar_block_created",
  "planning_board_card_completed", "routine_completed",
  "milestone_completed",
] as const;

export const PERSONAL_HISTORY_PAGE_SIZE = 50;
export const PERSONAL_HISTORY_MAX_PAGE_SIZE = 100;
export const PERSONAL_HISTORY_MAX_METADATA_KEYS = 10;
export const PERSONAL_HISTORY_MAX_TITLE_LENGTH = 160;
export const PERSONAL_HISTORY_MAX_SUMMARY_LENGTH = 240;

export type PersonalHistoryCategory =
  (typeof PERSONAL_HISTORY_CATEGORIES)[number];
export type PersonalHistoryEntityType =
  (typeof PERSONAL_HISTORY_ENTITY_TYPES)[number];
export type PersonalHistoryEventType =
  (typeof PERSONAL_HISTORY_EVENT_TYPES)[number];
export type PersonalHistoryMetadataValue =
  string | number | boolean | null;
export type PersonalHistoryEvent = {
  id: string;
  ownerUid: string;
  occurredAtMs: number;
  eventType: PersonalHistoryEventType;
  category: PersonalHistoryCategory;
  entityType: PersonalHistoryEntityType;
  entityId: string;
  parentEntityId: string | null;
  displayTitle: string | null;
  summary: string | null;
  metadata: Record<string, PersonalHistoryMetadataValue>;
  sourceEventId: string;
  schemaVersion: 1;
  createdAtMs: number;
  createdAt?: Timestamp;
};
export type PersonalHistoryMonthBounds = {
  monthKey: string;
  startAtMs: number;
  endAtMs: number;
  timeZone: string;
};
export const PERSONAL_HISTORY_EVENT_DEFINITIONS: Record<
PersonalHistoryEventType, {
  category: PersonalHistoryCategory;
  entityType: PersonalHistoryEntityType;
}> = {
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
  calendar_block_created: {
    category: "calendar", entityType: "calendar_event",
  },
  planning_board_card_completed: {
    category: "board", entityType: "planning_board_card",
  },
  routine_completed: {
    category: "routine", entityType: "routine_occurrence",
  },
  milestone_completed: {category: "milestone", entityType: "milestone"},
};

const has = <T extends readonly string[]>(values: T, value: unknown):
value is T[number] => typeof value === "string" &&
  (values as readonly string[]).includes(value);
const finite = (value: unknown) => typeof value === "number" &&
  Number.isFinite(value) ? value : null;
const safeId = (value: unknown) => typeof value === "string" &&
  value.trim() && value.length <= 500 && !value.includes("/") ?
  value.trim() : null;
const optionalText = (value: unknown, maximum: number) => value == null ? null :
  typeof value === "string" && value.trim().length <= maximum ?
    value.trim() || null : null;

export function normalizePersonalHistoryMetadata(value: unknown):
Record<string, PersonalHistoryMetadataValue> | null {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PERSONAL_HISTORY_MAX_METADATA_KEYS) return null;
  const result: Record<string, PersonalHistoryMetadataValue> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 40 || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      return null;
    }
    if (item == null) result[key] = null;
    else if (typeof item === "boolean") result[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === "string" && item.length <= 160) {
      result[key] = item;
    } else return null;
  }
  return result;
}

export function mapPersonalHistoryEventDoc(
  id: string,
  value: Record<string, unknown>
): PersonalHistoryEvent | null {
  const eventId = safeId(id);
  const ownerUid = safeId(value.ownerUid);
  const occurredAtMs = finite(value.occurredAtMs);
  const eventType = has(PERSONAL_HISTORY_EVENT_TYPES, value.eventType) ?
    value.eventType : null;
  const category = has(PERSONAL_HISTORY_CATEGORIES, value.category) ?
    value.category : null;
  const entityType = has(PERSONAL_HISTORY_ENTITY_TYPES, value.entityType) ?
    value.entityType : null;
  const entityId = safeId(value.entityId);
  const parentEntityId = value.parentEntityId == null ? null :
    safeId(value.parentEntityId);
  const displayTitle = optionalText(
    value.displayTitle, PERSONAL_HISTORY_MAX_TITLE_LENGTH);
  const summary = optionalText(
    value.summary, PERSONAL_HISTORY_MAX_SUMMARY_LENGTH);
  const metadata = normalizePersonalHistoryMetadata(value.metadata);
  const sourceEventId = safeId(value.sourceEventId);
  const createdAtMs = finite(value.createdAtMs);
  if (!eventId || !ownerUid || occurredAtMs == null || !eventType ||
    !category || !entityType || !entityId ||
    PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType].category !== category ||
    PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType].entityType !== entityType ||
    (value.parentEntityId != null && !parentEntityId) ||
    (value.displayTitle != null && !displayTitle) ||
    (value.summary != null && !summary) || !metadata || !sourceEventId ||
    value.schemaVersion !== 1 || createdAtMs == null) return null;
  return {
    id: eventId, ownerUid, occurredAtMs, eventType, category, entityType,
    entityId, parentEntityId, displayTitle, summary, metadata, sourceEventId,
    schemaVersion: 1, createdAtMs,
    createdAt: value.createdAt as Timestamp | undefined,
  };
}

export function getPersonalHistoryMonthBounds(
  monthKey: string,
  timeZone: string
): PersonalHistoryMonthBounds {
  const month = DateTime.fromFormat(monthKey, "yyyy-MM", {
    zone: timeZone, setZone: true,
  }).startOf("month");
  if (!IANAZone.isValidZone(timeZone) || !month.isValid ||
    month.toFormat("yyyy-MM") !== monthKey) {
    throw new Error("A valid yyyy-MM month and IANA timezone are required.");
  }
  return {
    monthKey, startAtMs: month.toMillis(),
    endAtMs: month.plus({months: 1}).toMillis(),
    timeZone,
  };
}

function stableHash(value: string) {
  let first = 2166136261; let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second ^ value.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}` +
    `${(second >>> 0).toString(16).padStart(8, "0")}`;
}
export function buildPersonalHistoryEventId(
  ownerUid: string,
  sourceEventId: string
) {
  const owner = safeId(ownerUid); const source = safeId(sourceEventId);
  if (!owner || !source) throw new Error("Valid history identity is required.");
  return `history_${stableHash(`${owner}:${source}`)}`;
}
