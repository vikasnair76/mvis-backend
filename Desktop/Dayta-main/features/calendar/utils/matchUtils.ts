import type { CalendarRuleRecord } from "../../../services/calendarRules";
import { getSuggestSubtaskRuleBoost } from "../../../services/calendarRules";
import { dayRangeMs } from "../../../services/scheduling";
import type { CalendarItem, GoogleCalendarEvent } from "../types/calendar.types";

export function normalizeMatchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getMatchTokens(value: unknown): string[] {
  const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "daily",
    "weekly",
    "goal",
    "task",
    "event",
    "events",
    "work",
    "plan",
    "todo",
    "today",
    "read",
    "make",
    "do",
  ]);

  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !STOP_WORDS.has(token));
}

export function countSharedTokens(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const bSet = new Set(b);
  let count = 0;

  for (const token of a) {
    if (bSet.has(token)) count += 1;
  }

  return count;
}

export function isStrongExactTitleMatch(a: unknown, b: unknown): boolean {
  const left = normalizeMatchText(a);
  const right = normalizeMatchText(b);

  if (!left || !right) return false;
  if (left !== right) return false;

  return left.length >= 4;
}

export function hasReason(reasons: string[], reason: string): boolean {
  return reasons.includes(reason);
}

export function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

/** An all-day event occupies the whole local day; a timed one its own range. */
export function getEventRangeForDay(
  event: GoogleCalendarEvent,
  date: Date
): { startMs: number; endMs: number } {
  if (event.allDay) {
    const { start, end } = dayRangeMs(date);
    return { startMs: start, endMs: end };
  }

  return {
    startMs: event.startMs,
    endMs: event.endMs ?? event.startMs + 60 * 60 * 1000,
  };
}

export function doesItemOverlapEventOnDate(
  item: CalendarItem & { date: Date },
  event: GoogleCalendarEvent
): boolean {
  // All-day Google events block the whole date.
  if (event.allDay) return true;

  if (typeof item.dueAtMs !== "number") return false;
  if (typeof event.startMs !== "number") return false;

  const { startMs, endMs } = getEventRangeForDay(event, item.date);

  // Treat the due item as a 30-minute block centered on its due time.
  const itemStart = item.dueAtMs - 15 * 60 * 1000;
  const itemEnd = item.dueAtMs + 15 * 60 * 1000;

  return rangesOverlap(itemStart, itemEnd, startMs, endMs);
}

export function getCalendarMatchSuggestion(
  item: CalendarItem & { date: Date },
  events: GoogleCalendarEvent[],
  minimumScore: number = 35
): {
  event: GoogleCalendarEvent;
  score: number;
  reasons: string[];
} | null {
  if (events.length === 0) return null;

  const itemTitleNormalized = normalizeMatchText(item.title);

  const itemTokens = getMatchTokens(item.title);
  const goalTokens = getMatchTokens(item.goalTitle);

  let bestMatch: {
    event: GoogleCalendarEvent;
    score: number;
    reasons: string[];
  } | null = null;

  for (const calendarEvent of events) {
    const eventTitleNormalized = normalizeMatchText(calendarEvent.title);
    const eventTitleTokens = getMatchTokens(calendarEvent.title);

    let score = 0;
    const reasons: string[] = [];

    if (itemTitleNormalized && eventTitleNormalized) {
      if (isStrongExactTitleMatch(item.title, calendarEvent.title)) {
        score += 90;
        reasons.push("exact title");
      } else if (
        itemTitleNormalized.length >= 5 &&
        eventTitleNormalized.length >= 5 &&
        (eventTitleNormalized.includes(itemTitleNormalized) ||
          itemTitleNormalized.includes(eventTitleNormalized))
      ) {
        score += 12;
        reasons.push("title match");
      }
    }

    // Item tokens are scored twice by design (title weight + task weight), but
    // the overlap itself only needs computing once.
    const sharedItemTokens = countSharedTokens(itemTokens, eventTitleTokens);

    if (sharedItemTokens >= 2) {
      score += 32;
      reasons.push("shared title terms");
    } else if (sharedItemTokens === 1) {
      score += 12;
      reasons.push("shared title term");
    }

    if (sharedItemTokens >= 2) {
      score += 8;
      reasons.push("shared task terms");
    } else if (sharedItemTokens === 1) {
      score += 3;
      reasons.push("shared task term");
    }

    const sharedGoalTokens = countSharedTokens(goalTokens, eventTitleTokens);
    if (sharedGoalTokens > 0) {
      score += sharedGoalTokens * 8;
      reasons.push(
        sharedGoalTokens === 1 ? "shared goal term" : "shared goal terms"
      );
    }

    if (
      typeof item.dueAtMs === "number" &&
      doesItemOverlapEventOnDate(item, calendarEvent)
    ) {
      score += 20;
      reasons.push(calendarEvent.allDay ? "all-day overlap" : "time overlap");
    }

    if (
      typeof item.linkedCalendarEventId === "string" &&
      item.linkedCalendarEventId.trim().length > 0 &&
      item.linkedCalendarEventId === calendarEvent.id
    ) {
      score += 100;
      reasons.push("already linked");
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        event: calendarEvent,
        score,
        reasons,
      };
    }
  }

  if (!bestMatch) return null;
  if (bestMatch.score < minimumScore) return null;

  return bestMatch;
}

