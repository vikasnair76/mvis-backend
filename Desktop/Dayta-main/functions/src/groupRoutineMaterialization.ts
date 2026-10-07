import { createHash } from "node:crypto";
import {
  FieldValue,
  Firestore,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";
import { DateTime, IANAZone } from "luxon";

export const MATERIALIZATION_VERSION = 1;
export const MATERIALIZATION_LOOK_BACK_MS = 24 * 60 * 60 * 1000;
export const MATERIALIZATION_LOOK_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_OCCURRENCES_PER_ROUTINE = 90;
export const MAX_ROUTINES_PER_SCHEDULED_RUN = 100;

type RoutineStatus = "active" | "paused" | "archived";
type Frequency = "daily" | "weekly" | "monthly";
type MonthlyMode = "day_of_month" | "nth_weekday";
type Routine = {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  location: string | null;
  status: RoutineStatus;
  frequency: Frequency;
  interval: number;
  weekdays: number[] | null;
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  weekOfMonth: 1 | 2 | 3 | 4 | -1 | null;
  weekdayOfMonth: number | null;
  localStartTime: string;
  durationMinutes: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  nextOccurrenceAtMs: number | null;
  createdByUid: string;
  createdByName: string | null;
  createdByEmail: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  participantUids: string[];
};
type Occurrence = { startAtMs: number; endAtMs: number | null; localDate: string };
type ExistingOccurrence = {
  id: string;
  startAtMs: number;
  scheduleFingerprint: string;
  contentFingerprint: string;
  status: "scheduled" | "cancelled";
  calendarProjectionId: string;
};

function requiredString(value: unknown, maximum = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error("invalid_string");
  }
  return value.trim();
}
function nullableString(value: unknown, maximum: number) {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maximum) throw new Error("invalid_string");
  return text || null;
}
function positiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("invalid_number");
  }
  return value;
}

