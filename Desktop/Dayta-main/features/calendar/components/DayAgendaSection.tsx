import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GoalCompletionRecord } from "../../../services/goalCompletionQueries";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { DatedItem, GoogleCalendarEvent } from "../types/calendar.types";
import type { SuggestedEventMatch } from "../hooks/useCalendarSuggestions";
import { AgendaItemCard } from "./AgendaItemCard";

export interface DayAgendaSectionProps {
  selectedDate: Date;
  summaryLabel: string;
  currentStreak: number;
  dueItems: DatedItem[];
  completedItems: DatedItem[];
  unscheduledItems: DatedItem[];
  completedGoals: GoalCompletionRecord[];
  googleEventCount?: number;
  conflictSummaryLabel?: string | null;
  suggestedSlotLabel?: string | null;
  noSlotMessage?: string | null;
  recentlyRescheduledKeys?: Set<string>;
  pendingKeys: Set<string>;
  googleEventsById?: Map<string, GoogleCalendarEvent>;
  suggestedEventByItemKey?: Map<string, SuggestedEventMatch>;
  itemKeyFor: (item: DatedItem) => string;
  onToggleItem: (item: DatedItem) => void;
  onOpenLinkedEvent?: (item: DatedItem) => void;
  onApplySuggestedEvent?: (event: GoogleCalendarEvent) => void;
  onUnlinkEvent?: (item: DatedItem) => void;
  pendingUnlinkKeys?: Set<string>;
}

export function DayAgendaSection({
  selectedDate,
  summaryLabel,
  currentStreak,
  dueItems,
  completedItems,
  unscheduledItems,
  completedGoals,
  googleEventCount = 0,
  conflictSummaryLabel,
  suggestedSlotLabel,
  noSlotMessage,
  recentlyRescheduledKeys,
  pendingKeys,
  googleEventsById,
  suggestedEventByItemKey,
  itemKeyFor,
  onToggleItem,
  onOpenLinkedEvent,
  onApplySuggestedEvent,
  onUnlinkEvent,
  pendingUnlinkKeys,
}: DayAgendaSectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  const dateLabel = selectedDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Items with an override are surfaced as recovery cards instead.
  const backlogItems = unscheduledItems.filter(
    (item) => !item.hasScheduleOverride
  );

  const isEmpty =
    dueItems.length === 0 &&
    completedItems.length === 0 &&
    backlogItems.length === 0 &&
    completedGoals.length === 0;

  const renderItem = (item: DatedItem, completed: boolean) => {
    const key = itemKeyFor(item);
    return (
      <AgendaItemCard
        key={key}
        item={item}
        completed={completed}
        pending={pendingKeys.has(key)}
        recentlyRescheduled={recentlyRescheduledKeys?.has(key) ?? false}
        googleEventsById={googleEventsById}
        suggestedEvent={
          completed ? null : suggestedEventByItemKey?.get(key) ?? null
        }
        onToggle={onToggleItem}
        onOpenLinkedEvent={onOpenLinkedEvent}
        onApplySuggestedEvent={onApplySuggestedEvent}
        onUnlinkEvent={onUnlinkEvent}
        unlinkPending={
          pendingUnlinkKeys?.has(`${item.goalId}:${item.subtaskId}`) ?? false
        }
      />
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{dateLabel}</Text>
      <Text style={styles.summaryText}>{summaryLabel}</Text>

      {googleEventCount > 0 ? (
        <Text style={styles.metaText}>
          {googleEventCount} Google Calendar event
          {googleEventCount === 1 ? "" : "s"}
        </Text>
      ) : null}

      {conflictSummaryLabel ? (
        <Text style={styles.conflictText}>{conflictSummaryLabel}</Text>
      ) : null}

      {suggestedSlotLabel ? (
        <Text style={styles.metaText}>{suggestedSlotLabel}</Text>
      ) : null}

      {noSlotMessage ? (
        <Text style={styles.conflictText}>{noSlotMessage}</Text>
      ) : null}

      {currentStreak > 0 ? (
        <View style={styles.streakBanner}>
          <Text style={styles.streakBannerText}>
            🔥 {currentStreak} day streak
          </Text>
        </View>
      ) : null}

      {isEmpty ? (
        <Text style={styles.emptyText}>
          Nothing scheduled for this day.
        </Text>
      ) : null}

      {dueItems.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Due</Text>
          {dueItems.map((item) => renderItem(item, false))}
        </>
      ) : null}

      {backlogItems.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Unscheduled</Text>
          {backlogItems.map((item) => renderItem(item, false))}
        </>
      ) : null}

      {completedItems.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Completed</Text>
          {completedItems.map((item) => renderItem(item, true))}
        </>
      ) : null}

      {completedGoals.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Completed goals</Text>

          {completedGoals
            .slice()
            .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
            .map((g) => {
              const metricLine =
                g.metricTargetValue != null
                  ? `${g.currentMetricValue ?? 0}/${g.metricTargetValue} ${
                      g.metricUnit ?? ""
                    }`.trim()
                  : "No metric target set";

              return (
                <View key={g.id} style={styles.goalCard}>
                  <Link
                    href={{ pathname: "/goal/[id]", params: { id: g.goalId } }}
                    asChild
                  >
                    <Pressable>
                      <Text style={styles.goalCardTitle}>{g.titleSnapshot}</Text>
                    </Pressable>
                  </Link>

                  {g.descriptionSnapshot ? (
                    <Text style={styles.goalCardMeta}>
                      {g.descriptionSnapshot}
                    </Text>
                  ) : null}

                  <Text style={styles.goalCardBadge}>Goal completed</Text>

                  <Text style={styles.goalCardMeta}>
                    {new Date(g.completedAtMs).toLocaleDateString()} • {metricLine}
                  </Text>

                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${g.progressPercentage ?? 0}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>
                      {g.progressPercentage ?? 0}%
                    </Text>
                  </View>
                </View>
              );
            })}
        </>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
    },
    sectionHeader: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    summaryText: {
      marginTop: 4,
      fontSize: 13,
      color: theme.colors.secondaryText,
    },
    metaText: {
      marginTop: 2,
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    conflictText: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.dangerText,
    },
    streakBanner: {
      marginTop: 8,
      alignSelf: "flex-start",
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: theme.colors.badge,
    },
    streakBannerText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    subHeader: {
      marginTop: 14,
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.secondaryText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    emptyText: {
      marginTop: 10,
      fontSize: 13,
      color: theme.colors.secondaryText,
    },
    goalCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 4,
    },
    goalCardTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.colors.text,
    },
    goalCardMeta: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    goalCardBadge: {
      alignSelf: "flex-start",
      marginTop: 2,
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 6,
    },
    progressTrack: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.secondaryBackground,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: theme.colors.primary,
    },
    progressText: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
  });
}