export function formatCalendarSuggestionReasonLabel(reasons: string[]): string {
  if (reasons.length === 0) return "Possible match";
  return reasons.slice(0, 2).join(" • ");
}

export function getVisibleSuggestionReasonLabels(
  reasons: string[] | undefined,
  limit = 3
): string[] {
  if (!Array.isArray(reasons) || reasons.length === 0) return [];

  const formatted = formatCalendarSuggestionReasonLabel(reasons);

  const labels = formatted
    .split("•")
    .map((label) => label.trim())
    .filter((label) => Boolean(label));

  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(label);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export function getTaskSuggestionForEvent(
  event: GoogleCalendarEvent,
  items: (CalendarItem & { date: Date })[],
  calendarRules: CalendarRuleRecord[]
): {
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
} | null {
  if (items.length === 0) return null;

  const matches: {
    item: CalendarItem & { date: Date };
    score: number;
    reasons: string[];
  }[] = [];

  for (const item of items) {
    const match = getCalendarMatchSuggestion(item, [event], 24);

    const matchingRules = calendarRules.filter(
      (rule) =>
        rule.type === "suggest_subtask" &&
        rule.goalId === item.goalId &&
        rule.subtaskId === item.subtaskId
    );

    const ruleBoost = matchingRules.reduce((best, rule) => {
      const next = getSuggestSubtaskRuleBoost({
        eventTitle: event.title,
        ruleMatchText: rule.matchText,
      });
      return next > best ? next : best;
    }, 0);

    if (!match) continue;

    matches.push({
      item,
      score: match.score + ruleBoost,
      reasons:
        ruleBoost > 0
          ? [...match.reasons, "saved preference"]
          : match.reasons,
    });
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score);

  const topMatch = matches[0];
  const secondMatch = matches[1];

  if (topMatch.score < 40) return null;

  if (!secondMatch || secondMatch.score < 20) {
    return {
      mode: "single",
      topMatch,
    };
  }

  const bothHaveStrongTitleOverlap =
    hasReason(topMatch.reasons, "shared title terms") &&
    hasReason(secondMatch.reasons, "shared title terms");

  const topIsExactTitle = hasReason(topMatch.reasons, "exact title");
  const secondIsExactTitle = hasReason(secondMatch.reasons, "exact title");

  if (bothHaveStrongTitleOverlap && !topIsExactTitle && !secondIsExactTitle) {
    return {
      mode: "ambiguous",
      topMatch,
      secondMatch,
    };
  }

  if (topMatch.score - secondMatch.score >= 8) {
    return {
      mode: "single",
      topMatch,
    };
  }

  return {
    mode: "ambiguous",
    topMatch,
    secondMatch,
  };
}

/**
 * A linked event counts as missing when the subtask has a persisted
 * "last known missing" flag, or when it is absent from the synced events.
 */
export function isLinkedEventMissing(
  item: Pick<CalendarItem, "linkedCalendarEventId"> & {
    linkedCalendarLastKnownMissing?: boolean | null;
  },
  googleEventById: Map<string, GoogleCalendarEvent>
): boolean {
  if (!item.linkedCalendarEventId) return false;
  if (item.linkedCalendarLastKnownMissing === true) return true;

  return !googleEventById.has(item.linkedCalendarEventId);
}

/**
 * Recurring items only surface their linked event on the day the event
 * actually falls on; one-time items always surface it.
 */
export function shouldShowLinkedEventForItem(
  item: CalendarItem & { date: Date }
): boolean {
  if (!item.linkedCalendarEventId) return false;

  const linkedStartMs =
    typeof item.linkedCalendarEventStartMs === "number"
      ? item.linkedCalendarEventStartMs
      : null;

  if (linkedStartMs == null) return true;
  if (item.frequency === "once") return true;

  const linkedDate = new Date(linkedStartMs);
  return (
    item.date.getFullYear() === linkedDate.getFullYear() &&
    item.date.getMonth() === linkedDate.getMonth() &&
    item.date.getDate() === linkedDate.getDate()
  );
}
