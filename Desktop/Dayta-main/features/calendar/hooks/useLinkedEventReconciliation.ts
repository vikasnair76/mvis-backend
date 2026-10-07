import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../../services/firebase";
import { applyEventTimeToSubtask } from "../../../services/subtasks";
import { dayKeyFromDate } from "../../../services/dateKey";
import { writeLinkedEventHistory } from "../../../services/linkedEventHistory";
import { getLinkedEventPolicyDecision } from "../../../services/linkedEventPolicy";
import {
  getScheduleOverrideKey,
  type ScheduleOverrideRecord,
} from "../../../services/scheduling";
import type {
  DatedItem,
  Goal,
  GoogleCalendarEvent,
} from "../types/calendar.types";
import {
  CLEAR_LINKED_EVENT_FIELDS,
  buildHandledLinkedEventPatch,
  detectLinkedEventChange,
  getLinkedEventMetadataOnlyHistoryReason,
  getLinkedSubtasks,
  isLinkedEventMetadataOnlyChange,
  shouldAllowControlledAutoFollow,
} from "../utils";

/**
 * Per-event load state from its own document subscription. "loading" must
 * never be treated as missing — that is exactly the false-positive the
 * visible-range lookup used to produce.
 */
type LinkedEventState =
  | { status: "loading" }
  | { status: "present"; event: GoogleCalendarEvent }
  | { status: "missing" };

/**
 * Keeps linked subtasks in step with their Google events:
 *  - subscribes to every linked event document individually, so existence
 *    and freshness don't depend on which days the calendar is showing;
 *  - reconciles moved / renamed / deleted events into the subtask's
 *    metadata, schedule (per policy), history log, and missing-state flags;
 *  - exposes the unlink action.
 */
