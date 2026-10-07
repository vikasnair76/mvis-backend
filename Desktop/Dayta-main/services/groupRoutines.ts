import { DateTime, IANAZone } from "luxon";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export const GROUP_ROUTINE_TITLE_MAX_LENGTH = 120;
export const GROUP_ROUTINE_DESCRIPTION_MAX_LENGTH = 2000;
export const GROUP_ROUTINE_LOCATION_MAX_LENGTH = 240;
export const GROUP_ROUTINE_MAX_INTERVAL = 100;
export const GROUP_ROUTINE_MAX_DURATION_MINUTES = 10_080;
export const DEFAULT_GROUP_ROUTINE_LIMIT = 100;
export const MAX_GROUP_ROUTINE_LIMIT = 200;
export const DEFAULT_GROUP_ROUTINE_OCCURRENCE_LIMIT = 100;
export const MAX_GROUP_ROUTINE_OCCURRENCE_LIMIT = 500;
export const GROUP_ROUTINE_MAX_PARTICIPANTS = 50;

export type GroupRoutineStatus = "active" | "paused" | "archived";
export type GroupRoutineFrequency = "daily" | "weekly" | "monthly";
export type GroupRoutineMonthlyMode = "day_of_month" | "nth_weekday";

export type GroupRoutineDoc = {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  location: string | null;
  status: GroupRoutineStatus;
  frequency: GroupRoutineFrequency;
  interval: number;
  weekdays: number[] | null;
  monthlyMode: GroupRoutineMonthlyMode | null;
  dayOfMonth: number | null;
  weekOfMonth: 1 | 2 | 3 | 4 | -1 | null;
  weekdayOfMonth: number | null;
  localStartTime: string;
  durationMinutes: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  nextOccurrenceAtMs: number | null;
  participantUids: string[];
  createdByUid: string;
  createdByName: string | null;
  createdByEmail: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  pausedAtMs: number | null;
  pausedByUid: string | null;
  archivedAtMs: number | null;
  archivedByUid: string | null;
};

export type GroupRoutineOccurrence = {
  startAtMs: number;
  endAtMs: number | null;
  localDate: string;
};

export type GroupRoutineScheduleInput = {
  frequency: GroupRoutineFrequency;
  interval?: number;
  weekdays?: number[] | null;
  monthlyMode?: GroupRoutineMonthlyMode | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  weekdayOfMonth?: number | null;
  localStartTime: string;
  durationMinutes?: number | null;
  timezone: string;
  startDate: string;
  endDate?: string | null;
  participantUids?: string[];
};

export type CreateGroupRoutineInput = GroupRoutineScheduleInput & {
  groupId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  createdByUid: string;
  createdByName?: string | null;
  createdByEmail?: string | null;
  nowMs?: number;
};

export type UpdateGroupRoutineInput = {
  routineId: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  frequency?: GroupRoutineFrequency;
  interval?: number;
  weekdays?: number[] | null;
  monthlyMode?: GroupRoutineMonthlyMode | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  weekdayOfMonth?: number | null;
  localStartTime?: string;
  durationMinutes?: number | null;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
  participantUids?: string[];
  nowMs?: number;
};

type NormalizedSchedule = {
  frequency: GroupRoutineFrequency;
  interval: number;
  weekdays: number[] | null;
  monthlyMode: GroupRoutineMonthlyMode | null;
  dayOfMonth: number | null;
  weekOfMonth: 1 | 2 | 3 | 4 | -1 | null;
  weekdayOfMonth: number | null;
  localStartTime: string;
  durationMinutes: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
};

function requiredString(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalBoundedString(value: unknown, maximum: number, label: string) {
  if (value == null) return null;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function finiteTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string) {
  return value == null ? null : finiteTimestamp(value, label);
}

function nullableServerTimestamp(value: unknown): Timestamp | null {
  if (value == null) return null;
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as Timestamp).toMillis === "function"
  ) {
    return value as Timestamp;
  }
  throw new Error("Server timestamp is invalid.");
}

