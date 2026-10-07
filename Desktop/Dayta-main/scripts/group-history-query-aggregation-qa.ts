import {DateTime} from "luxon";
import {
  aggregateGroupHistoryEvents,
  compareGroupHistoryEvents,
  mergeGroupHistoryEvents,
} from "../services/groupHistoryAggregation";
import {
  getGroupHistoryMonthBounds,
  getGroupHistoryMonthPageWithReader,
  getGroupHistoryMonthSummaryWithReader,
  GroupHistoryQueryError,
  groupHistoryQueryDiagnostic,
  normalizeGroupHistoryMonthQuery,
  type GroupHistoryBatchReader,
  type GroupHistorySourceDocument,
} from "../services/groupHistoryQueries";
import {type GroupHistoryEvent} from "../services/groupHistory";

let checks = 0;
const ok = (condition: unknown, name: string) => {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks += 1;
};
const rejects = (code: string, operation: () => unknown, name: string) => {
  try {
    operation();
  } catch (error) {
    ok(error instanceof GroupHistoryQueryError && error.code === code, name);
    return;
  }
  throw new Error(`FAIL ${name}`);
};
const at = (iso: string) => Date.parse(iso);
const event = (
  id: string,
  occurredAtMs: number,
  eventType: GroupHistoryEvent["eventType"] =
    "shared_subtask_completed"
): GroupHistoryEvent => {
  const routine = eventType === "group_routine_occurrence_completed";
  const task = eventType === "group_task_completed";
  return {
    id, schemaVersion: 1, groupId: "group-query",
    eventType,
    category: routine ? "routines" : task ? "tasks" : "goals",
    occurredAtMs, createdAtMs: occurredAtMs + 1,
    entityType: routine ? "routine_occurrence" :
      task ? "group_task" : "subtask",
    entityId: `${id}-entity`,
    parentEntityType: routine ? "routine" : task ? null : "goal",
    parentEntityId: task ? null : `${id}-parent`,
    sourceEventId: `${id}-source`,
    displayTitle: "Fixture", summary: null,
    actorUid: "actor", actorDisplayName: "Actor",
    creditedMemberUid: null, creditedMemberDisplayName: null,
    visibility: "group_members",
    metadata: routine ?
      {kind: eventType, participantCount: 2} :
      task ? {kind: eventType, claimedByUid: "actor"} :
        {kind: eventType, assignmentUid: null},
  } as GroupHistoryEvent;
};
const stored = (value: GroupHistoryEvent): GroupHistorySourceDocument => {
  const {id, ...data} = value;
  return {id, data};
};
const orderedReader = (
  documents: GroupHistorySourceDocument[],
  failAfterCalls = Number.POSITIVE_INFINITY
): GroupHistoryBatchReader => {
  const ordered = [...documents].sort((left, right) => {
    const time = Number(right.data.occurredAtMs) -
      Number(left.data.occurredAtMs);
    return time || right.id.localeCompare(left.id);
  });
  let calls = 0;
  return async ({cursor, limit}) => {
    calls += 1;
    if (calls > failAfterCalls) throw {code: "unavailable"};
    const start = cursor ? ordered.findIndex((document) =>
      document.id === cursor.eventId &&
      document.data.occurredAtMs === cursor.occurredAtMs) + 1 : 0;
    const documents = ordered.slice(start, start + limit);
    return {
      documents,
      sourceHasMore: start + documents.length < ordered.length,
    };
  };
};

