import React, { useCallback, useMemo, useState, useEffect } from "react";
import { Linking, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../services/firebase";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";
import type { AppThemeTokens } from "../../services/theme";
import { useIntegratedGroupCalendarEvents } from "../../hooks/useIntegratedGroupCalendarEvents";
import { getCalendarDayBounds } from "../../services/groupCalendarIntegration";
import { dayKeyFromDate, getUserTz } from "../../services/dateKey";
import { calculateCompletionStreak } from "../../services/streaks";
import type { DatedItem, ViewMode } from "./types/calendar.types";
import {
  addDays,
  addMonths,
  buildDaySummaryLabel,
  buildMonthGridDates,
  completionKey,
  dateKeyLocal,
  formatMonthYear,
  getSuggestedSlotLabel,
  sameDay,
  startOfWeekSunday,
} from "./utils";
import {
  useAgendaItems,
  useApplyFlow,
  useAutomationRules,
  useCalendarGoals,
  useCalendarHeatmap,
  useCalendarRules,
  useCalendarSuggestions,
  useDayCompletions,
  useDayConflicts,
  useGoogleCalendar,
  useLinkedEventReconciliation,
  usePlanningEvents,
  useScheduleOverrides,
  useScheduleRecovery,
} from "./hooks";
import {
  ApplyActionSheet,
  ApplyEventPanel,
  AutomationHistorySection,
  AutomationPromptBanner,
  CalendarHeader,
  DayAgendaSection,
  GoogleEventsSection,
  GroupEventsSection,
  MonthGridView,
  PlanningEventsSection,
  RecoverySection,
  WeekStripView,
} from "./components";

const GROUP_EVENT_LIMIT_BY_MODE: Record<ViewMode, number> = {
  day: 100,
  week: 200,
  month: 300,
};

export function CalendarScreen() {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);
  const router = useRouter();

  const [user, setUser] = useState(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [showGroupEvents, setShowGroupEvents] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const uid = user?.uid;
  const tz = useMemo(() => getUserTz(), []);
  const selectedDayKey = useMemo(
    () => dayKeyFromDate(selectedDate, tz),
    [selectedDate, tz]
  );

  const weekDates = useMemo(() => {
    const start = startOfWeekSunday(selectedDate);
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [selectedDate]);

  const monthGridDates = useMemo(
    () => buildMonthGridDates(selectedDate),
    [selectedDate]
  );

  // ---- Domain data ----------------------------------------------------------

  const { visibleGoals, activeGoalIds, subtasksByGoal } = useCalendarGoals(
    uid,
    authReady
  );

  const {
    heatByDayKey,
    setHeatByDayKey,
    goalCompletionCountsByDay,
    rangeKeys,
  } = useCalendarHeatmap({
    userId: uid,
    isReady: authReady,
    selectedDate,
    viewMode,
    weekDates,
    activeGoalIds,
  });

  const { scheduleOverridesByKey, setScheduleOverridesByKey } =
    useScheduleOverrides({
      userId: uid,
      isReady: authReady,
      rangeKeys,
    });

  const { calendarRules } = useCalendarRules(uid, authReady);

  const {
    completedByDayKey,
    goalCompletionsForSelectedDay,
    pendingKeys,
    toggleSubtask,
  } = useDayCompletions({
    userId: uid,
    isReady: authReady,
    selectedDayKey,
    tz,
    activeGoalIds,
    onHeatChange: setHeatByDayKey,
  });

  const { selectedSplit, selectedDayUnscheduledItems } = useAgendaItems({
    userId: uid,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    completedByDayKey,
    selectedDate,
    selectedDayKey,
    viewMode,
    weekDates,
    tz,
  });

  const googleCalendar = useGoogleCalendar({
    userId: uid,
    isReady: authReady,
    rangeKeys,
    selectedDate,
    tz,
  });

  const { suggestedEventByItemKey, suggestedTaskByEventId, candidateItems } =
    useCalendarSuggestions({
      dueItems: selectedSplit.due,
      unscheduledItems: selectedDayUnscheduledItems,
      selectedDayEvents: googleCalendar.selectedDayEvents,
      calendarRules,
      tz,
    });

  const applyFlow = useApplyFlow({
    userId: uid,
    tz,
    calendarRules,
    subtasksByGoal,
    candidateItems,
    onScheduleOverrideApplied: (key, record) =>
      setScheduleOverridesByKey((prev) => ({ ...prev, [key]: record })),
    onCompleteSubtask: toggleSubtask,
  });

  // Runs saved auto_link / auto_apply_duration rules against today's events.
  const automationRules = useAutomationRules({
    userId: uid,
    isReady: authReady,
    selectedDayEvents: googleCalendar.selectedDayEvents,
    candidateItems,
    subtasksByGoal,
    calendarRules,
    onHistoryEntry: applyFlow.addHistoryEntry,
  });

  // Keeps linked subtasks in step with moved / renamed / deleted events.
  const linkedEvents = useLinkedEventReconciliation({
    userId: uid,
    isReady: authReady,
    connected: googleCalendar.connected,
    tz,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    visibleEventsById: googleCalendar.allEventsById,
    onOverrideChanged: (key, record) =>
      setScheduleOverridesByKey((prev) => ({ ...prev, [key]: record })),
    onUnlinked: automationRules.suppressAutoLink,
    onHistoryEntry: applyFlow.addHistoryEntry,
  });

  const {
    overlapSummary,
    recoveryItems,
    daySuggestedSlot,
    noSlotMessage,
  } = useDayConflicts({
    dueItems: selectedSplit.due,
    unscheduledItems: selectedDayUnscheduledItems,
    selectedDayEvents: googleCalendar.selectedDayEvents,
    allEventsById: linkedEvents.eventsById,
    selectedDate,
    tz,
  });

  const scheduleRecovery = useScheduleRecovery({
    userId: uid,
    tz,
    selectedDate,
    subtasksByGoal,
    selectedDayEvents: googleCalendar.selectedDayEvents,
    onOverrideChanged: (key, record) =>
      setScheduleOverridesByKey((prev) => {
        if (record === null) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: record };
      }),
  });

  const {
    planningEvents,
    addEvent: handleAddPlanningEvent,
    removeEvent: handleArchivePlanningEvent,
  } = usePlanningEvents(uid, authReady);

  // ---- Group events ---------------------------------------------------------

  // Fetched for the range actually on screen, not just the selected day,
  // otherwise week/month views show nothing.
  const groupCalendarRange = useMemo(() => {
    const firstDate =
      viewMode === "month"
        ? monthGridDates[0]
        : viewMode === "week"
        ? weekDates[0]
        : selectedDate;
    const lastDate =
      viewMode === "month"
        ? monthGridDates[monthGridDates.length - 1]
        : viewMode === "week"
        ? weekDates[weekDates.length - 1]
        : selectedDate;

    const first = getCalendarDayBounds(dayKeyFromDate(firstDate, tz), tz);
    const last = getCalendarDayBounds(dayKeyFromDate(lastDate, tz), tz);
    return { startMs: first.startMs, endMs: last.endMs };
  }, [viewMode, monthGridDates, weekDates, selectedDate, tz]);

  const integratedGroupCalendar = useIntegratedGroupCalendarEvents({
    uid: uid ?? null,
    rangeStartMs: groupCalendarRange.startMs,
    rangeEndMs: groupCalendarRange.endMs,
    limitPerGroup: GROUP_EVENT_LIMIT_BY_MODE[viewMode],
  });

  // ---- Derived labels -------------------------------------------------------

  const daySummaryLabel = useMemo(() => {
    const agg = heatByDayKey[selectedDayKey];
    return buildDaySummaryLabel({
      subtaskCount: agg?.count ?? 0,
      goalCount: goalCompletionCountsByDay[selectedDayKey] ?? 0,
      metricSum: agg?.metricSum ?? 0,
    });
  }, [heatByDayKey, goalCompletionCountsByDay, selectedDayKey]);

  const currentStreak = useMemo(() => {
    const keys = new Set<string>();

    for (const dayKey of Object.keys(heatByDayKey)) {
      if ((heatByDayKey[dayKey]?.count ?? 0) > 0) keys.add(dayKey);
    }
    for (const dayKey of Object.keys(goalCompletionCountsByDay)) {
      if ((goalCompletionCountsByDay[dayKey] ?? 0) > 0) keys.add(dayKey);
    }

    return calculateCompletionStreak(Array.from(keys).sort(), selectedDayKey);
  }, [heatByDayKey, goalCompletionCountsByDay, selectedDayKey]);

  const headerLabel = useMemo(() => {
    if (viewMode === "month") {
      return formatMonthYear(selectedDate);
    }
    if (viewMode === "week") {
      const start = weekDates[0];
      const end = weekDates[6];
      return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
    if (sameDay(selectedDate, new Date())) {
      return "Today";
    }
    return selectedDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }, [viewMode, selectedDate, weekDates]);

  // ---- Handlers -------------------------------------------------------------

  const handlePrev = () => {
    if (viewMode === "month") {
      setSelectedDate((curr) => addMonths(curr, -1));
    } else if (viewMode === "week") {
      setSelectedDate((curr) => addDays(curr, -7));
    } else {
      setSelectedDate((curr) => addDays(curr, -1));
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      setSelectedDate((curr) => addMonths(curr, 1));
    } else if (viewMode === "week") {
      setSelectedDate((curr) => addDays(curr, 7));
    } else {
      setSelectedDate((curr) => addDays(curr, 1));
    }
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const itemKeyFor = useCallback(
    (item: DatedItem) =>
      `${item.goalId}:${item.subtaskId}:${dateKeyLocal(item.date, tz)}`,
    [tz]
  );

  const handleOpenLinkedEvent = useCallback(
    async (item: DatedItem) => {
      const linkedEventId =
        typeof item.linkedCalendarEventId === "string"
          ? item.linkedCalendarEventId
          : null;
      if (!linkedEventId) return;

      const event = linkedEvents.eventsById.get(linkedEventId);
      if (!event?.htmlLink) return;

      try {
        await Linking.openURL(event.htmlLink);
      } catch (e) {
        console.error("[CalendarScreen] open linked event failed", e);
      }
    },
    [linkedEvents.eventsById]
  );

  const handleToggleItem = useCallback(
    (item: DatedItem) => {
      void toggleSubtask(item.goalId, item.subtaskId, item.date, item.metricValue);
    },
    [toggleSubtask]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Header & Navigation Controls */}
      <CalendarHeader
        headerLabel={headerLabel}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        showGroupEvents={showGroupEvents}
        onToggleGroupEvents={() => setShowGroupEvents((prev) => !prev)}
        hasActiveGroups={integratedGroupCalendar.activeGroupCount > 0}
      />

      {/* 2. Month View Grid */}
      {viewMode === "month" && (
        <MonthGridView
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          heatByDayKey={heatByDayKey}
          goalCompletionCountsByDay={goalCompletionCountsByDay}
        />
      )}

      {/* 3. Week View Strip */}
      {viewMode === "week" && (
        <WeekStripView
          weekDates={weekDates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          heatByDayKey={heatByDayKey}
          goalCompletionCountsByDay={goalCompletionCountsByDay}
        />
      )}

      {/* 4. Agenda For The Selected Day */}
      <DayAgendaSection
        selectedDate={selectedDate}
        summaryLabel={daySummaryLabel}
        currentStreak={currentStreak}
        dueItems={selectedSplit.due}
        completedItems={selectedSplit.completed}
        unscheduledItems={selectedDayUnscheduledItems}
        completedGoals={goalCompletionsForSelectedDay}
        googleEventCount={googleCalendar.selectedDayEvents.length}
        conflictSummaryLabel={
          overlapSummary.totalCount > 0 ? overlapSummary.label : null
        }
        suggestedSlotLabel={
          daySuggestedSlot
            ? getSuggestedSlotLabel(
                daySuggestedSlot.startMs,
                daySuggestedSlot.endMs
              )
            : null
        }
        noSlotMessage={noSlotMessage}
        recentlyRescheduledKeys={scheduleRecovery.recentlyRescheduledKeys}
        pendingKeys={pendingKeys}
        googleEventsById={linkedEvents.eventsById}
        suggestedEventByItemKey={suggestedEventByItemKey}
        itemKeyFor={itemKeyFor}
        onToggleItem={handleToggleItem}
        onOpenLinkedEvent={(item) => void handleOpenLinkedEvent(item)}
        onApplySuggestedEvent={(event) => applyFlow.openForEvent(event)}
        onUnlinkEvent={(item) => void linkedEvents.unlinkEvent(item)}
        pendingUnlinkKeys={linkedEvents.pendingUnlinkKeys}
      />

      {/* 5. Conflict / Unscheduled Recovery */}
      <RecoverySection
        items={recoveryItems}
        isPending={scheduleRecovery.isPending}
        onUseSuggestedTime={(item, slot) =>
          void scheduleRecovery.useSuggestedTime(item, slot)
        }
        onReassignLaterToday={(item) =>
          void scheduleRecovery.reassignLaterToday(item)
        }
        onReassignTomorrowMorning={(item) =>
          void scheduleRecovery.reassignTomorrowMorning(item)
        }
        onMarkUnscheduled={(item) =>
          void scheduleRecovery.markUnscheduledForDay(item)
        }
        onSkipForDay={(item) => void scheduleRecovery.skipForDay(item)}
        onClearOverride={(item) =>
          void scheduleRecovery.clearOverrideForDay(item)
        }
      />

      {/* 6. Google Calendar Events For The Selected Day */}
      <GoogleEventsSection
        events={googleCalendar.selectedDayEvents}
        lastSyncAtMs={googleCalendar.integration?.lastSyncAtMs ?? null}
        manualSyncing={googleCalendar.manualSyncing}
        suggestedTaskByEventId={suggestedTaskByEventId}
        subtasksByGoal={subtasksByGoal}
        calendarRules={calendarRules}
        pendingQuickLinkEventIds={applyFlow.pendingQuickLinkEventIds}
        recentlyQuickLinkedEventIds={applyFlow.recentlyQuickLinkedEventIds}
        onRefresh={() => void googleCalendar.refresh()}
        onApplyEvent={(event, suggestedGoalId) =>
          applyFlow.openForEvent(event, suggestedGoalId)
        }
        onQuickLink={(event, goalId, subtaskId) =>
          void applyFlow.quickLinkSuggestedTask(event, goalId, subtaskId)
        }
      />

      {/* 7. Apply Event -> Subtask Flow */}
      {applyFlow.eventTarget ? (
        <ApplyEventPanel
          eventTarget={applyFlow.eventTarget}
          step={applyFlow.step}
          goals={visibleGoals}
          selectedGoalId={applyFlow.selectedGoalId}
          subtasksByGoal={subtasksByGoal}
          calendarRules={calendarRules}
          actionPending={applyFlow.actionPending}
          openedViaQuickSuggestion={applyFlow.openedViaQuickSuggestion}
          savedRuleSuggestion={applyFlow.savedRuleSuggestion}
          suggestedTaskMatch={
            suggestedTaskByEventId.get(applyFlow.eventTarget.eventId) ?? null
          }
          onSelectGoal={applyFlow.selectGoal}
          onSelectSubtask={applyFlow.setActionMenuTarget}
          onCancel={applyFlow.reset}
        />
      ) : null}

      {/* 8. Post-Apply Automation Prompt */}
      {applyFlow.automationPrompt ? (
        <AutomationPromptBanner
          prompt={applyFlow.automationPrompt}
          onAccept={applyFlow.acceptAutomationPrompt}
          onDismiss={applyFlow.dismissAutomationPrompt}
        />
      ) : null}

      {/* 9. Automation History */}
      <AutomationHistorySection history={applyFlow.automationHistory} />

      {/* 10. Group Events In View */}
      {showGroupEvents && (
        <GroupEventsSection
          events={integratedGroupCalendar.events}
          loading={integratedGroupCalendar.loading}
          partialError={integratedGroupCalendar.partialError}
          showDate={viewMode !== "day"}
          onSelectEvent={(item) =>
            router.push({
              pathname: "/group/[id]/calendar",
              params: { id: item.groupId, eventId: item.event.id },
            } as any)
          }
        />
      )}

      {/* 11. Planning Events Section */}
      <PlanningEventsSection
        events={planningEvents}
        onAddEvent={handleAddPlanningEvent}
        onArchiveEvent={(event) => handleArchivePlanningEvent(event.id)}
      />

      {applyFlow.actionMenuTarget && applyFlow.eventTarget ? (
        <ApplyActionSheet
          target={applyFlow.actionMenuTarget}
          eventTarget={applyFlow.eventTarget}
          subtask={
            (subtasksByGoal[applyFlow.actionMenuTarget.goalId] ?? []).find(
              (s: any) => s.id === applyFlow.actionMenuTarget!.subtaskId
            ) ?? null
          }
          isAlreadyCompletedForEventDay={
            completedByDayKey
              .get(dayKeyFromDate(new Date(applyFlow.eventTarget.startMs), tz))
              ?.has(
                completionKey(
                  applyFlow.actionMenuTarget.goalId,
                  applyFlow.actionMenuTarget.subtaskId
                )
              ) ?? false
          }
          calendarRules={calendarRules}
          actionPending={applyFlow.actionPending}
          onLinkOnly={() =>
            void applyFlow.linkEventToSubtask(
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId,
              applyFlow.eventTarget!
            )
          }
          onLinkAndUseTime={() =>
            void applyFlow.linkEventToSubtask(
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId,
              applyFlow.eventTarget!,
              { useEventTime: true }
            )
          }
          onApplyDuration={() =>
            void applyFlow.applyEventDurationToProgress(
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId,
              applyFlow.eventTarget!
            )
          }
          onMarkComplete={() =>
            void applyFlow.applyEventToCompletion(
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId,
              applyFlow.eventTarget!
            )
          }
          onEnableAutoLink={() =>
            applyFlow.offerAutomationRule(
              "auto_link",
              applyFlow.eventTarget!,
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId
            )
          }
          onEnableAutoApplyDuration={() =>
            applyFlow.offerAutomationRule(
              "auto_apply_duration",
              applyFlow.eventTarget!,
              applyFlow.actionMenuTarget!.goalId,
              applyFlow.actionMenuTarget!.subtaskId
            )
          }
          onClose={applyFlow.closeActionMenu}
        />
      ) : null}
    </ScrollView>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    container: {
      padding: 16,
      paddingBottom: 40,
      backgroundColor: theme.colors.background,
    },
  });
}
