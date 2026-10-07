import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { IntegratedGroupCalendarEventCard } from "../../../components/groupCalendar/IntegratedGroupCalendarEventCard";
import type { IntegratedGroupCalendarEvent } from "../../../services/groupCalendarIntegration";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

export interface GroupEventsSectionProps {
  events: IntegratedGroupCalendarEvent[];
  loading: boolean;
  partialError: boolean;
  showDate: boolean;
  onSelectEvent: (item: IntegratedGroupCalendarEvent) => void;
}

export function GroupEventsSection({
  events,
  loading,
  partialError,
  showDate,
  onSelectEvent,
}: GroupEventsSectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  if (!loading && !partialError && events.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Group events in view</Text>

      {loading ? <Text style={styles.muted}>Loading group events…</Text> : null}

      {partialError ? (
        <Text style={styles.errorText}>Couldn’t load some group events.</Text>
      ) : null}

      {events.map((item) => (
        <IntegratedGroupCalendarEventCard
          key={`${item.groupId}:${item.event.id}`}
          item={item}
          theme={theme}
          showDate={showDate}
          onPress={() => onSelectEvent(item)}
        />
      ))}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
      gap: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    muted: {
      fontSize: 13,
      color: theme.colors.secondaryText,
    },
    errorText: {
      fontSize: 13,
      color: theme.colors.danger,
    },
  });
}
