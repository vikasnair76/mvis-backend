import type { CalendarRuleRecord } from "../../../services/calendarRules";
import {
  getSuggestSubtaskRuleBoost,
  normalizeCalendarRuleMatchText,
} from "../../../services/calendarRules";
import type { CalendarItem } from "../types/calendar.types";

/** Only the fields this lookup actually reads off a subtask. */
export type SubtaskRuleCandidate = {
  id: string;
  title?: string | null;
};

export function getApplyPanelSavedRuleSuggestion(args: {
  eventTitle: string;
  subtasks: SubtaskRuleCandidate[];
  goalId: string | null;
  calendarRules: CalendarRuleRecord[];
}): {
  subtaskId: string;
  subtaskTitle: string;
  boost: number;
} | null {
  if (!args.goalId || !args.eventTitle || args.subtasks.length === 0) return null;

  let best: {
    subtaskId: string;
    subtaskTitle: string;
    boost: number;
  } | null = null;

  for (const subtask of args.subtasks) {
    const matchingRules = args.calendarRules.filter(
      (rule) =>
        rule.type === "suggest_subtask" &&
        rule.goalId === args.goalId &&
        rule.subtaskId === subtask.id
    );

    const boost = matchingRules.reduce((bestBoost, rule) => {
      const next = getSuggestSubtaskRuleBoost({
        eventTitle: args.eventTitle,
        ruleMatchText: rule.matchText,
      });
      return next > bestBoost ? next : bestBoost;
    }, 0);

    if (boost <= 0) continue;

    if (!best || boost > best.boost) {
      best = {
        subtaskId: subtask.id,
        subtaskTitle:
          typeof subtask?.title === "string" && subtask.title.trim().length > 0
            ? subtask.title.trim()
            : "Subtask",
        boost,
      };
    }
  }

  return best;
}

export function getSavedRulePreselectionForEvent(args: {
  eventTitle: string;
  items: (CalendarItem & { date: Date })[];
  calendarRules: CalendarRuleRecord[];
}): {
  goalId: string;
  subtaskId: string;
  subtaskTitle: string;
  boost: number;
} | null {
  if (!args.eventTitle || args.items.length === 0) return null;

  let best: {
    goalId: string;
    subtaskId: string;
    subtaskTitle: string;
    boost: number;
  } | null = null;

  for (const item of args.items) {
    const matchingRules = args.calendarRules.filter(
      (rule) =>
        rule.type === "suggest_subtask" &&
        rule.goalId === item.goalId &&
        rule.subtaskId === item.subtaskId
    );

    const boost = matchingRules.reduce((bestBoost, rule) => {
      const next = getSuggestSubtaskRuleBoost({
        eventTitle: args.eventTitle,
        ruleMatchText: rule.matchText,
      });
      return next > bestBoost ? next : bestBoost;
    }, 0);

    if (boost <= 0) continue;

    if (!best || boost > best.boost) {
      best = {
        goalId: item.goalId,
        subtaskId: item.subtaskId,
        subtaskTitle:
          typeof item.title === "string" && item.title.trim().length > 0
            ? item.title.trim()
            : "Subtask",
        boost,
      };
    }
  }

  return best;
}

export function getAutoLinkRuleMatchForEvent(args: {
  eventTitle: string;
  items: (CalendarItem & { date: Date })[];
  calendarRules: CalendarRuleRecord[];
}): {
  goalId: string;
  subtaskId: string;
  subtaskTitle: string;
  boost: number;
} | null {
  if (!args.eventTitle || args.items.length === 0) return null;

  let best: {
    goalId: string;
    subtaskId: string;
    subtaskTitle: string;
    boost: number;
  } | null = null;

  for (const item of args.items) {
    const matchingRules = args.calendarRules.filter(
      (rule) =>
        rule.type === "auto_link" &&
        rule.goalId === item.goalId &&
        rule.subtaskId === item.subtaskId
    );

    const boost = matchingRules.reduce((bestBoost, rule) => {
      const next = getSuggestSubtaskRuleBoost({
        eventTitle: args.eventTitle,
        ruleMatchText: rule.matchText,
      });
      return next > bestBoost ? next : bestBoost;
    }, 0);

    if (boost <= 0) continue;

    if (!best || boost > best.boost) {
      best = {
        goalId: item.goalId,
        subtaskId: item.subtaskId,
        subtaskTitle:
          typeof item.title === "string" && item.title.trim().length > 0
            ? item.title.trim()
            : "Subtask",
        boost,
      };
    }
  }

  return best;
}

