import assert from "node:assert/strict";
import {
  groupPersonalHistoryEventsByDay,
  summarizePersonalHistoryMonth,
} from "../services/personalHistoryAggregation";
import {
  getPersonalHistoryMonthPage,
  getPersonalHistoryMonthSummary,
  normalizePersonalHistoryMonthQuery,
  PersonalHistoryQueryError,
  PERSONAL_HISTORY_QUERY_SCAN_LIMIT,
} from "../services/personalHistoryQueries";
import {
  PERSONAL_HISTORY_EVENT_DEFINITIONS,
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
} from "../services/personalHistory";
import * as firebaseService from "../services/firebase";
import {doc, setDoc, writeBatch} from "firebase/firestore";
import type {RulesTestEnvironment} from "@firebase/rules-unit-testing";

const {qaTestEnv} = firebaseService as unknown as {
  qaTestEnv: RulesTestEnvironment;
};

let checks = 0;
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value: unknown, message: string) => {
  assert.ok(value, message); checks += 1;
};
const rejectsCode = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error) =>
    error instanceof PersonalHistoryQueryError && error.code === code);
  checks += 1;
};
const event = (
  id: string,
  occurredAtMs: number,
  eventType: PersonalHistoryEventType = "goal_completed"
): PersonalHistoryEvent => {
  const definition = PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType];
  return {
    id, ownerUid: "owner", occurredAtMs, eventType,
    category: definition.category, entityType: definition.entityType,
    entityId: `entity-${id}`, parentEntityId: null,
    displayTitle: id, summary: null, metadata: {},
    sourceEventId: `source-${id}`, schemaVersion: 1,
    createdAtMs: occurredAtMs,
  };
};

const ranges = [
  [2026, 1, "UTC", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"],
  [2025, 2, "UTC", "2025-02-01T00:00:00.000Z", "2025-03-01T00:00:00.000Z"],
  [2024, 2, "UTC", "2024-02-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z"],
  [2026, 4, "UTC", "2026-04-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"],
  [2026, 12, "UTC", "2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
] as const;
for (const [year, month, timeZone, start, end] of ranges) {
  const normalized = normalizePersonalHistoryMonthQuery({
    ownerUid: "owner", year, month, timeZone,
  });
  eq(normalized.range.startAtMs, Date.parse(start), `${year}-${month} start`);
  eq(normalized.range.endAtMs, Date.parse(end), `${year}-${month} next start`);
}
const spring = normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 3, timeZone: "America/New_York",
});
eq(spring.range.endAtMs - spring.range.startAtMs, 743 * 60 * 60_000,
  "spring DST month is 743 hours");
const fall = normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 11, timeZone: "America/New_York",
});
eq(fall.range.endAtMs - fall.range.startAtMs, 721 * 60 * 60_000,
  "fall DST month is 721 hours");
const kathmandu = normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 7, timeZone: "Asia/Kathmandu",
});
eq(kathmandu.range.startAtMs, Date.parse("2026-06-30T18:15:00Z"),
  "quarter-hour timezone supported");

rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "", year: 2026, month: 7, timeZone: "UTC",
}), "invalid_owner");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 13, timeZone: "UTC",
}), "invalid_month");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 1800, month: 1, timeZone: "UTC",
}), "invalid_month");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 7, timeZone: "Mars/Olympus",
}), "invalid_timezone");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 7, timeZone: "UTC", pageSize: 101,
}), "invalid_page_size");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 7, timeZone: "UTC",
  categories: ["goal"], eventTypes: ["subtask_completed"],
}), "invalid_filter");
rejectsCode(() => normalizePersonalHistoryMonthQuery({
  ownerUid: "owner", year: 2026, month: 7, timeZone: "UTC",
  cursor: {occurredAtMs: Date.parse("2026-08-01T00:00:00Z"), eventId: "x"},
}), "invalid_cursor");

const instant = Date.parse("2026-07-01T00:30:00Z");
const source = [
  event("a", instant),
  event("z", instant),
  event("older", instant - 60_000, "subtask_completed"),
];
const sourceCopy = [...source];
const utcGroups = groupPersonalHistoryEventsByDay(source, "UTC");
const pacificGroups = groupPersonalHistoryEventsByDay(
  source, "America/Los_Angeles");
eq(utcGroups[0].dayKey, "2026-07-01", "UTC local day");
eq(pacificGroups[0].dayKey, "2026-06-30", "same instant changes local day");
eq(utcGroups[0].events.map((item) => item.id), ["z", "a", "older"],
  "equal timestamps use descending event ID");
eq(source, sourceCopy, "grouping does not mutate source array");
const summary = summarizePersonalHistoryMonth([
  event("g1", instant, "goal_created"),
  event("g2", instant, "goal_completed"),
  event("s", instant - 86_400_000, "subtask_completed"),
  event("p", instant, "planner_suggestion_applied"),
  event("c", instant, "calendar_block_created"),
  event("b", instant, "planning_board_card_completed"),
  event("m", instant, "milestone_completed"),
  event("r", instant, "routine_completed"),
], "UTC");
eq(summary.totalEvents, 8, "summary total");
eq(summary.goalCreatedCount, 1, "goal creation count");
eq(summary.goalCompletedCount, 1, "goal completion count");
eq(summary.subtaskCompletedCount, 1, "subtask count");
eq(summary.plannerAppliedCount, 1, "planner count");
eq(summary.calendarBlockCreatedCount, 1, "calendar count");
eq(summary.boardCardCompletedCount, 1, "board count");
eq(summary.milestoneCompletedCount, 1, "milestone count");
eq(summary.routineCompletedCount, 1, "routine count");
eq(summary.activeDayCount, 2, "active local day count");

