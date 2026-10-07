import { useMemo } from "react";
import type { CalendarRuleRecord } from "../../../services/calendarRules";
import type {
  CalendarItem,
  DatedItem,
  GoogleCalendarEvent,
} from "../types/calendar.types";
import {
  dateKeyLocal,
  getCalendarMatchSuggestion,
  getTaskSuggestionForEvent,
} from "../utils";

export type SuggestedEventMatch = {
  event: GoogleCalendarEvent;
  score: number;
  reasons: string[];
};

export type SuggestedTaskMatch = {
  mode: "single" | "ambiguous";
  topMatch: {
    item: CalendarItem & { date: Date };
    score: number;
    reasons: string[];
  };
  secondMatch?: {
    item: CalendarItem & { date: Date };
    score: number;
    reasons: string[];
  };
};

function isAlreadyLinked(item: { linkedCalendarEventId?: string | null }) {
  return (
    typeof item.linkedCalendarEventId === "string" &&
    item.linkedCalendarEventId.trim().length > 0
  );
}

/**
 * Two-way suggestions between the selected day's agenda items and its synced
 * Google events. Items that are already linked are excluded from both sides.
 */
export function useCalendarSuggestions(args: {
  dueItems: DatedItem[];
  unscheduledItems: DatedItem[];
  selectedDayEvents: GoogleCalendarEvent[];
  calendarRules: CalendarRuleRecord[];
  tz: string;
}) {
  const { dueItems, unscheduledItems, selectedDayEvents, calendarRules, tz } =
    args;

  const candidateItems = useMemo(
    () => [...dueItems, ...unscheduledItems],
    [dueItems, unscheduledItems]
  );

  const suggestedEventByItemKey = useMemo(() => {
    const map = new Map<string, SuggestedEventMatch>();

    for (const item of candidateItems) {
      if (isAlreadyLinked(item)) continue;

      const suggestion = getCalendarMatchSuggestion(item, selectedDayEvents);
      if (!suggestion) continue;

      map.set(
        `${item.goalId}:${item.subtaskId}:${dateKeyLocal(item.date, tz)}`,
        suggestion
      );
    }

    return map;
  }, [candidateItems, selectedDayEvents, tz]);

  const suggestedTaskByEventId = useMemo(() => {
    const map = new Map<string, SuggestedTaskMatch>();
    const unlinked = candidateItems.filter((item) => !isAlreadyLinked(item));

    for (const event of selectedDayEvents) {
      const suggestion = getTaskSuggestionForEvent(
        event,
        unlinked,
        calendarRules
      );
      if (!suggestion) continue;

      map.set(event.id, suggestion);
    }

    return map;
  }, [candidateItems, selectedDayEvents, calendarRules]);

  return { suggestedEventByItemKey, suggestedTaskByEventId, candidateItems };
}
