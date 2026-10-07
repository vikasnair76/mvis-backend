import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  PERSONAL_HISTORY_EVENT_LABELS,
  assertPersonalHistoryLabelRegistryComplete,
  compareHistoryMonths,
  formatHistoryDayLabel,
  formatHistoryEventTime,
  getCurrentHistoryMonth,
  resolvePersonalHistoryNavigationTarget,
  resolvePersonalHistoryTitle,
  shiftHistoryMonth,
} from "../components/history/PersonalHistoryTimeline";
import {
  PERSONAL_HISTORY_EVENT_DEFINITIONS,
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
} from "../services/personalHistory";

let checks = 0;
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message); checks += 1;
};
const ok = (value: unknown, message: string) => {
  assert.ok(value, message); checks += 1;
};
const fixture = (
  eventType: PersonalHistoryEventType,
  patch: Partial<PersonalHistoryEvent> = {}
): PersonalHistoryEvent => {
  const definition = PERSONAL_HISTORY_EVENT_DEFINITIONS[eventType];
  return {
    id: `event-${eventType}`,
    ownerUid: "owner",
    occurredAtMs: Date.parse("2026-07-18T22:42:00Z"),
    eventType,
    category: definition.category,
    entityType: definition.entityType,
    entityId: "entity-1",
    parentEntityId: null,
    displayTitle: "Historical title",
    summary: null,
    metadata: {},
    sourceEventId: `source-${eventType}`,
    schemaVersion: 1,
    createdAtMs: Date.parse("2026-07-18T22:43:00Z"),
    ...patch,
  };
};

ok(assertPersonalHistoryLabelRegistryComplete(),
  "every canonical event type has a UI label");
eq(PERSONAL_HISTORY_EVENT_LABELS.goal_completed, "Goal completed",
  "goal label is factual");
eq(PERSONAL_HISTORY_EVENT_LABELS.subtask_completed, "Subtask completed",
  "subtask label is factual");
eq(PERSONAL_HISTORY_EVENT_LABELS.planner_suggestion_applied,
  "Planner suggestion applied", "planner label is factual");

eq(shiftHistoryMonth({year: 2026, month: 1}, -1),
  {year: 2025, month: 12}, "January moves to prior December");
eq(shiftHistoryMonth({year: 2026, month: 12}, 1),
  {year: 2027, month: 1}, "December moves to next January");
eq(compareHistoryMonths({year: 2026, month: 7}, {year: 2026, month: 7}),
  0, "same month recognized");
ok(compareHistoryMonths({year: 2026, month: 8},
  {year: 2026, month: 7}) > 0, "future month recognized");
eq(getCurrentHistoryMonth(
  "America/New_York", Date.parse("2026-08-01T02:00:00Z")),
{year: 2026, month: 7}, "current month uses selected timezone");

eq(formatHistoryDayLabel("2026-07-18", "UTC",
  Date.parse("2026-07-18T12:00:00Z")), "Today", "today label");
eq(formatHistoryDayLabel("2026-07-17", "UTC",
  Date.parse("2026-07-18T12:00:00Z")), "Yesterday", "yesterday label");
eq(formatHistoryEventTime(
  Date.parse("2026-07-18T22:42:00Z"), "America/New_York"),
"6:42 PM", "event time uses occurred timestamp and timezone");

eq(resolvePersonalHistoryTitle(fixture("goal_completed", {
  displayTitle: null,
})), "Untitled goal", "goal title has neutral fallback");
eq(resolvePersonalHistoryTitle(fixture("subtask_completed", {
  displayTitle: null,
})), "Untitled subtask", "subtask title has neutral fallback");

eq(resolvePersonalHistoryNavigationTarget(fixture("goal_completed")),
  {pathname: "/goal/[id]", params: {id: "entity-1"}},
  "goal opens canonical goal route");
eq(resolvePersonalHistoryNavigationTarget(fixture("subtask_completed", {
  parentEntityId: "goal-1",
})), {
  pathname: "/goal/[id]",
  params: {id: "goal-1", highlightSubtaskId: "entity-1"},
}, "subtask opens parent goal with highlight");
eq(resolvePersonalHistoryNavigationTarget(
  fixture("subtask_completed")), null,
"subtask without parent is non-navigable");
eq(resolvePersonalHistoryNavigationTarget(
  fixture("planner_suggestion_applied")), "/planner",
"planner event opens Planner");
eq(resolvePersonalHistoryNavigationTarget(
  fixture("calendar_block_created")), "/calendar",
"calendar event opens Calendar");
eq(resolvePersonalHistoryNavigationTarget(fixture(
  "planning_board_card_completed", {parentEntityId: "board-1"})), {
  pathname: "/board/[id]", params: {id: "board-1"},
}, "board card opens parent board");
eq(resolvePersonalHistoryNavigationTarget(fixture(
  "milestone_completed", {parentEntityId: "goal-1"})), {
  pathname: "/goal/[id]", params: {id: "goal-1"},
}, "milestone opens parent goal");
eq(resolvePersonalHistoryNavigationTarget(fixture("routine_completed")), null,
  "unsupported routine destination is non-interactive");