export function mapRoutineForMaterialization(
  documentId: string,
  data: DocumentData
): Routine {
  if (data.id !== documentId) throw new Error("routine_id_mismatch");
  const status: RoutineStatus =
    data.status === "active" || data.status === "paused" || data.status === "archived"
      ? data.status
      : (() => { throw new Error("invalid_status"); })();
  const frequency: Frequency =
    data.frequency === "daily" || data.frequency === "weekly" || data.frequency === "monthly"
      ? data.frequency
      : (() => { throw new Error("invalid_frequency"); })();
  const timezone = requiredString(data.timezone, 100);
  if (!IANAZone.isValidZone(timezone)) throw new Error("invalid_timezone");
  const interval = positiveNumber(data.interval);
  if (!Number.isInteger(interval) || interval > 100) throw new Error("invalid_interval");
  const localStartTime = requiredString(data.localStartTime, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localStartTime)) {
    throw new Error("invalid_local_time");
  }
  const startDate = requiredString(data.startDate, 10);
  const endDate = data.endDate == null ? null : requiredString(data.endDate, 10);
  for (const date of [startDate, endDate].filter(Boolean) as string[]) {
    const parsed = DateTime.fromISO(date, { zone: timezone });
    if (!parsed.isValid || parsed.toFormat("yyyy-LL-dd") !== date) {
      throw new Error("invalid_date");
    }
  }
  if (endDate && endDate < startDate) throw new Error("invalid_date_bounds");
  const durationMinutes =
    data.durationMinutes == null ? null : positiveNumber(data.durationMinutes);
  if (
    durationMinutes != null &&
    (!Number.isInteger(durationMinutes) || durationMinutes > 10_080)
  ) throw new Error("invalid_duration");
  const weekdays =
    frequency === "weekly" &&
    Array.isArray(data.weekdays) &&
    data.weekdays.length > 0 &&
    data.weekdays.every((day: unknown) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7)
      ? [...data.weekdays].sort((a, b) => a - b)
      : frequency === "weekly"
        ? (() => { throw new Error("invalid_weekdays"); })()
        : null;
  const monthlyMode =
    frequency === "monthly" &&
    (data.monthlyMode === "day_of_month" || data.monthlyMode === "nth_weekday")
      ? data.monthlyMode
      : frequency === "monthly"
        ? (() => { throw new Error("invalid_monthly_mode"); })()
        : null;
  const dayOfMonth =
    monthlyMode === "day_of_month" &&
    Number.isInteger(data.dayOfMonth) &&
    data.dayOfMonth >= 1 &&
    data.dayOfMonth <= 31
      ? data.dayOfMonth
      : monthlyMode === "day_of_month"
        ? (() => { throw new Error("invalid_day_of_month"); })()
        : null;
  const weekOfMonth =
    monthlyMode === "nth_weekday" &&
    [-1, 1, 2, 3, 4].includes(data.weekOfMonth)
      ? data.weekOfMonth
      : monthlyMode === "nth_weekday"
        ? (() => { throw new Error("invalid_week_of_month"); })()
        : null;
  const weekdayOfMonth =
    monthlyMode === "nth_weekday" &&
    Number.isInteger(data.weekdayOfMonth) &&
    data.weekdayOfMonth >= 1 &&
    data.weekdayOfMonth <= 7
      ? data.weekdayOfMonth
      : monthlyMode === "nth_weekday"
        ? (() => { throw new Error("invalid_weekday_of_month"); })()
        : null;
  return {
    id: documentId,
    groupId: requiredString(data.groupId, 500),
    title: requiredString(data.title, 120),
    description: nullableString(data.description, 2000),
    location: nullableString(data.location, 240),
    status,
    frequency,
    interval,
    weekdays,
    monthlyMode,
    dayOfMonth,
    weekOfMonth,
    weekdayOfMonth,
    localStartTime,
    durationMinutes,
    timezone,
    startDate,
    endDate,
    nextOccurrenceAtMs: data.nextOccurrenceAtMs == null ? null : positiveNumber(data.nextOccurrenceAtMs),
    createdByUid: requiredString(data.createdByUid, 500),
    createdByName: nullableString(data.createdByName, 160),
    createdByEmail: nullableString(data.createdByEmail, 320),
    createdAtMs: positiveNumber(data.createdAtMs),
    updatedAtMs: positiveNumber(data.updatedAtMs),
    participantUids:
      data.participantUids == null
        ? []
        : Array.isArray(data.participantUids) &&
            data.participantUids.length <= 50 &&
            data.participantUids.every(
              (uid: unknown) => typeof uid === "string" && !!uid.trim()
            ) &&
            new Set(data.participantUids).size === data.participantUids.length
          ? [...data.participantUids].sort()
          : (() => {
              throw new Error("invalid_participants");
            })(),
  };
}

function stableHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}
export function getRoutineScheduleFingerprint(routine: Routine) {
  return stableHash([
    routine.frequency, routine.interval, routine.weekdays, routine.monthlyMode,
    routine.dayOfMonth, routine.weekOfMonth, routine.weekdayOfMonth,
    routine.localStartTime, routine.timezone, routine.startDate, routine.endDate,
    routine.durationMinutes,
  ]);
}
export function getRoutineContentFingerprint(routine: Routine) {
  return stableHash([
    routine.title, routine.description, routine.location,
    routine.createdByUid, routine.createdByName, routine.createdByEmail,
    routine.participantUids,
  ]);
}
export function getRoutineOccurrenceId(routineId: string, startAtMs: number) {
  return `gro_${stableHash([routineId, startAtMs])}`;
}
export function getRoutineProjectionId(occurrenceId: string) {
  return `grp_${occurrenceId}`;
}

