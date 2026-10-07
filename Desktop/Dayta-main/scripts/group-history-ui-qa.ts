import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  assertGroupHistoryLabelRegistryComplete,
  buildGroupHistoryDaySections,
  formatGroupHistoryDayLabel,
  formatGroupHistoryMonthLabel,
  formatGroupHistoryTime,
  getCurrentGroupHistoryMonth,
  getGroupHistoryActorCreditLabel,
  GROUP_HISTORY_EVENT_LABELS,
  resolveGroupHistoryTitle,
  shiftGroupHistoryMonth,
} from "../components/history/GroupHistoryTimeline";
import {
  GROUP_HISTORY_EVENT_DEFINITIONS,
  type GroupHistoryEvent,
  type GroupHistoryEventType,
} from "../services/groupHistory";
import {
  mergeGroupHistoryEvents,
} from "../services/groupHistoryAggregation";

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

ok(assertGroupHistoryLabelRegistryComplete(), "label registry complete");
eq(GROUP_HISTORY_EVENT_LABELS.shared_subtask_completed,
  "Completed shared subtask", "subtask label factual");
eq(GROUP_HISTORY_EVENT_LABELS.group_routine_occurrence_completed,
  "Completed routine", "routine label factual");
eq(GROUP_HISTORY_EVENT_LABELS.group_task_completed,
  "Completed group task", "task label future compatible");
eq(getCurrentGroupHistoryMonth("UTC", Date.parse("2026-07-18T00:00:00Z")),
  {year: 2026, month: 7}, "current month timezone explicit");
eq(shiftGroupHistoryMonth({year: 2026, month: 1}, -1),
  {year: 2025, month: 12}, "January rollover");
eq(shiftGroupHistoryMonth({year: 2026, month: 12}, 1),
  {year: 2027, month: 1}, "December rollover");
eq(shiftGroupHistoryMonth({year: 2024, month: 2}, 1),
  {year: 2024, month: 3}, "leap February navigation");
eq(formatGroupHistoryMonthLabel({year: 2026, month: 7}), "July 2026",
  "month label");
eq(formatGroupHistoryDayLabel("2026-07-18", "UTC"),
  "Saturday, July 18, 2026", "day label");
eq(formatGroupHistoryTime(Date.parse("2026-07-18T22:42:00Z"), "UTC"),
  "10:42 PM", "occurrence time used");
eq(resolveGroupHistoryTitle(fixture("shared_subtask_completed")),
  "Historical title", "snapshot title");
eq(resolveGroupHistoryTitle(fixture("shared_subtask_completed", {
  displayTitle: null,
})), "Shared subtask", "deleted subtask fallback");
eq(resolveGroupHistoryTitle(fixture(
  "group_routine_occurrence_completed", {displayTitle: null})),
"Group routine", "deleted routine fallback");
eq(getGroupHistoryActorCreditLabel(fixture("shared_subtask_completed")),
  "Completed by Alex", "actor-only label");
eq(getGroupHistoryActorCreditLabel(fixture("shared_subtask_completed", {
  actorDisplayName: null, creditedMemberDisplayName: "Bailey",
})), "Credited to Bailey", "credit-only label");
eq(getGroupHistoryActorCreditLabel(fixture("shared_subtask_completed", {
  creditedMemberDisplayName: "Alex",
})), "Completed by Alex", "same actor and credit deduplicated");
eq(getGroupHistoryActorCreditLabel(fixture("shared_subtask_completed", {
  creditedMemberDisplayName: "Bailey",
})), "Completed by Alex · Credited to Bailey", "distinct actor and credit");
eq(getGroupHistoryActorCreditLabel(fixture("shared_subtask_completed", {
  actorDisplayName: null, creditedMemberDisplayName: null,
})), "Completion recorded", "missing attribution uses safe fallback");

const grouped = buildGroupHistoryDaySections([
  fixture("shared_subtask_completed", {
    id: "older", occurredAtMs: Date.parse("2026-07-17T23:00:00Z"),
  }),
  fixture("shared_subtask_completed", {
    id: "newer-b", occurredAtMs: Date.parse("2026-07-18T23:00:00Z"),
  }),
  fixture("group_routine_occurrence_completed", {
    id: "newer-a", occurredAtMs: Date.parse("2026-07-18T23:00:00Z"),
  }),
], "UTC");
eq(grouped.map((section) => section.dayKey),
  ["2026-07-18", "2026-07-17"], "newest local day first");
