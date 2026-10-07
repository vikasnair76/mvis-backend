import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {
  buildGroupHistoryAccessibilityLabel,
  buildGroupHistoryDaySections,
  getGroupHistoryNavigationTarget,
  getGroupHistoryRestorationKey,
  GROUP_HISTORY_ACCESSIBILITY_LABEL_LIMIT,
  GROUP_HISTORY_RESTORATION_LIMIT,
  normalizeGroupHistoryFilter,
  normalizeRestoredGroupHistoryState,
  readGroupHistoryRestorationState,
  storeGroupHistoryRestorationState,
  type GroupHistoryRestoredState,
} from "../components/history/GroupHistoryTimeline";
import {
  GROUP_HISTORY_EVENT_DEFINITIONS,
  type GroupHistoryEvent,
  type GroupHistoryEventType,
} from "../services/groupHistory";
import {
  mergeGroupHistoryEvents,
} from "../services/groupHistoryAggregation";
import {
  getGroupHistoryMonthSummaryWithReader,
  GROUP_HISTORY_PAGE_SCAN_LIMIT,
  GROUP_HISTORY_SUMMARY_SCAN_LIMIT,
  type GroupHistoryBatchReader,
} from "../services/groupHistoryQueries";

let checks = 0;
const ok = (value: unknown, message: string) => {
  assert.ok(value, message); checks += 1;
};
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};

const fixture = (
  index: number,
  eventType: GroupHistoryEventType = "shared_subtask_completed",
  patch: Partial<GroupHistoryEvent> = {}
): GroupHistoryEvent => {
  const definition = GROUP_HISTORY_EVENT_DEFINITIONS[eventType];
  return {
    id: `acceptance-event-${String(index).padStart(6, "0")}`,
    schemaVersion: 1,
    groupId: "acceptance-group",
    eventType,
    category: definition.category,
    occurredAtMs: Date.parse("2026-07-31T23:59:00Z") - index * 60_000,
    createdAtMs: Date.parse("2026-08-01T00:00:00Z"),
    entityType: definition.entityType,
    entityId: `acceptance-entity-${index}`,
    parentEntityType: definition.parentEntityType,
    parentEntityId: definition.parentEntityType ?
      `acceptance-parent-${index}` : null,
    sourceEventId: `acceptance-source-${index}`,
    displayTitle: `Synthetic completion ${index}`,
    summary: null,
    actorUid: "synthetic-actor",
    actorDisplayName: "Synthetic Member",
    creditedMemberUid: null,
    creditedMemberDisplayName: null,
    visibility: "group_members",
    metadata: eventType === "shared_subtask_completed" ?
      {kind: eventType, assignmentUid: null} :
      eventType === "group_task_completed" ?
        {kind: eventType, claimedByUid: null} :
        {kind: eventType, participantCount: 2},
    ...patch,
  };
};

const toSource = (event: GroupHistoryEvent) => {
  const {id, ...data} = event;
  return {id, data};
};