export function normalizeGroupRoutineParticipantUids(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Routine participants are invalid.");
  const normalized = Array.from(
    new Set(value.map((uid) => requiredString(uid, "Participant")))
  ).sort();
  if (normalized.length > GROUP_ROUTINE_MAX_PARTICIPANTS) {
    throw new Error(
      `Choose no more than ${GROUP_ROUTINE_MAX_PARTICIPANTS} participants.`
    );
  }
  return normalized;
}

export function normalizeGroupRoutineTitle(value: unknown) {
  const title = requiredString(value, "Routine title");
  if (title.length > GROUP_ROUTINE_TITLE_MAX_LENGTH) {
    throw new Error(
      `Routine title must be ${GROUP_ROUTINE_TITLE_MAX_LENGTH} characters or fewer.`
    );
  }
  return title;
}

export function normalizeRoutineLocalStartTime(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error("Enter a valid local start time.");
  }
  return normalized;
}

export function normalizeGroupRoutineDate(
  value: unknown,
  timezone: string,
  label: string
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = DateTime.fromISO(normalized, { zone: timezone });
  if (!parsed.isValid || parsed.toFormat("yyyy-LL-dd") !== normalized) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeWeekdays(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Select at least one weekday.");
  const values = value.map((weekday) => {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new Error("Weekdays must use 1 for Monday through 7 for Sunday.");
    }
    return weekday as number;
  });
  const normalized = Array.from(new Set(values)).sort((a, b) => a - b);
  if (!normalized.length) throw new Error("Select at least one weekday.");
  return normalized;
}

export function normalizeGroupRoutineSchedule(
  input: GroupRoutineScheduleInput
): NormalizedSchedule {
  if (!IANAZone.isValidZone(input.timezone)) {
    throw new Error("Select a valid timezone.");
  }
  const timezone = input.timezone;
  const frequency = input.frequency;
  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    throw new Error("Select a valid routine frequency.");
  }
  const interval = input.interval ?? 1;
  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > GROUP_ROUTINE_MAX_INTERVAL
  ) {
    throw new Error(
      `Routine interval must be between 1 and ${GROUP_ROUTINE_MAX_INTERVAL}.`
    );
  }
  const startDate = normalizeGroupRoutineDate(
    input.startDate,
    timezone,
    "Start date"
  );
  const endDate =
    input.endDate == null || input.endDate === ""
      ? null
      : normalizeGroupRoutineDate(input.endDate, timezone, "End date");
  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before start date.");
  }
  const durationMinutes =
    input.durationMinutes == null ? null : input.durationMinutes;
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > GROUP_ROUTINE_MAX_DURATION_MINUTES)
  ) {
    throw new Error(
      `Duration must be between 1 and ${GROUP_ROUTINE_MAX_DURATION_MINUTES} minutes.`
    );
  }

  let weekdays: number[] | null = null;
  let monthlyMode: GroupRoutineMonthlyMode | null = null;
  let dayOfMonth: number | null = null;
  let weekOfMonth: 1 | 2 | 3 | 4 | -1 | null = null;
  let weekdayOfMonth: number | null = null;

  if (frequency === "daily") {
    if (
      input.weekdays != null ||
      input.monthlyMode != null ||
      input.dayOfMonth != null ||
      input.weekOfMonth != null ||
      input.weekdayOfMonth != null
    ) {
      throw new Error("Daily routines cannot include weekly or monthly fields.");
    }
  } else if (frequency === "weekly") {
    weekdays = normalizeWeekdays(input.weekdays);
    if (
      input.monthlyMode != null ||
      input.dayOfMonth != null ||
      input.weekOfMonth != null ||
      input.weekdayOfMonth != null
    ) {
      throw new Error("Weekly routines cannot include monthly fields.");
    }
  } else {
    if (input.weekdays != null) {
      throw new Error("Monthly routines cannot include weekly fields.");
    }
    if (
      input.monthlyMode !== "day_of_month" &&
      input.monthlyMode !== "nth_weekday"
    ) {
      throw new Error("Select a valid monthly routine mode.");
    }
    monthlyMode = input.monthlyMode;
    if (monthlyMode === "day_of_month") {
      if (
        !Number.isInteger(input.dayOfMonth) ||
        (input.dayOfMonth ?? 0) < 1 ||
        (input.dayOfMonth ?? 0) > 31
      ) {
        throw new Error("Day of month must be between 1 and 31.");
      }
      if (input.weekOfMonth != null || input.weekdayOfMonth != null) {
        throw new Error("Day-of-month routines cannot include weekday fields.");
      }
      dayOfMonth = input.dayOfMonth as number;
    } else {
      if (
        input.weekOfMonth !== -1 &&
        input.weekOfMonth !== 1 &&
        input.weekOfMonth !== 2 &&
        input.weekOfMonth !== 3 &&
        input.weekOfMonth !== 4
      ) {
        throw new Error("Week of month must be first through fourth, or last.");
      }
      if (
        !Number.isInteger(input.weekdayOfMonth) ||
        (input.weekdayOfMonth ?? 0) < 1 ||
        (input.weekdayOfMonth ?? 0) > 7
      ) {
        throw new Error("Weekday of month must be between 1 and 7.");
      }
      if (input.dayOfMonth != null) {
        throw new Error("Nth-weekday routines cannot include day of month.");
      }
      weekOfMonth = input.weekOfMonth;
      weekdayOfMonth = input.weekdayOfMonth as number;
    }
  }

  return {
    frequency,
    interval,
    weekdays,
    monthlyMode,
    dayOfMonth,
    weekOfMonth,
    weekdayOfMonth,
    localStartTime: normalizeRoutineLocalStartTime(input.localStartTime),
    durationMinutes,
    timezone,
    startDate,
    endDate,
  };
}

