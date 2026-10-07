import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import {IANAZone} from "luxon";
import {db} from "./firebase";
import {
  getPersonalHistoryMonthBounds,
  mapPersonalHistoryEventDoc,
  PERSONAL_HISTORY_CATEGORIES,
  PERSONAL_HISTORY_EVENT_DEFINITIONS,
  PERSONAL_HISTORY_EVENT_TYPES,
  PERSONAL_HISTORY_MAX_PAGE_SIZE,
  PERSONAL_HISTORY_PAGE_SIZE,
  type PersonalHistoryCategory,
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
  type PersonalHistoryMonthBounds,
} from "./personalHistory";
import {
  groupPersonalHistoryEventsByDay,
  summarizePersonalHistoryMonth,
  type PersonalHistoryDayGroup,
  type PersonalHistoryMonthSummary,
} from "./personalHistoryAggregation";

export const PERSONAL_HISTORY_QUERY_SCAN_CHUNK_SIZE = 100;
export const PERSONAL_HISTORY_QUERY_SCAN_LIMIT = 2000;
export const PERSONAL_HISTORY_SUPPORTED_YEAR_MIN = 2000;
export const PERSONAL_HISTORY_SUPPORTED_YEAR_MAX = 2100;

export type PersonalHistoryCursor = {
  occurredAtMs: number;
  eventId: string;
};
export type PersonalHistoryMonthQuery = {
  ownerUid: string;
  year: number;
  month: number;
  timeZone: string;
  pageSize?: number;
  cursor?: PersonalHistoryCursor | null;
  categories?: PersonalHistoryCategory[];
  eventTypes?: PersonalHistoryEventType[];
};
export type NormalizedPersonalHistoryMonthQuery = {
  ownerUid: string;
  year: number;
  month: number;
  timeZone: string;
  pageSize: number;
  cursor: PersonalHistoryCursor | null;
  categories: PersonalHistoryCategory[];
  eventTypes: PersonalHistoryEventType[];
  range: PersonalHistoryMonthBounds;
};
export type PersonalHistoryMonthPage = {
  events: PersonalHistoryEvent[];
  nextCursor: PersonalHistoryCursor | null;
  hasMore: boolean;
  invalidEventCount: number;
  scannedEventCount: number;
  scanLimitReached: boolean;
  range: PersonalHistoryMonthBounds;
};
export type PersonalHistoryMonthResult = {
  query: NormalizedPersonalHistoryMonthQuery;
  page: PersonalHistoryMonthPage;
  dayGroups: PersonalHistoryDayGroup[];
};
export type PersonalHistoryMonthSummaryResult = {
  summary: PersonalHistoryMonthSummary;
  summaryComplete: boolean;
  invalidEventCount: number;
  scannedEventCount: number;
  range: PersonalHistoryMonthBounds;
};
export type PersonalHistoryQueryErrorCode =
  | "invalid_owner"
  | "invalid_month"
  | "invalid_timezone"
  | "invalid_page_size"
  | "invalid_cursor"
  | "invalid_filter"
  | "permission_denied"
  | "query_failed";

export class PersonalHistoryQueryError extends Error {
  constructor(public readonly code: PersonalHistoryQueryErrorCode) {
    super(code);
    this.name = "PersonalHistoryQueryError";
  }
}

const has = <T extends readonly string[]>(values: T, value: unknown):
value is T[number] => typeof value === "string" &&
  (values as readonly string[]).includes(value);
const unique = <T extends string>(values: readonly T[]) => [...new Set(values)];