function dateMatches(routine: Routine, candidate: DateTime) {
  const anchor = DateTime.fromISO(routine.startDate, { zone: routine.timezone }).startOf("day");
  const dateKey = candidate.toFormat("yyyy-LL-dd");
  if (dateKey < routine.startDate || (routine.endDate && dateKey > routine.endDate)) return false;
  if (routine.frequency === "daily") {
    return Math.floor(candidate.diff(anchor, "days").days) % routine.interval === 0;
  }
  if (routine.frequency === "weekly") {
    const delta = Math.floor(candidate.startOf("week").diff(anchor.startOf("week"), "weeks").weeks);
    return delta >= 0 && delta % routine.interval === 0 && !!routine.weekdays?.includes(candidate.weekday);
  }
  const delta = (candidate.year - anchor.year) * 12 + candidate.month - anchor.month;
  if (delta < 0 || delta % routine.interval !== 0) return false;
  if (routine.monthlyMode === "day_of_month") return candidate.day === routine.dayOfMonth;
  if (candidate.weekday !== routine.weekdayOfMonth) return false;
  if (routine.weekOfMonth === -1) return candidate.plus({ weeks: 1 }).month !== candidate.month;
  return Math.ceil(candidate.day / 7) === routine.weekOfMonth;
}
function occurrenceForDate(routine: Routine, candidate: DateTime): Occurrence {
  const [hour, minute] = routine.localStartTime.split(":").map(Number);
  const start = DateTime.fromObject(
    { year: candidate.year, month: candidate.month, day: candidate.day, hour, minute },
    { zone: routine.timezone }
  );
  if (!start.isValid) throw new Error("invalid_occurrence");
  return {
    startAtMs: start.toMillis(),
    endAtMs:
      routine.durationMinutes == null
        ? null
        : start.plus({ minutes: routine.durationMinutes }).toMillis(),
    localDate: candidate.toFormat("yyyy-LL-dd"),
  };
}
export function getRoutineOccurrencesInRange(
  routine: Routine,
  rangeStartMs: number,
  rangeEndMs: number,
  limit = MAX_OCCURRENCES_PER_ROUTINE
) {
  if (routine.status !== "active") return [];
  if (
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_OCCURRENCES_PER_ROUTINE
  ) throw new Error("invalid_range");
  const start = DateTime.fromMillis(rangeStartMs, { zone: routine.timezone });
  const end = DateTime.fromMillis(rangeEndMs, { zone: routine.timezone });
  let candidate = DateTime.max(
    DateTime.fromISO(routine.startDate, { zone: routine.timezone }),
    start.startOf("day")
  ).startOf("day");
  const finalDate = end.startOf("day").plus({ days: 1 });
  const result: Occurrence[] = [];
  while (candidate < finalDate && result.length < limit) {
    if (routine.endDate && candidate.toFormat("yyyy-LL-dd") > routine.endDate) break;
    if (dateMatches(routine, candidate)) {
      const occurrence = occurrenceForDate(routine, candidate);
      if (occurrence.startAtMs >= rangeStartMs && occurrence.startAtMs < rangeEndMs) {
        result.push(occurrence);
      }
    }
    candidate = candidate.plus({ days: 1 });
  }
  return result;
}
export function getNextRoutineOccurrence(routine: Routine, afterMs: number) {
  if (routine.status !== "active") return null;
  const rangeEnd = DateTime.fromMillis(afterMs, { zone: routine.timezone })
    .plus({ years: Math.max(2, Math.ceil(routine.interval / 12) + 1) })
    .toMillis();
  return getRoutineOccurrencesInRange(routine, afterMs + 1, rangeEnd, 1)[0] ?? null;
}

