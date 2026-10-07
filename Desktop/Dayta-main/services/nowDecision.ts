import { dayKeyFromMs, getUserTz } from "./dateKey";

export type HomeTaskItem = {
  goalId: string;
  subtaskId: string;
  title: string;
  goalTitle: string;
  dueAtMs: number | null;
  isCompletedToday: boolean;
};

export type NowDecision =
  | { type: "overdue"; item: HomeTaskItem }
  | { type: "now"; item: HomeTaskItem }
  | { type: "next"; item: HomeTaskItem }
  | { type: "needs_time"; item: HomeTaskItem }
  | { type: "all_clear" };

const NOW_WINDOW_PAST_MS = 15 * 60 * 1000;   // -15 min
const NOW_WINDOW_FUTURE_MS = 30 * 60 * 1000; // +30 min

export function getNowDecision(
  items: HomeTaskItem[],
  nowMs: number
): NowDecision {
 const tz = getUserTz();
const todayKey = dayKeyFromMs(nowMs, tz);

  // Filter to actionable (not completed today)
  const actionable = items.filter((i) => !i.isCompletedToday);

  if (actionable.length === 0) {
    return { type: "all_clear" };
  }

  // ---- 1. OVERDUE ----
  const overdue = actionable
    .filter((i) => i.dueAtMs != null && i.dueAtMs < nowMs)
    .sort((a, b) => (a.dueAtMs! - b.dueAtMs!));

  if (overdue.length > 0) {
    return { type: "overdue", item: overdue[0] };
  }

  // ---- 2. NOW (± window) ----
  const nowItems = actionable
    .filter((i) => {
      if (i.dueAtMs == null) return false;
      return (
        i.dueAtMs >= nowMs - NOW_WINDOW_PAST_MS &&
        i.dueAtMs <= nowMs + NOW_WINDOW_FUTURE_MS
      );
    })
    .sort((a, b) => (a.dueAtMs! - b.dueAtMs!));

  if (nowItems.length > 0) {
    return { type: "now", item: nowItems[0] };
  }

  // ---- 3. NEXT (later today) ----
  const nextToday = actionable
    .filter((i) => {
      if (i.dueAtMs == null) return false;
      return dayKeyFromMs(i.dueAtMs, tz) === todayKey
    })
    .sort((a, b) => (a.dueAtMs! - b.dueAtMs!));

  if (nextToday.length > 0) {
    return { type: "next", item: nextToday[0] };
  }

  // ---- 4. NEEDS TIME ----
  const needsTime = actionable.find((i) => i.dueAtMs == null);

  if (needsTime) {
    return { type: "needs_time", item: needsTime };
  }

  // ---- 5. FALLBACK ----
  return { type: "all_clear" };
}