function occurrenceDateMatches(
  schedule: NormalizedSchedule,
  candidate: DateTime
) {
  const anchor = DateTime.fromISO(schedule.startDate, {
    zone: schedule.timezone,
  }).startOf("day");
  const dateKey = candidate.toFormat("yyyy-LL-dd");
  if (dateKey < schedule.startDate) return false;
  if (schedule.endDate && dateKey > schedule.endDate) return false;

  if (schedule.frequency === "daily") {
    return Math.floor(candidate.diff(anchor, "days").days) % schedule.interval === 0;
  }
  if (schedule.frequency === "weekly") {
    const weekDelta = Math.floor(
      candidate.startOf("week").diff(anchor.startOf("week"), "weeks").weeks
    );
    return (
      weekDelta >= 0 &&
      weekDelta % schedule.interval === 0 &&
      !!schedule.weekdays?.includes(candidate.weekday)
    );
  }
  const monthDelta =
    (candidate.year - anchor.year) * 12 + candidate.month - anchor.month;
  if (monthDelta < 0 || monthDelta % schedule.interval !== 0) return false;
  if (schedule.monthlyMode === "day_of_month") {
    return candidate.day === schedule.dayOfMonth;
  }
  if (candidate.weekday !== schedule.weekdayOfMonth) return false;
  if (schedule.weekOfMonth === -1) {
    return candidate.plus({ weeks: 1 }).month !== candidate.month;
  }
  return Math.ceil(candidate.day / 7) === schedule.weekOfMonth;
}

function occurrenceForDate(
  schedule: NormalizedSchedule,
  candidate: DateTime
): GroupRoutineOccurrence {
  const [hour, minute] = schedule.localStartTime.split(":").map(Number);
  const start = DateTime.fromObject(
    {
      year: candidate.year,
      month: candidate.month,
      day: candidate.day,
      hour,
      minute,
    },
    { zone: schedule.timezone }
  );
  if (!start.isValid) throw new Error("Routine occurrence time is invalid.");
  return {
    startAtMs: start.toMillis(),
    endAtMs:
      schedule.durationMinutes == null
        ? null
        : start.plus({ minutes: schedule.durationMinutes }).toMillis(),
    localDate: candidate.toFormat("yyyy-LL-dd"),
  };
}

