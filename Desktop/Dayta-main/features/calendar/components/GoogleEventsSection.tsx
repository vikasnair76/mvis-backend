import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { CalendarRuleRecord } from "../../../services/calendarRules";
import type { GoogleCalendarEvent } from "../types/calendar.types";
import type { SuggestedTaskMatch } from "../hooks/useCalendarSuggestions";
import {
  canShowQuickSuggestedApply,
  formatCalendarSuggestionReasonLabel,
  formatRelativeSyncTime,
  hasSavedSuggestPreference,
} from "../utils";

export interface GoogleEventsSectionProps {
  events: GoogleCalendarEvent[];
  lastSyncAtMs: number | null;
  manualSyncing: boolean;
  suggestedTaskByEventId?: Map<string, SuggestedTaskMatch>;
  subtasksByGoal?: Record<string, any[]>;
  calendarRules?: CalendarRuleRecord[];
  pendingQuickLinkEventIds?: Set<string>;
  recentlyQuickLinkedEventIds?: Set<string>;
  onRefresh: () => void;
  onApplyEvent?: (event: GoogleCalendarEvent, suggestedGoalId: string | null) => void;
  onQuickLink?: (
    event: GoogleCalendarEvent,
    goalId: string,
    subtaskId: string
  ) => void;
}

export function GoogleEventsSection({
  events,
  lastSyncAtMs,
  manualSyncing,
  suggestedTaskByEventId,
  subtasksByGoal = {},
  calendarRules = [],
  pendingQuickLinkEventIds,
  recentlyQuickLinkedEventIds,
  onRefresh,
  onApplyEvent,
  onQuickLink,
}: GoogleEventsSectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  if (events.length === 0) return null;

  const syncLabel = manualSyncing
    ? "Refreshing now..."
    : formatRelativeSyncTime(lastSyncAtMs);

  const openEvent = async (event: GoogleCalendarEvent) => {
    if (!event.htmlLink) return;
    try {
      await Linking.openURL(event.htmlLink);
    } catch (e) {
      console.error("[GoogleEventsSection] open event failed", e);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Google Calendar</Text>

        <Pressable
          onPress={onRefresh}
          disabled={manualSyncing}
          style={[styles.refreshBtn, manualSyncing && styles.refreshBtnDisabled]}
        >
          <Text style={styles.refreshBtnText}>
            {manualSyncing ? "Refreshing..." : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.syncText}>{syncLabel}</Text>

      {events.map((event) => {
        const timeLabel = event.allDay
          ? "All day"
          : new Date(event.startMs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });

        const suggestion = suggestedTaskByEventId?.get(event.id) ?? null;
        const singleMatch = suggestion?.mode === "single" ? suggestion : null;

        const savedPreference = singleMatch
          ? hasSavedSuggestPreference({
              eventTitle: event.title ?? "Untitled event",
              goalId: singleMatch.topMatch.item.goalId,
              subtaskId: singleMatch.topMatch.item.subtaskId,
              calendarRules,
            })
          : false;

        const reasonLabel = singleMatch
          ? formatCalendarSuggestionReasonLabel(singleMatch.topMatch.reasons)
          : null;

        const canQuickApply =
          !!onQuickLink &&
          canShowQuickSuggestedApply({
            suggestedTaskMatch: suggestion,
            subtasksByGoal,
          });

        const quickLinkPending = pendingQuickLinkEventIds?.has(event.id) ?? false;
        const recentlyLinked =
          recentlyQuickLinkedEventIds?.has(event.id) ?? false;

        return (
          <Pressable
            key={event.id}
            onPress={event.htmlLink ? () => openEvent(event) : undefined}
            style={styles.eventCard}
          >
            <Text style={styles.eventTitle}>{event.title}</Text>

            <Text style={styles.eventMeta}>
              {timeLabel}
              {event.location ? ` • ${event.location}` : ""}
            </Text>

            {event.description ? (
              <Text style={styles.eventMeta}>{event.description}</Text>
            ) : null}

            {event.htmlLink ? (
              <Text style={styles.eventLink}>Open in Google Calendar</Text>
            ) : null}

            {recentlyLinked ? (
              <Text style={styles.successBadge}>Linked just now</Text>
            ) : null}

            {singleMatch ? (
              <View style={styles.suggestionBox}>
                <Text style={styles.suggestionLabel}>
                  Suggested task: {singleMatch.topMatch.item.title}
                </Text>
                <Text style={styles.suggestionMeta}>
                  Goal: {singleMatch.topMatch.item.goalTitle}
                </Text>

                {savedPreference ? (
                  <Text style={styles.savedPreferenceBadge}>
                    ✨ Saved preference
                  </Text>
                ) : null}

                {reasonLabel ? (
                  <Text style={styles.suggestionMeta}>
                    Why suggested: {reasonLabel}
                  </Text>
                ) : null}

                {canQuickApply ? (
                  <Pressable
                    disabled={quickLinkPending}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onQuickLink?.(
                        event,
                        singleMatch.topMatch.item.goalId,
                        singleMatch.topMatch.item.subtaskId
                      );
                    }}
                    style={[
                      styles.suggestionBtn,
                      quickLinkPending && styles.suggestionBtnDisabled,
                    ]}
                  >
                    <Text style={styles.suggestionBtnText}>
                      {quickLinkPending ? "Linking..." : "Quick link"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {suggestion?.mode === "ambiguous" ? (
              <View style={styles.suggestionBox}>
                <Text style={styles.suggestionLabel}>
                  Multiple likely tasks for this event
                </Text>
                <Text style={styles.suggestionMeta}>
                  Top match: {suggestion.topMatch.item.title}
                </Text>
                {suggestion.secondMatch ? (
                  <Text style={styles.suggestionMeta}>
                    Also likely: {suggestion.secondMatch.item.title}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {onApplyEvent ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onApplyEvent(
                    event,
                    singleMatch?.topMatch.item.goalId ?? null
                  );
                }}
                style={styles.applyBtn}
              >
                <Text style={styles.applyBtnText}>Apply to a subtask</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    refreshBtn: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.badge,
    },
    refreshBtnDisabled: {
      opacity: 0.5,
    },
    refreshBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    syncText: {
      marginTop: 4,
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    eventCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 4,
    },
    eventTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.colors.text,
    },
    eventMeta: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    eventLink: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    successBadge: {
      alignSelf: "flex-start",
      marginTop: 4,
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
    },
    suggestionBox: {
      marginTop: 8,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.secondaryBackground,
      gap: 2,
    },
    suggestionLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.text,
    },
    suggestionMeta: {
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
    savedPreferenceBadge: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    suggestionBtn: {
      alignSelf: "flex-start",
      marginTop: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.badge,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    suggestionBtnDisabled: {
      opacity: 0.5,
    },
    suggestionBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    applyBtn: {
      alignSelf: "flex-start",
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    applyBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.text,
    },
  });
}