const screen = readFileSync("app/(tabs)/history.tsx", "utf8");
const component = readFileSync(
  "components/history/PersonalHistoryTimeline.tsx", "utf8");
ok(screen.includes("getPersonalHistoryMonthPage") &&
  screen.includes("getPersonalHistoryMonthSummary") &&
  screen.includes("groupPersonalHistoryEventsByDay"),
"screen consumes canonical query and aggregation services");
ok(screen.includes("SectionList") && screen.includes("RefreshControl"),
  "screen uses paginated section list with pull to refresh");
ok(screen.includes("categories: selectedFilter === \"all\"") &&
  screen.includes("getPersonalHistoryMonthPage({...pageRequestModel"),
"category filters use the bounded query service");
ok(screen.includes("getPersonalHistoryMonthSummary(monthRequestModel)") &&
  screen.includes("Summary reflects all activity this month."),
"summary remains explicitly month-wide while rows are filtered");
ok(screen.includes("setCursor(null)") &&
  screen.includes("setHasMore(false)") &&
  screen.includes("requestIdRef.current += 1"),
"filter and month changes reset pagination and stale requests");
ok(screen.includes('accessibilityRole="tab"') &&
  screen.includes("accessibilityState={{selected}}"),
"filter chips announce selection");
ok(screen.includes("historySessionState.ownerUid") &&
  screen.includes("historySessionState.filter") &&
  screen.includes("historySessionState.scrollOffset") &&
  screen.includes("contentOffset={{x: 0, y: historySessionState.scrollOffset}}"),
"month, filter, and scroll restoration is scoped to the authenticated owner");
ok(screen.includes("End of history for this month."),
  "pagination has a stable end-of-month message");
ok(screen.includes("loadingMoreRef.current") &&
  screen.includes("if (!user?.uid || !cursor || !hasMore || loadingMoreRef.current)"),
"load-more double taps are synchronously guarded");
ok(screen.includes('accessibilityLabel="Show previous month"') &&
  screen.includes('accessibilityLabel="Show next month"') &&
  screen.includes('accessibilityLabel="Return to current month"'),
"month controls have accessible labels");
ok(screen.includes("accessibilityState={{disabled: !canMoveNext}}"),
  "future-month control announces disabled state");
ok(screen.includes("requestIdRef") &&
  screen.includes("requestId !== requestIdRef.current"),
"stale month requests cannot commit");
ok(screen.includes("mergePersonalHistoryEventPages"),
"pagination defensively deduplicates IDs");
ok(screen.includes("Promise.allSettled") &&
  screen.includes("pageResult.status === \"fulfilled\"") &&
  screen.includes("summaryResult.status === \"fulfilled\""),
"timeline and monthly summary failures settle independently");
ok(screen.includes("Monthly totals could not be loaded") &&
  screen.includes("Timeline items remain available"),
"summary failure preserves and explains timeline availability");
ok(screen.includes("initialNumToRender={12}") &&
  screen.includes("maxToRenderPerBatch={12}") &&
  screen.includes("windowSize={9}"),
"long history lists use bounded SectionList rendering batches");
ok(component.includes("onOpenEvent?:") &&
  component.includes("onOpenEvent(event)"),
"rows receive a stable event callback instead of per-row closures");
ok(screen.includes("History could not be refreshed") &&
  screen.includes("More history could not be loaded") &&
  screen.includes("History could not be loaded"),
"initial, refresh, and load-more errors are distinct");
ok(component.includes("minHeight: UI_SIZES.buttonHeight.lg") &&
  screen.includes("minHeight: 44"),
"interactive rows and controls meet touch-size baseline");
ok(component.includes("theme.colors.") && screen.includes("theme.colors."),
  "screen and components use theme tokens");
ok(!screen.includes("collectionGroup(") &&
  !screen.includes("onSnapshot(") &&
  !screen.includes('collection(db, "goals"') &&
  !screen.includes('collection(db, "subtasks"'),
"canonical UI performs no direct or source-document queries");
for (const prohibited of [
  "momentum", "best day", "productivity", "success rate",
  "completion rate", "comparison",
]) {
  ok(!screen.toLowerCase().includes(prohibited),
    `screen excludes ${prohibited} language`);
}
ok(!screen.includes("schemaVersion") &&
  !screen.includes("metadata JSON"),
"raw history internals are not rendered");

console.log(`Personal History UI QA passed (${checks} checks).`);
