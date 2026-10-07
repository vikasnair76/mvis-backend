import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HeatmapByDayKey } from "../../../services/completionsHeatMap";
import { dayKeyFromDate, getUserTz } from "../../../services/dateKey";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import {
  buildMonthGridDates,
  formatMonthYear,
  getCombinedCompletionCountForDay,
  sameDay,
} from "../utils";

export interface MonthGridViewProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  heatByDayKey: HeatmapByDayKey;
  goalCompletionCountsByDay: Record<string, number>;
  monthSummaryLabel?: string;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGridView({
  selectedDate,
  onSelectDate,
  heatByDayKey,
  goalCompletionCountsByDay,
  monthSummaryLabel,
}: MonthGridViewProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);
  const tz = useMemo(() => getUserTz(), []);

  const gridDates = useMemo(
    () => buildMonthGridDates(selectedDate),
    [selectedDate]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.monthHeader}>{formatMonthYear(selectedDate)}</Text>

      <View style={styles.gridShell}>
        <View style={styles.dowRow}>
          {DOW_LABELS.map((d) => (
            <Text key={d} style={styles.dowText}>
              {d}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.gridShell}>
        <View style={styles.grid}>
          {gridDates.map((d) => {
            const inMonth = d.getMonth() === selectedDate.getMonth();
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
                style={[
                  styles.cell,
                  !inMonth && styles.cellOutside,
                  isSelected && styles.cellSelected,
                ]}
              >
                <Text
                  style={[
                    styles.cellText,
                    !inMonth && styles.cellTextOutside,
                    isSelected && styles.cellTextSelected,
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
      </View>

      {monthSummaryLabel ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{monthSummaryLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    container: {
      marginTop: 12,
    },
    monthHeader: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.colors.text,
      marginBottom: 10,
    },
    gridShell: {
      marginBottom: 6,
    },
    dowRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
    },
    dowText: {
      flex: 1,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    cell: {
      width: "14.28%",
      aspectRatio: 1,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: 8,
      padding: 2,
    },
    cellOutside: {
      opacity: 0.3,
    },
    cellSelected: {
      backgroundColor: theme.colors.badge,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    cellText: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.text,
    },
    cellTextOutside: {
      color: theme.colors.secondaryText,
    },
    cellTextSelected: {
      color: theme.colors.primary,
      fontWeight: "800",
    },
    dotsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      marginTop: 2,
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
    summaryRow: {
      marginTop: 8,
      paddingVertical: 4,
    },
    summaryText: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
  });
}
