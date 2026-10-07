export type CalendarEventSource = "google";

export type CalendarEvent = {
  id: string;
  userId: string;

  source: CalendarEventSource;
  externalId: string;
  calendarId: string;

  title: string;
  description: string | null;
  location: string | null;

  startMs: number;
  endMs: number | null;
  allDay: boolean;

  startDayKey: string;
  endDayKey: string;

  status: string | null;
  htmlLink: string | null;
  rawUpdated: string | null;

  syncedAtMs: number;
};