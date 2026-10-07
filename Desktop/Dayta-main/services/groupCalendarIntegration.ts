import { DateTime } from "luxon";
import type { GroupCalendarEventDoc } from "./groupCalendar";

export type IntegratedGroupCalendarEvent = {
  source: "group";
  groupId: string;
  groupName: string;
  event: GroupCalendarEventDoc;
};

export type GroupCalendarTemporalState =
  | "upcoming"
  | "ongoing"
  | "ended"
  | "all_day_active"
  | "future_all_day"
  | "past_all_day";

export function getCalendarDayBounds(dayKey: string, timezone: string) {
  const start = DateTime.fromISO(dayKey, { zone: timezone }).startOf("day");
  if (!start.isValid) throw new Error("Choose a valid calendar day.");
  return {
    startMs: start.toMillis(),
    endMs: start.plus({ days: 1 }).toMillis(),
  };
}

export function overlapsGroupCalendarRange(
  event: GroupCalendarEventDoc,
  rangeStartMs: number,
  rangeEndMs: number
) {
  return (
    event.status === "scheduled" &&
    event.sortStartMs < rangeEndMs &&
    event.sortEndMs > rangeStartMs
  );
}

export function getGroupCalendarTemporalState(
  event: GroupCalendarEventDoc,
  nowMs: number
): GroupCalendarTemporalState {
  if (event.allDay) {
    if (nowMs < event.sortStartMs) return "future_all_day";
    if (nowMs >= event.sortEndMs) return "past_all_day";
    return "all_day_active";
  }
  if (nowMs < event.sortStartMs) return "upcoming";
  if (nowMs >= event.sortEndMs) return "ended";
  return "ongoing";
}

export function safeGroupCalendarName(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "Group event";
}

export function sortIntegratedGroupCalendarEvents(
  items: IntegratedGroupCalendarEvent[]
) {
  return [...items].sort((a, b) => {
    if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
    return (
      a.event.sortStartMs - b.event.sortStartMs ||
      a.groupName.localeCompare(b.groupName) ||
      a.event.title.localeCompare(b.event.title) ||
      a.event.id.localeCompare(b.event.id)
    );
  });
}
