import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  HistorySummaryCard,
  formatHistoryMonthLabel,
  shiftHistoryMonth,
  type HistoryMonthValue,
} from "../../../components/history/PersonalHistoryTimeline";
import type { PersonalHistoryMonthSummary } from "../../../services/personalHistoryAggregation";
import type { AppThemeTokens } from "../../../services/theme";
import type { HistoryStyles } from "../styles/history.styles";
import type { HistoryFilter } from "../types/history.types";
import { HISTORY_FILTERS } from "../utils";

interface HistoryHeaderProps {
  styles: HistoryStyles;
  theme: AppThemeTokens;
  signedIn: boolean;
  selectedMonth: HistoryMonthValue;
  currentMonth: HistoryMonthValue;
  viewingCurrentMonth: boolean;
  canMoveNext: boolean;
  selectedFilter: HistoryFilter;
  loading: boolean;
  hasSummary: boolean;
  summary: PersonalHistoryMonthSummary;
  summaryComplete: boolean;
  summaryError: boolean;
  refreshError: boolean;
  invalidEventCount: number;
  onSelectMonth: (month: HistoryMonthValue) => void;
  onSelectFilter: (filter: HistoryFilter) => void;
  onRetryRefresh: () => void;
}

/** Title, month navigator, summary card, filter chips, and quiet notices. */
export function HistoryHeader({
  styles,
  theme,
  signedIn,
  selectedMonth,
  currentMonth,
  viewingCurrentMonth,
  canMoveNext,
  selectedFilter,
  loading,
  hasSummary,
  summary,
  summaryComplete,
  summaryError,
  refreshError,
  invalidEventCount,
  onSelectMonth,
  onSelectFilter,
  onRetryRefresh,
}: HistoryHeaderProps) {
  return (
    <View style={styles.headerContent}>
      <Text style={styles.title} accessibilityRole="header">
        History
      </Text>
      <Text style={styles.subtitle}>
        A factual monthly timeline of recorded activity.
      </Text>

      <View style={styles.monthControls}>
        <Pressable
          onPress={() => onSelectMonth(shiftHistoryMonth(selectedMonth, -1))}
          style={styles.monthButton}
          accessibilityRole="button"
          accessibilityLabel="Show previous month"
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.monthLabel} accessibilityRole="header">
          {formatHistoryMonthLabel(selectedMonth)}
        </Text>
        <Pressable
          onPress={() => onSelectMonth(shiftHistoryMonth(selectedMonth, 1))}
          disabled={!canMoveNext}
          style={[styles.monthButton, !canMoveNext && styles.monthButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Show next month"
          accessibilityState={{ disabled: !canMoveNext }}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={canMoveNext ? theme.colors.text : theme.colors.textMuted}
          />
        </Pressable>
      </View>

      {!viewingCurrentMonth ? (
        <Pressable
          onPress={() => onSelectMonth(currentMonth)}
          style={styles.currentMonthButton}
          accessibilityRole="button"
          accessibilityLabel="Return to current month"
        >
          <Text style={styles.currentMonthText}>Current month</Text>
        </Pressable>
      ) : null}

      {signedIn && !loading && hasSummary ? (
        <>
          <HistorySummaryCard
            summary={summary}
            summaryComplete={summaryComplete}
            theme={theme}
          />
          <Text style={styles.summaryContract}>
            Summary reflects all activity this month.
          </Text>
        </>
      ) : null}

      {signedIn ? (
        <View style={styles.filterSection}>
          <Text style={styles.filterHeading} accessibilityRole="header">
            Timeline category
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
            accessibilityRole="tablist"
          >
            {HISTORY_FILTERS.map((filter) => {
              const selected = selectedFilter === filter.value;
              return (
                <Pressable
                  key={filter.value}
                  onPress={() => onSelectFilter(filter.value)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}
                  accessibilityRole="tab"
                  accessibilityLabel={`Show ${filter.label} history`}
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selected && styles.filterChipTextSelected,
                    ]}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {refreshError ? (
        <View style={styles.quietNotice}>
          <Text style={styles.quietNoticeText}>
            History could not be refreshed. Showing the previously loaded data.
          </Text>
          <Pressable
            onPress={onRetryRefresh}
            accessibilityRole="button"
            accessibilityLabel="Retry history refresh"
          >
            <Text style={styles.noticeAction}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {signedIn && !loading && summaryError ? (
        <View style={styles.quietNotice}>
          <Text style={styles.quietNoticeText}>
            Monthly totals could not be loaded. Timeline items remain available.
          </Text>
        </View>
      ) : null}

      {invalidEventCount > 0 ? (
        <Text style={styles.malformedNotice}>
          Some history items could not be displayed.
        </Text>
      ) : null}
    </View>
  );
}