export function normalizePersonalHistoryMonthQuery(
  input: PersonalHistoryMonthQuery
): NormalizedPersonalHistoryMonthQuery {
  const ownerUid = typeof input.ownerUid === "string" ?
    input.ownerUid.trim() : "";
  if (!ownerUid || ownerUid.length > 500 || ownerUid.includes("/")) {
    throw new PersonalHistoryQueryError("invalid_owner");
  }
  if (!Number.isInteger(input.year) ||
    input.year < PERSONAL_HISTORY_SUPPORTED_YEAR_MIN ||
    input.year > PERSONAL_HISTORY_SUPPORTED_YEAR_MAX ||
    !Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new PersonalHistoryQueryError("invalid_month");
  }
  if (!IANAZone.isValidZone(input.timeZone)) {
    throw new PersonalHistoryQueryError("invalid_timezone");
  }
  const pageSize = input.pageSize ?? PERSONAL_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 ||
    pageSize > PERSONAL_HISTORY_MAX_PAGE_SIZE) {
    throw new PersonalHistoryQueryError("invalid_page_size");
  }
  const categories = unique(input.categories ?? []);
  const eventTypes = unique(input.eventTypes ?? []);
  if (!categories.every((item) => has(PERSONAL_HISTORY_CATEGORIES, item)) ||
    !eventTypes.every((item) => has(PERSONAL_HISTORY_EVENT_TYPES, item))) {
    throw new PersonalHistoryQueryError("invalid_filter");
  }
  if (categories.length && eventTypes.some((eventType) =>
    !categories.includes(PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType].category))) {
    throw new PersonalHistoryQueryError("invalid_filter");
  }
  const monthKey = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const range = getPersonalHistoryMonthBounds(monthKey, input.timeZone);
  const cursor = input.cursor ?? null;
  if (cursor && (
    !Number.isFinite(cursor.occurredAtMs) ||
    cursor.occurredAtMs < range.startAtMs ||
    cursor.occurredAtMs >= range.endAtMs ||
    typeof cursor.eventId !== "string" || !cursor.eventId.trim() ||
    cursor.eventId.length > 500 || cursor.eventId.includes("/")
  )) throw new PersonalHistoryQueryError("invalid_cursor");
  return {
    ownerUid, year: input.year, month: input.month,
    timeZone: input.timeZone, pageSize, cursor,
    categories, eventTypes, range,
  };
}

export function matchesPersonalHistoryFilters(
  event: PersonalHistoryEvent,
  queryModel: Pick<NormalizedPersonalHistoryMonthQuery,
  "categories" | "eventTypes">
) {
  return (!queryModel.categories.length ||
      queryModel.categories.includes(event.category)) &&
    (!queryModel.eventTypes.length ||
      queryModel.eventTypes.includes(event.eventType));
}

const cursorFrom = (event: {occurredAtMs: number; id: string}):
PersonalHistoryCursor => ({occurredAtMs: event.occurredAtMs, eventId: event.id});

function queryConstraints(
  range: PersonalHistoryMonthBounds,
  cursor: PersonalHistoryCursor | null,
  pageSize: number
) {
  const constraints: QueryConstraint[] = [
    where("occurredAtMs", ">=", range.startAtMs),
    where("occurredAtMs", "<", range.endAtMs),
    orderBy("occurredAtMs", "desc"),
    orderBy(documentId(), "desc"),
  ];
  if (cursor) constraints.push(
    startAfter(cursor.occurredAtMs, cursor.eventId));
  constraints.push(limit(pageSize));
  return constraints;
}

function normalizeQueryFailure(error: unknown): PersonalHistoryQueryError {
  if (error instanceof PersonalHistoryQueryError) return error;
  const code = typeof error === "object" && error &&
    "code" in error ? String(error.code) : "";
  return new PersonalHistoryQueryError(
    code.includes("permission-denied") ? "permission_denied" : "query_failed");
}

