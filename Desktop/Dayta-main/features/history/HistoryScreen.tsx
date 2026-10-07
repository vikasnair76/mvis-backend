import React, { useCallback, useMemo } from "react";
import { RefreshControl, SafeAreaView, SectionList, Text, View } from "react-native";
import { router } from "expo-router";
import {
  HistoryEventRow,
  formatHistoryDayLabel,
  resolvePersonalHistoryNavigationTarget,
} from "../../components/history/PersonalHistoryTimeline";
import type { PersonalHistoryEvent } from "../../services/personalHistory";
import type { PersonalHistoryDayGroup } from "../../services/personalHistoryAggregation";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";
import { HistoryEmptyState, HistoryFooter, HistoryHeader } from "./components";
import { useHistoryTimeline } from "./hooks";
import { createHistoryStyles } from "./styles/history.styles";
import { getDeviceTimeZone } from "./utils";

type HistorySection = PersonalHistoryDayGroup & { data: PersonalHistoryEvent[] };

export function HistoryScreen() {
  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => createHistoryStyles(theme), [theme]);

  const timeZone = getDeviceTimeZone();
  const timeline = useHistoryTimeline(timeZone);
  const signedIn = !!timeline.user?.uid;

  const openEvent = useCallback(
    (event: PersonalHistoryEvent) => {
      const target = resolvePersonalHistoryNavigationTarget(event);
      if (!target) {
        console.info("personal_history_ui_navigation_unavailable", {
          eventType: event.eventType,
          entityType: event.entityType,
        });
        return;
      }

      console.info("history_navigation_opened", {
        eventType: event.eventType,
        entityType: event.entityType,
      });

      timeline.rememberForNavigation();
      router.push(target as never);
    },
    [timeline]
  );

  const onRefresh = useCallback(() => {
    console.info("history_refresh", {
      year: timeline.selectedMonth.year,
      month: timeline.selectedMonth.month,
      timeZone,
      category: timeline.selectedFilter,
    });
    void timeline.loadMonth("refresh");
  }, [timeline, timeZone]);

  return (
    <SafeAreaView style={styles.safe}>
      <SectionList<PersonalHistoryEvent, HistorySection>
        // Remount on any view change so scroll position and row recycling
        // start clean for the new month / filter.
        key={`${timeline.selectedMonth.year}-${timeline.selectedMonth.month}-${timeline.selectedFilter}-${timeZone}`}
        sections={timeline.sections}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => {
          const target = resolvePersonalHistoryNavigationTarget(item);
          return (
            <HistoryEventRow
              event={item}
              timeZone={timeZone}
              theme={theme}
              onOpenEvent={target ? openEvent : undefined}
            />
          );
        }}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader} accessibilityRole="header">
            {formatHistoryDayLabel(section.dayKey, timeZone)}
          </Text>
        )}
        ListHeaderComponent={
          <HistoryHeader
            styles={styles}
            theme={theme}
            signedIn={signedIn}
            selectedMonth={timeline.selectedMonth}
            currentMonth={timeline.currentMonth}
            viewingCurrentMonth={timeline.viewingCurrentMonth}
            canMoveNext={timeline.canMoveNext}
            selectedFilter={timeline.selectedFilter}
            loading={timeline.loading}
            hasSummary={timeline.hasSummary}
            summary={timeline.summary}
            summaryComplete={timeline.summaryComplete}
            summaryError={timeline.summaryError}
            refreshError={timeline.refreshError}
            invalidEventCount={timeline.invalidEventCount}
            onSelectMonth={timeline.selectMonth}
            onSelectFilter={timeline.selectFilter}
            onRetryRefresh={() => void timeline.loadMonth("refresh")}
          />
        }
        ListEmptyComponent={
          <HistoryEmptyState
            styles={styles}
            theme={theme}
            authReady={timeline.authReady}
            loading={timeline.loading}
            signedIn={signedIn}
            initialError={timeline.initialError}
            selectedMonth={timeline.selectedMonth}
            selectedFilter={timeline.selectedFilter}
            onRetry={() => void timeline.loadMonth("initial")}
          />
        }
        ListFooterComponent={
          <HistoryFooter
            styles={styles}
            theme={theme}
            hasMore={timeline.hasMore}
            hasEvents={timeline.events.length > 0}
            loading={timeline.loading}
            loadingMore={timeline.loadingMore}
            loadMoreError={timeline.loadMoreError}
            onLoadMore={() => void timeline.loadMore()}
          />
        }
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={9}
        refreshControl={
          <RefreshControl
            refreshing={timeline.refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            accessibilityLabel="Refresh monthly history"
          />
        }
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: timeline.initialScrollOffset }}
        onScroll={(event) =>
          timeline.rememberScrollOffset(event.nativeEvent.contentOffset.y)
        }
        scrollEventThrottle={32}
      />
    </SafeAreaView>
  );
}