export function useLinkedEventReconciliation(args: {
  userId: string | null | undefined;
  isReady: boolean;
  connected: boolean;
  tz: string;
  visibleGoals: Goal[];
  subtasksByGoal: Record<string, any[]>;
  scheduleOverridesByKey: Record<string, ScheduleOverrideRecord>;
  visibleEventsById: Map<string, GoogleCalendarEvent>;
  onOverrideChanged: (key: string, record: ScheduleOverrideRecord) => void;
  onUnlinked?: (eventId: string, goalId: string, subtaskId: string) => void;
  onHistoryEntry?: (label: string) => void;
}) {
  const {
    userId,
    isReady,
    connected,
    tz,
    visibleGoals,
    subtasksByGoal,
    scheduleOverridesByKey,
    visibleEventsById,
    onOverrideChanged,
    onUnlinked,
    onHistoryEntry,
  } = args;

  const uid = userId ?? null;

  const [linkedEventStateById, setLinkedEventStateById] = useState<
    Record<string, LinkedEventState>
  >({});
  const [pendingUnlinkKeys, setPendingUnlinkKeys] = useState<Set<string>>(
    new Set()
  );

  const syncingChangeKeysRef = useRef<Set<string>>(new Set());
  const syncingMissingKeysRef = useRef<Set<string>>(new Set());

  const linkedSubtasks = useMemo(
    () => getLinkedSubtasks(visibleGoals, subtasksByGoal, uid),
    [visibleGoals, subtasksByGoal, uid]
  );

  const linkedEventIdsKey = useMemo(
    () =>
      Array.from(
        new Set(
          linkedSubtasks.map((s) => String(s.linkedCalendarEventId).trim())
        )
      )
        .sort()
        .join(","),
    [linkedSubtasks]
  );

  // ---- Per-event document subscriptions ----------------------------------
  useEffect(() => {
    if (!isReady || !uid || !connected || !linkedEventIdsKey) {
      setLinkedEventStateById({});
      return;
    }

    const eventIds = linkedEventIdsKey.split(",");

    setLinkedEventStateById(
      Object.fromEntries(eventIds.map((id) => [id, { status: "loading" }]))
    );

    const unsubs = eventIds.map((eventId) =>
      onSnapshot(
        doc(db, "users", uid, "calendarEvents", eventId),
        (snap) => {
          setLinkedEventStateById((prev) => ({
            ...prev,
            [eventId]: snap.exists()
              ? {
                  status: "present",
                  event: { ...(snap.data() as GoogleCalendarEvent), id: snap.id },
                }
              : { status: "missing" },
          }));
        },
        (err) => {
          console.error(
            "[useLinkedEventReconciliation] linked event subscription failed",
            { eventId, error: err }
          );
        }
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [isReady, uid, connected, linkedEventIdsKey]);

  /**
   * Every known Google event: the dedicated linked-event docs win over the
   * visible-range map, so "missing" is never a range artefact.
   */
  const eventsById = useMemo(() => {
    const map = new Map(visibleEventsById);
    for (const [id, state] of Object.entries(linkedEventStateById)) {
      if (state.status === "present") map.set(id, state.event);
    }
    return map;
  }, [visibleEventsById, linkedEventStateById]);

  // ---- Change reconciliation ----------------------------------------------
  useEffect(() => {
    if (!isReady || !uid || !connected) return;
    if (linkedSubtasks.length === 0) return;

    let cancelled = false;

    const run = async () => {
      for (const subtask of linkedSubtasks) {
        if (cancelled) return;

        const eventId = String(subtask.linkedCalendarEventId).trim();
        const state = linkedEventStateById[eventId];
        if (!state || state.status !== "present") continue;

        const detection = detectLinkedEventChange({
          subtask,
          currentEvent: state.event,
        });
        if (!detection.hasAnyChange) continue;

        const syncKey = `${subtask.goalId}:${subtask.id}:${
          detection.currentEventUpdatedRaw ??
          detection.currentEventStartMs ??
          "none"
        }`;
        if (syncingChangeKeysRef.current.has(syncKey)) continue;
        syncingChangeKeysRef.current.add(syncKey);

        const subtaskRef = doc(db, "goals", subtask.goalId, "subtasks", subtask.id);
        const subtaskTitle =
          typeof subtask.title === "string" && subtask.title.trim()
            ? subtask.title.trim()
            : "Subtask";

        try {
          // Title / end / revision changed, start did not: just refresh.
          if (isLinkedEventMetadataOnlyChange(detection)) {
            await writeLinkedEventHistory({
              userId: uid,
              goalId: subtask.goalId,
              subtaskId: subtask.id,
              eventId,
              eventTitle: detection.currentEventTitle,
              previousHandledStartMs: detection.previousHandledStartMs,
              previousLinkedEventStartMs:
                typeof subtask.linkedCalendarEventStartMs === "number"
                  ? subtask.linkedCalendarEventStartMs
                  : null,
              nextEventStartMs: detection.currentEventStartMs,
              nextEventEndMs: detection.currentEventEndMs,
              previousDayKey:
                typeof detection.previousHandledStartMs === "number"
                  ? dayKeyFromDate(new Date(detection.previousHandledStartMs), tz)
                  : null,
              nextDayKey:
                typeof detection.currentEventStartMs === "number"
                  ? dayKeyFromDate(new Date(detection.currentEventStartMs), tz)
                  : null,
              decision: "metadata_only",
              reason: getLinkedEventMetadataOnlyHistoryReason(detection),
              hadOldDayOverride: false,
              oldOverrideDueAtMs: null,
              oldOverrideIsSkipped: false,
              oldOverrideIsUnscheduled: false,
              oldOverrideSource: null,
            });

            await updateDoc(
              subtaskRef,
              buildHandledLinkedEventPatch(detection, Date.now())
            );
            continue;
          }

          // Start time moved: ask the policy whether the task should follow.
          const previousHandledStartMs = detection.previousHandledStartMs;
          const currentEventStartMs = detection.currentEventStartMs;
          if (previousHandledStartMs === null || currentEventStartMs === null) {
            continue;
          }

          const previousDayKey = dayKeyFromDate(
            new Date(previousHandledStartMs),
            tz
          );
          const override =
            scheduleOverridesByKey[
              getScheduleOverrideKey(subtask.id, previousDayKey)
            ] ?? null;

          const policy = getLinkedEventPolicyDecision({
            previousHandledStartMs,
            currentEventStartMs,
            override,
            subtaskDueAtMs:
              typeof subtask.dueAtMs === "number" ? subtask.dueAtMs : null,
          });

          const isOneTime =
            subtask.scheduleType === "oneTime" || subtask.frequency === "once";

          const shouldFollow = shouldAllowControlledAutoFollow({
            isOneTime,
            decision: policy.decision,
            reason: policy.reason,
          });

          await writeLinkedEventHistory({
            userId: uid,
            goalId: subtask.goalId,
            subtaskId: subtask.id,
            eventId,
            eventTitle: detection.currentEventTitle,
            previousHandledStartMs,
            previousLinkedEventStartMs:
              typeof subtask.linkedCalendarEventStartMs === "number"
                ? subtask.linkedCalendarEventStartMs
                : null,
            nextEventStartMs: currentEventStartMs,
            nextEventEndMs: detection.currentEventEndMs,
            previousDayKey,
            nextDayKey: dayKeyFromDate(new Date(currentEventStartMs), tz),
            decision: shouldFollow ? "auto_propagate" : "metadata_only",
            reason: policy.reason,
            hadOldDayOverride: !!override,
            oldOverrideDueAtMs:
              typeof override?.dueAtMs === "number" ? override.dueAtMs : null,
            oldOverrideIsSkipped: !!override?.isSkipped,
            oldOverrideIsUnscheduled: !!override?.isUnscheduled,
            oldOverrideSource: override?.source ?? null,
          });

          if (shouldFollow) {
            const written = await applyEventTimeToSubtask({
              userId: uid,
              tz,
              goalId: subtask.goalId,
              subtaskId: subtask.id,
              baseSubtask: subtask,
              eventStartMs: currentEventStartMs,
            });
            if (written) onOverrideChanged(written.key, written.record);

            onHistoryEntry?.(`Updated "${subtaskTitle}" to match its event`);
          } else {
            onHistoryEntry?.(
              `"${subtaskTitle}" kept its own time after its event moved`
            );
          }

          await updateDoc(
            subtaskRef,
            buildHandledLinkedEventPatch(detection, Date.now())
          );
        } catch (e) {
          console.error(
            "[useLinkedEventReconciliation] failed to handle linked event change",
            { goalId: subtask.goalId, subtaskId: subtask.id, eventId, error: e }
          );
        } finally {
          syncingChangeKeysRef.current.delete(syncKey);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    isReady,
    uid,
    connected,
    tz,
    linkedSubtasks,
    linkedEventStateById,
    scheduleOverridesByKey,
    onOverrideChanged,
    onHistoryEntry,
  ]);

  // ---- Missing-state reconciliation ---------------------------------------
  useEffect(() => {
    if (!isReady || !uid || !connected) return;
    if (linkedSubtasks.length === 0) return;

    let cancelled = false;

    const run = async () => {
      for (const subtask of linkedSubtasks) {
        if (cancelled) return;

        // Only the goal owner writes missing-state onto the subtask.
        if (subtask.goalUserId !== uid) continue;

        const eventId = String(subtask.linkedCalendarEventId).trim();
        const state = linkedEventStateById[eventId];

        // Still loading: no verdict yet. Never stamp "missing" on unknown.
        if (!state || state.status === "loading") continue;

        const exists = state.status === "present";
        const lastKnownMissing = subtask.linkedCalendarLastKnownMissing === true;

        if (!exists && lastKnownMissing) continue;
        if (exists && !lastKnownMissing && subtask.linkedCalendarMissingAtMs == null) {
          continue;
        }

        const syncKey = `${subtask.goalId}:${subtask.id}:${exists ? "present" : "missing"}`;
        if (syncingMissingKeysRef.current.has(syncKey)) continue;
        syncingMissingKeysRef.current.add(syncKey);

        const subtaskRef = doc(db, "goals", subtask.goalId, "subtasks", subtask.id);
        const linkedStartMs =
          typeof subtask.linkedCalendarEventStartMs === "number"
            ? subtask.linkedCalendarEventStartMs
            : null;

        const historyBase = {
          userId: uid,
          goalId: subtask.goalId,
          subtaskId: subtask.id,
          eventId,
          eventTitle:
            typeof subtask.linkedCalendarEventTitle === "string"
              ? subtask.linkedCalendarEventTitle
              : null,
          previousHandledStartMs:
            typeof subtask.linkedCalendarLastHandledStartMs === "number"
              ? subtask.linkedCalendarLastHandledStartMs
              : linkedStartMs,
          previousLinkedEventStartMs: linkedStartMs,
          nextEventStartMs: linkedStartMs,
          nextEventEndMs:
            typeof subtask.linkedCalendarEventEndMs === "number"
              ? subtask.linkedCalendarEventEndMs
              : null,
          previousDayKey:
            linkedStartMs != null
              ? dayKeyFromDate(new Date(linkedStartMs), tz)
              : null,
          nextDayKey:
            linkedStartMs != null
              ? dayKeyFromDate(new Date(linkedStartMs), tz)
              : null,
          hadOldDayOverride: false,
          oldOverrideDueAtMs: null,
          oldOverrideIsSkipped: false,
          oldOverrideIsUnscheduled: false,
          oldOverrideSource: null,
        } as const;

        try {
          if (!exists) {
            await updateDoc(subtaskRef, {
              linkedCalendarLastKnownMissing: true,
              linkedCalendarMissingAtMs:
                typeof subtask.linkedCalendarMissingAtMs === "number"
                  ? subtask.linkedCalendarMissingAtMs
                  : Date.now(),
            });

            await writeLinkedEventHistory({
              ...historyBase,
              decision: "missing_event_state",
              reason: "linked_event_missing",
            });
            continue;
          }

          // Event is back: clear the flag and refresh the snapshot from it.
          const event = state.event;
          const detection = detectLinkedEventChange({ subtask, currentEvent: event });

          await updateDoc(subtaskRef, {
            linkedCalendarLastKnownMissing: false,
            linkedCalendarMissingAtMs: null,
            ...buildHandledLinkedEventPatch(detection, Date.now()),
          });

          await writeLinkedEventHistory({
            ...historyBase,
            eventTitle: detection.currentEventTitle,
            nextEventStartMs: detection.currentEventStartMs,
            nextEventEndMs: detection.currentEventEndMs,
            decision: "missing_event_state",
            reason: "linked_event_returned",
          });
        } catch (e) {
          console.error(
            "[useLinkedEventReconciliation] failed to reconcile missing state",
            { goalId: subtask.goalId, subtaskId: subtask.id, eventId, error: e }
          );
        } finally {
          syncingMissingKeysRef.current.delete(syncKey);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isReady, uid, connected, tz, linkedSubtasks, linkedEventStateById]);

  // ---- Unlink -------------------------------------------------------------
  const unlinkEvent = useCallback(
    async (item: DatedItem) => {
      const eventId =
        typeof item.linkedCalendarEventId === "string"
          ? item.linkedCalendarEventId.trim()
          : "";
      if (!eventId) return;

      const pendingKey = `${item.goalId}:${item.subtaskId}`;
      if (pendingUnlinkKeys.has(pendingKey)) return;

      const linkedTitle =
        typeof item.linkedCalendarEventTitle === "string" &&
        item.linkedCalendarEventTitle.trim()
          ? item.linkedCalendarEventTitle.trim()
          : "this event";

      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          "Unlink event?",
          `"${item.title}" will no longer follow "${linkedTitle}".`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Unlink", style: "destructive", onPress: () => resolve(true) },
          ]
        )
      );
      if (!confirmed) return;

      setPendingUnlinkKeys((prev) => new Set(prev).add(pendingKey));

      try {
        await updateDoc(
          doc(db, "goals", item.goalId, "subtasks", item.subtaskId),
          CLEAR_LINKED_EVENT_FIELDS
        );

        // Stop auto-link from immediately re-linking the pair the user just broke.
        onUnlinked?.(eventId, item.goalId, item.subtaskId);
        onHistoryEntry?.(`Unlinked "${item.title}" from "${linkedTitle}"`);
      } catch (e: any) {
        console.error("[useLinkedEventReconciliation] unlink failed", e);
        Alert.alert("Couldn't unlink", e?.message ?? "Unknown error");
      } finally {
        setPendingUnlinkKeys((prev) => {
          const next = new Set(prev);
          next.delete(pendingKey);
          return next;
        });
      }
    },
    [pendingUnlinkKeys, onUnlinked, onHistoryEntry]
  );

  return { eventsById, pendingUnlinkKeys, unlinkEvent };
}
