import {Ionicons} from "@expo/vector-icons";
import {DateTime, IANAZone} from "luxon";
import React, {memo, useMemo} from "react";
import {Pressable, StyleSheet, Text, View} from "react-native";
import {
  GROUP_HISTORY_CATEGORIES,
  GROUP_HISTORY_EVENT_TYPES,
  GROUP_HISTORY_MAX_ID_LENGTH,
  type GroupHistoryCategory,
  type GroupHistoryEvent,
  type GroupHistoryEventType,
} from "../../services/groupHistory";
import {
  compareGroupHistoryEvents,
  type GroupHistoryMonthSummary,
} from "../../services/groupHistoryAggregation";
import {UI_SIZES, type AppThemeTokens} from "../../services/theme";

export type GroupHistoryMonthValue = {year: number; month: number};
export type GroupHistoryFilter = "all" | GroupHistoryCategory;
export type GroupHistoryRestoredState = {
  year: number;
  month: number;
  filter: GroupHistoryFilter;
};
export const GROUP_HISTORY_RESTORATION_LIMIT = 32;
export const GROUP_HISTORY_ACCESSIBILITY_LABEL_LIMIT = 700;
export type GroupHistoryNavigationTarget =
  | {
    kind: "goal";
    pathname: "/goal/[id]";
    params: {id: string; highlightSubtaskId: string};
  }
  | {
    kind: "group_routine_occurrence";
    pathname: "/group/[id]/routine-occurrence/[occurrenceId]";
    params: {id: string; occurrenceId: string};
  };
export type GroupHistoryDaySection = {
  dayKey: string;
  title: string;
  data: GroupHistoryEvent[];
};

export const GROUP_HISTORY_FILTERS: {
  value: GroupHistoryFilter;
  label: string;
  accessibilityLabel: string;
}[] = [
  {value: "all", label: "All", accessibilityLabel: "Show all group history"},
  {value: "goals", label: "Goals",
    accessibilityLabel: "Show shared-goal history"},
  {value: "tasks", label: "Tasks",
    accessibilityLabel: "Show group-task history"},
  {value: "routines", label: "Routines",
    accessibilityLabel: "Show group-routine history"},
];

export const GROUP_HISTORY_EVENT_LABELS: Record<
GroupHistoryEventType, string> = {
  shared_subtask_completed: "Completed shared subtask",
  group_task_completed: "Completed group task",
  group_routine_occurrence_completed: "Completed routine",
};

const iconNames: Record<GroupHistoryEventType,
React.ComponentProps<typeof Ionicons>["name"]> = {
  shared_subtask_completed: "checkbox-outline",
  group_task_completed: "checkmark-done-outline",
  group_routine_occurrence_completed: "repeat-outline",
};

export function getCurrentGroupHistoryMonth(
  timeZone: string,
  nowMs = Date.now()
): GroupHistoryMonthValue {
  if (!IANAZone.isValidZone(timeZone)) throw new Error("invalid_timezone");
  const current = DateTime.fromMillis(nowMs, {zone: timeZone});
  return {year: current.year, month: current.month};
}

export function shiftGroupHistoryMonth(
  value: GroupHistoryMonthValue,
  delta: number
): GroupHistoryMonthValue {
  const shifted = DateTime.fromObject({
    year: value.year, month: value.month, day: 1,
  }, {zone: "UTC"}).plus({months: delta});
  return {year: shifted.year, month: shifted.month};
}

export function formatGroupHistoryMonthLabel(value: GroupHistoryMonthValue) {
  return DateTime.fromObject({
    year: value.year, month: value.month, day: 1,
  }, {zone: "UTC"}).toFormat("LLLL yyyy");
}

export function formatGroupHistoryDayLabel(
  dayKey: string,
  timeZone: string
) {
  const day = DateTime.fromISO(dayKey, {zone: timeZone});
  return day.isValid ? day.toFormat("cccc, LLLL d, yyyy") : "Date unavailable";
}

