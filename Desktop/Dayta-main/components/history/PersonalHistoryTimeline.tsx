import {Ionicons} from "@expo/vector-icons";
import {DateTime, IANAZone} from "luxon";
import React, {memo, useMemo} from "react";
import {Pressable, StyleSheet, Text, View} from "react-native";
import {
  PERSONAL_HISTORY_EVENT_TYPES,
  type PersonalHistoryEntityType,
  type PersonalHistoryEvent,
  type PersonalHistoryEventType,
} from "../../services/personalHistory";
import type {PersonalHistoryMonthSummary} from
  "../../services/personalHistoryAggregation";
import {UI_SIZES, type AppThemeTokens} from "../../services/theme";

export type HistoryMonthValue = {year: number; month: number};
export type PersonalHistoryNavigationTarget =
  | {pathname: "/goal/[id]"; params: {
    id: string; highlightSubtaskId?: string;
  }}
  | {pathname: "/board/[id]"; params: {id: string}}
  | "/planner"
  | "/calendar";

export const PERSONAL_HISTORY_EVENT_LABELS: Record<
PersonalHistoryEventType, string> = {
  goal_created: "Goal created",
  goal_completed: "Goal completed",
  goal_archived: "Goal archived",
  goal_restored: "Goal restored",
  subtask_completed: "Subtask completed",
  planner_suggestion_applied: "Planner suggestion applied",
  planner_calendar_block_created: "Planner calendar block created",
  calendar_block_created: "Calendar block created",
  planning_board_card_completed: "Board card completed",
  routine_completed: "Routine completed",
  milestone_completed: "Milestone completed",
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];
export const PERSONAL_HISTORY_CATEGORY_ICONS: Record<
PersonalHistoryEvent["category"], IconName> = {
  goal: "flag-outline",
  subtask: "checkbox-outline",
  planner: "sparkles-outline",
  calendar: "calendar-outline",
  board: "grid-outline",
  routine: "repeat-outline",
  milestone: "trophy-outline",
  system: "information-circle-outline",
};

const titleFallbacks: Record<PersonalHistoryEntityType, string> = {
  goal: "Untitled goal",
  subtask: "Untitled subtask",
  planner_suggestion: "Planner suggestion",
  calendar_event: "Untitled calendar block",
  planning_board_card: "Untitled board card",
  routine_occurrence: "Routine occurrence",
  milestone: "Untitled milestone",
};

export function resolvePersonalHistoryTitle(event: PersonalHistoryEvent) {
  return event.displayTitle?.trim() ||
    titleFallbacks[event.entityType] || "History item";
}

export function getCurrentHistoryMonth(
  timeZone: string,
  nowMs = Date.now()
): HistoryMonthValue {
  if (!IANAZone.isValidZone(timeZone)) throw new Error("invalid_timezone");
  const now = DateTime.fromMillis(nowMs, {zone: timeZone});
  return {year: now.year, month: now.month};
}

export function shiftHistoryMonth(
  value: HistoryMonthValue,
  delta: number
): HistoryMonthValue {
  const shifted = DateTime.fromObject(
    {year: value.year, month: value.month, day: 1},
    {zone: "UTC"}
  ).plus({months: delta});
  return {year: shifted.year, month: shifted.month};
}

