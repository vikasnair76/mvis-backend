import { DateTime, IANAZone } from "luxon";
import {
  getNextGroupRoutineOccurrence,
  normalizeGroupRoutineSchedule,
  normalizeGroupRoutineTitle,
  type CreateGroupRoutineInput,
  type GroupRoutineDoc,
  type GroupRoutineFrequency,
  type GroupRoutineMonthlyMode,
  type UpdateGroupRoutineInput,
} from "./groupRoutines";
import type { GroupMemberStatus, GroupRole } from "./groups";

export const GROUP_ROUTINE_WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

export type GroupRoutineFormState = {
  title: string;
  description: string;
  location: string;
  frequency: GroupRoutineFrequency;
  intervalText: string;
  weekdays: number[];
  monthlyMode: GroupRoutineMonthlyMode;
  dayOfMonthText: string;
  weekOfMonth: 1 | 2 | 3 | 4 | -1;
  weekdayOfMonth: number;
  localStartTime: string;
  timezone: string;
  startDate: string;
  hasEndDate: boolean;
  endDate: string;
  hasDuration: boolean;
  durationHoursText: string;
  durationMinutesText: string;
  participantUids: string[];
};

function deviceTimezone() {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return IANAZone.isValidZone(candidate) ? candidate : "UTC";
}

export function createGroupRoutineFormDefaults(nowMs = Date.now()): GroupRoutineFormState {
  const timezone = deviceTimezone();
  const now = DateTime.fromMillis(nowMs, { zone: timezone });
  const start = now.plus({ hours: 1 }).startOf("hour");
  return {
    title: "",
    description: "",
    location: "",
    frequency: "weekly",
    intervalText: "1",
    weekdays: [start.weekday],
    monthlyMode: "day_of_month",
    dayOfMonthText: String(start.day),
    weekOfMonth: Math.min(4, Math.ceil(start.day / 7)) as 1 | 2 | 3 | 4,
    weekdayOfMonth: start.weekday,
    localStartTime: start.toFormat("HH:mm"),
    timezone,
    startDate: start.toFormat("yyyy-LL-dd"),
    hasEndDate: false,
    endDate: start.plus({ months: 1 }).toFormat("yyyy-LL-dd"),
    hasDuration: false,
    durationHoursText: "1",
    durationMinutesText: "0",
    participantUids: [],
  };
}

export function createGroupRoutineFormFromDoc(routine: GroupRoutineDoc): GroupRoutineFormState {
  const duration = routine.durationMinutes ?? 60;
  return {
    title: routine.title,
    description: routine.description ?? "",
    location: routine.location ?? "",
    frequency: routine.frequency,
    intervalText: String(routine.interval),
    weekdays: routine.weekdays ?? [1],
    monthlyMode: routine.monthlyMode ?? "day_of_month",
    dayOfMonthText: String(routine.dayOfMonth ?? 1),
    weekOfMonth: routine.weekOfMonth ?? 1,
    weekdayOfMonth: routine.weekdayOfMonth ?? 1,
    localStartTime: routine.localStartTime,
    timezone: routine.timezone,
    startDate: routine.startDate,
    hasEndDate: routine.endDate != null,
    endDate: routine.endDate ?? routine.startDate,
    hasDuration: routine.durationMinutes != null,
    durationHoursText: String(Math.floor(duration / 60)),
    durationMinutesText: String(duration % 60),
    participantUids: routine.participantUids,
  };
}

export function normalizeGroupRoutineForm(
  form: GroupRoutineFormState
): Omit<CreateGroupRoutineInput, "groupId" | "createdByUid" | "createdByName" | "createdByEmail"> {
  const interval = Number(form.intervalText);
  const dayOfMonth = Number(form.dayOfMonthText);
  const hours = Number(form.durationHoursText || "0");
  const minutes = Number(form.durationMinutesText || "0");
  if (!Number.isInteger(interval)) throw new Error("Enter a whole-number interval.");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) {
    throw new Error("Enter a valid duration.");
  }
  const durationMinutes = form.hasDuration ? hours * 60 + minutes : null;
  const schedule = normalizeGroupRoutineSchedule({
    frequency: form.frequency,
    interval,
    weekdays: form.frequency === "weekly" ? form.weekdays : null,
    monthlyMode: form.frequency === "monthly" ? form.monthlyMode : null,
    dayOfMonth:
      form.frequency === "monthly" && form.monthlyMode === "day_of_month"
        ? dayOfMonth
        : null,
    weekOfMonth:
      form.frequency === "monthly" && form.monthlyMode === "nth_weekday"
        ? form.weekOfMonth
        : null,
    weekdayOfMonth:
      form.frequency === "monthly" && form.monthlyMode === "nth_weekday"
        ? form.weekdayOfMonth
        : null,
    localStartTime: form.localStartTime,
    timezone: form.timezone,
    startDate: form.startDate,
    endDate: form.hasEndDate ? form.endDate : null,
    durationMinutes,
  });
  return {
    title: normalizeGroupRoutineTitle(form.title),
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    ...schedule,
    participantUids: form.participantUids,
  };
}

