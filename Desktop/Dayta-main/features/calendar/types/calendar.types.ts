/**
 * Calendar Feature - Domain Models and UI Types
 */

export type ViewMode = "day" | "week" | "month";

export type Goal = {
  id: string;
  userId: string;
  title: string;
  status: "active" | "paused" | "completed";
};

export type CalendarItem = {
  goalId: string;
  goalTitle: string;
  subtaskId: string;
  title: string;
  isSharedAssigned?: boolean;
  sharedSourceGroupName?: string | null;
  frequency?: string;
  dueAtMs?: number | null;
  metricValue?: number | null;
  metricUnit?: string | null;
  contributesToMetric?: boolean;
  hasScheduleOverride?: boolean;
  scheduleOverrideSource?: "suggestedTime" | "snooze" | "skip" | "unscheduled" | null;
  isUnscheduledForSelectedDay?: boolean;
  scheduleKind?: "scheduled" | "unscheduled" | "skipped" | "none";
  scheduleSource?: "override" | "suggested" | "default" | "none";
  linkedCalendarEventId?: string | null;
  linkedCalendarEventTitle?: string | null;
  linkedCalendarEventStartMs?: number | null;
};

export type DatedItem = CalendarItem & {
  date: Date;
  linkedCalendarLastKnownMissing?: boolean | null;
  linkedCalendarMissingAtMs?: number | null;
};

export type RecoveryItem = {
  type: "conflict" | "unscheduled";
  key: string;
  item: DatedItem;
  goalTitle: string;
  title: string;
  detail: string;
  suggestedSlot: { startMs: number; endMs: number } | null;
};

export type GoogleCalendarEvent = {
  id: string;
  userId: string;
  source: "google";
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

export type LatestLinkedEventHistory = {
  decision: string | null;
  reason: string | null;
  previousHandledStartMs: number | null;
  nextEventStartMs: number | null;
  handledAtMs: number | null;
  oldOverrideDueAtMs: number | null;
  oldOverrideSource: string | null;
};

export type ApplyActionMenuTarget = {
  goalId: string;
  subtaskId: string;
  subtaskTitle: string;
  mode: "unlinked" | "linked";
  existingLinkedTitle: string | null;
  nextEventTitle: string | null;
};

export type AutomationHistoryEntry = {
  id: string;
  label: string;
  createdAtMs: number;
};

export type LinkedEventChangeDetection = {
  hasAnyChange: boolean;
  titleChanged: boolean;
  startChanged: boolean;
  endChanged: boolean;
  updatedChanged: boolean;
  usedLegacySnapshotFallback: boolean;

  previousHandledTitle: string | null;
  previousHandledStartMs: number | null;
  previousHandledEndMs: number | null;
  previousHandledUpdatedRaw: string | null;

  currentEventTitle: string | null;
  currentEventStartMs: number | null;
  currentEventEndMs: number | null;
  currentEventUpdatedRaw: string | null;
};

export interface CalendarRangeDayKeys {
  startDayKey: string;
  endDayKey: string;
}

/** Rule types that the post-apply automation prompt can offer to save. */
export type CalendarRuleTypePrompt =
  | "suggest_subtask"
  | "auto_link"
  | "auto_apply_duration";
