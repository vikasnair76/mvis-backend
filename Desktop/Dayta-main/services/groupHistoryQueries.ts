import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import {DateTime, IANAZone} from "luxon";
import {db} from "./firebase";
import {
  GROUP_HISTORY_CATEGORIES,
  GROUP_HISTORY_MAX_ID_LENGTH,
  GROUP_HISTORY_SCHEMA_VERSION,
  getGroupHistoryCollectionPath,
  mapGroupHistoryEventDoc,
  type GroupHistoryCategory,
  type GroupHistoryEvent,
} from "./groupHistory";
import {
  aggregateGroupHistoryEvents,
  type GroupHistoryMonthSummary,
} from "./groupHistoryAggregation";

export const GROUP_HISTORY_PAGE_SIZE = 50;
export const GROUP_HISTORY_MAX_PAGE_SIZE = 100;
export const GROUP_HISTORY_SCAN_CHUNK_SIZE = 100;
export const GROUP_HISTORY_PAGE_SCAN_LIMIT = 1000;
export const GROUP_HISTORY_SUMMARY_SCAN_LIMIT = 5000;
export const GROUP_HISTORY_SUPPORTED_YEAR_MIN = 2000;
export const GROUP_HISTORY_SUPPORTED_YEAR_MAX = 2100;

export type GroupHistoryMonthBounds = {
  monthKey: string;
  startMs: number;
  endExclusiveMs: number;
  timeZone: string;
};
export type GroupHistoryCursor = {
  occurredAtMs: number;
  eventId: string;
};
export type GetGroupHistoryMonthPageInput = {
  groupId: string;
  year: number;
  month: number;
  timeZone: string;
  pageSize?: number;
  cursor?: GroupHistoryCursor | null;
  category?: GroupHistoryCategory | null;
};
export type NormalizedGroupHistoryMonthQuery = {
  groupId: string;
  year: number;
  month: number;
  timeZone: string;
  pageSize: number;
  cursor: GroupHistoryCursor | null;
  category: GroupHistoryCategory | null;
  range: GroupHistoryMonthBounds;
};
export type GroupHistoryPagePartialReason =
  | "malformed_scan_limit"
  | "category_scan_limit"
  | "query_conflict";
export type GroupHistoryMonthPage = {
  events: GroupHistoryEvent[];
  nextCursor: GroupHistoryCursor | null;
  hasMore: boolean;
  requestedPageSize: number;
  returnedEventCount: number;
  scannedDocumentCount: number;
  skippedMalformedCount: number;
  skippedUnsupportedSchemaCount: number;
  duplicateEventCount: number;
  partial: boolean;
  partialReason: GroupHistoryPagePartialReason | null;
  range: GroupHistoryMonthBounds;
};
export type GroupHistoryMonthSummaryResult = {
  summary: GroupHistoryMonthSummary;
  complete: boolean;
  partialReason: "scan_limit_reached" | "query_failed_after_partial_scan" | null;
  scannedDocumentCount: number;
  skippedMalformedCount: number;
  skippedUnsupportedSchemaCount: number;
  duplicateEventCount: number;
  range: GroupHistoryMonthBounds;
};
export type GroupHistoryQueryErrorCode =
  | "invalid_group"
  | "invalid_year"
  | "invalid_month"
  | "invalid_timezone"
  | "invalid_page_size"
  | "invalid_cursor"
  | "invalid_category"
  | "unauthenticated"
  | "permission_denied"
  | "group_not_found"
  | "query_failed"
  | "query_conflict";

export class GroupHistoryQueryError extends Error {
  constructor(
    public readonly code: GroupHistoryQueryErrorCode,
    public readonly retryable = false
  ) {
    super(code);
    this.name = "GroupHistoryQueryError";
  }
}

export type GroupHistorySourceDocument = {
  id: string;
  data: DocumentData;
};
export type GroupHistoryBatch = {
  documents: GroupHistorySourceDocument[];
  sourceHasMore: boolean;
};
export type GroupHistoryBatchReader = (input: {
  query: NormalizedGroupHistoryMonthQuery;
  cursor: GroupHistoryCursor | null;
  limit: number;
}) => Promise<GroupHistoryBatch>;

