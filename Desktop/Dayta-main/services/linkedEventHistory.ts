import {
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";

import type {
  LinkedEventPolicyDecision,
  LinkedEventPolicyReason,
} from "./linkedEventPolicy";


export type LinkedEventHistoryDecision =
  | LinkedEventPolicyDecision
  | "metadata_only"
  | "missing_event_state";

export type LinkedEventHistoryReason =
  | LinkedEventPolicyReason
  | "metadata_only_title_change"
  | "metadata_only_end_change"
  | "metadata_only_title_and_end_change"
  | "metadata_only_refresh"
  | "linked_event_missing"
  | "linked_event_returned";

export type WriteLinkedEventHistoryInput = {
  userId: string;
  goalId: string;
  subtaskId: string;

  eventId: string | null;
  eventTitle: string | null;

  previousHandledStartMs: number | null;
  previousLinkedEventStartMs: number | null;
  nextEventStartMs: number | null;
  nextEventEndMs: number | null;

  previousDayKey: string | null;
  nextDayKey: string | null;

  decision: LinkedEventHistoryDecision;
  reason: LinkedEventHistoryReason;

  hadOldDayOverride: boolean;
  oldOverrideDueAtMs: number | null;
  oldOverrideIsSkipped: boolean;
  oldOverrideIsUnscheduled: boolean;
  oldOverrideSource: string | null;
};

function sanitizeHistoryIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildLinkedEventHistoryId(
  eventId: string | null,
  previousHandledStartMs: number | null,
  nextEventStartMs: number | null
) {
  const safeEventId = sanitizeHistoryIdPart(eventId ?? "no_event");
  const oldPart =
    previousHandledStartMs == null ? "null" : String(previousHandledStartMs);
  const newPart =
    nextEventStartMs == null ? "null" : String(nextEventStartMs);

  return `${safeEventId}__${oldPart}__${newPart}`;
}

export async function writeLinkedEventHistory(
  input: WriteLinkedEventHistoryInput
) {
  const historyId = buildLinkedEventHistoryId(
    input.eventId,
    input.previousHandledStartMs,
    input.nextEventStartMs
  );

  const historyRef = doc(
    db,
    "goals",
    input.goalId,
    "subtasks",
    input.subtaskId,
    "linkedEventHistory",
    historyId
  );

  await setDoc(
    historyRef,
    {
      userId: input.userId,
      goalId: input.goalId,
      subtaskId: input.subtaskId,

      eventId: input.eventId,
      eventTitle: input.eventTitle,

      previousHandledStartMs: input.previousHandledStartMs,
      previousLinkedEventStartMs: input.previousLinkedEventStartMs,
      nextEventStartMs: input.nextEventStartMs,
      nextEventEndMs: input.nextEventEndMs,

      previousDayKey: input.previousDayKey,
      nextDayKey: input.nextDayKey,

      decision: input.decision,
      reason: input.reason,

      hadOldDayOverride: input.hadOldDayOverride,
      oldOverrideDueAtMs: input.oldOverrideDueAtMs,
      oldOverrideIsSkipped: input.oldOverrideIsSkipped,
      oldOverrideIsUnscheduled: input.oldOverrideIsUnscheduled,
      oldOverrideSource: input.oldOverrideSource,

      handledAtMs: Date.now(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  return historyId;
}