export function getAutoApplyDurationRuleMatchForEvent(args: {
  eventTitle: string;
  items: (CalendarItem & { date: Date })[];
  calendarRules: CalendarRuleRecord[];
}): {
  goalId: string;
  subtaskId: string;
  subtaskTitle: string;
  boost: number;
} | null {
  if (!args.eventTitle || args.items.length === 0) return null;

  let best: {
    goalId: string;
    subtaskId: string;
    subtaskTitle: string;
    boost: number;
  } | null = null;

  for (const item of args.items) {
    const matchingRules = args.calendarRules.filter(
      (rule) =>
        rule.type === "auto_apply_duration" &&
        rule.goalId === item.goalId &&
        rule.subtaskId === item.subtaskId
    );

    const itemMetricUnit =
      typeof item.metricUnit === "string" ? item.metricUnit.trim() : "";

    const isDurationCapable =
      !!item.contributesToMetric && itemMetricUnit.length > 0;

    if (!isDurationCapable) continue;
    if (matchingRules.length === 0) continue;

    const boost = matchingRules.reduce((bestBoost, rule) => {
      const next = getSuggestSubtaskRuleBoost({
        eventTitle: args.eventTitle,
        ruleMatchText: rule.matchText,
      });
      return next > bestBoost ? next : bestBoost;
    }, 0);

    if (boost <= 0) continue;

    if (!best || boost > best.boost) {
      best = {
        goalId: item.goalId,
        subtaskId: item.subtaskId,
        subtaskTitle: item.title ?? "Subtask",
        boost,
      };
    }
  }

  return best;
}

export function hasSavedPreferenceForEvent(args: {
  eventTitle: string;
  calendarRules: CalendarRuleRecord[];
}): boolean {
  return args.calendarRules.some((rule) => {
    if (rule.type !== "suggest_subtask") return false;

    return (
      getSuggestSubtaskRuleBoost({
        eventTitle: args.eventTitle,
        ruleMatchText: rule.matchText,
      }) > 0
    );
  });
}

export function hasSavedSuggestPreference(args: {
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  calendarRules: {
    type: string;
    matchText?: string | null;
    goalId?: string | null;
    subtaskId?: string | null;
  }[];
}): boolean {
  const normalizedTitle = normalizeCalendarRuleMatchText(args.eventTitle);
  if (!normalizedTitle) return false;

  return args.calendarRules.some(
    (rule) =>
      rule.type === "suggest_subtask" &&
      rule.matchText === normalizedTitle &&
      rule.goalId === args.goalId &&
      rule.subtaskId === args.subtaskId
  );
}

export function hasAutoLinkRuleForEvent(args: {
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  calendarRules: {
    type: string;
    matchText?: string | null;
    goalId?: string | null;
    subtaskId?: string | null;
  }[];
}): boolean {
  const normalizedTitle = normalizeCalendarRuleMatchText(args.eventTitle);
  if (!normalizedTitle) return false;

  return args.calendarRules.some(
    (rule) =>
      rule.type === "auto_link" &&
      rule.matchText === normalizedTitle &&
      rule.goalId === args.goalId &&
      rule.subtaskId === args.subtaskId
  );
}

export function hasAutoApplyDurationRuleForEvent(args: {
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  calendarRules: {
    type: string;
    matchText?: string | null;
    goalId?: string | null;
    subtaskId?: string | null;
  }[];
}): boolean {
  const normalizedTitle = normalizeCalendarRuleMatchText(args.eventTitle);
  if (!normalizedTitle) return false;

  return args.calendarRules.some(
    (rule) =>
      rule.type === "auto_apply_duration" &&
      rule.matchText === normalizedTitle &&
      rule.goalId === args.goalId &&
      rule.subtaskId === args.subtaskId
  );
}

export function getAutomationPromptKey(args: {
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration";
}): string {
  const normalizedTitle = normalizeCalendarRuleMatchText(args.eventTitle);
  return [
    args.promptType,
    normalizedTitle,
    args.goalId,
    args.subtaskId,
  ].join(":");
}

export function hasMatchingCalendarRule(args: {
  calendarRules: {
    type: string;
    matchText?: string | null;
    goalId?: string | null;
    subtaskId?: string | null;
  }[];
  eventTitle: string;
  goalId: string;
  subtaskId: string;
  promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration";
}): boolean {
  const normalizedTitle = normalizeCalendarRuleMatchText(args.eventTitle);
  if (!normalizedTitle) return false;

  return args.calendarRules.some(
    (rule) =>
      rule.type === args.promptType &&
      rule.goalId === args.goalId &&
      rule.subtaskId === args.subtaskId &&
      rule.matchText === normalizedTitle
  );
}

export function getAutomationPromptTitle(
  promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration"
): string {
  switch (promptType) {
    case "suggest_subtask":
      return "Remember this match?";
    case "auto_link":
      return "Enable automatic linking too?";
    case "auto_apply_duration":
      return "Enable automatic duration updates?";
    default:
      return "Save automation preference?";
  }
}

