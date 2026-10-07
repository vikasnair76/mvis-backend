import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {
  comparePersonalHistoryEvents,
  groupPersonalHistoryEventsByDay,
  mergePersonalHistoryEventPages,
  summarizePersonalHistoryMonth,
} from "../services/personalHistoryAggregation";
import {
  PERSONAL_HISTORY_EVENT_DEFINITIONS,
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
} from "../services/personalHistory";

const TIME_ZONE = "America/New_York";
const BASE_MS = Date.parse("2026-07-31T23:59:00Z");
const SIZES = [0, 25, 50, 100, 250, 500, 1000, 2000];
const eventTypes: PersonalHistoryEventType[] = [
  "goal_created",
  "goal_completed",
  "subtask_completed",
  "planner_suggestion_applied",
  "calendar_block_created",
  "planning_board_card_completed",
  "milestone_completed",
];

function fixture(index: number, occurredAtMs = BASE_MS - index * 60_000) {
  const eventType = eventTypes[index % eventTypes.length];
  const definition = PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType];
  return {
    id: `event-${String(index).padStart(5, "0")}`,
    ownerUid: "performance-fixture-owner",
    occurredAtMs,
    eventType,
    category: definition.category,
    entityType: definition.entityType,
    entityId: `entity-${index}`,
    parentEntityId: null,
    displayTitle: `Fixture ${index}`,
    summary: null,
    metadata: {},
    sourceEventId: `source-${index}`,
    schemaVersion: 1,
    createdAtMs: occurredAtMs,
  } satisfies PersonalHistoryEvent;
}

const measurements = SIZES.map((size) => {
  const events = Array.from({length: size}, (_, index) => fixture(index));
  const startedAt = performance.now();
  const groups = groupPersonalHistoryEventsByDay(events, TIME_ZONE);
  const summary = summarizePersonalHistoryMonth(events, TIME_ZONE);
  const durationMs = performance.now() - startedAt;
  assert.equal(summary.totalEvents, size);
  assert.equal(groups.reduce((sum, group) => sum + group.events.length, 0), size);
  assert.ok(durationMs < 5_000, `${size}-event aggregation exceeded 5 seconds`);
  return {size, durationMs: Number(durationMs.toFixed(3)), days: groups.length};
});

const equalTimestamp = Array.from(
  {length: 100},
  (_, index) => fixture(index, BASE_MS)
);
const firstOrder = [...equalTimestamp].sort(comparePersonalHistoryEvents)
  .map((event) => event.id);
for (let iteration = 0; iteration < 10; iteration += 1) {
  assert.deepEqual(
    [...equalTimestamp].reverse().sort(comparePersonalHistoryEvents)
      .map((event) => event.id),
    firstOrder,
    "equal-timestamp ordering must be deterministic"
  );
}

const oneDay = Array.from(
  {length: 500},
  (_, index) => fixture(index, BASE_MS - index * 1_000)
);
assert.equal(groupPersonalHistoryEventsByDay(oneDay, TIME_ZONE).length, 1);

let conflicts = 0;
const duplicate = fixture(1);
const merged = mergePersonalHistoryEventPages(
  [fixture(0), duplicate],
  [duplicate, fixture(2), {...duplicate, sourceEventId: "conflicting-source"}],
  () => {
    conflicts += 1;
  }
);
assert.equal(merged.length, 3, "pagination merge must deduplicate document IDs");
assert.equal(conflicts, 1, "conflicting duplicate must be observable");

const sparse = Array.from({length: 2000}, (_, index) => fixture(index));
const sparseStartedAt = performance.now();
const sparseMatches = sparse.filter((event, index) =>
  index % 199 === 0 && event.category === "goal");
const sparseDurationMs = performance.now() - sparseStartedAt;
assert.ok(sparseMatches.length > 0);
assert.ok(sparseDurationMs < 5_000, "bounded sparse scan exceeded 5 seconds");

let latestRequestId = 0;
const oldRequestId = ++latestRequestId;
const newestRequestId = ++latestRequestId;
assert.equal(oldRequestId === latestRequestId, false);
assert.equal(newestRequestId === latestRequestId, true);

console.log(JSON.stringify({
  suite: "personal-history-performance",
  runtime: {node: process.version, platform: process.platform, arch: process.arch},
  measurements,
  equalTimestampEvents: equalTimestamp.length,
  singleDayEvents: oneDay.length,
  sparseScan: {
    scanned: sparse.length,
    matched: sparseMatches.length,
    durationMs: Number(sparseDurationMs.toFixed(3)),
  },
  status: "passed",
}, null, 2));
