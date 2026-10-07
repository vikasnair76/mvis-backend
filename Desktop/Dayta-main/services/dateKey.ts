import { DateTime } from "luxon";

// Use device timezone for now (later you can store user tz in profile)
export const getUserTz = () => DateTime.local().zoneName;

// Convert timestamp -> "YYYY-MM-DD"
export function dayKeyFromMs(ms: number, tz: string) {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyy-LL-dd");
}

// Convert JS Date -> "YYYY-MM-DD"
export function dayKeyFromDate(date: Date, tz: string) {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-LL-dd");
}

// Start of day in ms
export function startOfDayMs(dayKey: string, tz: string) {
  return DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: tz })
    .startOf("day")
    .toMillis();
}

// End of day in ms
export function endOfDayMs(dayKey: string, tz: string) {
  return DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: tz })
    .endOf("day")
    .toMillis();
}