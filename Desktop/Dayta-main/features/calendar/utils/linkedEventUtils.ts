import type {
  Goal,
  GoogleCalendarEvent,
  LinkedEventChangeDetection,
} from "../types/calendar.types";
import { isGroupSharedGoal } from "./goalUtils";

/** A subtask flattened with its goal id, as the reconciler needs it. */
export type LinkedSubtask = any & { goalId: string };

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Every subtask the user owns or is assigned that carries a linked event id.
 * Mirrors the visibility rules the agenda itself uses.
 */
export function getLinkedSubtasks(
  visibleGoals: Goal[],
  subtasksByGoal: Record<string, any[]>,
  uid: string | null
): LinkedSubtask[] {
  const out: LinkedSubtask[] = [];

  for (const goal of visibleGoals) {
    if (goal.status === "completed") continue;

    for (const s of subtasksByGoal[goal.id] ?? []) {
      const isSharedAssigned =
        goal.userId !== uid && isGroupSharedGoal(goal) && s.assignedToUid === uid;
      if (goal.userId !== uid && !isSharedAssigned) continue;

      if (!trimmedOrNull(s.linkedCalendarEventId)) continue;

      out.push({ ...s, goalId: goal.id, goalUserId: goal.userId });
    }
  }

  return out;
}

/**
 * The "last handled" snapshot of the linked event, as stored on the subtask.
 * Older links only stored the event fields, not the handled fields; those
 * fall back to the event fields and are flagged so callers can log it.
 */
export function getNormalizedLinkedEventSnapshot(subtask: any) {
  const eventTitle = trimmedOrNull(subtask?.linkedCalendarEventTitle);
  const eventStartMs = numberOrNull(subtask?.linkedCalendarEventStartMs);
  const eventEndMs = numberOrNull(subtask?.linkedCalendarEventEndMs);
  const eventUpdatedRaw = trimmedOrNull(subtask?.linkedCalendarEventUpdatedRaw);

  const lastHandledStartMs =
    numberOrNull(subtask?.linkedCalendarLastHandledStartMs) ?? eventStartMs;
  const lastHandledEndMs =
    numberOrNull(subtask?.linkedCalendarLastHandledEndMs) ?? eventEndMs;
  const lastHandledUpdatedRaw =
    trimmedOrNull(subtask?.linkedCalendarLastHandledUpdatedRaw) ??
    eventUpdatedRaw;

  const isLegacySnapshot =
    eventStartMs !== null &&
    (typeof subtask?.linkedCalendarLastHandledStartMs !== "number" ||
      (eventEndMs !== null &&
        typeof subtask?.linkedCalendarLastHandledEndMs !== "number") ||
      (eventUpdatedRaw !== null &&
        !trimmedOrNull(subtask?.linkedCalendarLastHandledUpdatedRaw)));

  return {
    eventTitle,
    eventStartMs,
    eventEndMs,
    eventUpdatedRaw,
    lastHandledStartMs,
    lastHandledEndMs,
    lastHandledUpdatedRaw,
    isLegacySnapshot,
  };
}

export function detectLinkedEventChange(args: {
  subtask: any;
  currentEvent: GoogleCalendarEvent | null | undefined;
}): LinkedEventChangeDetection {
  const { subtask, currentEvent } = args;
  const snapshot = getNormalizedLinkedEventSnapshot(subtask);

  const previousHandledTitle = snapshot.eventTitle;
  const previousHandledStartMs = snapshot.lastHandledStartMs;
  const previousHandledEndMs = snapshot.lastHandledEndMs;
  const previousHandledUpdatedRaw = snapshot.lastHandledUpdatedRaw;

  const currentEventTitle = trimmedOrNull(currentEvent?.title);
  const currentEventStartMs = numberOrNull(currentEvent?.startMs);
  const currentEventEndMs = numberOrNull(currentEvent?.endMs);
  const currentEventUpdatedRaw = trimmedOrNull(currentEvent?.rawUpdated);

  const titleChanged = previousHandledTitle !== currentEventTitle;
  const startChanged = previousHandledStartMs !== currentEventStartMs;
  const endChanged = previousHandledEndMs !== currentEventEndMs;
  const updatedChanged = previousHandledUpdatedRaw !== currentEventUpdatedRaw;

  return {
    hasAnyChange: titleChanged || startChanged || endChanged || updatedChanged,
    titleChanged,
    startChanged,
    endChanged,
    updatedChanged,
    usedLegacySnapshotFallback: snapshot.isLegacySnapshot,

    previousHandledTitle,
    previousHandledStartMs,
    previousHandledEndMs,
    previousHandledUpdatedRaw,

    currentEventTitle,
    currentEventStartMs,
    currentEventEndMs,
    currentEventUpdatedRaw,
  };
}

export function isLinkedEventMetadataOnlyChange(
  detection: LinkedEventChangeDetection
): boolean {
  return (
    !detection.startChanged &&
    (detection.titleChanged || detection.endChanged || detection.updatedChanged)
  );
}

export function getLinkedEventMetadataOnlyHistoryReason(
  detection: LinkedEventChangeDetection
):
  | "metadata_only_title_and_end_change"
  | "metadata_only_title_change"
  | "metadata_only_end_change"
  | "metadata_only_refresh" {
  if (detection.titleChanged && detection.endChanged) {
    return "metadata_only_title_and_end_change";
  }
  if (detection.titleChanged) return "metadata_only_title_change";
  if (detection.endChanged) return "metadata_only_end_change";
  return "metadata_only_refresh";
}

/**
 * Recurring subtasks follow any auto_propagate decision. One-time subtasks
 * only follow when they were still aligned to the old event time — a manual
 * reschedule on a one-time task is never overridden by the calendar.
 */
export function shouldAllowControlledAutoFollow(args: {
  isOneTime: boolean;
  decision?: string | null;
  reason?: string | null;
}): boolean {
  if (args.decision !== "auto_propagate") return false;
  if (!args.isOneTime) return true;
  return args.reason === "still_following_old_event_time";
}

/** Patch that fully detaches a subtask from its linked calendar event. */
export const CLEAR_LINKED_EVENT_FIELDS = {
  linkedCalendarEventId: null,
  linkedCalendarEventTitle: null,
  linkedCalendarEventStartMs: null,
  linkedCalendarEventEndMs: null,
  linkedCalendarCalendarId: null,
  linkedCalendarEventUpdatedRaw: null,
  linkedCalendarLinkedAtMs: null,
  linkedCalendarLastSyncedAtMs: null,
  linkedCalendarLastHandledStartMs: null,
  linkedCalendarLastHandledEndMs: null,
  linkedCalendarLastHandledUpdatedRaw: null,
  linkedCalendarLastKnownMissing: null,
  linkedCalendarMissingAtMs: null,
} as const;

/** Snapshot fields to stamp after handling the current event state. */
export function buildHandledLinkedEventPatch(
  detection: LinkedEventChangeDetection,
  now: number
) {
  return {
    linkedCalendarEventTitle: detection.currentEventTitle,
    linkedCalendarEventStartMs: detection.currentEventStartMs,
    linkedCalendarEventEndMs: detection.currentEventEndMs,
    linkedCalendarEventUpdatedRaw: detection.currentEventUpdatedRaw,

    linkedCalendarLastHandledStartMs: detection.currentEventStartMs,
    linkedCalendarLastHandledEndMs: detection.currentEventEndMs,
    linkedCalendarLastHandledUpdatedRaw: detection.currentEventUpdatedRaw,
    linkedCalendarLastSyncedAtMs: now,
  };
}