export function groupRoutineFormToUpdate(
  form: GroupRoutineFormState,
  routineId: string
): UpdateGroupRoutineInput {
  return { routineId, ...normalizeGroupRoutineForm(form) };
}

export function canCreateGroupRoutineUi(
  role: GroupRole | null,
  status: GroupMemberStatus | null
) {
  return status === "active" && role != null && role !== "viewer";
}

export function canManageGroupRoutineUi(
  role: GroupRole | null,
  status: GroupMemberStatus | null,
  currentUid: string | null,
  routine: Pick<GroupRoutineDoc, "createdByUid" | "status">
) {
  if (status !== "active" || !role || !currentUid || routine.status === "archived") return false;
  return (
    role === "owner" ||
    role === "admin" ||
    role === "moderator" ||
    (role === "member" && routine.createdByUid === currentUid)
  );
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

function displayTime(localStartTime: string) {
  return DateTime.fromFormat(localStartTime, "HH:mm", { zone: "UTC" }).toFormat("h:mm a");
}

export function formatGroupRoutineRecurrenceSummary(
  routine: Pick<
    GroupRoutineDoc,
    | "frequency"
    | "interval"
    | "weekdays"
    | "monthlyMode"
    | "dayOfMonth"
    | "weekOfMonth"
    | "weekdayOfMonth"
    | "localStartTime"
  >
) {
  const time = displayTime(routine.localStartTime);
  if (routine.frequency === "daily") {
    return `${routine.interval === 1 ? "Every day" : `Every ${routine.interval} days`} at ${time}`;
  }
  if (routine.frequency === "weekly") {
    const days = (routine.weekdays ?? [])
      .map((value) => GROUP_ROUTINE_WEEKDAYS.find((day) => day.value === value)?.long)
      .filter((value) => value != null) as string[];
    const cadence = routine.interval === 1 ? "Every week" : `Every ${routine.interval} weeks`;
    return `${cadence} on ${joinWords(days)} at ${time}`;
  }
  if (routine.monthlyMode === "day_of_month") {
    const cadence = routine.interval === 1 ? "Monthly" : `Every ${routine.interval} months`;
    return `${cadence} on day ${routine.dayOfMonth} at ${time}`;
  }
  const ordinal: Record<number, string> = {
    1: "first",
    2: "second",
    3: "third",
    4: "fourth",
    [-1]: "last",
  };
  const weekday = GROUP_ROUTINE_WEEKDAYS.find(
    (day) => day.value === routine.weekdayOfMonth
  )?.long;
  const cadence = routine.interval === 1 ? "Monthly" : `Every ${routine.interval} months`;
  return `${cadence} on the ${ordinal[routine.weekOfMonth ?? 1]} ${weekday} at ${time}`;
}

export function formatGroupRoutineDateBounds(
  routine: Pick<GroupRoutineDoc, "startDate" | "endDate" | "timezone">
) {
  const start = DateTime.fromISO(routine.startDate, { zone: routine.timezone }).toFormat("DDD");
  const end = routine.endDate
    ? DateTime.fromISO(routine.endDate, { zone: routine.timezone }).toFormat("DDD")
    : null;
  return end ? `Starting ${start} · Through ${end}` : `Starting ${start}`;
}

export function formatGroupRoutineDuration(durationMinutes: number | null) {
  if (durationMinutes == null) return null;
  const days = Math.floor(durationMinutes / 1440);
  const hours = Math.floor((durationMinutes % 1440) / 60);
  const minutes = durationMinutes % 60;
  return [
    days ? `${days} ${days === 1 ? "day" : "days"}` : "",
    hours ? `${hours} ${hours === 1 ? "hr" : "hrs"}` : "",
    minutes ? `${minutes} min` : "",
  ].filter(Boolean).join(" ");
}

export function getGroupRoutineStatusLabel(status: GroupRoutineDoc["status"]) {
  return status === "active" ? "Active" : status === "paused" ? "Paused" : "Archived";
}

export function formatGroupRoutineNextOccurrence(
  routine: GroupRoutineDoc,
  nowMs = Date.now()
) {
  if (routine.status === "paused") return "Paused";
  if (routine.status === "archived") return "Archived";
  let nextMs = routine.nextOccurrenceAtMs;
  if (nextMs == null || nextMs <= nowMs) {
    nextMs = getNextGroupRoutineOccurrence(routine, nowMs)?.startAtMs ?? null;
  }
  if (nextMs == null) return "Schedule ended";
  const now = DateTime.fromMillis(nowMs, { zone: routine.timezone });
  const next = DateTime.fromMillis(nextMs, { zone: routine.timezone });
  const dayDelta = Math.round(next.startOf("day").diff(now.startOf("day"), "days").days);
  const dayLabel =
    dayDelta === 0
      ? "Today"
      : dayDelta === 1
        ? "Tomorrow"
        : next.year === now.year
          ? next.toFormat("ccc, LLL d")
          : next.toFormat("LLL d, yyyy");
  return `Next: ${dayLabel} at ${next.toFormat("h:mm a")}`;
}

export function getGroupRoutineCreatorLabel(
  routine: Pick<GroupRoutineDoc, "createdByName" | "createdByEmail">
) {
  return routine.createdByName?.trim() || routine.createdByEmail?.trim() || "Group member";
}
