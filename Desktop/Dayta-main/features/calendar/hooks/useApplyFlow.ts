import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../../services/firebase";
import { dayKeyFromDate } from "../../../services/dateKey";
import {
  applyEventTimeToSubtask as applyEventTimeToSubtaskWrite,
  applySubtaskMetricProgressTx,
} from "../../../services/subtasks";
import {
  createCalendarRule,
  createSuggestSubtaskRule,
  deleteCalendarRules,
  normalizeCalendarRuleMatchText,
  type CalendarRuleRecord,
  type CalendarRuleType,
} from "../../../services/calendarRules";
import type { ScheduleOverrideRecord } from "../../../services/scheduling";
import type {
  ApplyActionMenuTarget,
  AutomationHistoryEntry,
  CalendarRuleTypePrompt,
  DatedItem,
  GoogleCalendarEvent,
} from "../types/calendar.types";
import {
  convertEventDurationToMetricValue,
  formatMetricValueLabel,
  getApplyPanelSavedRuleSuggestion,
  getAutomationPromptKey,
  getTimeMetricUnitKind,
  getAutomationRuleSuccessMessage,
  getEventActionSuccessMessage,
  getEventActionSuccessTitle,
  getSavedRulePreselectionForEvent,
  hasMatchingCalendarRule,
} from "../utils";

export type ApplyEventTarget = {
  eventId: string;
  eventTitle: string;
  startMs: number;
  endMs: number | null;
  calendarId: string | null;
  rawUpdated: string | null;
};

export type AutomationPrompt = {
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  subtaskTitle: string;
  promptType: CalendarRuleTypePrompt;
};

const MAX_AUTOMATION_HISTORY = 20;
/** How long the "Linked just now" badge stays on a quick-linked event. */
const RECENTLY_LINKED_BADGE_MS = 10_000;

function linkedEventPatch(target: ApplyEventTarget, now: number) {
  return {
    linkedCalendarEventId: target.eventId,
    linkedCalendarEventTitle: target.eventTitle,
    linkedCalendarEventStartMs: target.startMs,
    linkedCalendarEventEndMs: target.endMs ?? null,
    linkedCalendarCalendarId: target.calendarId,
    linkedCalendarEventUpdatedRaw: target.rawUpdated ?? null,
    linkedCalendarLinkedAtMs: now,
    linkedCalendarLastKnownMissing: false,
    linkedCalendarMissingAtMs: null,

    linkedCalendarLastSyncedAtMs: now,
    linkedCalendarLastHandledStartMs: target.startMs,
    linkedCalendarLastHandledEndMs: target.endMs ?? null,
    linkedCalendarLastHandledUpdatedRaw: target.rawUpdated ?? null,
  };
}

/**
 * The "apply a Google event to a subtask" flow: goal/subtask selection, the
 * link actions, and the follow-up prompts that turn a manual link into a
 * saved calendar rule.
 */
