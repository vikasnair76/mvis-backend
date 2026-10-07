import { Alert, Platform } from "react-native";
import type { CalendarItem, GoogleCalendarEvent } from "../types/calendar.types";
import { DEFAULT_TOMORROW_MORNING_HOUR, sameDay } from "./dateUtils";

/** Working window the slot search will place tasks into: 08:00–20:00 local. */
const WORK_DAY_START_HOUR = 8;
const WORK_DAY_END_HOUR = 20;

export type TimeSlot = { startMs: number; endMs: number };

function workDayBounds(date: Date) {
  const startMs = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    WORK_DAY_START_HOUR,
    0,
    0,
    0
  ).getTime();

  const endMs = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    WORK_DAY_END_HOUR,
    0,
    0,
    0
  ).getTime();

  return { startMs, endMs };
}

/** Timed events clipped to the working window, merged into busy blocks. */
function mergedBusyRanges(
  date: Date,
  events: GoogleCalendarEvent[]
): TimeSlot[] {
  const bounds = workDayBounds(date);

  const ranges = events
    .filter((event) => !event.allDay)
    .map((event) => ({
      startMs: Math.max(event.startMs, bounds.startMs),
      endMs: Math.min(
        event.endMs ?? event.startMs + 60 * 60 * 1000,
        bounds.endMs
      ),
    }))
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: TimeSlot[] = [];

  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.startMs > last.endMs) merged.push({ ...range });
    else last.endMs = Math.max(last.endMs, range.endMs);
  }

  return merged;
}

export function findFirstAvailableSlotOnDate(
  date: Date,
  events: GoogleCalendarEvent[],
  minMinutes: number = 30
): TimeSlot | null {
  const bounds = workDayBounds(date);
  const minMs = minMinutes * 60 * 1000;
  const merged = mergedBusyRanges(date, events);

  if (merged.length === 0) {
    return { startMs: bounds.startMs, endMs: bounds.startMs + minMs };
  }

  let cursor = bounds.startMs;

  for (const range of merged) {
    if (range.startMs - cursor >= minMs) {
      return { startMs: cursor, endMs: cursor + minMs };
    }
    cursor = Math.max(cursor, range.endMs);
  }

  if (bounds.endMs - cursor >= minMs) {
    return { startMs: cursor, endMs: cursor + minMs };
  }

  return null;
}

export function findFirstAvailableSlotAfterTimeOnDate(
  date: Date,
  events: GoogleCalendarEvent[],
  targetStartMs: number,
  minMinutes: number = 30
): TimeSlot | null {
  const bounds = workDayBounds(date);
  const minMs = minMinutes * 60 * 1000;
  const merged = mergedBusyRanges(date, events);

  let cursor = Math.max(bounds.startMs, targetStartMs);

  for (const range of merged) {
    if (range.endMs <= cursor) continue;

    if (range.startMs - cursor >= minMs) {
      return { startMs: cursor, endMs: cursor + minMs };
    }

    if (range.startMs <= cursor && range.endMs > cursor) {
      cursor = range.endMs;
    }
  }

  if (bounds.endMs - cursor >= minMs) {
    return { startMs: cursor, endMs: cursor + minMs };
  }

  return null;
}

/**
 * Like findFirstAvailableSlotOnDate, but never returns a slot starting before
 * `notBeforeMs` — used so "reassign" never suggests a time already past.
 */
export function findFirstAvailableSlotOnDateNotBefore(
  date: Date,
  events: GoogleCalendarEvent[],
  slotMinutes: number,
  notBeforeMs: number | null
): TimeSlot | null {
  const slot = findFirstAvailableSlotOnDate(date, events, slotMinutes);

  if (!slot) return null;
  if (typeof notBeforeMs !== "number") return slot;

  // Stay inside the working window: the caller's label promises an opening
  // "today", not an after-hours slot at 21:00.
  const bounds = workDayBounds(date);
  const slotDurationMs = slotMinutes * 60 * 1000;

  let cursor = Math.max(notBeforeMs, bounds.startMs);

  // Same busy blocks as the other slot searches, so an event with no end
  // still counts as a one-hour block instead of being dropped.
  const busyRanges = mergedBusyRanges(date, events);

  while (cursor + slotDurationMs <= bounds.endMs) {
    const candidateStart = cursor;
    const candidateEnd = candidateStart + slotDurationMs;

    let nextCursor = candidateEnd;
    let overlaps = false;

    for (const range of busyRanges) {
      if (range.startMs < candidateEnd && range.endMs > candidateStart) {
        overlaps = true;
        nextCursor = Math.max(nextCursor, range.endMs);
      }
    }

    if (!overlaps) return { startMs: candidateStart, endMs: candidateEnd };

    cursor = nextCursor;
  }

  return null;
}

