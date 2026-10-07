import type { HomeTaskItem } from "../../../services/nowDecision";

export type GoalLite = {
  id: string;
  title: string;
  userId: string;
  status?: string;
};

export type SubtaskLite = {
  id: string;
  title: string;
  dueAtMs?: number | null;
  frequency?: "daily" | "weekly" | "once" | null;
  weeklyDay?: number | null;
  scheduledDayKey?: string | null;
};

/** A subtask with the schedule fields needed to decide if it's for today. */
export type HomeCandidateItem = HomeTaskItem & {
  frequency?: string | null;
  weeklyDay?: number | null;
  scheduledDayKey?: string | null;
  todayKey: string;
};

export type QuickPlanOption = "today_evening" | "tomorrow_morning";

export type TodayStats = {
  done: number;
  needTime: number;
  upcoming: number;
};

export type RecoveryHint = {
  title: string;
  body: string;
  action: string;
};