async function main() {
const normalized = normalizeGroupHistoryMonthQuery({
  groupId: " group-query ", year: 2024, month: 3,
  timeZone: "America/New_York",
});
ok(normalized.groupId === "group-query", "valid group ID normalized");
ok(normalized.pageSize === 50, "default page size");
ok(normalized.category === null, "default all categories");
rejects("invalid_group", () => normalizeGroupHistoryMonthQuery({
  groupId: "", year: 2024, month: 1, timeZone: "UTC",
}), "blank group rejected");
rejects("invalid_group", () => normalizeGroupHistoryMonthQuery({
  groupId: "bad/id", year: 2024, month: 1, timeZone: "UTC",
}), "slash group rejected");
rejects("invalid_year", () => getGroupHistoryMonthBounds(1999, 1, "UTC"),
  "invalid year rejected");
rejects("invalid_month", () => getGroupHistoryMonthBounds(2024, 13, "UTC"),
  "invalid month rejected");
rejects("invalid_timezone", () =>
  getGroupHistoryMonthBounds(2024, 1, "Not/AZone"),
"invalid timezone rejected");
rejects("invalid_page_size", () => normalizeGroupHistoryMonthQuery({
  groupId: "group", year: 2024, month: 1, timeZone: "UTC", pageSize: 101,
}), "unbounded page rejected");
rejects("invalid_category", () => normalizeGroupHistoryMonthQuery({
  groupId: "group", year: 2024, month: 1, timeZone: "UTC",
  category: "people" as never,
}), "invalid category rejected");
rejects("invalid_cursor", () => normalizeGroupHistoryMonthQuery({
  groupId: "group", year: 2024, month: 1, timeZone: "UTC",
  cursor: {occurredAtMs: at("2024-02-01T00:00:00Z"), eventId: "event"},
}), "out-of-month cursor rejected");

const january = getGroupHistoryMonthBounds(2024, 1, "UTC");
ok(january.startMs === at("2024-01-01T00:00:00Z"), "January start");
ok(january.endExclusiveMs === at("2024-02-01T00:00:00Z"),
  "January exclusive end");
const december = getGroupHistoryMonthBounds(2024, 12, "UTC");
ok(december.endExclusiveMs === at("2025-01-01T00:00:00Z"),
  "December rollover");
ok(getGroupHistoryMonthBounds(2024, 2, "UTC").endExclusiveMs -
  getGroupHistoryMonthBounds(2024, 2, "UTC").startMs === 29 * 86400000,
"leap February");
ok(getGroupHistoryMonthBounds(2023, 2, "UTC").endExclusiveMs -
  getGroupHistoryMonthBounds(2023, 2, "UTC").startMs === 28 * 86400000,
"non-leap February");
const spring = getGroupHistoryMonthBounds(2024, 3, "America/New_York");
ok(spring.endExclusiveMs - spring.startMs === 31 * 86400000 - 3600000,
  "spring DST month");
const fall = getGroupHistoryMonthBounds(2024, 11, "America/New_York");
ok(fall.endExclusiveMs - fall.startMs === 30 * 86400000 + 3600000,
  "fall DST month");
ok(getGroupHistoryMonthBounds(2024, 1, "Asia/Kathmandu").startMs ===
  at("2023-12-31T18:15:00Z"), "non-hour offset");

const marchTime = at("2024-03-10T16:00:00Z");
const docs = [
  stored(event("z", marchTime)),
  stored(event("y", marchTime)),
  stored(event("x", marchTime - 1,
    "group_routine_occurrence_completed")),
];
const first = await getGroupHistoryMonthPageWithReader({
  groupId: "group-query", year: 2024, month: 3,
  timeZone: "UTC", pageSize: 2,
}, orderedReader(docs));
ok(first.events.map((item) => item.id).join(",") === "z,y",
  "descending equal-time ID order");
ok(first.hasMore && first.nextCursor?.eventId === "y", "first page cursor");
const second = await getGroupHistoryMonthPageWithReader({
  groupId: "group-query", year: 2024, month: 3,
  timeZone: "UTC", pageSize: 2, cursor: first.nextCursor,
}, orderedReader(docs));
ok(second.events.length === 1 && second.events[0].id === "x",
  "cursor resumes without overlap");
ok(!second.hasMore && second.nextCursor === null, "final page semantics");

const malformed = {id: "w", data: {
  ...stored(event("w", marchTime - 2)).data, category: "wrong",
}};
const unsupported = {id: "v", data: {
  ...stored(event("v", marchTime - 3)).data, schemaVersion: 2,
}};
const filtered = await getGroupHistoryMonthPageWithReader({
  groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
  pageSize: 2, category: "routines",
}, orderedReader([...docs, malformed, unsupported]));
ok(filtered.events.length === 1 &&
  filtered.events[0].category === "routines", "service category filtering");
ok(filtered.skippedMalformedCount === 1, "malformed counted");
ok(filtered.skippedUnsupportedSchemaCount === 1, "unsupported counted");
const partial = await getGroupHistoryMonthPageWithReader({
  groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
  pageSize: 2, category: "tasks",
}, orderedReader([...docs, malformed, unsupported]), 2);
ok(partial.partial && partial.partialReason === "category_scan_limit",
  "category scan bounded");
ok(partial.nextCursor != null, "partial advances last-scanned cursor");

const summary = aggregateGroupHistoryEvents([
  event("one", at("2024-03-01T01:00:00Z")),
  event("two", at("2024-03-01T23:00:00Z"),
    "group_routine_occurrence_completed"),
  event("three", at("2024-03-02T01:00:00Z"), "group_task_completed"),
  event("one", at("2024-03-01T01:00:00Z")),
], "America/New_York");
ok(summary.summary.totalEvents === 3, "duplicates excluded from total");
ok(summary.duplicateEventCount === 1, "duplicates counted");
ok(summary.summary.sharedSubtaskCompletedCount === 1, "subtask count");
ok(summary.summary.routineOccurrenceCompletedCount === 1, "routine count");
ok(summary.summary.groupTaskCompletedCount === 1, "registered task count");
ok(summary.summary.activeLocalDayCount === 2, "timezone local active days");
ok(JSON.stringify(summary) === JSON.stringify(aggregateGroupHistoryEvents([
  event("one", at("2024-03-01T01:00:00Z")),
  event("two", at("2024-03-01T23:00:00Z"),
    "group_routine_occurrence_completed"),
  event("three", at("2024-03-02T01:00:00Z"), "group_task_completed"),
  event("one", at("2024-03-01T01:00:00Z")),
], "America/New_York")), "aggregation deterministic");
ok(compareGroupHistoryEvents(event("z", marchTime), event("y", marchTime)) < 0,
  "ordering helper tie-break");
const merged = mergeGroupHistoryEvents(
  [event("same", marchTime)],
  [event("same", marchTime + 1)]
);
ok(merged.conflict && merged.duplicateEventCount === 1,
  "contradictory merge detected");

const fullSummary = await getGroupHistoryMonthSummaryWithReader({
  groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
}, orderedReader(docs), 10);
ok(fullSummary.complete && fullSummary.summary.totalEvents === 3,
  "complete full-month summary");
const cappedSummary = await getGroupHistoryMonthSummaryWithReader({
  groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
}, orderedReader(docs), 2);
ok(!cappedSummary.complete &&
  cappedSummary.partialReason === "scan_limit_reached",
"summary scan cap explicit");
const manyDocs = Array.from({length: 101}, (_, index) =>
  stored(event(`many-${String(index).padStart(3, "0")}`,
    marchTime - index)));
const lateFailure = await getGroupHistoryMonthSummaryWithReader({
  groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
}, orderedReader(manyDocs, 1), 200);
ok(!lateFailure.complete &&
  lateFailure.partialReason === "query_failed_after_partial_scan",
"late summary failure returns partial");
let initialFailed = false;
try {
  await getGroupHistoryMonthSummaryWithReader({
    groupId: "group-query", year: 2024, month: 3, timeZone: "UTC",
  }, orderedReader(docs, 0), 10);
} catch (error) {
  initialFailed = error instanceof GroupHistoryQueryError &&
    error.code === "query_failed" && error.retryable;
}
ok(initialFailed, "initial query failure normalized");
const diagnostic = groupHistoryQueryDiagnostic({
  mode: "page", result: "partial", reason: "category_scan_limit",
  pageSize: 2, returnedCount: 0, scannedCount: 2,
});
ok(!JSON.stringify(diagnostic).includes("group-query"),
  "diagnostic excludes group ID");
ok(!JSON.stringify(diagnostic).includes("actor"), "diagnostic excludes actor");

for (const size of [0, 1, 25, 50, 100, 250, 500, 1000, 2000, 5000]) {
  const generated = Array.from({length: size}, (_, index) =>
    event(`perf-${index}`, DateTime.fromISO("2024-03-01T00:00:00Z")
      .plus({minutes: index}).toMillis()));
  const result = aggregateGroupHistoryEvents(generated, "UTC");
  ok(result.summary.totalEvents === size, `stress aggregation ${size}`);
}

console.log(`Group History query/aggregation QA passed (${checks} checks).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