export function formatGroupHistoryTime(
  occurredAtMs: number,
  timeZone: string
) {
  const time = DateTime.fromMillis(occurredAtMs, {zone: timeZone});
  return time.isValid ? time.toFormat("h:mm a") : "Time unavailable";
}

export function resolveGroupHistoryTitle(event: GroupHistoryEvent) {
  if (event.displayTitle?.trim()) return event.displayTitle.trim();
  if (event.eventType === "shared_subtask_completed") return "Shared subtask";
  if (event.eventType === "group_routine_occurrence_completed") {
    return "Group routine";
  }
  return "Group task";
}

export function normalizeGroupHistoryFilter(
  value: unknown
): GroupHistoryFilter {
  return value === "all" ||
    (typeof value === "string" &&
      (GROUP_HISTORY_CATEGORIES as readonly string[]).includes(value)) ?
    value as GroupHistoryFilter : "all";
}

export function getGroupHistoryQueryCategory(
  filter: GroupHistoryFilter
): GroupHistoryCategory | null {
  return filter === "all" ? null : filter;
}

export function getGroupHistoryFilterLabel(filter: GroupHistoryFilter) {
  return GROUP_HISTORY_FILTERS.find((item) => item.value === filter)?.label ??
    "All";
}

export function getGroupHistoryEmptyCopy(filter: GroupHistoryFilter) {
  if (filter === "goals") {
    return "No shared-goal completions were recorded this month.";
  }
  if (filter === "tasks") {
    return "No group-task completions were recorded this month. " +
      "Completed group tasks will appear here when supported.";
  }
  if (filter === "routines") {
    return "No group-routine completions were recorded this month.";
  }
  return "No recorded group completions for this month.";
}

export function getGroupHistoryPartialCopy(
  reason: string | null,
  filter: GroupHistoryFilter
) {
  if (reason === "query_conflict") {
    return "Some matching history entries may not be shown yet.";
  }
  return filter === "all" ?
    "This month reached its safe loading limit. Try loading more or refreshing." :
    "This category reached its safe loading limit. " +
      "Try loading more or refreshing.";
}

function safeRouteId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= GROUP_HISTORY_MAX_ID_LENGTH &&
    !normalized.includes("/") && normalized !== "." && normalized !== ".." ?
    normalized : null;
}

export function getGroupHistoryNavigationTarget(
  event: GroupHistoryEvent,
  routeGroupId: string
): GroupHistoryNavigationTarget | null {
  const groupId = safeRouteId(routeGroupId);
  if (!groupId || event.groupId !== groupId) return null;
  if (event.eventType === "shared_subtask_completed") {
    const goalId = safeRouteId(event.parentEntityId);
    const subtaskId = safeRouteId(event.entityId);
    return goalId && subtaskId ? {
      kind: "goal",
      pathname: "/goal/[id]",
      params: {id: goalId, highlightSubtaskId: subtaskId},
    } : null;
  }
  if (event.eventType === "group_routine_occurrence_completed") {
    const occurrenceId = safeRouteId(event.entityId);
    return occurrenceId ? {
      kind: "group_routine_occurrence",
      pathname: "/group/[id]/routine-occurrence/[occurrenceId]",
      params: {id: groupId, occurrenceId},
    } : null;
  }
  return null;
}

export function getGroupHistoryNavigationKind(
  event: GroupHistoryEvent,
  groupId: string
) {
  return getGroupHistoryNavigationTarget(event, groupId)?.kind ?? null;
}

export function getGroupHistoryRestorationKey(uid: string, groupId: string) {
  const safeUid = safeRouteId(uid);
  const safeGroupId = safeRouteId(groupId);
  return safeUid && safeGroupId ?
    `group-history:${safeUid}:${safeGroupId}` : null;
}

export function normalizeRestoredGroupHistoryState(
  value: unknown
): GroupHistoryRestoredState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<GroupHistoryRestoredState>;
  if (!Number.isInteger(candidate.year) ||
    candidate.year! < 2000 || candidate.year! > 2100 ||
    !Number.isInteger(candidate.month) ||
    candidate.month! < 1 || candidate.month! > 12) return null;
  return {
    year: candidate.year!,
    month: candidate.month!,
    filter: normalizeGroupHistoryFilter(candidate.filter),
  };
}

