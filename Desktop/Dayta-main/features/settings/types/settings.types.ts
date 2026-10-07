/**
 * Settings feature - shared types.
 */

/** Mirror of `users/{uid}/integrations/googleCalendar`. `null` = no doc. */
export type CalendarIntegrationState = {
  connected: boolean;
  googleEmail: string | null;
  selectedCalendarId: string | null;
  lastSyncAtMs: number | null;
  lastError: string | null;
} | null;

/** What a manual connect / sync reports back for the confirmation alert. */
export type GoogleCalendarSyncSummary = {
  eventsCount: number;
  written: number;
};