const safeId = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= GROUP_HISTORY_MAX_ID_LENGTH &&
    !normalized.includes("/") && normalized !== "." && normalized !== ".." ?
    normalized : null;
};
const hasCategory = (value: unknown): value is GroupHistoryCategory =>
  typeof value === "string" &&
  (GROUP_HISTORY_CATEGORIES as readonly string[]).includes(value);

export function getGroupHistoryMonthBounds(
  year: number,
  month: number,
  timeZone: string
): GroupHistoryMonthBounds {
  if (!Number.isInteger(year) ||
    year < GROUP_HISTORY_SUPPORTED_YEAR_MIN ||
    year > GROUP_HISTORY_SUPPORTED_YEAR_MAX) {
    throw new GroupHistoryQueryError("invalid_year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new GroupHistoryQueryError("invalid_month");
  }
  if (!IANAZone.isValidZone(timeZone)) {
    throw new GroupHistoryQueryError("invalid_timezone");
  }
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const start = DateTime.fromObject(
    {year, month, day: 1},
    {zone: timeZone}
  ).startOf("day");
  if (!start.isValid) throw new GroupHistoryQueryError("invalid_timezone");
  return {
    monthKey,
    startMs: start.toMillis(),
    endExclusiveMs: start.plus({months: 1}).toMillis(),
    timeZone,
  };
}

export function normalizeGroupHistoryMonthQuery(
  input: GetGroupHistoryMonthPageInput
): NormalizedGroupHistoryMonthQuery {
  const groupId = safeId(input.groupId);
  if (!groupId) throw new GroupHistoryQueryError("invalid_group");
  const range = getGroupHistoryMonthBounds(
    input.year, input.month, input.timeZone);
  const pageSize = input.pageSize ?? GROUP_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 ||
    pageSize > GROUP_HISTORY_MAX_PAGE_SIZE) {
    throw new GroupHistoryQueryError("invalid_page_size");
  }
  const category = input.category ?? null;
  if (category != null && !hasCategory(category)) {
    throw new GroupHistoryQueryError("invalid_category");
  }
  const rawCursor = input.cursor ?? null;
  const cursorId = rawCursor ? safeId(rawCursor.eventId) : null;
  if (rawCursor && (
    !Number.isInteger(rawCursor.occurredAtMs) ||
    rawCursor.occurredAtMs < range.startMs ||
    rawCursor.occurredAtMs >= range.endExclusiveMs ||
    !cursorId
  )) throw new GroupHistoryQueryError("invalid_cursor");
  return {
    groupId,
    year: input.year,
    month: input.month,
    timeZone: input.timeZone,
    pageSize,
    cursor: rawCursor ? {
      occurredAtMs: rawCursor.occurredAtMs,
      eventId: cursorId!,
    } : null,
    category,
    range,
  };
}

function constraints(
  range: GroupHistoryMonthBounds,
  cursor: GroupHistoryCursor | null,
  batchSize: number
) {
  const result: QueryConstraint[] = [
    where("occurredAtMs", ">=", range.startMs),
    where("occurredAtMs", "<", range.endExclusiveMs),
    orderBy("occurredAtMs", "desc"),
    orderBy(documentId(), "desc"),
  ];
  if (cursor) result.push(startAfter(cursor.occurredAtMs, cursor.eventId));
  result.push(limit(batchSize));
  return result;
}

export const readGroupHistoryBatch: GroupHistoryBatchReader = async (input) => {
  const snapshot = await getDocs(query(
    collection(db, getGroupHistoryCollectionPath(input.query.groupId)),
    ...constraints(input.query.range, input.cursor, input.limit)
  ));
  return {
    documents: snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data(),
    })),
    sourceHasMore: snapshot.size === input.limit,
  };
};

export function normalizeGroupHistoryQueryFailure(error: unknown) {
  if (error instanceof GroupHistoryQueryError) return error;
  const code = typeof error === "object" && error && "code" in error ?
    String(error.code) : "";
  if (code.includes("unauthenticated")) {
    return new GroupHistoryQueryError("unauthenticated");
  }
  if (code.includes("permission-denied")) {
    return new GroupHistoryQueryError("permission_denied");
  }
  if (code.includes("not-found")) {
    return new GroupHistoryQueryError("group_not_found");
  }
  return new GroupHistoryQueryError("query_failed", true);
}