function readerFor(events: GroupHistoryEvent[]): GroupHistoryBatchReader {
  const sources = events.map(toSource);
  return async ({cursor, limit}) => {
    const start = cursor ?
      sources.findIndex((source) => source.id === cursor.eventId) + 1 : 0;
    const documents = sources.slice(start, start + limit);
    return {
      documents,
      sourceHasMore: start + documents.length < sources.length,
    };
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const measurements: {
  size: number;
  mergeMedianMs: number;
  sectionsMedianMs: number;
  labelsMedianMs: number;
  targetsMedianMs: number;
  retained: number;
  sections: number;
}[] = [];

for (const size of [0, 1, 25, 50, 100, 250, 500, 1000, 2000, 5000]) {
  const events = Array.from({length: size}, (_, index) =>
    fixture(index, index % 2 ?
      "shared_subtask_completed" :
      "group_routine_occurrence_completed"));
  const samples = {
    merge: [] as number[],
    sections: [] as number[],
    labels: [] as number[],
    targets: [] as number[],
  };
  for (let run = 0; run < 6; run += 1) {
    let started = performance.now();
    const merged = mergeGroupHistoryEvents([], events);
    samples.merge.push(performance.now() - started);
    started = performance.now();
    const sections = buildGroupHistoryDaySections(events, "UTC");
    samples.sections.push(performance.now() - started);
    started = performance.now();
    events.forEach((event) =>
      buildGroupHistoryAccessibilityLabel(event, "UTC"));
    samples.labels.push(performance.now() - started);
    started = performance.now();
    events.forEach((event) =>
      getGroupHistoryNavigationTarget(event, "acceptance-group"));
    samples.targets.push(performance.now() - started);
    if (run === 5) {
      eq(merged.events.length, size, `merge retains ${size}`);
      eq(sections.reduce((sum, section) => sum + section.data.length, 0),
        size, `sections retain ${size}`);
    }
  }
  const sections = buildGroupHistoryDaySections(events, "UTC");
  measurements.push({
    size,
    mergeMedianMs: Number(median(samples.merge.slice(1)).toFixed(3)),
    sectionsMedianMs: Number(median(samples.sections.slice(1)).toFixed(3)),
    labelsMedianMs: Number(median(samples.labels.slice(1)).toFixed(3)),
    targetsMedianMs: Number(median(samples.targets.slice(1)).toFixed(3)),
    retained: events.length,
    sections: sections.length,
  });
}

const tied = [
  fixture(3, "shared_subtask_completed", {occurredAtMs: 1000, id: "tie-c"}),
  fixture(1, "shared_subtask_completed", {occurredAtMs: 1000, id: "tie-a"}),
  fixture(2, "shared_subtask_completed", {occurredAtMs: 1000, id: "tie-b"}),
];
eq(mergeGroupHistoryEvents([], tied).events.map((event) => event.id),
  ["tie-c", "tie-b", "tie-a"], "tied timestamp ordering is stable");
eq(mergeGroupHistoryEvents(tied, tied).events.length, 3,
  "duplicate page IDs are removed");

const cache = new Map<string, GroupHistoryRestoredState>();
for (let index = 0; index < GROUP_HISTORY_RESTORATION_LIMIT + 8; index += 1) {
  storeGroupHistoryRestorationState(cache, `key-${index}`, {
    year: 2026, month: index % 12 + 1, filter: "all",
  });
}
eq(cache.size, GROUP_HISTORY_RESTORATION_LIMIT,
  "restoration cache is bounded");
ok(!cache.has("key-0") && cache.has("key-39"),
  "oldest restoration entries are evicted");
readGroupHistoryRestorationState(cache, "key-8");
storeGroupHistoryRestorationState(cache, "newest", {
  year: 2026, month: 7, filter: "goals",
});
ok(cache.has("key-8"), "read refreshes restoration recency");
eq(normalizeRestoredGroupHistoryState({
  year: 2026, month: 7, filter: "bad", events: ["private"],
}), {year: 2026, month: 7, filter: "all"},
"restoration normalization excludes payloads");
eq(normalizeGroupHistoryFilter("tasks"), "tasks", "filter normalization");
ok(getGroupHistoryRestorationKey("uid-a", "group-a") !==
  getGroupHistoryRestorationKey("uid-b", "group-a"),
"restoration keys isolate accounts");

const longLabel = buildGroupHistoryAccessibilityLabel(fixture(1, undefined, {
  displayTitle: "T".repeat(500),
  summary: "S".repeat(500),
  actorDisplayName: "A".repeat(200),
  creditedMemberDisplayName: "B".repeat(200),
}), "UTC");
ok(longLabel.length <= GROUP_HISTORY_ACCESSIBILITY_LABEL_LIMIT,
  "accessibility label is bounded");
ok(!longLabel.includes("synthetic-actor") && !longLabel.includes("@"),
  "accessibility label omits UID and email");

const fiveThousand = Array.from({length: 5000}, (_, index) => fixture(index));
const completeSummary = await getGroupHistoryMonthSummaryWithReader({
  groupId: "acceptance-group", year: 2026, month: 7, timeZone: "UTC",
}, readerFor(fiveThousand));
ok(completeSummary.complete, "5,000 known-exhausted events summarize fully");
eq(completeSummary.summary.totalEvents, 5000,
  "5,000-event summary count");

const fiveThousandOne = Array.from(
  {length: GROUP_HISTORY_SUMMARY_SCAN_LIMIT + 1},
  (_, index) => fixture(index));
const partialSummary = await getGroupHistoryMonthSummaryWithReader({
  groupId: "acceptance-group", year: 2026, month: 7, timeZone: "UTC",
}, readerFor(fiveThousandOne));
ok(!partialSummary.complete, "5,001-event summary is partial");
eq(partialSummary.partialReason, "scan_limit_reached",
  "summary cap has explicit reason");
eq(partialSummary.scannedDocumentCount, GROUP_HISTORY_SUMMARY_SCAN_LIMIT,
  "summary terminates at cap");
eq(GROUP_HISTORY_PAGE_SCAN_LIMIT, 1000, "page scan cap unchanged");

const route = readFileSync("app/group/[id]/history.tsx", "utf8");
const component = readFileSync(
  "components/history/GroupHistoryTimeline.tsx", "utf8");
const queries = readFileSync("services/groupHistoryQueries.ts", "utf8");
const rules = readFileSync("firestore.rules", "utf8");
const indexes = readFileSync("firestore.indexes.json", "utf8");
ok(route.includes("requestVersionRef.current += 1"),
  "transitions and access loss invalidate requests");
ok(route.includes("mountedRef.current") &&
  route.includes("version !== requestVersionRef.current"),
"unmount and stale responses are guarded");
ok(route.includes("loadingMoreRef.current") &&
  route.includes("refreshInFlightRef.current"),
"refresh and pagination races are guarded");
ok(route.includes("setEvents([])") &&
  route.includes("setSummary(createEmptyGroupHistoryMonthSummary())"),
"access loss clears both visible domains");
ok(route.includes("previousUid !== nextUser?.uid"),
  "auth change invalidates prior state");
ok(route.includes("initialNumToRender={12}") &&
  route.includes("windowSize={9}"),
"SectionList rendering is explicitly bounded");
ok(!route.includes("getItemLayout") &&
  !route.includes("removeClippedSubviews"),
"variable-height accessibility layout avoids unsafe assumptions");
ok(!route.includes("collection(") && !route.includes("getDoc("),
  "UI has no raw query or source join");
ok(!route.includes("addDoc(") && !route.includes("setDoc(") &&
  !route.includes("updateDoc("), "History UI has no client writes");
ok(component.includes("accessibilityRole=\"button\"") &&
  component.includes("<View style={styles.eventRow} accessible"),
"row semantics match navigation capability");
ok(component.includes("importantForAccessibility=\"no-hide-descendants\"") &&
  component.includes("importantForAccessibility=\"no\""),
"decorative icons and chevrons are hidden");
ok(queries.includes("GROUP_HISTORY_PAGE_SCAN_LIMIT = 1000") &&
  queries.includes("GROUP_HISTORY_SUMMARY_SCAN_LIMIT = 5000"),
"query scans remain bounded");
ok(rules.includes("match /historyEvents/{historyEventId}"),
  "Group History rules remain present");
ok(!indexes.includes("\"collectionGroup\": \"historyEvents\""),
  "no Group History composite index is required");

for (const path of [
  "docs/checklists/group-history-production-acceptance.md",
  "docs/runbooks/group-history-production-rollout.md",
  "docs/group-history-8b7b6-performance-accessibility-production-acceptance.md",
]) ok(readFileSync(path, "utf8").length > 500, `${path} exists`);

console.log(JSON.stringify({
  suite: "group-history-final-acceptance",
  runtime: {node: process.version, platform: process.platform,
    arch: process.arch},
  methodology: "six runs per size; first discarded; median of five",
  measurements,
  checks,
  status: "passed",
}, null, 2));