export function compareHistoryMonths(
  left: HistoryMonthValue,
  right: HistoryMonthValue
) {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

export function formatHistoryMonthLabel(value: HistoryMonthValue) {
  return DateTime.fromObject({
    year: value.year, month: value.month, day: 1,
  }).toFormat("LLLL yyyy");
}

export function formatHistoryDayLabel(
  dayKey: string,
  timeZone: string,
  nowMs = Date.now()
) {
  const day = DateTime.fromISO(dayKey, {zone: timeZone}).startOf("day");
  const today = DateTime.fromMillis(nowMs, {zone: timeZone}).startOf("day");
  if (day.equals(today)) return "Today";
  if (day.equals(today.minus({days: 1}))) return "Yesterday";
  return day.toFormat("cccc, LLLL d");
}

export function formatHistoryEventTime(
  occurredAtMs: number,
  timeZone: string
) {
  const time = DateTime.fromMillis(occurredAtMs, {zone: timeZone});
  return time.isValid ? time.toFormat("h:mm a") : "Time unavailable";
}

export function resolvePersonalHistoryNavigationTarget(
  event: PersonalHistoryEvent
): PersonalHistoryNavigationTarget | null {
  if (event.entityType === "goal") {
    return {pathname: "/goal/[id]", params: {id: event.entityId}};
  }
  if (event.entityType === "subtask" && event.parentEntityId) {
    return {
      pathname: "/goal/[id]",
      params: {
        id: event.parentEntityId,
        highlightSubtaskId: event.entityId,
      },
    };
  }
  if (event.entityType === "planner_suggestion") return "/planner";
  if (event.entityType === "calendar_event" &&
    event.eventType === "calendar_block_created") return "/calendar";
  if (event.entityType === "planning_board_card" && event.parentEntityId) {
    return {
      pathname: "/board/[id]",
      params: {id: event.parentEntityId},
    };
  }
  if (event.entityType === "milestone" && event.parentEntityId) {
    return {
      pathname: "/goal/[id]",
      params: {id: event.parentEntityId},
    };
  }
  return null;
}

export function assertPersonalHistoryLabelRegistryComplete() {
  return PERSONAL_HISTORY_EVENT_TYPES.every((eventType) =>
    Boolean(PERSONAL_HISTORY_EVENT_LABELS[eventType]));
}

export const HistoryEventRow = memo(function HistoryEventRow(props: {
  event: PersonalHistoryEvent;
  timeZone: string;
  theme: AppThemeTokens;
  onOpenEvent?: (event: PersonalHistoryEvent) => void;
}) {
  const {event, timeZone, theme, onOpenEvent} = props;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const label = PERSONAL_HISTORY_EVENT_LABELS[event.eventType];
  const displayTitle = resolvePersonalHistoryTitle(event);
  const time = formatHistoryEventTime(event.occurredAtMs, timeZone);
  const content = (
    <>
      <View style={styles.iconWrap} accessible={false}>
        <Ionicons
          name={PERSONAL_HISTORY_CATEGORY_ICONS[event.category]}
          size={20}
          color={theme.colors.primary}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
      <View style={styles.eventText}>
        <Text style={styles.eventLabel}>{label}</Text>
        <Text style={styles.eventTitle}>{displayTitle}</Text>
        {event.summary ? (
          <Text style={styles.eventSummary}>{event.summary}</Text>
        ) : null}
        <Text style={styles.eventTime}>{time}</Text>
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
  const accessibilityLabel = [
    label, displayTitle, event.summary, time,
  ].filter(Boolean).join(". ");
  return onOpenEvent ? (
    <Pressable
      onPress={() => onOpenEvent(event)}
      style={({pressed}) => [
        styles.eventRow,
        pressed && styles.eventRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the related item."
    >
      {content}
    </Pressable>
  ) : (
    <View
      style={styles.eventRow}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </View>
  );
});

const summaryItems: {
  key: keyof PersonalHistoryMonthSummary;
  label: string;
}[] = [
  {key: "totalEvents", label: "Events"},
  {key: "goalCompletedCount", label: "Goals completed"},
  {key: "subtaskCompletedCount", label: "Subtasks completed"},
  {key: "plannerAppliedCount", label: "Planner actions"},
  {key: "calendarBlockCreatedCount", label: "Calendar blocks"},
  {key: "boardCardCompletedCount", label: "Board cards"},
  {key: "milestoneCompletedCount", label: "Milestones"},
];

export function HistorySummaryCard(props: {
  summary: PersonalHistoryMonthSummary;
  summaryComplete: boolean;
  theme: AppThemeTokens;
}) {
  const {summary, summaryComplete, theme} = props;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const visible = summaryItems.filter((item) =>
    item.key === "totalEvents" || summary[item.key] > 0);
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryHeading} accessibilityRole="header">
        Monthly totals
      </Text>
      <View style={styles.summaryGrid}>
        {visible.map((item) => (
          <View
            key={item.key}
            style={styles.summaryTile}
            accessibilityLabel={`${item.label}, ${summary[item.key]}.`}
          >
            <Text style={styles.summaryValue}>{summary[item.key]}</Text>
            <Text style={styles.summaryLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
      {!summaryComplete ? (
        <Text
          style={styles.partialText}
          accessibilityLabel="Showing partial totals for this month."
        >
          Showing partial totals for this month.
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: AppThemeTokens) => StyleSheet.create({
  eventRow: {
    minHeight: UI_SIZES.buttonHeight.lg,
    flexDirection: "row",
    alignItems: "center",
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
  eventLabel: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  eventTitle: {
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  eventSummary: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  eventTime: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: UI_SIZES.radius.lg,
    padding: UI_SIZES.cardPadding.md,
    gap: UI_SIZES.spacing.md,
  },
  summaryHeading: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: UI_SIZES.spacing.sm,
  },
  summaryTile: {
    minWidth: 112,
    flexGrow: 1,
    flexBasis: "30%",
    borderRadius: UI_SIZES.radius.md,
    padding: UI_SIZES.cardPadding.sm,
    backgroundColor: theme.colors.surfaceMuted,
  },
  summaryValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  summaryLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  partialText: {
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: UI_SIZES.radius.sm,
    padding: UI_SIZES.cardPadding.sm,
    lineHeight: 19,
  },
});