export function readGroupHistoryRestorationState(
  cache: Map<string, GroupHistoryRestoredState>,
  key: string
) {
  const value = cache.get(key) ?? null;
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function storeGroupHistoryRestorationState(
  cache: Map<string, GroupHistoryRestoredState>,
  key: string,
  value: GroupHistoryRestoredState,
  limit = GROUP_HISTORY_RESTORATION_LIMIT
) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("invalid_restoration_limit");
  }
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

export function getGroupHistoryAttributionLines(event: GroupHistoryEvent) {
  const actor = event.actorDisplayName?.trim() || null;
  const credited = event.creditedMemberDisplayName?.trim() || null;
  if (actor && credited && actor === credited) {
    return [`Completed by ${actor}`];
  }
  const lines: string[] = [];
  if (actor) lines.push(`Completed by ${actor}`);
  if (credited) lines.push(`Credited to ${credited}`);
  return lines.length ? lines : ["Completion recorded"];
}

export function getGroupHistoryActorCreditLabel(event: GroupHistoryEvent) {
  return getGroupHistoryAttributionLines(event).join(" · ");
}

export function buildGroupHistoryAccessibilityLabel(
  event: GroupHistoryEvent,
  timeZone: string
) {
  const label = [
    GROUP_HISTORY_EVENT_LABELS[event.eventType],
    resolveGroupHistoryTitle(event),
    ...getGroupHistoryAttributionLines(event),
    event.summary,
    formatGroupHistoryTime(event.occurredAtMs, timeZone),
  ].filter(Boolean).join(". ");
  return label.length <= GROUP_HISTORY_ACCESSIBILITY_LABEL_LIMIT ?
    label : `${label.slice(
      0, GROUP_HISTORY_ACCESSIBILITY_LABEL_LIMIT - 1).trimEnd()}…`;
}

export function buildGroupHistoryDaySections(
  events: readonly GroupHistoryEvent[],
  timeZone: string
): GroupHistoryDaySection[] {
  if (!IANAZone.isValidZone(timeZone)) throw new Error("invalid_timezone");
  const groups = new Map<string, GroupHistoryEvent[]>();
  for (const event of events) {
    const dayKey = DateTime.fromMillis(event.occurredAtMs, {
      zone: timeZone,
    }).toFormat("yyyy-MM-dd");
    const current = groups.get(dayKey);
    if (current) current.push(event);
    else groups.set(dayKey, [event]);
  }
  return [...groups.entries()]
    .map(([dayKey, items]) => ({
      dayKey,
      title: formatGroupHistoryDayLabel(dayKey, timeZone),
      data: [...items].sort(compareGroupHistoryEvents),
    }))
    .sort((left, right) => right.dayKey.localeCompare(left.dayKey));
}

export function assertGroupHistoryLabelRegistryComplete() {
  return GROUP_HISTORY_EVENT_TYPES.every((eventType) =>
    Boolean(GROUP_HISTORY_EVENT_LABELS[eventType]));
}

export const GroupHistoryEventRow = memo(function GroupHistoryEventRow(props: {
  event: GroupHistoryEvent;
  timeZone: string;
  theme: AppThemeTokens;
  onOpenEvent?: (event: GroupHistoryEvent) => void;
}) {
  const {event, timeZone, theme, onOpenEvent} = props;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const eventLabel = GROUP_HISTORY_EVENT_LABELS[event.eventType];
  const title = resolveGroupHistoryTitle(event);
  const attributionLines = getGroupHistoryAttributionLines(event);
  const time = formatGroupHistoryTime(event.occurredAtMs, timeZone);
  const accessibilityLabel = buildGroupHistoryAccessibilityLabel(
    event, timeZone);
  const content = (
    <>
      <View style={styles.iconWrap} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Ionicons
          name={iconNames[event.eventType]}
          size={20}
          color={theme.colors.primary}
        />
      </View>
      <View style={styles.eventText}>
        <Text style={styles.eventLabel}>{eventLabel}</Text>
        <Text style={styles.eventTitle}>{title}</Text>
        {attributionLines.map((line) => (
          <Text key={line} style={styles.attribution}>{line}</Text>
        ))}
        {event.summary ? (
          <Text style={styles.summary}>{event.summary}</Text>
        ) : null}
        <Text style={styles.time}>{time}</Text>
      </View>
      {onOpenEvent ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : null}
    </>
  );
  return onOpenEvent ? (
    <Pressable
      style={({pressed}) => [
        styles.eventRow,
        pressed && styles.eventRowPressed,
      ]}
      onPress={() => onOpenEvent(event)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the related item."
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.eventRow} accessible
      accessibilityLabel={accessibilityLabel}>
      {content}
    </View>
  );
});