function scheduleFromRoutine(
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
    | "durationMinutes"
    | "timezone"
    | "startDate"
    | "endDate"
  >
) {
  return normalizeGroupRoutineSchedule(routine);
}

export function getNextGroupRoutineOccurrence(
  routine: Pick<GroupRoutineDoc, keyof NormalizedSchedule | "status">,
  afterMs: number
): GroupRoutineOccurrence | null {
  if (routine.status !== "active") return null;
  if (!Number.isFinite(afterMs)) throw new Error("Occurrence boundary is invalid.");
  const schedule = scheduleFromRoutine(routine);
  const after = DateTime.fromMillis(afterMs, { zone: schedule.timezone });
  let candidate = DateTime.max(
    DateTime.fromISO(schedule.startDate, { zone: schedule.timezone }),
    after.startOf("day")
  ).startOf("day");
  const maximumDays =
    schedule.frequency === "daily"
      ? schedule.interval + 2
      : schedule.frequency === "weekly"
      ? schedule.interval * 7 + 8
      : schedule.interval * 31 + 35;

  for (let index = 0; index <= maximumDays; index += 1) {
    const dateKey = candidate.toFormat("yyyy-LL-dd");
    if (schedule.endDate && dateKey > schedule.endDate) return null;
    if (occurrenceDateMatches(schedule, candidate)) {
      const occurrence = occurrenceForDate(schedule, candidate);
      if (occurrence.startAtMs > afterMs) return occurrence;
    }
    candidate = candidate.plus({ days: 1 });
  }
  return null;
}

export function getGroupRoutineOccurrencesInRange(
  routine: Pick<GroupRoutineDoc, keyof NormalizedSchedule | "status">,
  rangeStartMs: number,
  rangeEndMs: number,
  options?: { limit?: number }
) {
  if (
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs
  ) {
    throw new Error("Choose a valid occurrence range.");
  }
  if (routine.status !== "active") return [];
  const resultLimit = options?.limit ?? DEFAULT_GROUP_ROUTINE_OCCURRENCE_LIMIT;
  if (
    !Number.isInteger(resultLimit) ||
    resultLimit < 1 ||
    resultLimit > MAX_GROUP_ROUTINE_OCCURRENCE_LIMIT
  ) {
    throw new Error(
      `Occurrence limit must be between 1 and ${MAX_GROUP_ROUTINE_OCCURRENCE_LIMIT}.`
    );
  }
  const schedule = scheduleFromRoutine(routine);
  const rangeStart = DateTime.fromMillis(rangeStartMs, {
    zone: schedule.timezone,
  });
  const rangeEnd = DateTime.fromMillis(rangeEndMs, {
    zone: schedule.timezone,
  });
  let candidate = DateTime.max(
    DateTime.fromISO(schedule.startDate, { zone: schedule.timezone }),
    rangeStart.startOf("day")
  ).startOf("day");
  const finalDate = rangeEnd.startOf("day").plus({ days: 1 });
  const occurrences: GroupRoutineOccurrence[] = [];

  while (candidate < finalDate && occurrences.length < resultLimit) {
    const dateKey = candidate.toFormat("yyyy-LL-dd");
    if (schedule.endDate && dateKey > schedule.endDate) break;
    if (occurrenceDateMatches(schedule, candidate)) {
      const occurrence = occurrenceForDate(schedule, candidate);
      if (
        occurrence.startAtMs >= rangeStartMs &&
        occurrence.startAtMs < rangeEndMs
      ) {
        occurrences.push(occurrence);
      }
    }
    candidate = candidate.plus({ days: 1 });
  }
  return occurrences;
}

function normalizeStatus(value: unknown): GroupRoutineStatus {
  if (value === "active" || value === "paused" || value === "archived") {
    return value;
  }
  throw new Error("Routine status is invalid.");
}