const ownerUid = "owner";
const base = Date.parse("2026-07-20T12:00:00Z");
await qaTestEnv.withSecurityRulesDisabled(async (context) => {
  const adminDb = context.firestore();
  const writes: Promise<void>[] = [];
  for (let index = 0; index < 125; index += 1) {
    const eventType: PersonalHistoryEventType =
      index % 10 === 0 ? "subtask_completed" : "goal_completed";
    const item = event(`query-${String(index).padStart(3, "0")}`,
      base - Math.floor(index / 5) * 1000, eventType);
    writes.push(setDoc(
      doc(adminDb, "users", ownerUid, "historyEvents", item.id), item));
  }
  writes.push(setDoc(
    doc(adminDb, "users", ownerUid, "historyEvents", "malformed"), {
      ownerUid, occurredAtMs: base - 500, eventType: "unknown", schemaVersion: 9,
    }));
  writes.push(setDoc(
    doc(adminDb, "users", ownerUid, "historyEvents", "next-month"), {
      ...event("next-month", Date.parse("2026-08-01T00:00:00Z")),
    }));
  await Promise.all(writes);
});

const first = await getPersonalHistoryMonthPage({
  ownerUid, year: 2026, month: 7, timeZone: "UTC", pageSize: 17,
});
eq(first.events.length, 17, "page is filled");
ok(first.hasMore && first.nextCursor, "first page has serializable cursor");
eq(first.events.slice(0, 5).map((item) => item.id),
  ["query-004", "query-003", "query-002", "query-001", "query-000"],
  "compound ordering is stable");
const second = await getPersonalHistoryMonthPage({
  ownerUid, year: 2026, month: 7, timeZone: "UTC", pageSize: 17,
  cursor: first.nextCursor,
});
eq(second.events.length, 17, "second page is filled");
eq(new Set([...first.events, ...second.events].map((item) => item.id)).size,
  34, "equal timestamp boundary has no duplicate or skip");
const filtered = await getPersonalHistoryMonthPage({
  ownerUid, year: 2026, month: 7, timeZone: "UTC", pageSize: 10,
  categories: ["subtask"], eventTypes: ["subtask_completed"],
});
eq(filtered.events.length, 10, "filtered scan fills across source pages");
ok(filtered.scannedEventCount > filtered.events.length,
  "filtering scans bounded source pages");
const noMatches = await getPersonalHistoryMonthPage({
  ownerUid, year: 2026, month: 7, timeZone: "UTC", pageSize: 10,
  categories: ["calendar"],
});
eq(noMatches.events.length, 0, "no-match filter returns empty");
eq(noMatches.hasMore, false, "no-match scan reaches month end");
ok(noMatches.invalidEventCount >= 1, "malformed event counted and excluded");
const monthSummary = await getPersonalHistoryMonthSummary({
  ownerUid, year: 2026, month: 7, timeZone: "UTC",
});
eq(monthSummary.summary.totalEvents, 125, "summary spans all source pages");
eq(monthSummary.summaryComplete, true, "bounded month summary is complete");
eq(PERSONAL_HISTORY_QUERY_SCAN_LIMIT, 2000, "explicit scan ceiling");

await qaTestEnv.withSecurityRulesDisabled(async (context) => {
  const adminDb = context.firestore();
  for (let offset = 0; offset < 2001; offset += 500) {
    const batch = writeBatch(adminDb);
    for (let index = offset; index < Math.min(offset + 500, 2001); index += 1) {
      const item = event(`ceiling-${String(index).padStart(4, "0")}`,
        Date.parse("2026-08-20T12:00:00Z") - index);
      batch.set(doc(adminDb, "users", ownerUid, "historyEvents", item.id), item);
    }
    await batch.commit();
  }
});
const limitedSummary = await getPersonalHistoryMonthSummary({
  ownerUid, year: 2026, month: 8, timeZone: "UTC",
});
eq(limitedSummary.scannedEventCount, 2000, "summary stops at scan ceiling");
eq(limitedSummary.summaryComplete, false,
  "ceiling-limited summary is never reported complete");

const benchmarkEvents = Array.from({length: 1000}, (_, index) =>
  event(`benchmark-${index}`, base - index * 60_000,
    index % 2 ? "goal_completed" : "subtask_completed"));
const benchmarkStarted = performance.now();
groupPersonalHistoryEventsByDay(benchmarkEvents, "America/New_York");
summarizePersonalHistoryMonth(benchmarkEvents, "America/New_York");
ok(performance.now() - benchmarkStarted < 1000,
  "1,000-event grouping and summary complete under one second");

await qaTestEnv.cleanup();
console.log(`Personal History query QA passed (${checks} checks).`);