export function buildOccurrenceData(
  routine: Routine,
  occurrence: Occurrence,
  nowMs: number,
  existingGeneratedAtMs?: number
) {
  const id = getRoutineOccurrenceId(routine.id, occurrence.startAtMs);
  const projectionId = getRoutineProjectionId(id);
  return {
    id,
    groupId: routine.groupId,
    routineId: routine.id,
    occurrenceKey: `${routine.localStartTime}@${occurrence.localDate}`,
    calendarProjectionId: projectionId,
    materializationVersion: MATERIALIZATION_VERSION,
    scheduleFingerprint: getRoutineScheduleFingerprint(routine),
    contentFingerprint: getRoutineContentFingerprint(routine),
    startAtMs: occurrence.startAtMs,
    endAtMs: occurrence.endAtMs,
    localDate: occurrence.localDate,
    localStartTime: routine.localStartTime,
    timezone: routine.timezone,
    durationMinutes: routine.durationMinutes,
    status: "scheduled",
    executionStatus: "scheduled",
    executionUpdatedAtMs: null,
    executionUpdatedByUid: null,
    executionParticipantUid: null,
    executionRevision: 0,
    completedAtMs: null,
    completedByUid: null,
    skippedAtMs: null,
    skippedByUid: null,
    skipReason: null,
    reopenedAtMs: null,
    reopenedByUid: null,
    participantUids: routine.participantUids,
    participantCount: routine.participantUids.length,
    pendingParticipantCount: routine.participantUids.length,
    completedParticipantCount: 0,
    skippedParticipantCount: 0,
    excusedParticipantCount: 0,
    routineTitleSnapshot: routine.title,
    routineDescriptionSnapshot: routine.description,
    routineLocationSnapshot: routine.location,
    routineCreatedByUid: routine.createdByUid,
    routineCreatedByName: routine.createdByName,
    routineCreatedByEmail: routine.createdByEmail,
    routineUpdatedAtMsSnapshot: routine.updatedAtMs,
    generatedAtMs: existingGeneratedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    cancelledAtMs: null,
    cancelledReason: null,
    generatedAt: existingGeneratedAtMs ? Timestamp.fromMillis(existingGeneratedAtMs) : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function buildProjectionData(
  routine: Routine,
  occurrenceData: ReturnType<typeof buildOccurrenceData>,
  nowMs: number,
  existingCreatedAtMs?: number
) {
  const endAtMs = occurrenceData.endAtMs ?? occurrenceData.startAtMs + 60_000;
  return {
    id: occurrenceData.calendarProjectionId,
    scope: "group",
    type: "group",
    visibility: "group",
    groupId: routine.groupId,
    title: routine.title,
    description: routine.description,
    location: routine.location,
    allDay: false,
    startAtMs: occurrenceData.startAtMs,
    endAtMs,
    startDate: null,
    endDate: null,
    timezone: routine.timezone,
    sortStartMs: occurrenceData.startAtMs,
    sortEndMs: endAtMs,
    createdByUid: routine.createdByUid,
    createdByName: routine.createdByName,
    createdByEmail: routine.createdByEmail,
    attendeeUids: [],
    status: "scheduled",
    cancelledAtMs: null,
    cancelledByUid: null,
    createdAtMs: existingCreatedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    createdAt: existingCreatedAtMs ? Timestamp.fromMillis(existingCreatedAtMs) : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    sourceType: "group_routine",
    sourceRoutineId: routine.id,
    sourceOccurrenceId: occurrenceData.id,
    sourceScheduleFingerprint: occurrenceData.scheduleFingerprint,
  };
}

function generatedFieldsEqual(existing: DocumentData | undefined, expected: DocumentData) {
  if (!existing) return false;
  const executionOwnedFields = new Set([
    "executionStatus",
    "executionUpdatedAtMs",
    "executionUpdatedByUid",
    "executionParticipantUid",
    "executionRevision",
    "completedAtMs",
    "completedByUid",
    "skippedAtMs",
    "skippedByUid",
    "skipReason",
    "reopenedAtMs",
    "reopenedByUid",
    "participantUids",
    "participantCount",
    "pendingParticipantCount",
    "completedParticipantCount",
    "skippedParticipantCount",
    "excusedParticipantCount",
  ]);
  return Object.entries(expected).every(([key, value]) => {
    if (
      key === "updatedAt" ||
      key === "generatedAt" ||
      key === "createdAt" ||
      executionOwnedFields.has(key)
    ) return true;
    return JSON.stringify(existing[key]) === JSON.stringify(value);
  });
}

export async function reconcileRoutine(
  firestore: Firestore,
  routineId: string,
  nowMs = Date.now()
) {
  const routineRef = firestore.collection("groupRoutines").doc(routineId);
  const initial = await routineRef.get();
  if (!initial.exists) return { created: 0, updated: 0, cancelled: 0, unchanged: 0, cacheChanged: false };
  const routine = mapRoutineForMaterialization(initial.id, initial.data() ?? {});
  const version = routine.updatedAtMs;
  const windowStartMs = nowMs - MATERIALIZATION_LOOK_BACK_MS;
  const windowEndMs = nowMs + MATERIALIZATION_LOOK_AHEAD_MS;
  const desired = getRoutineOccurrencesInRange(
    routine,
    windowStartMs,
    windowEndMs,
    MAX_OCCURRENCES_PER_ROUTINE
  );
  const existingSnapshot = await firestore
    .collection("groupRoutineOccurrences")
    .where("routineId", "==", routine.id)
    .where("status", "==", "scheduled")
    .where("startAtMs", ">=", nowMs)
    .limit(MAX_OCCURRENCES_PER_ROUTINE)
    .get();
  const desiredOccurrenceRefs = desired.map((occurrence) =>
    firestore
      .collection("groupRoutineOccurrences")
      .doc(getRoutineOccurrenceId(routine.id, occurrence.startAtMs))
  );
  const desiredOccurrenceSnapshots = desiredOccurrenceRefs.length
    ? await firestore.getAll(...desiredOccurrenceRefs)
    : [];
  const existing = new Map<string, ExistingOccurrence & DocumentData>(
    existingSnapshot.docs.map((item) => [
      item.id,
      { id: item.id, ...item.data() } as ExistingOccurrence & DocumentData,
    ])
  );
  for (const snapshot of desiredOccurrenceSnapshots) {
    if (snapshot.exists) {
      existing.set(snapshot.id, {
        id: snapshot.id,
        ...snapshot.data(),
      } as ExistingOccurrence & DocumentData);
    }
  }
  const projectionIds = new Set<string>([
    ...desired.map((occurrence) =>
      getRoutineProjectionId(getRoutineOccurrenceId(routine.id, occurrence.startAtMs))
    ),
    ...[...existing.values()].map((item) => item.calendarProjectionId),
  ]);
  const projectionSnapshots = projectionIds.size
    ? await firestore.getAll(
        ...[...projectionIds].map((id) =>
          firestore.collection("planningCalendarEvents").doc(id)
        )
      )
    : [];
  const existingProjections = new Map(
    projectionSnapshots.map((snapshot) => [snapshot.id, snapshot])
  );
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let unchanged = 0;
  let cacheChanged = false;
  await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(routineRef);
    if (!currentSnapshot.exists) throw new Error("stale_routine");
    const current = mapRoutineForMaterialization(
      currentSnapshot.id,
      currentSnapshot.data() ?? {}
    );
    if (current.updatedAtMs !== version) throw new Error("stale_routine");
    const desiredIds = new Set<string>();
    for (const occurrence of desired) {
      const occurrenceId = getRoutineOccurrenceId(routine.id, occurrence.startAtMs);
      desiredIds.add(occurrenceId);
      const previous = existing.get(occurrenceId);
      if (previous && occurrence.startAtMs < nowMs) {
        unchanged += 1;
        continue;
      }
      const occurrenceData = buildOccurrenceData(
        routine,
        occurrence,
        nowMs,
        previous?.generatedAtMs
      );
      const occurrenceRef = firestore.collection("groupRoutineOccurrences").doc(occurrenceId);
      const projectionRef = firestore.collection("planningCalendarEvents").doc(occurrenceData.calendarProjectionId);
      const previousProjection = existingProjections.get(
        occurrenceData.calendarProjectionId
      );
      const projectionData = buildProjectionData(
        routine,
        occurrenceData,
        nowMs,
        previousProjection?.data()?.createdAtMs
      );
      if (!previous) created += 1;
      else if (!generatedFieldsEqual(previous, occurrenceData)) updated += 1;
      else unchanged += 1;
      if (!previous || !generatedFieldsEqual(previous, occurrenceData)) {
        const mayReconcileParticipants =
          !!previous &&
          previous.status === "scheduled" &&
          (previous.executionStatus == null ||
            previous.executionStatus === "scheduled") &&
          (previous.completedParticipantCount ?? 0) === 0 &&
          (previous.skippedParticipantCount ?? 0) === 0 &&
          (previous.excusedParticipantCount ?? 0) === 0;
        const preservedParticipantUids = mayReconcileParticipants
          ? occurrenceData.participantUids
          : previous?.participantUids ?? occurrenceData.participantUids;
        transaction.set(
          occurrenceRef,
          previous
            ? {
                ...occurrenceData,
                executionStatus: previous.executionStatus ?? "scheduled",
                executionUpdatedAtMs: previous.executionUpdatedAtMs ?? null,
                executionUpdatedByUid: previous.executionUpdatedByUid ?? null,
                executionParticipantUid:
                  previous.executionParticipantUid ?? null,
                executionRevision: previous.executionRevision ?? 0,
                completedAtMs: previous.completedAtMs ?? null,
                completedByUid: previous.completedByUid ?? null,
                skippedAtMs: previous.skippedAtMs ?? null,
                skippedByUid: previous.skippedByUid ?? null,
                skipReason: previous.skipReason ?? null,
                reopenedAtMs: previous.reopenedAtMs ?? null,
                reopenedByUid: previous.reopenedByUid ?? null,
                participantUids:
                  preservedParticipantUids,
                participantCount:
                  mayReconcileParticipants
                    ? preservedParticipantUids.length
                    : previous.participantCount ??
                      occurrenceData.participantCount,
                pendingParticipantCount:
                  mayReconcileParticipants
                    ? preservedParticipantUids.length
                    : previous.pendingParticipantCount ??
                      occurrenceData.pendingParticipantCount,
                completedParticipantCount:
                  previous.completedParticipantCount ?? 0,
                skippedParticipantCount:
                  previous.skippedParticipantCount ?? 0,
                excusedParticipantCount:
                  previous.excusedParticipantCount ?? 0,
              }
            : occurrenceData
        );
        if (mayReconcileParticipants) {
          const previousParticipantUids = Array.isArray(previous?.participantUids)
            ? previous.participantUids
            : [];
          for (const participantUid of routine.participantUids) {
            if (!previousParticipantUids.includes(participantUid)) {
              transaction.set(
                occurrenceRef.collection("participants").doc(participantUid),
                {
                  id: participantUid,
                  uid: participantUid,
                  groupId: routine.groupId,
                  routineId: routine.id,
                  occurrenceId,
                  status: "pending",
                  statusRevision: 0,
                  note: null,
                  completedAtMs: null,
                  skippedAtMs: null,
                  excusedAtMs: null,
                  updatedByUid: "system",
                  updatedAtMs: nowMs,
                  createdAtMs: nowMs,
                }
              );
            }
          }
          for (const participantUid of previousParticipantUids) {
            if (!routine.participantUids.includes(participantUid)) {
              transaction.delete(
                occurrenceRef.collection("participants").doc(participantUid)
              );
            }
          }
        }
        if (!previous) {
          for (const participantUid of routine.participantUids) {
            transaction.set(
              occurrenceRef.collection("participants").doc(participantUid),
              {
                id: participantUid,
                uid: participantUid,
                groupId: routine.groupId,
                routineId: routine.id,
                occurrenceId,
                status: "pending",
                statusRevision: 0,
                note: null,
                completedAtMs: null,
                skippedAtMs: null,
                excusedAtMs: null,
                updatedByUid: "system",
                updatedAtMs: nowMs,
                createdAtMs: nowMs,
              }
            );
          }
        }
      }
      if (!previousProjection?.exists || !generatedFieldsEqual(previousProjection.data(), projectionData)) {
        transaction.set(projectionRef, projectionData);
      }
    }
    const cancellationReason =
      routine.status === "paused"
        ? "paused"
        : routine.status === "archived"
          ? "archived"
          : "schedule_changed";
    for (const [occurrenceId, item] of existing) {
      if (
        item.startAtMs >= nowMs &&
        item.status === "scheduled" &&
        !desiredIds.has(occurrenceId)
      ) {
        cancelled += 1;
        transaction.update(
          firestore.collection("groupRoutineOccurrences").doc(occurrenceId),
          {
            status: "cancelled",
            cancelledAtMs: nowMs,
            cancelledReason: cancellationReason,
            updatedAtMs: nowMs,
            updatedAt: FieldValue.serverTimestamp(),
          }
        );
        transaction.update(
          firestore.collection("planningCalendarEvents").doc(item.calendarProjectionId),
          {
            status: "cancelled",
            cancelledAtMs: nowMs,
            cancelledByUid: "system",
            updatedAtMs: nowMs,
            updatedAt: FieldValue.serverTimestamp(),
          }
        );
      }
    }
    const nextOccurrenceAtMs =
      routine.status === "active"
        ? getNextRoutineOccurrence(routine, nowMs)?.startAtMs ?? null
        : null;
    if (current.nextOccurrenceAtMs !== nextOccurrenceAtMs) {
      cacheChanged = true;
      transaction.update(routineRef, {
        nextOccurrenceAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { created, updated, cancelled, unchanged, cacheChanged };
}