export function mapGroupRoutineDoc(
  documentId: string,
  data: unknown
): GroupRoutineDoc | null {
  try {
    if (!data || typeof data !== "object") throw new Error("Invalid record.");
    const value = data as Record<string, unknown>;
    const canonicalFields = [
      "id",
      "groupId",
      "title",
      "description",
      "location",
      "status",
      "frequency",
      "interval",
      "weekdays",
      "monthlyMode",
      "dayOfMonth",
      "weekOfMonth",
      "weekdayOfMonth",
      "localStartTime",
      "durationMinutes",
      "timezone",
      "startDate",
      "endDate",
      "nextOccurrenceAtMs",
      "createdByUid",
      "createdByName",
      "createdByEmail",
      "createdAtMs",
      "updatedAtMs",
      "createdAt",
      "updatedAt",
      "pausedAtMs",
      "pausedByUid",
      "archivedAtMs",
      "archivedByUid",
    ];
    if (
      canonicalFields.some(
        (field) => !Object.prototype.hasOwnProperty.call(value, field)
      )
    ) {
      throw new Error("Routine is missing canonical fields.");
    }
    if (value.id !== documentId) throw new Error("Routine ID mismatch.");
    const id = requiredString(value.id, "Routine ID");
    const groupId = requiredString(value.groupId, "Group ID");
    const createdByUid = requiredString(value.createdByUid, "Creator");
    const status = normalizeStatus(value.status);
    const schedule = normalizeGroupRoutineSchedule({
      frequency: value.frequency as GroupRoutineFrequency,
      interval: value.interval as number,
      weekdays: value.weekdays as number[] | null,
      monthlyMode: value.monthlyMode as GroupRoutineMonthlyMode | null,
      dayOfMonth: value.dayOfMonth as number | null,
      weekOfMonth: value.weekOfMonth as number | null,
      weekdayOfMonth: value.weekdayOfMonth as number | null,
      localStartTime: value.localStartTime as string,
      durationMinutes: value.durationMinutes as number | null,
      timezone: value.timezone as string,
      startDate: value.startDate as string,
      endDate: value.endDate as string | null,
    });
    const nextOccurrenceAtMs = nullableTimestamp(
      value.nextOccurrenceAtMs,
      "Next occurrence"
    );
    const pausedAtMs = nullableTimestamp(value.pausedAtMs, "Paused time");
    const pausedByUid =
      value.pausedByUid == null ? null : requiredString(value.pausedByUid, "Paused actor");
    const archivedAtMs = nullableTimestamp(value.archivedAtMs, "Archived time");
    const archivedByUid =
      value.archivedByUid == null
        ? null
        : requiredString(value.archivedByUid, "Archived actor");
    if ((pausedAtMs == null) !== (pausedByUid == null)) {
      throw new Error("Pause metadata is invalid.");
    }
    if ((archivedAtMs == null) !== (archivedByUid == null)) {
      throw new Error("Archive metadata is invalid.");
    }
    if (status === "active") {
      if (
        pausedAtMs != null ||
        archivedAtMs != null
      ) {
        throw new Error("Active lifecycle metadata is invalid.");
      }
    } else if (status === "paused") {
      if (
        nextOccurrenceAtMs != null ||
        pausedAtMs == null ||
        archivedAtMs != null
      ) {
        throw new Error("Paused lifecycle metadata is invalid.");
      }
    } else if (nextOccurrenceAtMs != null || archivedAtMs == null) {
      throw new Error("Archived lifecycle metadata is invalid.");
    }
    return {
      id,
      groupId,
      title: normalizeGroupRoutineTitle(value.title),
      description: optionalBoundedString(
        value.description,
        GROUP_ROUTINE_DESCRIPTION_MAX_LENGTH,
        "Routine description"
      ),
      location: optionalBoundedString(
        value.location,
        GROUP_ROUTINE_LOCATION_MAX_LENGTH,
        "Routine location"
      ),
      status,
      ...schedule,
      nextOccurrenceAtMs,
      participantUids: normalizeGroupRoutineParticipantUids(
        value.participantUids
      ),
      createdByUid,
      createdByName: optionalBoundedString(value.createdByName, 160, "Creator name"),
      createdByEmail: optionalBoundedString(value.createdByEmail, 320, "Creator email"),
      createdAtMs: finiteTimestamp(value.createdAtMs, "Created time"),
      updatedAtMs: finiteTimestamp(value.updatedAtMs, "Updated time"),
      createdAt: nullableServerTimestamp(value.createdAt),
      updatedAt: nullableServerTimestamp(value.updatedAt),
      pausedAtMs,
      pausedByUid,
      archivedAtMs,
      archivedByUid,
    };
  } catch {
    console.log("[GroupRoutines] ignored malformed routine", { routineId: documentId });
    return null;
  }
}

