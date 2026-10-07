import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  buildPersonalHistoryEventId,
  getPersonalHistoryMonthBounds,
  mapPersonalHistoryEventDoc,
  normalizePersonalHistoryMetadata,
  PERSONAL_HISTORY_CATEGORIES,
  PERSONAL_HISTORY_ENTITY_TYPES,
  PERSONAL_HISTORY_EVENT_TYPES,
} from "../services/personalHistory";

let checks = 0;
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value: unknown, message: string) => {
  assert.ok(value, message); checks += 1;
};
const fixture = (patch: Record<string, unknown> = {}) => ({
  ownerUid: "owner", occurredAtMs: Date.parse("2026-07-04T16:00:00Z"),
  eventType: "goal_completed", category: "goal", entityType: "goal",
  entityId: "goal-1", parentEntityId: null, displayTitle: "Finish launch",
  summary: "Goal completed.", metadata: {completionSource: "manual"},
  sourceEventId: "goal-1:completed:1", schemaVersion: 1,
  createdAtMs: Date.parse("2026-07-04T16:00:00Z"), ...patch,
});

eq(PERSONAL_HISTORY_CATEGORIES.length, 8, "bounded categories");
ok(PERSONAL_HISTORY_ENTITY_TYPES.includes("planner_suggestion"),
  "planner entity supported");
for (const eventType of [
  "goal_created", "goal_completed", "goal_archived", "goal_restored",
  "subtask_completed", "planner_suggestion_applied",
  "planner_calendar_block_created", "calendar_block_created",
  "planning_board_card_completed", "routine_completed",
  "milestone_completed",
]) ok(PERSONAL_HISTORY_EVENT_TYPES.includes(eventType as never),
  `${eventType} canonical`);

const mapped = mapPersonalHistoryEventDoc("history-1", fixture());
ok(mapped, "valid event maps");
eq(mapped?.displayTitle, "Finish launch", "bounded title preserved");
eq(mapped?.metadata.completionSource, "manual", "bounded metadata preserved");
eq(mapPersonalHistoryEventDoc("bad", fixture({eventType: "scored"})), null,
  "unknown event rejected");
eq(mapPersonalHistoryEventDoc("bad", fixture({category: "calendar"})), null,
  "event category mismatch rejected");
eq(mapPersonalHistoryEventDoc("bad", fixture({entityType: "subtask"})), null,
  "event entity mismatch rejected");
eq(mapPersonalHistoryEventDoc("bad", fixture({schemaVersion: 2})), null,
  "unknown schema rejected");
eq(mapPersonalHistoryEventDoc("bad", fixture({ownerUid: ""})), null,
  "owner required");
eq(mapPersonalHistoryEventDoc("bad", fixture({occurredAtMs: Infinity})), null,
  "finite occurrence required");
eq(normalizePersonalHistoryMetadata({payload: {secret: true}}), null,
  "nested payload rejected");
eq(normalizePersonalHistoryMetadata({notes: Array(3).fill("private")}), null,
  "arrays rejected");
eq(normalizePersonalHistoryMetadata(Object.fromEntries(
  Array.from({length: 11}, (_, index) => [`key${index}`, index]))), null,
"metadata key cap");

const july = getPersonalHistoryMonthBounds("2026-07", "America/New_York");
eq(july.startAtMs, Date.parse("2026-07-01T04:00:00Z"),
  "local month start is timezone aware");
eq(july.endAtMs, Date.parse("2026-08-01T04:00:00Z"),
  "local month end is exclusive");
const november = getPersonalHistoryMonthBounds(
  "2026-11", "America/New_York");
eq(november.startAtMs, Date.parse("2026-11-01T04:00:00Z"),
  "DST month starts in EDT");
eq(november.endAtMs, Date.parse("2026-12-01T05:00:00Z"),
  "DST month ends in EST");
assert.throws(() => getPersonalHistoryMonthBounds(
  "2026-13", "America/New_York")); checks += 1;

const firstId = buildPersonalHistoryEventId("owner", "goal-1:completed:1");
eq(firstId, buildPersonalHistoryEventId("owner", "goal-1:completed:1"),
  "history identity deterministic");
ok(firstId !== buildPersonalHistoryEventId("owner", "goal-1:completed:2"),
  "different source transition has different identity");
ok(firstId !== buildPersonalHistoryEventId("other", "goal-1:completed:1"),
  "owner participates in identity");

const service = readFileSync("services/personalHistory.ts", "utf8");
const queryService = readFileSync(
  "services/personalHistoryQueries.ts", "utf8");
ok(queryService.includes(
  "collection(db, \"users\", normalized.ownerUid, \"historyEvents\")"),
  "user-owned history collection");
ok(queryService.includes("where(\"occurredAtMs\", \">=\", range.startAtMs)") &&
  queryService.includes("where(\"occurredAtMs\", \"<\", range.endAtMs)"),
"month query is half-open and bounded");
ok(queryService.includes("limit(pageSize)"), "pagination has strict limit");
ok(queryService.includes(
  "startAfter(cursor.occurredAtMs, cursor.eventId)"),
"pagination uses stable value cursor");
ok(!service.includes("setDoc(") && !service.includes("addDoc(") &&
  !service.includes("updateDoc(") && !service.includes("deleteDoc("),
"foundation exposes no client writer");

console.log(`Personal History foundation QA passed (${checks} checks).`);