export function GroupHistorySummaryCard(props: {
  summary: GroupHistoryMonthSummary;
  complete: boolean;
  theme: AppThemeTokens;
}) {
  const {summary, complete, theme} = props;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const items = [
    {label: "Completions", value: summary.totalEvents},
    {label: "Shared subtasks", value: summary.sharedSubtaskCompletedCount},
    {label: "Routine occurrences",
      value: summary.routineOccurrenceCompletedCount},
    {label: "Active days", value: summary.activeLocalDayCount},
    ...(summary.groupTaskCompletedCount > 0 ? [{
      label: "Group tasks", value: summary.groupTaskCompletedCount,
    }] : []),
  ];
  return (
    <View style={styles.summaryCard} accessible accessibilityLabel={[
      complete ? "Complete month summary" : "Partial month summary",
      ...items.map((item) => `${item.label}: ${item.value}`),
    ].join(". ")}>
      <Text style={styles.summaryHeading} accessibilityRole="header">
        {complete ? "Month summary" : "Partial month summary"}
      </Text>
      {!complete ? (
        <Text style={styles.partialText}>
          These totals reflect the history entries that could be read safely.
        </Text>
      ) : null}
      <View style={styles.summaryGrid}>
        {items.map((item) => (
          <View key={item.label} style={styles.summaryTile}>
            <Text style={styles.summaryValue}>{item.value}</Text>
            <Text style={styles.summaryLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (theme: AppThemeTokens) => StyleSheet.create({
  eventRow: {
    minHeight: UI_SIZES.buttonHeight.lg,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: UI_SIZES.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: UI_SIZES.radius.lg,
    padding: UI_SIZES.cardPadding.md,
  },
  eventRowPressed: {backgroundColor: theme.colors.surfaceMuted},
  iconWrap: {
    width: 40,
    minHeight: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.badge,
  },
  eventText: {flex: 1, minWidth: 0, gap: 3},
  eventLabel: {color: theme.colors.primary, fontSize: 12, fontWeight: "900"},
  eventTitle: {
    color: theme.colors.text, fontSize: 16, lineHeight: 22,
    fontWeight: "800",
  },
  attribution: {color: theme.colors.textMuted, fontSize: 14, lineHeight: 20},
  summary: {color: theme.colors.textMuted, fontSize: 14, lineHeight: 20},
  time: {color: theme.colors.textMuted, fontSize: 13, lineHeight: 18},
  summaryCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: UI_SIZES.radius.lg,
    padding: UI_SIZES.cardPadding.md,
    gap: UI_SIZES.spacing.md,
  },
  summaryHeading: {color: theme.colors.text, fontSize: 18, fontWeight: "900"},
  summaryGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm,
  },
  summaryTile: {
    minWidth: 112,
    flexGrow: 1,
    flexBasis: "30%",
    borderRadius: UI_SIZES.radius.md,
    padding: UI_SIZES.cardPadding.sm,
    backgroundColor: theme.colors.surfaceMuted,
  },
  summaryValue: {color: theme.colors.text, fontSize: 22, fontWeight: "900"},
  summaryLabel: {
    color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2,
  },
  partialText: {
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: UI_SIZES.radius.sm,
    padding: UI_SIZES.cardPadding.sm,
    lineHeight: 19,
  },
});
