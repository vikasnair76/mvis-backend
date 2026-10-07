import type { Goal } from "../types/goals.types";

export function computeProgress(current: number | null, target: number | null): number {
  if (target == null || target <= 0) return 0;
  const safeCurrent = current ?? 0;
  const pct = (safeCurrent / target) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function formatCompletedDate(completedAtMs?: number | null): string | null {
  if (!completedAtMs) return null;

  return new Date(completedAtMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getSharedGoalLabel(goal: Goal): string | null {
  const accessRole = (goal as any).sharedAccessRole;
  const sharedGroupName = (goal as any).sharedGroupName;
  const sharedGroupId = (goal as any).sharedGroupId;

  if (accessRole === "assigned_member") {
    if (typeof sharedGroupName === "string" && sharedGroupName.trim()) {
      return `Shared goal • Assigned to me • ${sharedGroupName.trim()}`;
    }

    return "Shared goal • Assigned to me";
  }

  if (typeof sharedGroupName === "string" && sharedGroupName.trim()) {
    return `Shared goal • ${sharedGroupName.trim()}`;
  }

  const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
    ? goal.sharedGroupIds
    : [];

  if (sharedGroupId || sharedGroupIds.length > 0) {
    return "Shared goal";
  }

  return null;
}