const cursorFor = (document: GroupHistorySourceDocument):
GroupHistoryCursor | null => {
  const occurredAtMs = document.data.occurredAtMs;
  const eventId = safeId(document.id);
  return Number.isInteger(occurredAtMs) && eventId ?
    {occurredAtMs, eventId} : null;
};
const isAfter = (
  previous: GroupHistoryCursor,
  next: GroupHistoryCursor
) => next.occurredAtMs < previous.occurredAtMs ||
  (next.occurredAtMs === previous.occurredAtMs &&
    next.eventId < previous.eventId);

export async function getGroupHistoryMonthPageWithReader(
  input: GetGroupHistoryMonthPageInput,
  reader: GroupHistoryBatchReader = readGroupHistoryBatch,
  scanLimit = GROUP_HISTORY_PAGE_SCAN_LIMIT
): Promise<GroupHistoryMonthPage> {
  const normalized = normalizeGroupHistoryMonthQuery(input);
  const events: GroupHistoryEvent[] = [];
  const seen = new Map<string, GroupHistoryEvent>();
  let scanCursor = normalized.cursor;
  let lastReturnedCursor: GroupHistoryCursor | null = null;
  let sourceHasMore = false;
  let scannedDocumentCount = 0;
  let skippedMalformedCount = 0;
  let skippedUnsupportedSchemaCount = 0;
  let duplicateEventCount = 0;
  let conflict = false;
  try {
    while (scannedDocumentCount < scanLimit &&
      events.length <= normalized.pageSize) {
      const batchSize = Math.min(
        GROUP_HISTORY_SCAN_CHUNK_SIZE,
        scanLimit - scannedDocumentCount
      );
      const batch = await reader({
        query: normalized, cursor: scanCursor, limit: batchSize,
      });
      sourceHasMore = batch.sourceHasMore;
      if (!batch.documents.length) break;
      for (const document of batch.documents) {
        scannedDocumentCount += 1;
        const nextCursor = cursorFor(document);
        if (!nextCursor || (scanCursor && !isAfter(scanCursor, nextCursor))) {
          conflict = true;
          break;
        }
        scanCursor = nextCursor;
        if (document.data.schemaVersion !== GROUP_HISTORY_SCHEMA_VERSION) {
          skippedUnsupportedSchemaCount += 1;
          continue;
        }
        const event = mapGroupHistoryEventDoc(
          normalized.groupId, document.id, document.data);
        if (!event) {
          skippedMalformedCount += 1;
          continue;
        }
        const existing = seen.get(event.id);
        if (existing) {
          duplicateEventCount += 1;
          if (existing.occurredAtMs !== event.occurredAtMs ||
            existing.eventType !== event.eventType ||
            existing.sourceEventId !== event.sourceEventId) conflict = true;
          continue;
        }
        seen.set(event.id, event);
        if (normalized.category && event.category !== normalized.category) {
          continue;
        }
        events.push(event);
        if (events.length === normalized.pageSize) {
          lastReturnedCursor = nextCursor;
        }
        if (events.length > normalized.pageSize) break;
      }
      if (conflict || events.length > normalized.pageSize ||
        !sourceHasMore) break;
    }
  } catch (error) {
    throw normalizeGroupHistoryQueryFailure(error);
  }
  const scanLimitReached = scannedDocumentCount >= scanLimit && sourceHasMore &&
    events.length <= normalized.pageSize;
  const hasExtraEvent = events.length > normalized.pageSize;
  const partialReason: GroupHistoryPagePartialReason | null = conflict ?
    "query_conflict" : scanLimitReached ?
      normalized.category ? "category_scan_limit" : "malformed_scan_limit" :
      null;
  const hasMore = hasExtraEvent || scanLimitReached;
  return {
    events: events.slice(0, normalized.pageSize),
    nextCursor: hasMore ?
      (hasExtraEvent ? lastReturnedCursor : scanCursor) : null,
    hasMore,
    requestedPageSize: normalized.pageSize,
    returnedEventCount: Math.min(events.length, normalized.pageSize),
    scannedDocumentCount,
    skippedMalformedCount,
    skippedUnsupportedSchemaCount,
    duplicateEventCount,
    partial: partialReason != null,
    partialReason,
    range: normalized.range,
  };
}