function canonicalCreateInput(input: CreateGroupRoutineInput) {
  const groupId = requiredString(input.groupId, "Group ID");
  const createdByUid = requiredString(input.createdByUid, "Creator");
  const schedule = normalizeGroupRoutineSchedule(input);
  return {
    groupId,
    title: normalizeGroupRoutineTitle(input.title),
    description: optionalBoundedString(
      input.description,
      GROUP_ROUTINE_DESCRIPTION_MAX_LENGTH,
      "Routine description"
    ),
    location: optionalBoundedString(
      input.location,
      GROUP_ROUTINE_LOCATION_MAX_LENGTH,
      "Routine location"
    ),
    ...schedule,
    participantUids: normalizeGroupRoutineParticipantUids(
      input.participantUids
    ),
    createdByUid,
    createdByName: optionalBoundedString(input.createdByName, 160, "Creator name"),
    createdByEmail: optionalBoundedString(input.createdByEmail, 320, "Creator email"),
  };
}

export async function createGroupRoutine(input: CreateGroupRoutineInput) {
  const canonical = canonicalCreateInput(input);
  const nowMs = input.nowMs ?? Date.now();
  finiteTimestamp(nowMs, "Current time");
  const routineRef = doc(collection(db, "groupRoutines"));
  const next = getNextGroupRoutineOccurrence(
    { ...canonical, status: "active" },
    nowMs - 1
  );
  if (!next) throw new Error("This routine has no future occurrence.");
  await runTransaction(db, async (transaction) => {
    transaction.set(routineRef, {
      id: routineRef.id,
      ...canonical,
      status: "active",
      nextOccurrenceAtMs: next.startAtMs,
      pausedAtMs: null,
      pausedByUid: null,
      archivedAtMs: null,
      archivedByUid: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return routineRef.id;
}

export async function updateGroupRoutine(input: UpdateGroupRoutineInput) {
  const routineId = requiredString(input.routineId, "Routine ID");
  const nowMs = input.nowMs ?? Date.now();
  finiteTimestamp(nowMs, "Current time");
  await runTransaction(db, async (transaction) => {
    const routineRef = doc(db, "groupRoutines", routineId);
    const snapshot = await transaction.get(routineRef);
    const current = snapshot.exists()
      ? mapGroupRoutineDoc(snapshot.id, snapshot.data())
      : null;
    if (!current) throw new Error("Routine is unavailable.");
    if (current.status === "archived") {
      throw new Error("Archived routines cannot be changed.");
    }
    const schedule = normalizeGroupRoutineSchedule({
      frequency: input.frequency ?? current.frequency,
      interval: input.interval ?? current.interval,
      weekdays: input.weekdays !== undefined ? input.weekdays : current.weekdays,
      monthlyMode:
        input.monthlyMode !== undefined ? input.monthlyMode : current.monthlyMode,
      dayOfMonth:
        input.dayOfMonth !== undefined ? input.dayOfMonth : current.dayOfMonth,
      weekOfMonth:
        input.weekOfMonth !== undefined ? input.weekOfMonth : current.weekOfMonth,
      weekdayOfMonth:
        input.weekdayOfMonth !== undefined
          ? input.weekdayOfMonth
          : current.weekdayOfMonth,
      localStartTime: input.localStartTime ?? current.localStartTime,
      durationMinutes:
        input.durationMinutes !== undefined
          ? input.durationMinutes
          : current.durationMinutes,
      timezone: input.timezone ?? current.timezone,
      startDate: input.startDate ?? current.startDate,
      endDate: input.endDate !== undefined ? input.endDate : current.endDate,
    });
    const next =
      current.status === "active"
        ? getNextGroupRoutineOccurrence(
            { ...schedule, status: "active" },
            nowMs - 1
          )
        : null;
    if (current.status === "active" && !next) {
      throw new Error("This routine has no future occurrence.");
    }
    transaction.update(routineRef, {
      title:
        input.title === undefined
          ? current.title
          : normalizeGroupRoutineTitle(input.title),
      description:
        input.description === undefined
          ? current.description
          : optionalBoundedString(
              input.description,
              GROUP_ROUTINE_DESCRIPTION_MAX_LENGTH,
              "Routine description"
            ),
      location:
        input.location === undefined
          ? current.location
          : optionalBoundedString(
              input.location,
              GROUP_ROUTINE_LOCATION_MAX_LENGTH,
              "Routine location"
            ),
      ...schedule,
      participantUids:
        input.participantUids === undefined
          ? current.participantUids
          : normalizeGroupRoutineParticipantUids(input.participantUids),
      nextOccurrenceAtMs: next?.startAtMs ?? null,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
}

async function transitionGroupRoutine(
  routineIdInput: string,
  actorUidInput: string,
  nowMsInput: number | undefined,
  transition: "pause" | "resume" | "archive"
) {
  const routineId = requiredString(routineIdInput, "Routine ID");
  const actorUid = requiredString(actorUidInput, "Actor");
  const nowMs = nowMsInput ?? Date.now();
  finiteTimestamp(nowMs, "Current time");
  await runTransaction(db, async (transaction) => {
    const routineRef = doc(db, "groupRoutines", routineId);
    const snapshot = await transaction.get(routineRef);
    const current = snapshot.exists()
      ? mapGroupRoutineDoc(snapshot.id, snapshot.data())
      : null;
    if (!current) throw new Error("Routine is unavailable.");
    const lifecyclePatch = getGroupRoutineLifecycleTransition(
      current,
      transition,
      actorUid,
      nowMs
    );
    transaction.update(routineRef, {
      ...lifecyclePatch,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
}

export function getGroupRoutineLifecycleTransition(
  current: GroupRoutineDoc,
  transition: "pause" | "resume" | "archive",
  actorUidInput: string,
  nowMsInput: number
): Pick<
  GroupRoutineDoc,
  | "status"
  | "pausedAtMs"
  | "pausedByUid"
  | "archivedAtMs"
  | "archivedByUid"
  | "nextOccurrenceAtMs"
> {
  const actorUid = requiredString(actorUidInput, "Actor");
  const nowMs = finiteTimestamp(nowMsInput, "Current time");
  if (transition === "pause") {
    if (current.status !== "active") {
      throw new Error("Only active routines can be paused.");
    }
    return {
      status: "paused",
      pausedAtMs: nowMs,
      pausedByUid: actorUid,
      archivedAtMs: null,
      archivedByUid: null,
      nextOccurrenceAtMs: null,
    };
  }
  if (transition === "resume") {
    if (current.status !== "paused") {
      throw new Error("Only paused routines can be resumed.");
    }
    const next = getNextGroupRoutineOccurrence(
      { ...current, status: "active" },
      nowMs - 1
    );
    if (!next) throw new Error("This routine has no future occurrence.");
    return {
      status: "active",
      pausedAtMs: null,
      pausedByUid: null,
      archivedAtMs: null,
      archivedByUid: null,
      nextOccurrenceAtMs: next.startAtMs,
    };
  }
  if (current.status === "archived") {
    throw new Error("This routine is already archived.");
  }
  return {
    status: "archived",
    pausedAtMs: current.pausedAtMs,
    pausedByUid: current.pausedByUid,
    archivedAtMs: nowMs,
    archivedByUid: actorUid,
    nextOccurrenceAtMs: null,
  };
}

export function pauseGroupRoutine(input: {
  routineId: string;
  actorUid: string;
  nowMs?: number;
}) {
  return transitionGroupRoutine(
    input.routineId,
    input.actorUid,
    input.nowMs,
    "pause"
  );
}

export function resumeGroupRoutine(input: {
  routineId: string;
  actorUid: string;
  nowMs?: number;
}) {
  return transitionGroupRoutine(
    input.routineId,
    input.actorUid,
    input.nowMs,
    "resume"
  );
}

export function archiveGroupRoutine(input: {
  routineId: string;
  actorUid: string;
  nowMs?: number;
}) {
  return transitionGroupRoutine(
    input.routineId,
    input.actorUid,
    input.nowMs,
    "archive"
  );
}

export function subscribeGroupRoutine(
  routineIdInput: string,
  onNext: (routine: GroupRoutineDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const routineId = routineIdInput.trim();
  if (!routineId) {
    onNext(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, "groupRoutines", routineId),
    (snapshot) =>
      onNext(
        snapshot.exists()
          ? mapGroupRoutineDoc(snapshot.id, snapshot.data())
          : null
      ),
    (error) => {
      console.log("[GroupRoutines] single subscription failed", { routineId });
      onError?.(error);
    }
  );
}

function subscribeGroupRoutinesByStatus(
  groupIdInput: string,
  status: GroupRoutineStatus,
  options: { limit?: number } | undefined,
  onNext: (routines: GroupRoutineDoc[]) => void,
  onError?: (error: unknown) => void
) {
  const groupId = groupIdInput.trim();
  if (!groupId) {
    onNext([]);
    return () => {};
  }
  const resultLimit = Math.max(
    1,
    Math.min(options?.limit ?? DEFAULT_GROUP_ROUTINE_LIMIT, MAX_GROUP_ROUTINE_LIMIT)
  );
  const routinesQuery = query(
    collection(db, "groupRoutines"),
    where("groupId", "==", groupId),
    where("status", "==", status),
    limit(resultLimit)
  );
  return onSnapshot(
    routinesQuery,
    (snapshot) => {
      const routines = snapshot.docs
        .map((item) => mapGroupRoutineDoc(item.id, item.data()))
        .filter(
          (routine): routine is GroupRoutineDoc =>
            routine != null && routine.status === status
        )
        .sort((a, b) => {
          const aNext = a.nextOccurrenceAtMs ?? Number.MAX_SAFE_INTEGER;
          const bNext = b.nextOccurrenceAtMs ?? Number.MAX_SAFE_INTEGER;
          return (
            aNext - bNext ||
            a.title.localeCompare(b.title) ||
            a.id.localeCompare(b.id)
          );
        });
      onNext(routines);
    },
    (error) => {
      console.log("[GroupRoutines] group subscription failed", {
        groupId,
        status,
      });
      onError?.(error);
    }
  );
}

export function subscribeActiveGroupRoutines(
  groupId: string,
  options: { limit?: number } | undefined,
  onNext: (routines: GroupRoutineDoc[]) => void,
  onError?: (error: unknown) => void
) {
  return subscribeGroupRoutinesByStatus(
    groupId,
    "active",
    options,
    onNext,
    onError
  );
}

export function subscribePausedGroupRoutines(
  groupId: string,
  options: { limit?: number } | undefined,
  onNext: (routines: GroupRoutineDoc[]) => void,
  onError?: (error: unknown) => void
) {
  return subscribeGroupRoutinesByStatus(
    groupId,
    "paused",
    options,
    onNext,
    onError
  );
}

export function subscribeArchivedGroupRoutines(
  groupId: string,
  options: { limit?: number } | undefined,
  onNext: (routines: GroupRoutineDoc[]) => void,
  onError?: (error: unknown) => void
) {
  return subscribeGroupRoutinesByStatus(
    groupId,
    "archived",
    options,
    onNext,
    onError
  );
}
