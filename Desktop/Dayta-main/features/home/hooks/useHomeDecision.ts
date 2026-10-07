import { useMemo } from "react";
import { getNowDecision, type HomeTaskItem, type NowDecision } from "../../../services/nowDecision";
import type { RecoveryHint, TodayStats } from "../types/home.types";
import { taskKey } from "../utils";

/**
 * Pure derivation from the task list + completion set: the "Now" decision,
 * today's counts, the recovery hint, and the three mini-lists.
 */
export function useHomeDecision(items: HomeTaskItem[], completedTodayKeys: Set<string>) {
  const decisionItems = useMemo<HomeTaskItem[]>(
    () =>
      items.map((item) => ({
        ...item,
        isCompletedToday: completedTodayKeys.has(taskKey(item)),
      })),
    [items, completedTodayKeys]
  );

  const decision = useMemo<NowDecision>(
    () => getNowDecision(decisionItems, Date.now()),
    [decisionItems]
  );

  const todayStats = useMemo<TodayStats>(() => {
    const now = Date.now();
    return {
      done: completedTodayKeys.size,
      needTime: decisionItems.filter((i) => !i.isCompletedToday && i.dueAtMs == null).length,
      upcoming: decisionItems.filter(
        (i) => !i.isCompletedToday && typeof i.dueAtMs === "number" && i.dueAtMs > now
      ).length,
    };
  }, [completedTodayKeys, decisionItems]);

  const recoveryHint = useMemo<RecoveryHint | null>(() => {
    const now = Date.now();
    const overdueCount = decisionItems.filter(
      (i) => !i.isCompletedToday && typeof i.dueAtMs === "number" && i.dueAtMs < now
    ).length;
    const needTimeCount = decisionItems.filter(
      (i) => !i.isCompletedToday && i.dueAtMs == null
    ).length;

    if (overdueCount > 0) {
      return {
        title: `${overdueCount} overdue`,
        body: "Some tasks are past their planned time.",
        action: "Review today",
      };
    }
    if (needTimeCount > 0) {
      return {
        title: `${needTimeCount} need a time`,
        body: "Some tasks are relevant today but are not scheduled yet.",
        action: "Plan tasks",
      };
    }
    return null;
  }, [decisionItems]);

  const upcomingItems = useMemo(() => {
    const now = Date.now();
    return decisionItems
      .filter((i) => !i.isCompletedToday && typeof i.dueAtMs === "number" && i.dueAtMs > now)
      .sort((a, b) => (a.dueAtMs ?? 0) - (b.dueAtMs ?? 0))
      .slice(0, 3);
  }, [decisionItems]);

  const needsTimeItems = useMemo(
    () => decisionItems.filter((i) => !i.isCompletedToday && i.dueAtMs == null).slice(0, 3),
    [decisionItems]
  );

  const doneTodayItems = useMemo(
    () => decisionItems.filter((i) => i.isCompletedToday).slice(0, 5),
    [decisionItems]
  );

  return { decision, todayStats, recoveryHint, upcomingItems, needsTimeItems, doneTodayItems };
}