export function getGroupHistoryMonthPage(
  input: GetGroupHistoryMonthPageInput
) {
  return getGroupHistoryMonthPageWithReader(input);
}

export async function getGroupHistoryMonthSummaryWithReader(
  input: Omit<GetGroupHistoryMonthPageInput, "cursor" | "pageSize" | "category">,
  reader: GroupHistoryBatchReader = readGroupHistoryBatch,
  scanLimit = GROUP_HISTORY_SUMMARY_SCAN_LIMIT
): Promise<GroupHistoryMonthSummaryResult> {
  const normalized = normalizeGroupHistoryMonthQuery({
    ...input, pageSize: GROUP_HISTORY_MAX_PAGE_SIZE, category: null,
  });
  const events: GroupHistoryEvent[] = [];
  const seen = new Set<string>();
  let cursor: GroupHistoryCursor | null = null;
  let sourceHasMore = false;
  let scannedDocumentCount = 0;
  let skippedMalformedCount = 0;
  let skippedUnsupportedSchemaCount = 0;
  let duplicateEventCount = 0;
  let completedBatchCount = 0;
  try {
    while (scannedDocumentCount < scanLimit) {
      const batch = await reader({
        query: normalized,
        cursor,
        limit: Math.min(
          GROUP_HISTORY_SCAN_CHUNK_SIZE,
          scanLimit - scannedDocumentCount
        ),
      });
      sourceHasMore = batch.sourceHasMore;
      if (!batch.documents.length) break;
      for (const document of batch.documents) {
        scannedDocumentCount += 1;
        const nextCursor = cursorFor(document);
        if (!nextCursor || (cursor && !isAfter(cursor, nextCursor))) {
          throw new GroupHistoryQueryError("query_conflict");
        }
        cursor = nextCursor;
        if (document.data.schemaVersion !== GROUP_HISTORY_SCHEMA_VERSION) {
          skippedUnsupportedSchemaCount += 1;
          continue;
        }
        const event = mapGroupHistoryEventDoc(
          normalized.groupId, document.id, document.data);
        if (!event) {
          skippedMalformedCount += 1;
          continue;
        }
        if (seen.has(event.id)) {
          duplicateEventCount += 1;
          continue;
        }
        seen.add(event.id);
        events.push(event);
      }
      completedBatchCount += 1;
      if (!sourceHasMore) break;
    }
  } catch (error) {
    if (!completedBatchCount) throw normalizeGroupHistoryQueryFailure(error);
    return {
      ...aggregateGroupHistoryEvents(events, normalized.timeZone),
      complete: false,
      partialReason: "query_failed_after_partial_scan",
      scannedDocumentCount,
      skippedMalformedCount,
      skippedUnsupportedSchemaCount,
      duplicateEventCount,
      range: normalized.range,
    };
  }
  const limitReached = scannedDocumentCount >= scanLimit && sourceHasMore;
  return {
    ...aggregateGroupHistoryEvents(events, normalized.timeZone),
    complete: !limitReached,
    partialReason: limitReached ? "scan_limit_reached" : null,
    scannedDocumentCount,
    skippedMalformedCount,
    skippedUnsupportedSchemaCount,
    duplicateEventCount,
    range: normalized.range,
  };
}

export function getGroupHistoryMonthSummary(
  input: Omit<GetGroupHistoryMonthPageInput, "cursor" | "pageSize" | "category">
) {
  return getGroupHistoryMonthSummaryWithReader(input);
}

export function groupHistoryQueryDiagnostic(input: {
  mode: "page" | "summary";
  result: "completed" | "partial" | "failed";
  reason?: string | null;
  pageSize?: number;
  returnedCount?: number;
  scannedCount?: number;
  malformedCount?: number;
  unsupportedCount?: number;
  duplicateCount?: number;
  complete?: boolean;
}) {
  return {
    mode: input.mode,
    result: input.result,
    reason: input.reason ?? null,
    schemaVersion: GROUP_HISTORY_SCHEMA_VERSION,
    pageSize: input.pageSize ?? null,
    returnedCount: input.returnedCount ?? null,
    scannedCount: input.scannedCount ?? null,
    malformedCount: input.malformedCount ?? null,
    unsupportedCount: input.unsupportedCount ?? null,
    duplicateCount: input.duplicateCount ?? null,
    complete: input.complete ?? null,
  };
}
