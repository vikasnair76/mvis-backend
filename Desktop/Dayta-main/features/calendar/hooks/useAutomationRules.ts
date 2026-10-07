import { useCallback, useEffect, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../../services/firebase";
import type { CalendarRuleRecord } from "../../../services/calendarRules";
import { applySubtaskMetricProgressTx } from "../../../services/subtasks";
import type { DatedItem, GoogleCalendarEvent } from "../types/calendar.types";
import {
  convertEventDurationToMetricValue,
  getAutoApplyDurationRuleMatchForEvent,
  getAutoLinkRuleMatchForEvent,
} from "../utils";

const autoKey = (eventId: string, goalId: string, subtaskId: string) =>
  `${eventId}:${goalId}:${subtaskId}`;

/**
 * Executes saved calendar rules against the selected day's events:
 *  - `auto_link`: links the matching subtask to the event.
 *  - `auto_apply_duration`: adds the event's length to the subtask's metric.
 *
 * Both are idempotent against persisted state (the subtask's
 * `linkedCalendarEventId`, and `autoAppliedDurationEventIds` respectively),
 * so a fresh session never re-runs an already-applied rule.
 */
export function useAutomationRules(args: {
  userId: string | null | undefined;
  isReady: boolean;
  selectedDayEvents: GoogleCalendarEvent[];
  candidateItems: DatedItem[];
  subtasksByGoal: Record<string, any[]>;
  calendarRules: CalendarRuleRecord[];
  onHistoryEntry?: (label: string) => void;
}) {
  const {
    userId,
    isReady,
    selectedDayEvents,
    candidateItems,
    subtasksByGoal,
    calendarRules,
    onHistoryEntry,
  } = args;

  // Keys in flight, so an effect re-run mid-write doesn't double-fire.
  const pendingRef = useRef<Set<string>>(new Set());

  // Manual unlink suppresses re-linking that same pair for this session;
  // otherwise auto-link would immediately undo the user's action.
  const [suppressedAutoLinkKeys, setSuppressedAutoLinkKeys] = useState<
    Set<string>
  >(new Set());

  const suppressAutoLink = useCallback(
    (eventId: string, goalId: string, subtaskId: string) => {
      setSuppressedAutoLinkKeys((prev) =>
        new Set(prev).add(autoKey(eventId, goalId, subtaskId))
      );
    },
    []
  );

  // ---- auto_link ----------------------------------------------------------
  useEffect(() => {
    if (!isReady || !userId) return;
    if (selectedDayEvents.length === 0) return;
    if (!calendarRules.some((rule) => rule.type === "auto_link")) return;

    let cancelled = false;

    const run = async () => {
      for (const event of selectedDayEvents) {
        if (cancelled) return;

        const match = getAutoLinkRuleMatchForEvent({
          eventTitle: event.title ?? "Untitled event",
          items: candidateItems,
          calendarRules,
        });
        if (!match) continue;

        const target = candidateItems.find(
          (item) =>
            item.goalId === match.goalId && item.subtaskId === match.subtaskId
        );
        if (!target) continue;

        // Already linked to this exact event: nothing to do.
        if (target.linkedCalendarEventId === event.id) continue;

        const key = autoKey(event.id, match.goalId, match.subtaskId);
        if (suppressedAutoLinkKeys.has(key)) continue;
        if (pendingRef.current.has(key)) continue;

        pendingRef.current.add(key);

        try {
          const now = Date.now();

          await updateDoc(
            doc(db, "goals", match.goalId, "subtasks", match.subtaskId),
            {
              linkedCalendarEventId: event.id,
              linkedCalendarEventTitle: event.title ?? "Untitled event",
              linkedCalendarEventStartMs: event.startMs,
              linkedCalendarEventEndMs: event.endMs ?? null,
              linkedCalendarCalendarId: event.calendarId ?? null,
              linkedCalendarEventUpdatedRaw: event.rawUpdated ?? null,
              linkedCalendarLinkedAtMs: now,
              linkedCalendarLastSyncedAtMs: now,
              linkedCalendarLastHandledStartMs: event.startMs,
              linkedCalendarLastHandledEndMs: event.endMs ?? null,
              linkedCalendarLastHandledUpdatedRaw: event.rawUpdated ?? null,
              linkedCalendarLastKnownMissing: false,
              linkedCalendarMissingAtMs: null,
            }
          );

          onHistoryEntry?.(
            `Auto-linked "${match.subtaskTitle}" to "${event.title ?? "Untitled event"}"`
          );
        } catch (e) {
          console.error("[useAutomationRules] auto-link failed", {
            eventId: event.id,
            goalId: match.goalId,
            subtaskId: match.subtaskId,
            error: e,
          });
        } finally {
          pendingRef.current.delete(key);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    isReady,
    userId,
    selectedDayEvents,
    candidateItems,
    calendarRules,
    suppressedAutoLinkKeys,
    onHistoryEntry,
  ]);

  // ---- auto_apply_duration -------------------------------------------------
  useEffect(() => {
    if (!isReady || !userId) return;
    if (selectedDayEvents.length === 0) return;
    if (!calendarRules.some((rule) => rule.type === "auto_apply_duration")) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      for (const event of selectedDayEvents) {
        if (cancelled) return;

        const durationMs =
          typeof event.startMs === "number" && typeof event.endMs === "number"
            ? event.endMs - event.startMs
            : 0;
        if (durationMs <= 0) continue;

        const match = getAutoApplyDurationRuleMatchForEvent({
          eventTitle: event.title ?? "Untitled event",
          items: candidateItems,
          calendarRules,
        });
        if (!match) continue;

        const target = candidateItems.find(
          (item) =>
            item.goalId === match.goalId && item.subtaskId === match.subtaskId
        );
        if (!target?.contributesToMetric) continue;

        // Persistent idempotency: skip if this event was already counted.
        const baseSubtask = (subtasksByGoal[match.goalId] ?? []).find(
          (s: any) => s.id === match.subtaskId
        );
        const alreadyApplied: string[] = Array.isArray(
          baseSubtask?.autoAppliedDurationEventIds
        )
          ? baseSubtask.autoAppliedDurationEventIds
          : [];
        if (alreadyApplied.includes(event.id)) continue;

        const key = autoKey(event.id, match.goalId, match.subtaskId);
        if (pendingRef.current.has(key)) continue;

        const metricValue = convertEventDurationToMetricValue(target, {
          startMs: event.startMs,
          endMs: event.endMs ?? null,
        });
        if (
          typeof metricValue !== "number" ||
          !Number.isFinite(metricValue) ||
          metricValue <= 0
        ) {
          continue;
        }

        pendingRef.current.add(key);

        try {
          const result = await applySubtaskMetricProgressTx(
            match.goalId,
            match.subtaskId,
            userId,
            metricValue,
            { autoAppliedEventId: event.id }
          );

          if (result.applied) {
            onHistoryEntry?.(
              `Auto-applied ${metricValue} to "${match.subtaskTitle}" from "${event.title ?? "Untitled event"}"`
            );
          }
        } catch (e) {
          console.error("[useAutomationRules] auto-apply duration failed", {
            eventId: event.id,
            goalId: match.goalId,
            subtaskId: match.subtaskId,
            error: e,
          });
        } finally {
          pendingRef.current.delete(key);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    isReady,
    userId,
    selectedDayEvents,
    candidateItems,
    subtasksByGoal,
    calendarRules,
    onHistoryEntry,
  ]);

  return { suppressAutoLink };
}
