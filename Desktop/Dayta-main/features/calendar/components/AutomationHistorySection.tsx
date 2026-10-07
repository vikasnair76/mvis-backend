import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { AutomationHistoryEntry } from "../types/calendar.types";
import { formatAutomationHistoryTime } from "../utils";

const COLLAPSED_COUNT = 3;

export interface AutomationHistorySectionProps {
  history: AutomationHistoryEntry[];
}

export function AutomationHistorySection({
  history,
}: AutomationHistorySectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);
  const [showAll, setShowAll] = useState(false);

  if (history.length === 0) return null;

  const visible = showAll ? history : history.slice(0, COLLAPSED_COUNT);
  const hiddenCount = history.length - COLLAPSED_COUNT;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent automation actions</Text>

        {hiddenCount > 0 ? (
          <Pressable
            onPress={() => setShowAll((prev) => !prev)}
            style={styles.toggleBtn}
          >
            <Text style={styles.toggleBtnText}>
              {showAll ? "Hide" : `Show ${hiddenCount} more`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {visible.map((entry) => (
        <View key={entry.id} style={styles.row}>
          <Text style={styles.rowLabel}>{entry.label}</Text>
          <Text style={styles.rowTime}>
            {formatAutomationHistoryTime(entry.createdAtMs)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    title: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.text,
    },
    toggleBtn: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.badge,
    },
    toggleBtnText: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    row: {
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    rowLabel: {
      fontSize: 13,
      color: theme.colors.text,
    },
    rowTime: {
      marginTop: 2,
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
  });
}
