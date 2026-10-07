import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { ViewMode } from "../types/calendar.types";

export interface CalendarHeaderProps {
  title?: string;
  headerLabel: string;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  showGroupEvents?: boolean;
  onToggleGroupEvents?: () => void;
  hasActiveGroups?: boolean;
}

const VIEW_MODES: ViewMode[] = ["day", "week", "month"];

export function CalendarHeader({
  title = "Calendar",
  headerLabel,
  viewMode,
  onChangeViewMode,
  onPrev,
  onNext,
  onToday,
  showGroupEvents = false,
  onToggleGroupEvents,
  hasActiveGroups = false,
}: CalendarHeaderProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      {/* Date Navigation Bar */}
      <View style={styles.dateBar}>
        <Pressable style={styles.arrowBtn} onPress={onPrev}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

        <View style={styles.dateLabelContainer}>
          <Text style={styles.dateLabel}>{headerLabel}</Text>
        </View>

        <Pressable style={styles.arrowBtn} onPress={onNext}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>

      {/* View Mode Switcher */}
      <View style={styles.controlsRow}>
        <View style={styles.modeRow}>
          {VIEW_MODES.map((mode) => (
            <Pressable
              key={mode}
              onPress={() => onChangeViewMode(mode)}
              style={[
                styles.modePill,
                viewMode === mode && styles.modePillActive,
              ]}
            >
              <Text
                style={[
                  styles.modePillText,
                  viewMode === mode && styles.modePillTextActive,
                ]}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.todayBtn} onPress={onToday}>
          <Text style={styles.todayBtnText}>Today</Text>
        </Pressable>
      </View>

      {/* Optional Group Events Toggle */}
      {hasActiveGroups && onToggleGroupEvents ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: showGroupEvents }}
          accessibilityLabel="Show group events in Calendar"
          onPress={onToggleGroupEvents}
          style={[
            styles.groupTogglePill,
            showGroupEvents && styles.groupTogglePillActive,
          ]}
        >
          <Text
            style={[
              styles.groupToggleText,
              showGroupEvents && styles.groupToggleTextActive,
            ]}
          >
            Group events {showGroupEvents ? "on" : "off"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    container: {
      gap: 12,
      marginBottom: 12,
    },
    title: {
      fontSize: 28,
      fontWeight: "800",
      color: theme.colors.text,
    },
    dateBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    arrowBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.secondaryBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    arrowText: {
      fontSize: 22,
      fontWeight: "600",
      color: theme.colors.text,
      marginTop: -2,
    },
    dateLabelContainer: {
      flex: 1,
      alignItems: "center",
    },
    dateLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    controlsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    modeRow: {
      flexDirection: "row",
      gap: 6,
    },
    modePill: {
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    modePillActive: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    modePillText: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    modePillTextActive: {
      color: theme.colors.primary,
      fontWeight: "700",
    },
    todayBtn: {
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    todayBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.text,
    },
    groupTogglePill: {
      alignSelf: "flex-start",
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    groupTogglePillActive: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    groupToggleText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    groupToggleTextActive: {
      color: theme.colors.primary,
    },
  });
}
