import { DateTime } from "luxon";

export type Subtask = {
  id: string;
  frequency: "once" | "daily" | "weekly";
  weeklyDay?: number | null; // 0=Sun..6=Sat (pick one convention)
  dueAtMs?: number | null;
  createdAtMs?: number | null;
  metricValue?: number | null;

  // for Option B ("once" tasks disappear after first completion)
  firstCompletedAtMs?: number | null;
};

export function occursOnDay(subtask: Subtask, dayKey: string, tz: string) {
  if (subtask.frequency === "daily") return true;

  if (subtask.frequency === "weekly") {
    if (subtask.weeklyDay == null) return false;
    const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: tz });
    const weekday0Sun = day.weekday % 7; // Luxon weekday: 1=Mon..7=Sun
    return weekday0Sun === subtask.weeklyDay;
  }

  // "once"
  // Option B behavior is enforced in UI by hiding tasks where firstCompletedAtMs exists.
  // So this function just says "yes, it's relevant on any day until completed."
  return true;
}