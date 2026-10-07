import { useMemo } from "react";
import type {
  DatedItem,
  GoogleCalendarEvent,
  RecoveryItem,
} from "../types/calendar.types";
import {
  DEFAULT_SUGGESTED_SLOT_MINUTES,
  buildOverlapSummary,
  dateKeyLocal,
  doesItemOverlapEventOnDate,
  findFirstAvailableSlotOnDateNotBefore,
  getNoSlotLabel,
  getRecoverySlotLabel,
  getRecoverySuggestionNotBeforeMs,
  sameDay,
  shouldIgnoreConflictForLinkedEvent,
  shouldShowNoMoreOpeningsToday,
  type TimeSlot,
} from "../utils";

export type DayOverlapRow = {
  item: DatedItem;
  overlappingEvents: GoogleCalendarEvent[];
  hasOverlap: boolean;
  suggestedSlot: TimeSlot | null;
};

/**
 * Cross-references the selected day's due items against its Google events to
 * find scheduling conflicts, and proposes an open slot for each one.
 */
export function useDayConflicts(args: {
  dueItems: DatedItem[];
  unscheduledItems: DatedItem[];
  selectedDayEvents: GoogleCalendarEvent[];
  allEventsById: Map<string, GoogleCalendarEvent>;
  selectedDate: Date;
  tz: string;
}) {
  const {
    dueItems,
    unscheduledItems,
    selectedDayEvents,
    allEventsById,
    selectedDate,
    tz,
  } = args;

  const overlaps = useMemo<DayOverlapRow[]>(() => {
    return dueItems.map((item) => {
      const overlappingEvents = selectedDayEvents.filter((event) => {
        if (shouldIgnoreConflictForLinkedEvent(item, event, allEventsById)) {
          return false;
        }
        return doesItemOverlapEventOnDate(item, event);
      });

      const notBeforeMs = getRecoverySuggestionNotBeforeMs({
        itemDate: item.date,
        dueAtMs: item.dueAtMs ?? null,
      });

      const suggestedSlot =
        overlappingEvents.length > 0
          ? findFirstAvailableSlotOnDateNotBefore(
              item.date,
              selectedDayEvents,
              DEFAULT_SUGGESTED_SLOT_MINUTES,
              notBeforeMs
            )
          : null;

      return {
        item,
        overlappingEvents,
        hasOverlap: overlappingEvents.length > 0,
        suggestedSlot,
      };
    });
  }, [dueItems, selectedDayEvents, allEventsById]);

  const overlapSummary = useMemo(() => buildOverlapSummary(overlaps), [overlaps]);

  const overlapByItemKey = useMemo(() => {
    const map = new Map<string, DayOverlapRow>();
    for (const row of overlaps) {
      map.set(
        `${row.item.goalId}:${row.item.subtaskId}:${dateKeyLocal(row.item.date, tz)}`,
        row
      );
    }
    return map;
  }, [overlaps, tz]);

  const recoveryItems = useMemo<RecoveryItem[]>(() => {
    const conflicts: RecoveryItem[] = overlaps
      .filter((row) => row.hasOverlap)
      .map((row) => {
        const noMoreToday = shouldShowNoMoreOpeningsToday({
          date: row.item.date,
          suggestedSlot: row.suggestedSlot,
        });

        return {
          type: "conflict",
          key: `${row.item.goalId}:${row.item.subtaskId}:${dateKeyLocal(
            row.item.date,
            tz
          )}`,
          item: row.item,
          title: row.item.title,
          goalTitle: row.item.goalTitle,
          suggestedSlot: row.suggestedSlot,
          detail: row.suggestedSlot
            ? getRecoverySlotLabel(
                row.suggestedSlot.startMs,
                row.suggestedSlot.endMs
              )
            : getNoSlotLabel(DEFAULT_SUGGESTED_SLOT_MINUTES, { noMoreToday }),
        };
      });

    // Only items pushed off this day by an actual override are recoverable.
    // One-time subtasks that simply have no date yet are backlog, not recovery,
    // and stay in the agenda's own "Unscheduled" bucket.
    const unscheduled: RecoveryItem[] = unscheduledItems
      .filter(
        (item) => item.isUnscheduledForSelectedDay && item.hasScheduleOverride
      )
      .map((item) => {
        const notBeforeMs = getRecoverySuggestionNotBeforeMs({
          itemDate: item.date,
          dueAtMs: null,
        });

        const suggestedSlot = findFirstAvailableSlotOnDateNotBefore(
          item.date,
          selectedDayEvents,
          DEFAULT_SUGGESTED_SLOT_MINUTES,
          notBeforeMs
        );

        const noMoreToday = shouldShowNoMoreOpeningsToday({
          date: item.date,
          suggestedSlot,
        });

        return {
          type: "unscheduled",
          key: `${item.goalId}:${item.subtaskId}:${dateKeyLocal(item.date, tz)}`,
          item,
          title: item.title,
          goalTitle: item.goalTitle,
          suggestedSlot,
          detail: suggestedSlot
            ? getRecoverySlotLabel(suggestedSlot.startMs, suggestedSlot.endMs)
            : getNoSlotLabel(DEFAULT_SUGGESTED_SLOT_MINUTES, { noMoreToday }),
        };
      });

    return [...conflicts, ...unscheduled];
  }, [overlaps, unscheduledItems, selectedDayEvents, tz]);

  const daySuggestedSlot = useMemo(() => {
    if (overlapSummary.timedConflictCount === 0) return null;

    const notBeforeMs = sameDay(selectedDate, new Date()) ? Date.now() : null;

    return findFirstAvailableSlotOnDateNotBefore(
      selectedDate,
      selectedDayEvents,
      DEFAULT_SUGGESTED_SLOT_MINUTES,
      notBeforeMs
    );
  }, [selectedDate, selectedDayEvents, overlapSummary.timedConflictCount]);

  const noSlotMessage = useMemo(() => {
    if (overlapSummary.timedConflictCount === 0 || daySuggestedSlot) return null;

    return getNoSlotLabel(DEFAULT_SUGGESTED_SLOT_MINUTES, {
      noMoreToday: shouldShowNoMoreOpeningsToday({
        date: selectedDate,
        suggestedSlot: daySuggestedSlot,
      }),
    });
  }, [overlapSummary.timedConflictCount, daySuggestedSlot, selectedDate]);

  return {
    overlaps,
    overlapSummary,
    overlapByItemKey,
    recoveryItems,
    daySuggestedSlot,
    noSlotMessage,
  };
}
