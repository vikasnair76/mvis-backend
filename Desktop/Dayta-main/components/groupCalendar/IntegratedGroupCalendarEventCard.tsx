import { DateTime } from "luxon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getGroupCalendarTemporalState,
  type IntegratedGroupCalendarEvent,
} from "../../services/groupCalendarIntegration";
import type { AppThemeTokens } from "../../services/theme";

function timeLabel(item: IntegratedGroupCalendarEvent, nowMs: number) {
  const { event } = item;
  if (event.allDay) return "All day";
  const start = DateTime.fromMillis(event.sortStartMs).toLocaleString(
    DateTime.TIME_SIMPLE
  );
  const end = DateTime.fromMillis(event.sortEndMs).toLocaleString(
    DateTime.TIME_SIMPLE
  );
  const state = getGroupCalendarTemporalState(event, nowMs);
  if (state === "ongoing") return `Now · until ${end}`;
  if (state === "ended") return `Ended · ${start}–${end}`;
  return `${start}–${end}`;
}

export function IntegratedGroupCalendarEventCard(props: {
  item: IntegratedGroupCalendarEvent;
  theme: AppThemeTokens;
  nowMs?: number;
  showDate?: boolean;
  onPress: () => void;
}) {
  const { event } = props.item;
  const nowMs = props.nowMs ?? Date.now();
  const timing = timeLabel(props.item, nowMs);
  const date = DateTime.fromMillis(event.sortStartMs).toLocaleString(
    DateTime.DATE_MED
  );
  const location = event.location ? `, ${event.location}` : "";
  const accessibilityLabel = `${event.title}, ${props.item.groupName}, ${
    props.showDate ? `${date}, ` : ""
  }${timing}${location}. Opens group calendar details.`;
  const styles = createStyles(props.theme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={props.onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.badgeRow}>
        <Text style={styles.badge} numberOfLines={1}>
          Group · {props.item.groupName}
        </Text>
      </View>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.meta}>
        {props.showDate ? `${date} · ` : ""}
        {timing}
      </Text>
      {event.location ? (
        <Text style={styles.meta} numberOfLines={2}>
          {event.location}
        </Text>
      ) : null}
    </Pressable>
  );
}

const createStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
    card: {
      width: "100%",
      borderWidth: 1,
      borderColor: theme.colors.primary,
      borderRadius: 12,
      padding: 12,
      backgroundColor: theme.colors.surface,
      gap: 4,
    },
    pressed: { opacity: 0.72 },
    badgeRow: { flexDirection: "row", minWidth: 0 },
    badge: {
      maxWidth: "100%",
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 9,
      paddingVertical: 4,
      fontSize: 11,
      fontWeight: "800",
    },
    title: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
    meta: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  });