export function getAutomationPromptBody(args: {
  promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration";
  subtaskTitle: string;
  eventTitle: string;
}): string {
  switch (args.promptType) {
    case "suggest_subtask":
      return `"${args.subtaskTitle}" can be suggested for similar "${args.eventTitle}" events in the future.`;
    case "auto_link":
      return `"${args.subtaskTitle}" can also be linked automatically for similar "${args.eventTitle}" events.`;
    case "auto_apply_duration":
      return `"${args.subtaskTitle}" can automatically receive duration updates for similar "${args.eventTitle}" events.`;
    default:
      return `"${args.subtaskTitle}" can be reused for similar "${args.eventTitle}" events.`;
  }
}

export function getAutomationPromptPrimaryLabel(
  promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration"
): string {
  switch (promptType) {
    case "suggest_subtask":
      return "Remember suggestion";
    case "auto_link":
      return "Enable auto-link";
    case "auto_apply_duration":
      return "Enable auto-apply";
    default:
      return "Save";
  }
}

export function formatAutomationHistoryTime(createdAtMs: number): string {
  const diffMs = Date.now() - createdAtMs;
  if (diffMs < 60_000) return "Just now";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function getEventActionSuccessTitle(
  action: "link_only" | "link_and_use_time"
): string {
  switch (action) {
    case "link_only":
      return "Event linked";
    case "link_and_use_time":
      return "Event linked and time updated";
    default:
      return "Update complete";
  }
}

export function getEventActionSuccessMessage(args: {
  action: "link_only" | "link_and_use_time";
  eventTitle: string;
  subtaskTitle: string;
}): string {
  switch (args.action) {
    case "link_only":
      return `"${args.subtaskTitle}" is now linked to "${args.eventTitle}" for this event.\n\nYou can optionally save this as a future automation preference.`;
    case "link_and_use_time":
      return `"${args.subtaskTitle}" is now linked to "${args.eventTitle}" and its scheduled time was updated for this event.\n\nYou can optionally save this as a future automation preference.`;
    default:
      return `"${args.subtaskTitle}" was updated from "${args.eventTitle}".`;
  }
}

export function getAutomationRuleSuccessMessage(args: {
  type: "auto_link" | "auto_apply_duration" | "suggest_subtask";
  subtaskTitle: string;
}): string {
  switch (args.type) {
    case "auto_link":
      return `"${args.subtaskTitle}" will now auto-link for similar future events.`;
    case "auto_apply_duration":
      return `"${args.subtaskTitle}" will now receive duration automatically for similar future events.`;
    case "suggest_subtask":
      return `"${args.subtaskTitle}" will now be suggested for similar future events.`;
    default:
      return `"${args.subtaskTitle}" will now be reused for similar future events.`;
  }
}

/**
 * Quick apply is only offered when the suggestion is unambiguous and the
 * target subtask is actually still linkable — not a completed one-time
 * subtask, and not a one-time subtask already linked to a different event.
 */
export function canShowQuickSuggestedApply(args: {
  suggestedTaskMatch:
    | {
        mode: "single" | "ambiguous";
        topMatch: {
          item: CalendarItem & { date: Date };
          score: number;
          reasons: string[];
        };
        secondMatch?: {
          item: CalendarItem & { date: Date };
          score: number;
          reasons: string[];
        };
      }
    | null
    | undefined;
  subtasksByGoal: Record<string, any[]>;
}): boolean {
  if (!args.suggestedTaskMatch) return false;
  if (args.suggestedTaskMatch.mode !== "single") return false;

  const suggestedItem = args.suggestedTaskMatch.topMatch.item;
  if (!suggestedItem?.goalId || !suggestedItem?.subtaskId) return false;

  const baseSubtask =
    (args.subtasksByGoal[suggestedItem.goalId] ?? []).find(
      (s: any) => s.id === suggestedItem.subtaskId
    ) ?? null;

  if (!baseSubtask) return false;

  const isOneTime =
    baseSubtask?.scheduleType === "oneTime" || baseSubtask?.frequency === "once";

  const isOnceAlreadyCompleted =
    baseSubtask?.frequency === "once" &&
    baseSubtask?.firstCompletedAtMs != null;

  if (isOnceAlreadyCompleted) return false;

  const linkedEventId =
    typeof baseSubtask?.linkedCalendarEventId === "string" &&
    baseSubtask.linkedCalendarEventId.trim().length > 0
      ? baseSubtask.linkedCalendarEventId.trim()
      : null;

  if (
    isOneTime &&
    linkedEventId &&
    linkedEventId !== suggestedItem.linkedCalendarEventId
  ) {
    return false;
  }

  return true;
}
