import { DateTime } from "luxon";

export function previousDayKey(dayKey: string): string {
  return DateTime.fromFormat(dayKey, "yyyy-LL-dd")
    .minus({ days: 1 })
    .toFormat("yyyy-LL-dd");
}

export function calculateCompletionStreak(dayKeys: string[], anchorDayKey: string): number {
  const set = new Set(dayKeys);
  let streak = 0;
  let cursor = anchorDayKey;

  while (set.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }

  return streak;
}