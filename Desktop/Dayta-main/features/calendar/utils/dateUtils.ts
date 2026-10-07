import { dayKeyFromDate } from "../../../services/dateKey";
import { dayRangeMs } from "../../../services/scheduling";
import type { PlanningCalendarEventDoc } from "../../../services/planningCalendar";
import type { CalendarRangeDayKeys } from "../types/calendar.types";

export const DEFAULT_SUGGESTED_SLOT_MINUTES = 30;
export const DEFAULT_TOMORROW_MORNING_HOUR = 9;

export function dayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function startOfWeekSunday(d: Date): Date {
  const dow = d.getDay(); // 0=Sun
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
}

export function buildMonthGridDates(d: Date): Date[] {
  const first = startOfMonth(d);
  const gridStart = startOfWeekSunday(first);

  // 6 rows * 7 days = 42 cells
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
  return days;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function monthRangeDayKeys(anchor: Date, tz: string): CalendarRangeDayKeys {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return {
    startDayKey: dayKeyFromDate(start, tz),
    endDayKey: dayKeyFromDate(end, tz),
  };
}

export function weekRangeDayKeys(weekDates: Date[], tz: string): CalendarRangeDayKeys {
  const start = weekDates[0];
  const end = weekDates[6];
  return {
    startDayKey: dayKeyFromDate(start, tz),
    endDayKey: dayKeyFromDate(end, tz),
  };
}

export function parsePlanningDateTime(dateInput: string, timeInput: string): number | null {
  const dateParts = dateInput.trim().split("-");
  const timeParts = timeInput.trim().split(":");

  if (dateParts.length !== 3 || timeParts.length !== 2) return null;

  const [yearText, monthText, dayText] = dateParts;
  const [hourText, minuteText] = timeParts;

  if (
    !/^\d{4}$/.test(yearText) ||
    !/^\d{2}$/.test(monthText) ||
    !/^\d{2}$/.test(dayText) ||
    !/^\d{2}$/.test(hourText) ||
    !/^\d{2}$/.test(minuteText)
  ) {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.getTime();
}

export function formatPlanningEventRange(event: PlanningCalendarEventDoc): string {
  const start = new Date(event.startAtMs);
  const end = new Date(event.endAtMs);
  const dateLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const startLabel = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endLabel = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${dateLabel} · ${startLabel} - ${endLabel}`;
}

export function formatPlanningEventDateLabel(event: PlanningCalendarEventDoc): string {
  const start = new Date(event.startAtMs);

  if (sameDay(start, new Date())) {
    return "Today";
  }
  if (sameDay(start, addDays(new Date(), 1))) {
    return "Tomorrow";
  }

  return start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPlanningEventTimeRange(event: PlanningCalendarEventDoc): string {
  const start = new Date(event.startAtMs);
  const end = new Date(event.endAtMs);
  const startLabel = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endLabel = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${startLabel} - ${endLabel}`;
}

export function doesEventOverlapDate(
  event: {
    startMs: number | null;
    endMs?: number | null;
    allDay?: boolean;
  },
  date: Date
): boolean {
  if (typeof event.startMs !== "number") return false;

  const { start, end } = dayRangeMs(date);
  const eventStart = event.startMs;
  const eventEnd = typeof event.endMs === "number" ? event.endMs : eventStart;

  return eventStart < end && eventEnd > start;
}

export function formatRelativeSyncTime(lastSyncAtMs?: number | null): string {
  if (!lastSyncAtMs) return "Never synced yet";

  const diffMs = Date.now() - lastSyncAtMs;
  if (diffMs < 60 * 1000) return "Last synced just now";

  const diffMin = Math.floor(diffMs / (60 * 1000));
  if (diffMin < 60) {
    return `Last synced ${diffMin} min ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `Last synced ${diffHr} hr ago`;
  }

  const diffDay = Math.floor(diffHr / 24);
  return `Last synced ${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

export function withDayAndTime(baseDate: Date, timeMs: number): number {
  const t = new Date(timeMs);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
    t.getMilliseconds()
  ).getTime();
}