export async function getPersonalHistoryMonthPage(
  input: PersonalHistoryMonthQuery
): Promise<PersonalHistoryMonthPage> {
  const normalized = normalizePersonalHistoryMonthQuery(input);
  const matches: PersonalHistoryEvent[] = [];
  let scanCursor = normalized.cursor;
  let returnedCursor: PersonalHistoryCursor | null = null;
  let invalidEventCount = 0;
  let scannedEventCount = 0;
  let sourceHasMore = false;
  try {
    while (scannedEventCount < PERSONAL_HISTORY_QUERY_SCAN_LIMIT &&
      matches.length <= normalized.pageSize) {
      const remaining = PERSONAL_HISTORY_QUERY_SCAN_LIMIT - scannedEventCount;
      const batchSize = Math.min(
        PERSONAL_HISTORY_QUERY_SCAN_CHUNK_SIZE, remaining);
      const snapshot: QuerySnapshot<DocumentData> = await getDocs(query(
        collection(db, "users", normalized.ownerUid, "historyEvents"),
        ...queryConstraints(normalized.range, scanCursor, batchSize)
      ));
      sourceHasMore = snapshot.size === batchSize;
      if (snapshot.empty) break;
      for (const document of snapshot.docs as QueryDocumentSnapshot<
      DocumentData>[]) {
        scannedEventCount += 1;
        scanCursor = {
          occurredAtMs: Number(document.get("occurredAtMs")),
          eventId: document.id,
        };
        const event = mapPersonalHistoryEventDoc(
          document.id, document.data());
        if (!event || event.ownerUid !== normalized.ownerUid) {
          invalidEventCount += 1;
          continue;
        }
        if (!matchesPersonalHistoryFilters(event, normalized)) continue;
        matches.push(event);
        if (matches.length === normalized.pageSize) {
          returnedCursor = cursorFrom(event);
        }
        if (matches.length > normalized.pageSize) break;
      }
      if (matches.length > normalized.pageSize || !sourceHasMore) break;
    }
  } catch (error) {
    throw normalizeQueryFailure(error);
  }
  const scanLimitReached = scannedEventCount >=
    PERSONAL_HISTORY_QUERY_SCAN_LIMIT && sourceHasMore &&
    matches.length <= normalized.pageSize;
  const hasExtraMatch = matches.length > normalized.pageSize;
  const events = matches.slice(0, normalized.pageSize);
  if (!returnedCursor && scanLimitReached) returnedCursor = scanCursor;
  return {
    events,
    nextCursor: hasExtraMatch || scanLimitReached ? returnedCursor : null,
    hasMore: hasExtraMatch || scanLimitReached,
    invalidEventCount,
    scannedEventCount,
    scanLimitReached,
    range: normalized.range,
  };
}

export async function getPersonalHistoryMonthResult(
  input: PersonalHistoryMonthQuery
): Promise<PersonalHistoryMonthResult> {
  const queryModel = normalizePersonalHistoryMonthQuery(input);
  const page = await getPersonalHistoryMonthPage(input);
  return {
    query: queryModel,
    page,
    dayGroups: groupPersonalHistoryEventsByDay(
      page.events, queryModel.timeZone),
  };
}

export async function getPersonalHistoryMonthSummary(
  input: Omit<PersonalHistoryMonthQuery, "cursor" | "pageSize">
): Promise<PersonalHistoryMonthSummaryResult> {
  const normalized = normalizePersonalHistoryMonthQuery({
    ...input, pageSize: PERSONAL_HISTORY_MAX_PAGE_SIZE,
  });
  const events: PersonalHistoryEvent[] = [];
  let cursor: PersonalHistoryCursor | null = null;
  let invalidEventCount = 0;
  let scannedEventCount = 0;
  let sourceHasMore = false;
  try {
    while (scannedEventCount < PERSONAL_HISTORY_QUERY_SCAN_LIMIT) {
      const batchSize = Math.min(PERSONAL_HISTORY_QUERY_SCAN_CHUNK_SIZE,
        PERSONAL_HISTORY_QUERY_SCAN_LIMIT - scannedEventCount);
      const snapshot: QuerySnapshot<DocumentData> = await getDocs(query(
        collection(db, "users", normalized.ownerUid, "historyEvents"),
        ...queryConstraints(normalized.range, cursor, batchSize)
      ));
      sourceHasMore = snapshot.size === batchSize;
      if (snapshot.empty) break;
      for (const document of snapshot.docs as QueryDocumentSnapshot<
      DocumentData>[]) {
        scannedEventCount += 1;
        cursor = {
          occurredAtMs: Number(document.get("occurredAtMs")),
          eventId: document.id,
        };
        const event = mapPersonalHistoryEventDoc(
          document.id, document.data());
        if (!event || event.ownerUid !== normalized.ownerUid) {
          invalidEventCount += 1;
        } else if (matchesPersonalHistoryFilters(event, normalized)) {
          events.push(event);
        }
      }
      if (!sourceHasMore) break;
    }
  } catch (error) {
    throw normalizeQueryFailure(error);
  }
  return {
    summary: summarizePersonalHistoryMonth(events, normalized.timeZone),
    summaryComplete: !(scannedEventCount >=
      PERSONAL_HISTORY_QUERY_SCAN_LIMIT && sourceHasMore),
    invalidEventCount,
    scannedEventCount,
    range: normalized.range,
  };
}
