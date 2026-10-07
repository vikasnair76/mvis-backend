import { dayKeyFromMs } from "../../../services/dateKey";
import type { HomeTaskItem, NowDecision } from "../../../services/nowDecision";
import type { HomeCandidateItem, QuickPlanOption } from "../types/home.types";

export const QUICK_PLAN_EVENING_HOUR = 18;
export const QUICK_PLAN_MORNING_HOUR = 9;

export function taskKey(item: Pick<HomeTaskItem, "goalId" | "subtaskId">): string {
  return `${item.goalId}:${item.subtaskId}`;
}

/**
 * A subtask is "for today" if it's due today, explicitly scheduled for today,
 * or daily. Weekly subtasks without a date are not surfaced here.
 */
export function isRelevantForToday(item: HomeCandidateItem, tz: string): boolean {
  if (item.dueAtMs != null) {
    return dayKeyFromMs(item.dueAtMs, tz) === item.todayKey;
  }
  if (item.scheduledDayKey === item.todayKey) return true;
  if (item.frequency === "daily") return true;
  return false;
}

export function getTimeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function formatMiniTime(ms: number | null): string {
  if (typeof ms !== "number") return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** 18:00 today (or tomorrow if that's already passed), or 09:00 tomorrow. */
export function getQuickPlanDate(option: QuickPlanOption, now: Date = new Date()): Date {
  if (option === "today_evening") {
    const evening = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      QUICK_PLAN_EVENING_HOUR,
      0,
      0,
      0
    );
    if (evening.getTime() <= now.getTime()) {
      evening.setDate(evening.getDate() + 1);
    }
    return evening;
  }

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    QUICK_PLAN_MORNING_HOUR,
    0,
    0,
    0
  );
}

/** Eyebrow label + helper line for each decision type. */
export function getDecisionMeta(decision: NowDecision): { label: string; helper: string } {
  switch (decision.type) {
    case "overdue":
      return { label: "Overdue", helper: "This task is past its scheduled time" };
    case "now":
      return { label: "Now", helper: "This is your current best action" };
    case "next":
      return { label: "Next", helper: "Coming up today" };
    case "needs_time":
      return {
        label: "Needs a time",
        helper: "This task is relevant today but still needs a spot on your plan",
      };
    case "all_clear":
      return { label: "All clear", helper: "No urgent tasks right now" };
  }
}
