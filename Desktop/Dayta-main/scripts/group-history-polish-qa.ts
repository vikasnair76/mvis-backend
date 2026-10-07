import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  buildGroupHistoryAccessibilityLabel,
  buildGroupHistoryDaySections,
  getGroupHistoryEmptyCopy,
  getGroupHistoryFilterLabel,
  getGroupHistoryNavigationTarget,
  getGroupHistoryPartialCopy,
  getGroupHistoryQueryCategory,
  getGroupHistoryRestorationKey,
  normalizeGroupHistoryFilter,
  normalizeRestoredGroupHistoryState,
} from "../components/history/GroupHistoryTimeline";
import {
  GROUP_HISTORY_EVENT_DEFINITIONS,
  type GroupHistoryEvent,
  type GroupHistoryEventType,
} from "../services/groupHistory";
import {mergeGroupHistoryEvents} from
  "../services/groupHistoryAggregation";

let checks = 0;
const ok = (value: unknown, message: string) => {
  assert.ok(value, message); checks += 1;
};
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const fixture = (
  eventType: GroupHistoryEventType,
  patch: Partial<GroupHistoryEvent> = {}
): GroupHistoryEvent => {
  const definition = GROUP_HISTORY_EVENT_DEFINITIONS[eventType];
  return {
    id: `event-${eventType}`,
    schemaVersion: 1,
    groupId: "group-ui",
    eventType,
    category: definition.category,
    occurredAtMs: Date.parse("2026-07-18T22:42:00Z"),
    createdAtMs: Date.parse("2026-07-18T23:42:00Z"),
    entityType: definition.entityType,
    entityId: "entity",
    parentEntityType: definition.parentEntityType,
    parentEntityId: definition.parentEntityType ? "parent" : null,
    sourceEventId: `source-${eventType}`,
    displayTitle: "Historical title",
    summary: null,
    actorUid: "actor",
    actorDisplayName: "Alex",
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

eq(normalizeGroupHistoryFilter(undefined), "all", "default filter");
eq(normalizeGroupHistoryFilter("invalid"), "all", "invalid filter fallback");
eq(getGroupHistoryQueryCategory("all"), null, "all maps to null");
eq(getGroupHistoryQueryCategory("goals"), "goals", "goals mapping");
eq(getGroupHistoryQueryCategory("tasks"), "tasks", "tasks mapping");
eq(getGroupHistoryQueryCategory("routines"), "routines", "routines mapping");
eq(getGroupHistoryFilterLabel("goals"), "Goals", "stable filter label");
ok(getGroupHistoryEmptyCopy("all").includes("group completions"),
  "all empty copy");
ok(getGroupHistoryEmptyCopy("goals").includes("shared-goal"),
  "goal empty copy");
ok(getGroupHistoryEmptyCopy("tasks").includes("group-task"),
  "task empty copy");
ok(getGroupHistoryEmptyCopy("routines").includes("group-routine"),
  "routine empty copy");
ok(getGroupHistoryPartialCopy("category_scan_limit", "goals")
  .includes("category"), "category partial copy");
ok(!getGroupHistoryPartialCopy("query_conflict", "all")
  .includes("query_conflict"), "reason code not exposed");

eq(getGroupHistoryRestorationKey("user-a", "group-a"),
  "group-history:user-a:group-a", "UID and group scoped key");
eq(getGroupHistoryRestorationKey("user/a", "group-a"), null,
  "unsafe UID rejected");
eq(normalizeRestoredGroupHistoryState({
  year: 2025, month: 12, filter: "goals", events: ["private"],
}), {year: 2025, month: 12, filter: "goals"},
"restoration retains presentation state only");
eq(normalizeRestoredGroupHistoryState({
  year: 1999, month: 12, filter: "all",
}), null, "invalid year rejected");
eq(normalizeRestoredGroupHistoryState({
  year: 2026, month: 13, filter: "all",
}), null, "invalid month rejected");
eq(normalizeRestoredGroupHistoryState({
  year: 2026, month: 1, filter: "bad",
}), {year: 2026, month: 1, filter: "all"}, "invalid filter normalized");

eq(getGroupHistoryNavigationTarget(fixture("shared_subtask_completed", {
  entityId: "subtask-a", parentEntityId: "goal-a",
}), "group-ui"), {
  kind: "goal",
  pathname: "/goal/[id]",
  params: {id: "goal-a", highlightSubtaskId: "subtask-a"},
}, "shared subtask target");
eq(getGroupHistoryNavigationTarget(fixture("shared_subtask_completed", {
  parentEntityId: null,
}), "group-ui"), null, "missing goal ID");
eq(getGroupHistoryNavigationTarget(fixture("shared_subtask_completed", {
  entityId: "bad/id",
}), "group-ui"), null, "slash ID rejected");
eq(getGroupHistoryNavigationTarget(fixture(
  "group_routine_occurrence_completed", {
    entityId: "occurrence-a",
  }), "group-ui"), {
  kind: "group_routine_occurrence",
  pathname: "/group/[id]/routine-occurrence/[occurrenceId]",
  params: {id: "group-ui", occurrenceId: "occurrence-a"},
}, "routine occurrence target");
eq(getGroupHistoryNavigationTarget(fixture("group_task_completed"),
  "group-ui"), null, "group task intentionally informational");
eq(getGroupHistoryNavigationTarget(fixture("shared_subtask_completed"),
  "another-group"), null, "cross-group route rejected");

const route = readFileSync("app/group/[id]/history.tsx", "utf8");
const component = readFileSync(
  "components/history/GroupHistoryTimeline.tsx", "utf8");
const dashboard = readFileSync("app/group/[id].tsx", "utf8");
ok(route.includes("GROUP_HISTORY_FILTERS"), "filter chips rendered");
ok(route.includes("getGroupHistoryMonthPage({") &&
  route.includes("category,"), "service-backed category query");
ok(!route.includes(".filter((event)"), "no local event filtering");
ok(route.includes("skipSummaryOnNextLoadRef"),
  "filter leaves summary independent");
ok(route.includes("setEvents([])") && route.includes("setCursor(null)"),
  "transitions clear rows and cursor");
ok(route.includes("requestVersionRef"), "stale requests invalidated");
ok(route.includes("loadingMoreRef"), "pagination double taps guarded");
ok(route.includes("refreshInFlightRef"), "refresh double taps guarded");
ok(route.includes("storeGroupHistoryRestorationState(restorationState"),
  "presentation state restored in session");
ok(route.includes("restorationState.delete(restorationKey)"),
  "access loss deletes restoration");
ok(route.includes("previousUid !== nextUser?.uid") &&
  route.includes("restorationState.delete(previousKey)"),
  "auth change invalidates previous-user restoration");
ok(!route.includes("AsyncStorage"), "no persistent private cache");
ok(!route.includes("collection(") && !route.includes("getDoc("),
  "no raw query or source joins");
ok(route.includes("onOpenEvent={target ? openEvent : undefined}"),
  "row semantics follow proven target");
ok(component.includes("accessibilityRole=\"button\"") &&
  component.includes("<View style={styles.eventRow} accessible"),
  "navigable and static row semantics");
ok(route.includes("accessibilityState={{selected}}"),
  "selected filter exposed");
ok(route.includes("Couldn’t load more") && route.includes("\"Retry\""),
  "pagination failure is retryable");
ok(route.includes("Existing entries remain visible"),
  "non-destructive ordinary refresh failure");
ok(dashboard.includes('pathname: "/group/[id]/history"'),
  "dashboard route retained");
ok(!dashboard.includes("getGroupHistoryMonthPage"),
  "dashboard does not query history");
ok(!route.includes("actorUid}") && !route.includes("creditedMemberUid}") &&
  !route.includes("email}"), "no raw identity rendering");
ok(!route.includes("ranking") && !route.includes("chart") &&
  !route.includes("score"), "no analytics or gamification");

for (const size of [0, 1, 25, 50, 100, 250, 500, 1000, 2000, 5000]) {
  const events = Array.from({length: size}, (_, index) => fixture(
    index % 2 ? "shared_subtask_completed" :
      "group_routine_occurrence_completed", {
      id: `perf-${index}`,
      entityId: `entity-${index}`,
      occurredAtMs: Date.parse("2026-07-31T23:00:00Z") -
        index * 60 * 60 * 1000,
    }));
  const sections = buildGroupHistoryDaySections(events, "UTC");
  eq(sections.reduce((total, section) => total + section.data.length, 0),
    size, `section preparation preserves ${size}`);
  const merged = mergeGroupHistoryEvents([], events);
  eq(merged.events.length, size, `linear merge preserves ${size}`);
  for (const event of events) {
    getGroupHistoryNavigationTarget(event, "group-ui");
    buildGroupHistoryAccessibilityLabel(event, "UTC");
  }
}

console.log(`Group History polish QA passed (${checks} checks).`);
