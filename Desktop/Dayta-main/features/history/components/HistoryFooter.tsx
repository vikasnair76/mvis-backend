import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import type { HistoryStyles } from "../styles/history.styles";

interface HistoryFooterProps {
  styles: HistoryStyles;
  theme: AppThemeTokens;
  hasMore: boolean;
  hasEvents: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
}

/** Load-more control, end-of-month marker, or bottom spacer. */
export function HistoryFooter({
  styles,
  theme,
  hasMore,
  hasEvents,
  loading,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: HistoryFooterProps) {
  if (hasMore) {
    return (
      <View style={styles.footer}>
        {loadMoreError ? (
          <Text style={styles.loadMoreError}>
            More history could not be loaded. Try again.
          </Text>
        ) : null}
        <Pressable
          onPress={onLoadMore}
          disabled={loadingMore}
          style={styles.loadMoreButton}
          accessibilityRole="button"
          accessibilityLabel="Load more history events"
          accessibilityState={{ disabled: loadingMore }}
        >
          {loadingMore ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text style={styles.loadMoreText}>
              {loadMoreError ? "Retry load more" : "Load more"}
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (hasEvents && !loading) {
    return (
      <Text
        style={styles.endOfMonth}
        accessibilityLabel="End of history for this month"
      >
        End of history for this month.
      </Text>
    );
  }

  return <View style={styles.footerSpace} />;
}
