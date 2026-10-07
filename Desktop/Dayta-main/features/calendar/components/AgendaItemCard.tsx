import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { DatedItem, GoogleCalendarEvent } from "../types/calendar.types";
import type { SuggestedEventMatch } from "../hooks/useCalendarSuggestions";
import {
  formatCalendarSuggestionReasonLabel,
  formatLinkedEventLabel,
  formatTaskDueLabel,
  getScheduleOverrideBadgeLabel,
  isLinkedEventMissing,
  shouldShowLinkedEventForItem,
} from "../utils";

export interface AgendaItemCardProps {
  item: DatedItem;
  completed: boolean;
  pending: boolean;
  recentlyRescheduled?: boolean;
  googleEventsById?: Map<string, GoogleCalendarEvent>;
  suggestedEvent?: SuggestedEventMatch | null;
  onToggle: (item: DatedItem) => void;
  onOpenLinkedEvent?: (item: DatedItem) => void;
  onApplySuggestedEvent?: (event: GoogleCalendarEvent) => void;
  onUnlinkEvent?: (item: DatedItem) => void;
  unlinkPending?: boolean;
}

export function AgendaItemCard({
  item,
  completed,
  pending,
  recentlyRescheduled = false,
  googleEventsById,
  suggestedEvent,
  onToggle,
  onOpenLinkedEvent,
  onApplySuggestedEvent,
  onUnlinkEvent,
  unlinkPending = false,
}: AgendaItemCardProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  const frequencyLabel =
    item.frequency === "once" ? "one time" : item.frequency ?? "once";
  const dueLabel = formatTaskDueLabel(item.dueAtMs);

  const metaLine = [
    frequencyLabel,
    typeof item.dueAtMs === "number"
      ? new Date(item.dueAtMs).toLocaleDateString()
      : null,
    dueLabel,
  ]
    .filter(Boolean)
    .join(" • ");

  const showLinkedEvent = shouldShowLinkedEventForItem(item);
  const linkedEventMissing = googleEventsById
    ? isLinkedEventMissing(item, googleEventsById)
    : false;
  const linkedEventLabel = formatLinkedEventLabel(
    item.linkedCalendarEventTitle,
    item.linkedCalendarEventStartMs,
    { missing: linkedEventMissing }
  );
  const linkedEventOpenable =
    !linkedEventMissing && !!item.linkedCalendarEventId && !!onOpenLinkedEvent;

  const suggestedEventReasonLabel = suggestedEvent
    ? formatCalendarSuggestionReasonLabel(suggestedEvent.reasons)
    : null;

  return (
    <View
      style={[
        styles.card,
        completed && styles.cardCompleted,
        pending && styles.cardPending,
      ]}
    >
      <Link href={{ pathname: "/goal/[id]", params: { id: item.goalId } }} asChild>
        <Pressable>
          <Text style={[styles.goalTitle, completed && styles.completedText]}>
            {item.goalTitle}
          </Text>

          {item.isSharedAssigned ? (
            <Text style={styles.sharedBadge}>
              {item.sharedSourceGroupName
                ? `Shared • Assigned to me • ${item.sharedSourceGroupName}`
                : "Shared • Assigned to me"}
            </Text>
          ) : null}

          <Text style={[styles.subtaskTitle, completed && styles.completedText]}>
            {completed ? "✓ " : ""}
            {item.title}
          </Text>
        </Pressable>
      </Link>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{metaLine}</Text>

        {recentlyRescheduled ? (
          <Text style={styles.metaBadge}>Rescheduled</Text>
        ) : item.hasScheduleOverride ? (
          <Text style={styles.metaBadge}>
            {getScheduleOverrideBadgeLabel(item.scheduleOverrideSource)}
          </Text>
        ) : null}
      </View>

      {suggestedEvent && onApplySuggestedEvent ? (
        <View style={styles.suggestedEventBox}>
          <Text style={styles.suggestedEventLabel}>
            Suggested event: {suggestedEvent.event.title}
            {" • "}
            {suggestedEvent.event.allDay
              ? "All day"
              : new Date(suggestedEvent.event.startMs).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
          </Text>

          {suggestedEventReasonLabel ? (
            <Text style={styles.suggestedEventReason}>
              {suggestedEventReasonLabel}
            </Text>
          ) : null}

          <Pressable
            onPress={() => onApplySuggestedEvent(suggestedEvent.event)}
            style={styles.suggestedEventBtn}
          >
            <Text style={styles.suggestedEventBtnText}>
              Apply suggested event
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showLinkedEvent && linkedEventLabel ? (
        <Pressable
          onPress={() => onOpenLinkedEvent?.(item)}
          disabled={!linkedEventOpenable}
          style={[
            styles.linkedEvent,
            linkedEventMissing && styles.linkedEventMissing,
          ]}
        >
          <Text
            style={[
              styles.linkedEventText,
              linkedEventMissing && styles.linkedEventMissingText,
            ]}
          >
            {linkedEventMissing
              ? `${linkedEventLabel} • missing from synced calendar`
              : linkedEventLabel}
          </Text>

          {linkedEventOpenable ? (
            <Text style={styles.linkedEventHint}>Open event</Text>
          ) : null}
        </Pressable>
      ) : null}

      {showLinkedEvent && onUnlinkEvent ? (
        <Pressable
          onPress={() => onUnlinkEvent(item)}
          disabled={unlinkPending}
          style={[styles.unlinkBtn, unlinkPending && styles.unlinkBtnDisabled]}
        >
          <Text style={styles.unlinkBtnText}>
            {unlinkPending
              ? "Unlinking..."
              : linkedEventMissing
              ? "Unlink missing event"
              : "Unlink event"}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => onToggle(item)}
        disabled={pending}
        style={({ pressed }) => [
          styles.completeBtn,
          completed && styles.completeBtnCompleted,
          pending && styles.completeBtnDisabled,
          pressed && styles.completeBtnPressed,
        ]}
      >
        <Text
          style={[
            styles.completeBtnText,
            completed && styles.completeBtnCompletedText,
          ]}
        >
          {pending
            ? completed
              ? "Undoing..."
              : "Completing..."
            : completed
            ? "Undo"
            : "Complete"}
        </Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    card: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 4,
    },
    cardCompleted: {
      backgroundColor: theme.colors.secondaryBackground,
    },
    cardPending: {
      opacity: 0.6,
    },
    goalTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
    subtaskTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: theme.colors.text,
      marginTop: 2,
    },
    completedText: {
      color: theme.colors.secondaryText,
      textDecorationLine: "line-through",
    },
    sharedBadge: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 2,
    },
    metaText: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    metaBadge: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
    },
    suggestedEventBox: {
      marginTop: 6,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.badge,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      gap: 4,
    },
    suggestedEventLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    suggestedEventReason: {
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
    suggestedEventBtn: {
      alignSelf: "flex-start",
      marginTop: 2,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    suggestedEventBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    linkedEvent: {
      marginTop: 6,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    linkedEventMissing: {
      backgroundColor: theme.colors.dangerBackground,
      borderColor: theme.colors.dangerBorder,
    },
    linkedEventText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    linkedEventMissingText: {
      color: theme.colors.dangerText,
    },
    linkedEventHint: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    unlinkBtn: {
      alignSelf: "flex-start",
      marginTop: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.secondaryBackground,
    },
    unlinkBtnDisabled: {
      opacity: 0.5,
    },
    unlinkBtnText: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    completeBtn: {
      alignSelf: "flex-start",
      marginTop: 8,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: theme.colors.badge,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    completeBtnCompleted: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
    },
    completeBtnDisabled: {
      opacity: 0.5,
    },
    completeBtnPressed: {
      opacity: 0.7,
    },
    completeBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    completeBtnCompletedText: {
      color: theme.colors.secondaryText,
    },
  });
}