eq(grouped[0].data.map((event) => event.id), ["newer-b", "newer-a"],
  "stable event order within day");
const zoneGroups = buildGroupHistoryDaySections([
  fixture("shared_subtask_completed", {
    id: "west", occurredAtMs: Date.parse("2026-07-18T02:00:00Z"),
  }),
], "America/Los_Angeles");
eq(zoneGroups[0].dayKey, "2026-07-17", "local day differs from UTC");

const merge = mergeGroupHistoryEvents(
  [fixture("shared_subtask_completed", {id: "same"})],
  [
    fixture("shared_subtask_completed", {id: "same"}),
    fixture("group_routine_occurrence_completed", {id: "next"}),
  ]
);
eq(merge.events.length, 2, "page merge deduplicates");
eq(merge.duplicateEventCount, 1, "duplicate page row counted");
ok(!merge.conflict, "identical duplicate is safe");

const routeSource = readFileSync(
  "app/group/[id]/history.tsx", "utf8");
const dashboardSource = readFileSync("app/group/[id].tsx", "utf8");
ok(routeSource.includes("useLocalSearchParams"), "route reads group param");
ok(routeSource.includes("validGroupId"), "route validates group ID");
ok(routeSource.includes("getGroupHistoryMonthPage"),
  "route uses canonical page service");
ok(routeSource.includes("getGroupHistoryMonthSummary"),
  "route uses canonical summary service");
ok(routeSource.includes("loadTimeline") && routeSource.includes("loadSummary"),
  "summary and timeline load independently");
ok(routeSource.includes("requestVersionRef"), "stale requests protected");
ok(routeSource.includes("RefreshControl"), "pull to refresh present");
ok(routeSource.includes("Load More"), "explicit load more present");
ok(routeSource.includes("loadingMoreRef"), "double tap guarded");
ok(routeSource.includes("clearSensitiveState"), "access clearing present");
ok(routeSource.includes("GROUP_HISTORY_FILTERS"), "category filter UI exists");
ok(!routeSource.includes("collection("), "screen has no raw history query");
ok(!routeSource.includes("getDoc("), "screen has no source joins");
ok(!routeSource.includes("actorUid}"), "UID not displayed");
ok(!routeSource.includes("creditedMemberUid}"), "credited UID not displayed");
ok(!routeSource.includes("createdAtMs"), "write time not displayed");
ok(routeSource.includes("getGroupHistoryNavigationTarget"),
  "rows use centralized safe navigation");
ok(routeSource.includes("accessibilityLabel=\"Previous month\""),
  "previous month accessible");
ok(routeSource.includes("accessibilityLabel=\"Next month\""),
  "next month accessible");
ok(routeSource.includes("\"Load more group history\""),
  "load more accessible");
ok(dashboardSource.includes('pathname: "/group/[id]/history"'),
  "dashboard points to group History route");
ok(dashboardSource.includes("Browse completed shared work by month and category."),
  "minimal dashboard copy");
ok(!routeSource.includes("PersonalHistory"), "no personal route coupling");
ok(!routeSource.includes("ranking") && !routeSource.includes("score"),
  "no ranking or scoring");

for (const size of [0, 1, 25, 50, 100, 250, 500, 1000, 2000]) {
  const events = Array.from({length: size}, (_, index) =>
    fixture(index % 2 ? "shared_subtask_completed" :
      "group_routine_occurrence_completed", {
      id: `perf-${index}`,
      occurredAtMs: Date.parse("2026-07-31T23:00:00Z") -
        index * 60 * 60 * 1000,
    }));
  const sections = buildGroupHistoryDaySections(events, "UTC");
  eq(sections.reduce((count, section) => count + section.data.length, 0),
    size, `preparation preserves ${size} rows`);
}

console.log(`Group History UI QA passed (${checks} checks).`);
