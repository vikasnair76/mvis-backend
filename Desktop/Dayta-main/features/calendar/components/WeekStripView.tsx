import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import { dayKeyFromDate, getUserTz } from "../../../services/dateKey";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import { getCombinedCompletionCountForDay, sameDay } from "../utils";

export interface WeekStripViewProps {
  weekDates: Date[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  heatByDayKey: HeatmapByDayKey;
  goalCompletionCountsByDay: Record<string, number>;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekStripView({
  weekDates,
  selectedDate,
  onSelectDate,
  heatByDayKey,
  goalCompletionCountsByDay,
}: WeekStripViewProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);
  const tz = useMemo(() => getUserTz(), []);

  return (
    <View style={styles.weekStrip}>
      {weekDates.map((d) => {
        const isSelected = sameDay(d, selectedDate);
        const dk = dayKeyFromDate(d, tz);
        const dots = Math.min(
          4,
          getCombinedCompletionCountForDay(
            dk,
            heatByDayKey,
            goalCompletionCountsByDay
          )
        );

        return (
          <Pressable
            key={dk}
            onPress={() => onSelectDate(d)}
            style={[styles.weekDay, isSelected && styles.weekDaySelected]}
          >
            <Text
              style={[styles.weekDow, isSelected && styles.weekDowSelected]}
            >
              {DOW_LABELS[d.getDay()]}
            </Text>
            <Text
              style={[
                styles.weekDayNum,
                isSelected && styles.weekDayNumSelected,
              ]}
            >
              {d.getDate()}
            </Text>

            {dots > 0 && (
              <View style={styles.dotsRow}>
                {Array.from({ length: Math.min(3, dots) }).map((_, i) => (
                  <View key={i} style={styles.dot} />
                ))}
                {dots >= 4 && <Text style={styles.dotPlus}>+</Text>}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    weekStrip: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 8,
      marginBottom: 12,
      gap: 6,
    },
    weekDay: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    weekDaySelected: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    weekDow: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.secondaryText,
      marginBottom: 2,
    },
    weekDowSelected: {
      color: theme.colors.primary,
    },
    weekDayNum: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.text,
    },
    weekDayNumSelected: {
      color: theme.colors.primary,
    },
    dotsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      marginTop: 4,
      minHeight: 6,
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.primary,
    },
    dotPlus: {
      fontSize: 8,
      color: theme.colors.primary,
      fontWeight: "700",
    },
  });
}