/** On today, never suggest a slot in the past (or before the item's own time). */
export function getRecoverySuggestionNotBeforeMs(args: {
  itemDate: Date;
  dueAtMs?: number | null;
}): number | null {
  if (!sameDay(args.itemDate, new Date())) return null;

  const now = Date.now();
  return typeof args.dueAtMs === "number" ? Math.max(now, args.dueAtMs) : now;
}

export function shouldShowNoMoreOpeningsToday(args: {
  date: Date;
  suggestedSlot: TimeSlot | null;
}): boolean {
  return sameDay(args.date, new Date()) && !args.suggestedSlot;
}

export function getTomorrowMorningMs(fromDate: Date): number {
  return new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate() + 1,
    DEFAULT_TOMORROW_MORNING_HOUR,
    0,
    0,
    0
  ).getTime();
}

/**
 * A task never conflicts with the event it is deliberately linked to, as long
 * as that event still exists in the synced calendar.
 */
export function shouldIgnoreConflictForLinkedEvent(
  item: { linkedCalendarEventId?: string | null },
  event: { id: string },
  googleEventById: Map<string, GoogleCalendarEvent>
): boolean {
  const linkedEventId =
    typeof item.linkedCalendarEventId === "string"
      ? item.linkedCalendarEventId.trim()
      : "";

  if (!linkedEventId) return false;
  if (!googleEventById.has(linkedEventId)) return false;

  return linkedEventId === event.id;
}

export function formatGoogleEventTime(event: GoogleCalendarEvent): string {
  if (event.allDay) return "All day";

  return new Date(event.startMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getOverlapSummaryLabel(
  item: CalendarItem & { date: Date },
  overlappingEvents: GoogleCalendarEvent[]
): string {
  const count = overlappingEvents.length;
  const noun = `Google event${count === 1 ? "" : "s"}`;

  return typeof item.dueAtMs === "number"
    ? `Conflicts with ${count} ${noun}`
    : `Blocked by ${count} ${noun}`;
}

export function getOverlapEventLabel(
  item: CalendarItem & { date: Date },
  event: GoogleCalendarEvent
): string {
  if (typeof item.dueAtMs !== "number" && event.allDay) {
    return `All day block • ${event.title}`;
  }

  return `${formatGoogleEventTime(event)} • ${event.title}`;
}

export function getNoSlotLabel(
  slotMinutes: number,
  options?: { noMoreToday?: boolean }
): string {
  if (options?.noMoreToday) return "No more openings today";
  return `No ${slotMinutes}-minute opening available`;
}

export function getSuggestedSlotLabel(startMs: number, endMs: number): string {
  return `Earliest opening today: ${formatSlotRange(startMs, endMs)}`;
}

export function getRecoverySlotLabel(startMs: number, endMs: number): string {
  return `Next opening today: ${formatSlotRange(startMs, endMs)}`;
}

export function getRecoveryTypeLabel(type: "conflict" | "unscheduled"): string {
  return type === "conflict" ? "Conflict" : "Unscheduled";
}

function formatSlotRange(startMs: number, endMs: number): string {
  const opts = { hour: "numeric", minute: "2-digit" } as const;
  return `${new Date(startMs).toLocaleTimeString([], opts)} - ${new Date(
    endMs
  ).toLocaleTimeString([], opts)}`;
}

export function buildOverlapSummary(
  rows: { item: CalendarItem & { date: Date }; hasOverlap: boolean }[]
): {
  timedConflictCount: number;
  untimedBlockedCount: number;
  totalCount: number;
  label: string;
} {
  let timedConflictCount = 0;
  let untimedBlockedCount = 0;

  for (const row of rows) {
    if (!row.hasOverlap) continue;
    if (typeof row.item.dueAtMs === "number") timedConflictCount += 1;
    else untimedBlockedCount += 1;
  }

  const parts: string[] = [];

  if (timedConflictCount > 0) {
    parts.push(
      `${timedConflictCount} timed conflict${timedConflictCount === 1 ? "" : "s"}`
    );
  }

  if (untimedBlockedCount > 0) {
    parts.push(
      `${untimedBlockedCount} untimed item${
        untimedBlockedCount === 1 ? "" : "s"
      } blocked`
    );
  }

  return {
    timedConflictCount,
    untimedBlockedCount,
    totalCount: timedConflictCount + untimedBlockedCount,
    label: parts.join(" • "),
  };
}

/** Promise-based confirm that works on both native and web. */
export function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}
