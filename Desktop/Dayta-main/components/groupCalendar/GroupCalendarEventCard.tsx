import { DateTime } from "luxon";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GroupCalendarEventDoc } from "../../services/groupCalendar";
import { UI_SIZES, type AppThemeTokens } from "../../services/theme";

export function formatGroupCalendarDateSpan(
  event: GroupCalendarEventDoc,
  displayTimezone: string,
  includeDate = true
): string {
  if (event.allDay && event.startDate && event.endDate) {
    const start = DateTime.fromISO(event.startDate, { zone: event.timezone });
    const visibleEnd = DateTime.fromISO(event.endDate, {
      zone: event.timezone,
    }).minus({ days: 1 });
    if (start.hasSame(visibleEnd, "day")) {
      return includeDate ? `${start.toFormat("MMM d")} · All day` : "All day";
    }
    const endLabel = start.hasSame(visibleEnd, "year")
      ? visibleEnd.toFormat("MMM d")
      : visibleEnd.toFormat("MMM d, yyyy");
    return `${start.toFormat("MMM d")}–${endLabel} · All day`;
  }

  const start = DateTime.fromMillis(event.startAtMs ?? 0, {
    zone: displayTimezone,
  });
  const end = DateTime.fromMillis(event.endAtMs ?? 0, {
    zone: displayTimezone,
  });
  const datePrefix = includeDate ? `${start.toFormat("ccc, MMM d")} · ` : "";
  const endLabel = start.hasSame(end, "day")
    ? end.toFormat("t")
    : end.toFormat("ccc, MMM d, t");
  return `${datePrefix}${start.toFormat("t")}–${endLabel}`;
}

export function getGroupCalendarEventAccessibilityLabel(
  event: GroupCalendarEventDoc,
  displayTimezone: string
): string {
  const parts = [
    event.title,
    formatGroupCalendarDateSpan(event, displayTimezone, true),
    event.location,
  ].filter(Boolean);
  return parts.join(", ");
}

export function sortGroupCalendarEventsForDisplay(
  events: GroupCalendarEventDoc[]
): GroupCalendarEventDoc[] {
  return [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.sortStartMs !== b.sortStartMs) return a.sortStartMs - b.sortStartMs;
    const titleOrder = a.title.localeCompare(b.title);
    return titleOrder || a.id.localeCompare(b.id);
  });
}

export function GroupCalendarEventCard({
  event,
  displayTimezone,
  theme,
  compact = false,
  onPress,
}: {
  event: GroupCalendarEventDoc;
  displayTimezone: string;
  theme: AppThemeTokens;
  compact?: boolean;
  onPress: () => void;
}) {
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={getGroupCalendarEventAccessibilityLabel(
        event,
        displayTimezone
      )}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.compactCard,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.time}>
        {formatGroupCalendarDateSpan(event, displayTimezone, !compact)}
      </Text>
      <Text style={styles.title} numberOfLines={compact ? 1 : 2}>
        {event.title}
      </Text>
      {event.location ? (
        <Text style={styles.meta} numberOfLines={1}>
          {event.location}
        </Text>
      ) : null}
      {!compact &&
      (event.createdByName || event.attendeeUids.length > 0) ? (
        <View style={styles.footer}>
          {event.createdByName ? (
            <Text style={styles.meta}>Created by {event.createdByName}</Text>
          ) : null}
          {event.attendeeUids.length > 0 ? (
            <Text style={styles.meta}>
              {event.attendeeUids.length} attendee
              {event.attendeeUids.length === 1 ? "" : "s"}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    card: {
      padding: UI_SIZES.cardPadding.md,
      gap: UI_SIZES.spacing.xs,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    compactCard: {
      padding: UI_SIZES.cardPadding.sm,
    },
    pressed: {
      opacity: 0.78,
    },
    time: {
      color: theme.colors.primary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "900",
    },
    title: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "900",
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
    },
    footer: {
      marginTop: UI_SIZES.spacing.xs,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: UI_SIZES.spacing.sm,
    },
  });
}
