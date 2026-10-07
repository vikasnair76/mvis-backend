import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  formatHistoryMonthLabel,
  type HistoryMonthValue,
} from "../../../components/history/PersonalHistoryTimeline";
import type { AppThemeTokens } from "../../../services/theme";
import type { HistoryStyles } from "../styles/history.styles";
import type { HistoryFilter, HistoryUiError } from "../types/history.types";
import { getEmptyLabelForFilter } from "../utils";

interface HistoryEmptyStateProps {
  styles: HistoryStyles;
  theme: AppThemeTokens;
  authReady: boolean;
  loading: boolean;
  signedIn: boolean;
  initialError: HistoryUiError | null;
  selectedMonth: HistoryMonthValue;
  selectedFilter: HistoryFilter;
  onRetry: () => void;
}

/** What the list shows when it has no rows: loading, signed out, error, or empty. */
export function HistoryEmptyState({
  styles,
  theme,
  authReady,
  loading,
  signedIn,
  initialError,
  selectedMonth,
  selectedFilter,
  onRetry,
}: HistoryEmptyStateProps) {
  if (!authReady || loading) {
    return (
      <View
        style={styles.stateCard}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Loading monthly history"
      >
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.stateText}>Loading monthly history…</Text>
      </View>
    );
  }

  if (!signedIn) {
    return (
      <View style={styles.stateCard}>
        <Text style={styles.stateTitle}>Sign in to view History</Text>
        <Text style={styles.stateText}>
          Your personal monthly timeline is available after you sign in.
        </Text>
      </View>
    );
  }

  if (initialError) {
    return (
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>History could not be loaded.</Text>
        <Text style={styles.errorText}>
          {initialError === "permission_denied"
            ? "This history is not available for the current account."
            : "Check your connection and try again."}
        </Text>
        <Pressable
          onPress={onRetry}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading History"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>
        {selectedFilter === "all"
          ? `No history yet for ${formatHistoryMonthLabel(selectedMonth)}.`
          : `No ${getEmptyLabelForFilter(selectedFilter)} this month.`}
      </Text>
      <Text style={styles.stateText}>
        Completed goals, subtasks, planner actions, calendar blocks, and other
        recorded activity will appear here.
      </Text>
    </View>
  );
}