export function useApplyFlow(args: {
  userId: string | null | undefined;
  tz: string;
  calendarRules: CalendarRuleRecord[];
  subtasksByGoal: Record<string, any[]>;
  candidateItems: DatedItem[];
  onScheduleOverrideApplied?: (
    key: string,
    record: ScheduleOverrideRecord
  ) => void;
  /** Marks a subtask complete for a day; provided by useDayCompletions. */
  onCompleteSubtask?: (
    goalId: string,
    subtaskId: string,
    date: Date,
    metricValue?: number | null
  ) => Promise<void>;
}) {
  const {
    userId,
    tz,
    calendarRules,
    subtasksByGoal,
    candidateItems,
    onScheduleOverrideApplied,
    onCompleteSubtask,
  } = args;

  const [eventTarget, setEventTarget] = useState<ApplyEventTarget | null>(null);
  const [step, setStep] = useState<"goal" | "subtask">("goal");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [actionMenuTarget, setActionMenuTarget] =
    useState<ApplyActionMenuTarget | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [openedViaQuickSuggestion, setOpenedViaQuickSuggestion] =
    useState(false);

  const [automationPrompt, setAutomationPrompt] =
    useState<AutomationPrompt | null>(null);
  const [suppressedPromptKeys, setSuppressedPromptKeys] = useState<Set<string>>(
    new Set()
  );
  const [automationHistory, setAutomationHistory] = useState<
    AutomationHistoryEntry[]
  >([]);
  const [pendingQuickLinkEventIds, setPendingQuickLinkEventIds] = useState<
    Set<string>
  >(new Set());
  const [recentlyQuickLinkedEventIds, setRecentlyQuickLinkedEventIds] =
    useState<Set<string>>(new Set());

  const addHistoryEntry = useCallback((label: string) => {
    setAutomationHistory((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label,
          createdAtMs: Date.now(),
        },
        ...prev,
      ].slice(0, MAX_AUTOMATION_HISTORY)
    );
  }, []);

  const reset = useCallback(() => {
    setEventTarget(null);
    setStep("goal");
    setSelectedGoalId(null);
    setActionMenuTarget(null);
    setOpenedViaQuickSuggestion(false);
  }, []);

  const openForEvent = useCallback(
    (event: GoogleCalendarEvent, suggestedGoalId?: string | null) => {
      const savedRulePreselection = getSavedRulePreselectionForEvent({
        eventTitle: event.title ?? "Untitled event",
        items: candidateItems,
        calendarRules,
      });

      const nextGoalId =
        savedRulePreselection?.goalId ?? suggestedGoalId ?? null;

      setSelectedGoalId(nextGoalId);
      setStep(nextGoalId ? "subtask" : "goal");
      setActionMenuTarget(null);
      setOpenedViaQuickSuggestion(nextGoalId != null);

      setEventTarget({
        eventId: event.id,
        eventTitle: event.title ?? "Untitled event",
        startMs: event.startMs,
        endMs: event.endMs ?? null,
        calendarId: event.calendarId ?? null,
        rawUpdated: event.rawUpdated ?? null,
      });
    },
    [candidateItems, calendarRules]
  );

  const selectGoal = useCallback((goalId: string) => {
    setSelectedGoalId(goalId);
    setStep("subtask");
  }, []);

  const savedRuleSuggestion =
    eventTarget && selectedGoalId
      ? getApplyPanelSavedRuleSuggestion({
          eventTitle: eventTarget.eventTitle,
          goalId: selectedGoalId,
          subtasks: subtasksByGoal[selectedGoalId] ?? [],
          calendarRules,
        })
      : null;

  /** Queue the step-1 prompt unless a rule already exists or it was dismissed. */
  const queuePromptAfterLink = useCallback(
    (target: ApplyEventTarget, goalId: string, subtaskId: string, subtaskTitle: string) => {
      const promptKey = getAutomationPromptKey({
        eventTitle: target.eventTitle,
        goalId,
        subtaskId,
        promptType: "suggest_subtask",
      });

      const alreadySaved = hasMatchingCalendarRule({
        calendarRules,
        eventTitle: target.eventTitle,
        goalId,
        subtaskId,
        promptType: "suggest_subtask",
      });

      if (alreadySaved || suppressedPromptKeys.has(promptKey)) return;

      setAutomationPrompt({
        eventTitle: target.eventTitle,
        goalId,
        subtaskId,
        subtaskTitle,
        promptType: "suggest_subtask",
      });
    },
    [calendarRules, suppressedPromptKeys]
  );

  const getSubtaskTitle = useCallback(
    (goalId: string, subtaskId: string) => {
      const subtask = (subtasksByGoal[goalId] ?? []).find(
        (s: any) => s.id === subtaskId
      );
      return typeof subtask?.title === "string" && subtask.title.trim()
        ? subtask.title.trim()
        : "Subtask";
    },
    [subtasksByGoal]
  );

  const applyEventTimeToSubtask = useCallback(
    async (goalId: string, subtaskId: string, eventStartMs: number) => {
      const baseSubtask = (subtasksByGoal[goalId] ?? []).find(
        (s: any) => s.id === subtaskId
      );
      if (!baseSubtask) throw new Error("Subtask not found");

      const written = await applyEventTimeToSubtaskWrite({
        userId: userId ?? "",
        tz,
        goalId,
        subtaskId,
        baseSubtask,
        eventStartMs,
      });

      if (written) onScheduleOverrideApplied?.(written.key, written.record);
    },
    [subtasksByGoal, tz, userId, onScheduleOverrideApplied]
  );

  const linkEventToSubtask = useCallback(
    async (
      goalId: string,
      subtaskId: string,
      target: ApplyEventTarget,
      options?: { useEventTime?: boolean; silent?: boolean }
    ): Promise<boolean> => {
      if (actionPending) return false;

      const useEventTime = options?.useEventTime === true;

      try {
        setActionPending(true);

        await updateDoc(
          doc(db, "goals", goalId, "subtasks", subtaskId),
          linkedEventPatch(target, Date.now())
        );

        if (useEventTime) {
          await applyEventTimeToSubtask(goalId, subtaskId, target.startMs);
        }

        const subtaskTitle = getSubtaskTitle(goalId, subtaskId);
        const action = useEventTime ? "link_and_use_time" : "link_only";

        addHistoryEntry(
          useEventTime
            ? `Linked "${subtaskTitle}" and updated its time`
            : `Linked "${subtaskTitle}" to "${target.eventTitle}"`
        );

        reset();

        if (options?.silent) {
          queuePromptAfterLink(target, goalId, subtaskId, subtaskTitle);
          return true;
        }

        Alert.alert(
          getEventActionSuccessTitle(action),
          getEventActionSuccessMessage({
            action,
            eventTitle: target.eventTitle,
            subtaskTitle,
          }),
          [
            {
              text: "OK",
              onPress: () =>
                queuePromptAfterLink(target, goalId, subtaskId, subtaskTitle),
            },
          ]
        );

        return true;
      } catch (e: any) {
        console.error("[useApplyFlow] link event to subtask failed", e);
        Alert.alert("Couldn't apply event", e?.message ?? "Unknown error");
        return false;
      } finally {
        setActionPending(false);
      }
    },
    [
      actionPending,
      applyEventTimeToSubtask,
      getSubtaskTitle,
      addHistoryEntry,
      reset,
      queuePromptAfterLink,
    ]
  );

  /** Converts the event's length into the subtask's time metric and applies it. */
  const applyEventDurationToProgress = useCallback(
    async (goalId: string, subtaskId: string, target: ApplyEventTarget) => {
      if (actionPending) return;
      if (!userId) {
        Alert.alert("Sign in required", "Please sign in to update progress.");
        return;
      }

      try {
        setActionPending(true);

        const baseSubtask = (subtasksByGoal[goalId] ?? []).find(
          (s: any) => s.id === subtaskId
        );
        if (!baseSubtask) throw new Error("Subtask not found");

        const metricValue = convertEventDurationToMetricValue(baseSubtask, target);
        if (metricValue == null) {
          throw new Error(
            "This subtask does not support duration-based progress yet."
          );
        }

        await applySubtaskMetricProgressTx(goalId, subtaskId, userId, metricValue);

        const unitKind = getTimeMetricUnitKind(baseSubtask?.metricUnit);
        const valueLabel =
          unitKind === "hours"
            ? `${formatMetricValueLabel(metricValue)} hr`
            : unitKind === "minutes"
            ? `${formatMetricValueLabel(metricValue)} min`
            : formatMetricValueLabel(metricValue);

        const subtaskTitle = getSubtaskTitle(goalId, subtaskId);
        addHistoryEntry(`Applied ${valueLabel} to "${subtaskTitle}"`);

        Alert.alert(
          "Progress applied",
          `"${subtaskTitle}" was updated with ${valueLabel} from "${target.eventTitle}".`
        );

        reset();
      } catch (e: any) {
        console.error("[useApplyFlow] apply event duration failed", e);
        Alert.alert("Update failed", e?.message ?? "Unknown error");
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, userId, subtasksByGoal, getSubtaskTitle, addHistoryEntry, reset]
  );

  /** Marks the subtask complete on the event's day. */
  const applyEventToCompletion = useCallback(
    async (goalId: string, subtaskId: string, target: ApplyEventTarget) => {
      if (actionPending) return;
      if (!onCompleteSubtask) return;

      try {
        setActionPending(true);

        const eventDate = new Date(target.startMs);
        const eventDayKey = dayKeyFromDate(eventDate, tz);
        const subtaskTitle = getSubtaskTitle(goalId, subtaskId);

        await onCompleteSubtask(goalId, subtaskId, eventDate);

        addHistoryEntry(`Completed "${subtaskTitle}" from "${target.eventTitle}"`);

        Alert.alert(
          "Subtask completed",
          `"${subtaskTitle}" was marked complete from "${target.eventTitle}" on ${eventDayKey}.`
        );

        reset();
      } catch (e: any) {
        console.error("[useApplyFlow] apply event to completion failed", e);
        Alert.alert("Update failed", e?.message ?? "Unknown error");
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, onCompleteSubtask, tz, getSubtaskTitle, addHistoryEntry, reset]
  );

  /** Opens the rule prompt directly at a given step, from the action sheet. */
  const offerAutomationRule = useCallback(
    (
      promptType: CalendarRuleTypePrompt,
      target: ApplyEventTarget,
      goalId: string,
      subtaskId: string
    ) => {
      setAutomationPrompt({
        eventTitle: target.eventTitle,
        goalId,
        subtaskId,
        subtaskTitle: getSubtaskTitle(goalId, subtaskId),
        promptType,
      });
      reset();
    },
    [getSubtaskTitle, reset]
  );

  const quickLinkSuggestedTask = useCallback(
    async (event: GoogleCalendarEvent, goalId: string, subtaskId: string) => {
      if (!goalId || !subtaskId) return;
      if (pendingQuickLinkEventIds.has(event.id)) return;

      setPendingQuickLinkEventIds((prev) => new Set(prev).add(event.id));

      try {
        const linked = await linkEventToSubtask(
          goalId,
          subtaskId,
          {
            eventId: event.id,
            eventTitle: event.title ?? "Untitled event",
            startMs: event.startMs,
            endMs: event.endMs ?? null,
            calendarId: event.calendarId ?? null,
            rawUpdated: event.rawUpdated ?? null,
          },
          { silent: true }
        );

        if (linked) {
          setRecentlyQuickLinkedEventIds((prev) => new Set(prev).add(event.id));
          setTimeout(() => {
            setRecentlyQuickLinkedEventIds((prev) => {
              if (!prev.has(event.id)) return prev;
              const next = new Set(prev);
              next.delete(event.id);
              return next;
            });
          }, RECENTLY_LINKED_BADGE_MS);
        }
      } catch (error) {
        console.error("[useApplyFlow] quick suggested link failed", error);
        Alert.alert(
          "Couldn't quick link",
          "Something went wrong while linking this suggested task."
        );
      } finally {
        setPendingQuickLinkEventIds((prev) => {
          const next = new Set(prev);
          next.delete(event.id);
          return next;
        });
      }
    },
    [pendingQuickLinkEventIds, linkEventToSubtask]
  );

  /** Drop stale rules of the same type for this event title before saving. */
  const replaceExistingRulesForEventTitle = useCallback(
    async (params: {
      type: CalendarRuleType;
      eventTitle: string;
      nextGoalId: string;
      nextSubtaskId: string;
    }) => {
      if (!userId) return 0;

      const normalizedTitle = normalizeCalendarRuleMatchText(params.eventTitle);
      if (!normalizedTitle) return 0;

      const stale = calendarRules.filter(
        (rule) =>
          rule.type === params.type &&
          rule.matchText === normalizedTitle &&
          !(
            rule.goalId === params.nextGoalId &&
            rule.subtaskId === params.nextSubtaskId
          )
      );

      let deletedCount = 0;

      for (const rule of stale) {
        deletedCount += await deleteCalendarRules({
          userId,
          type: params.type,
          eventTitle: params.eventTitle,
          goalId: rule.goalId,
          subtaskId: rule.subtaskId,
        });
      }

      return deletedCount;
    },
    [userId, calendarRules]
  );

  const suppressPrompt = useCallback((prompt: AutomationPrompt) => {
    const key = getAutomationPromptKey({
      eventTitle: prompt.eventTitle,
      goalId: prompt.goalId,
      subtaskId: prompt.subtaskId,
      promptType: prompt.promptType,
    });

    if (key) {
      setSuppressedPromptKeys((prev) => new Set(prev).add(key));
    }
  }, []);

  const acceptAutomationPrompt = useCallback(async () => {
    const prompt = automationPrompt;
    if (!prompt || !userId) return;

    try {
      if (prompt.promptType === "suggest_subtask") {
        await replaceExistingRulesForEventTitle({
          type: "suggest_subtask",
          eventTitle: prompt.eventTitle,
          nextGoalId: prompt.goalId,
          nextSubtaskId: prompt.subtaskId,
        });

        await createSuggestSubtaskRule({
          userId,
          eventTitle: prompt.eventTitle,
          goalId: prompt.goalId,
          subtaskId: prompt.subtaskId,
        });

        addHistoryEntry(
          `Saved suggestion preference for "${prompt.subtaskTitle}"`
        );
        suppressPrompt(prompt);

        // Step 2: offer full auto-link for this event title.
        setAutomationPrompt({ ...prompt, promptType: "auto_link" });
        return;
      }

      await replaceExistingRulesForEventTitle({
        type: prompt.promptType,
        eventTitle: prompt.eventTitle,
        nextGoalId: prompt.goalId,
        nextSubtaskId: prompt.subtaskId,
      });

      await createCalendarRule({
        userId,
        type: prompt.promptType,
        eventTitle: prompt.eventTitle,
        goalId: prompt.goalId,
        subtaskId: prompt.subtaskId,
      });

      suppressPrompt(prompt);
      setAutomationPrompt(null);

      addHistoryEntry(
        prompt.promptType === "auto_link"
          ? `Enabled auto-link for "${prompt.subtaskTitle}"`
          : `Enabled auto-apply duration for "${prompt.subtaskTitle}"`
      );

      Alert.alert(
        prompt.promptType === "auto_link"
          ? "Auto-link enabled"
          : "Auto-apply enabled",
        getAutomationRuleSuccessMessage({
          type: prompt.promptType,
          subtaskTitle: prompt.subtaskTitle,
        })
      );
    } catch (error: any) {
      console.error("[useApplyFlow] automation prompt save failed", error);
      Alert.alert(
        "Couldn't save preference",
        error?.message ?? "Unknown error"
      );
    }
  }, [
    automationPrompt,
    userId,
    replaceExistingRulesForEventTitle,
    addHistoryEntry,
    suppressPrompt,
  ]);

  const dismissAutomationPrompt = useCallback(() => {
    if (automationPrompt) suppressPrompt(automationPrompt);
    setAutomationPrompt(null);
  }, [automationPrompt, suppressPrompt]);

  return {
    // apply panel
    eventTarget,
    step,
    selectedGoalId,
    actionMenuTarget,
    actionPending,
    openedViaQuickSuggestion,
    savedRuleSuggestion,
    openForEvent,
    selectGoal,
    setActionMenuTarget,
    closeActionMenu: () => setActionMenuTarget(null),
    reset,

    // link actions
    linkEventToSubtask,
    applyEventDurationToProgress,
    applyEventToCompletion,
    offerAutomationRule,
    quickLinkSuggestedTask,
    pendingQuickLinkEventIds,
    recentlyQuickLinkedEventIds,

    // automation
    automationPrompt,
    acceptAutomationPrompt,
    dismissAutomationPrompt,
    automationHistory,
    addHistoryEntry,
  };
}
