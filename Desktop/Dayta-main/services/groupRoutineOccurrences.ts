import { IANAZone } from "luxon";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {db, functions} from "./firebase";
import type { GroupMemberStatus, GroupRole } from "./groups";

export const GROUP_ROUTINE_MATERIALIZATION_VERSION = 1;
export const GROUP_ROUTINE_CHECK_IN_NOTE_MAX_LENGTH = 500;
export const GROUP_ROUTINE_OCCURRENCE_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "skipped",
  "cancelled",
] as const;
export const GROUP_ROUTINE_PARTICIPANT_STATUSES = [
  "pending",
  "completed",
  "skipped",
  "excused",
] as const;

export type GroupRoutineScheduleStatus = "scheduled" | "cancelled";
export type GroupRoutineOccurrenceStatus =
  (typeof GROUP_ROUTINE_OCCURRENCE_STATUSES)[number];
export type GroupRoutineParticipantStatus =
  (typeof GROUP_ROUTINE_PARTICIPANT_STATUSES)[number];

export type GroupRoutineOccurrenceDoc = {
  id: string;
  groupId: string;
  routineId: string;
  occurrenceKey: string;
  calendarProjectionId: string;
  materializationVersion: 1;
  scheduleFingerprint: string;
  contentFingerprint: string;
  startAtMs: number;
  endAtMs: number | null;
  localDate: string;
  localStartTime: string;
  timezone: string;
  durationMinutes: number | null;
  status: GroupRoutineScheduleStatus;
  executionStatus: GroupRoutineOccurrenceStatus;
  executionUpdatedAtMs: number | null;
  executionUpdatedByUid: string | null;
  executionParticipantUid: string | null;
  executionRevision: number;
  completedAtMs: number | null;
  completedByUid: string | null;
  skippedAtMs: number | null;
  skippedByUid: string | null;
  skipReason: string | null;
  reopenedAtMs: number | null;
  reopenedByUid: string | null;
  participantUids: string[];
  participantCount: number;
  pendingParticipantCount: number;
  completedParticipantCount: number;
  skippedParticipantCount: number;
  excusedParticipantCount: number;
  routineTitleSnapshot: string;
  routineDescriptionSnapshot: string | null;
  routineLocationSnapshot: string | null;
  routineCreatedByUid: string;
  routineCreatedByName: string | null;
  routineCreatedByEmail: string | null;
  routineUpdatedAtMsSnapshot: number;
  generatedAtMs: number;
  updatedAtMs: number;
  cancelledAtMs: number | null;
  cancelledReason:
    | "schedule_changed"
    | "paused"
    | "archived"
    | "date_bounds_changed"
    | null;
  generatedAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type GroupRoutineOccurrenceParticipantDoc = {
  id: string;
  uid: string;
  groupId: string;
  routineId: string;
  occurrenceId: string;
  status: GroupRoutineParticipantStatus;
  statusRevision: number;
  note: string | null;
  completedAtMs: number | null;
  skippedAtMs: number | null;
  excusedAtMs: number | null;
  updatedByUid: string;
  updatedAtMs: number;
  createdAtMs: number;
};

export type RoutineOccurrenceCounts = Pick<
  GroupRoutineOccurrenceDoc,
  | "participantCount"
  | "pendingParticipantCount"
  | "completedParticipantCount"
  | "skippedParticipantCount"
  | "excusedParticipantCount"
>;

function stringValue(value: unknown, maximum: number, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error("Invalid string.");
  }
  return value;
}
function positiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid timestamp.");
  }
  return value;
}
function nullablePositiveNumber(value: unknown) {
  return value == null ? null : positiveNumber(value);
}
function nullableString(value: unknown, maximum: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("Invalid string.");
  }
  return value;
}
function serverTimestampValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "object" && value && "toMillis" in value) {
    return value as Timestamp;
  }
  throw new Error("Invalid server timestamp.");
}
function nonnegativeInteger(value: unknown, fallback = 0) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("Invalid count.");
  }
  return Number(value);
}
function normalizedUidList(value: unknown) {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((uid) => typeof uid !== "string" || !uid.trim())
  ) {
    throw new Error("Invalid participants.");
  }
  const result = Array.from(new Set(value)).sort();
  if (result.length !== value.length) throw new Error("Invalid participants.");
  return result;
}

export function normalizeRoutineOccurrenceStatus(
  value: unknown,
  fallback: GroupRoutineOccurrenceStatus = "scheduled"
) {
  return GROUP_ROUTINE_OCCURRENCE_STATUSES.includes(
    value as GroupRoutineOccurrenceStatus
  )
    ? (value as GroupRoutineOccurrenceStatus)
    : fallback;
}
export function normalizeRoutineParticipantStatus(
  value: unknown,
  fallback: GroupRoutineParticipantStatus = "pending"
) {
  return GROUP_ROUTINE_PARTICIPANT_STATUSES.includes(
    value as GroupRoutineParticipantStatus
  )
    ? (value as GroupRoutineParticipantStatus)
    : fallback;
}
export function normalizeRoutineCheckInNote(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("Check-in note is invalid.");
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  if (normalized.length > GROUP_ROUTINE_CHECK_IN_NOTE_MAX_LENGTH) {
    throw new Error(
      `Check-in note must be ${GROUP_ROUTINE_CHECK_IN_NOTE_MAX_LENGTH} characters or fewer.`
    );
  }
  return normalized || null;
}

export function hasValidRoutineOccurrenceCountInvariant(
  counts: RoutineOccurrenceCounts
) {
  return (
    Object.values(counts).every(
      (value) => Number.isInteger(value) && value >= 0
    ) &&
    counts.pendingParticipantCount +
      counts.completedParticipantCount +
      counts.skippedParticipantCount +
      counts.excusedParticipantCount ===
      counts.participantCount
  );
}

export function deriveRoutineOccurrenceExecutionState(input: {
  scheduleCancelled: boolean;
  participantStatuses: GroupRoutineParticipantStatus[];
  noParticipantStatus?: "scheduled" | "completed" | "skipped";
}): { executionStatus: GroupRoutineOccurrenceStatus; counts: RoutineOccurrenceCounts } {
  const participantCount = input.participantStatuses.length;
  const counts: RoutineOccurrenceCounts = {
    participantCount,
    pendingParticipantCount: input.participantStatuses.filter(
      (status) => status === "pending"
    ).length,
    completedParticipantCount: input.participantStatuses.filter(
      (status) => status === "completed"
    ).length,
    skippedParticipantCount: input.participantStatuses.filter(
      (status) => status === "skipped"
    ).length,
    excusedParticipantCount: input.participantStatuses.filter(
      (status) => status === "excused"
    ).length,
  };
  if (input.scheduleCancelled) return { executionStatus: "cancelled", counts };
  if (!participantCount) {
    return {
      executionStatus: input.noParticipantStatus ?? "scheduled",
      counts,
    };
  }
  if (counts.pendingParticipantCount > 0) {
    return {
      executionStatus:
        counts.completedParticipantCount + counts.skippedParticipantCount > 0
          ? "in_progress"
          : "scheduled",
      counts,
    };
  }
  return {
    executionStatus:
      counts.completedParticipantCount > 0 ? "completed" : "skipped",
    counts,
  };
}

export function canTransitionRoutineParticipantStatus(input: {
  from: GroupRoutineParticipantStatus;
  to: GroupRoutineParticipantStatus;
  actorRole: GroupRole | null;
  actorStatus: GroupMemberStatus | null;
  actorUid: string;
  participantUid: string;
  scheduleCancelled: boolean;
  routineCreatedByUid?: string;
}) {
  if (
    input.actorStatus !== "active" ||
    input.actorRole === "viewer" ||
    input.scheduleCancelled
  ) {
    return false;
  }
  const manager =
    input.actorRole === "owner" ||
    input.actorRole === "admin" ||
    input.actorRole === "moderator" ||
    (input.actorRole === "member" &&
      input.routineCreatedByUid === input.actorUid);
  if (manager) return true;
  return (
    input.actorUid === input.participantUid &&
    input.to !== "excused" &&
    ["pending", "completed", "skipped"].includes(input.to)
  );
}

export function canTransitionRoutineOccurrenceStatus(input: {
  from: GroupRoutineOccurrenceStatus;
  to: "scheduled" | "completed" | "skipped";
  actorRole: GroupRole | null;
  actorStatus: GroupMemberStatus | null;
  actorUid: string;
  routineCreatedByUid: string;
  hasParticipants: boolean;
  scheduleCancelled: boolean;
}) {
  if (input.actorStatus !== "active" || input.scheduleCancelled) return false;
  const manager =
    input.actorRole === "owner" ||
    input.actorRole === "admin" ||
    input.actorRole === "moderator" ||
    (input.actorRole === "member" &&
      input.actorUid === input.routineCreatedByUid);
  return manager && !input.hasParticipants;
}

export function mapGroupRoutineOccurrenceDoc(
  documentId: string,
  value: unknown
): GroupRoutineOccurrenceDoc | null {
  try {
    if (!value || typeof value !== "object") throw new Error("Invalid occurrence.");
    const data = value as Record<string, unknown>;
    if (data.id !== documentId || data.materializationVersion !== 1) {
      throw new Error("Invalid identity.");
    }
    const status =
      data.status === "scheduled" || data.status === "cancelled"
        ? data.status
        : null;
    if (!status) throw new Error("Invalid status.");
    const timezone = stringValue(data.timezone, 100) as string;
    if (!IANAZone.isValidZone(timezone)) throw new Error("Invalid timezone.");
    const localDate = stringValue(data.localDate, 10) as string;
    const localStartTime = stringValue(data.localStartTime, 5) as string;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localStartTime)
    ) {
      throw new Error("Invalid local timing.");
    }
    const startAtMs = positiveNumber(data.startAtMs);
    const endAtMs = nullablePositiveNumber(data.endAtMs);
    if (endAtMs != null && endAtMs <= startAtMs) throw new Error("Invalid duration.");
    const cancelledAtMs = nullablePositiveNumber(data.cancelledAtMs);
    const cancelledReason =
      data.cancelledReason === "schedule_changed" ||
      data.cancelledReason === "paused" ||
      data.cancelledReason === "archived" ||
      data.cancelledReason === "date_bounds_changed"
        ? data.cancelledReason
        : null;
    if (
      (status === "scheduled" &&
        (cancelledAtMs != null || cancelledReason != null)) ||
      (status === "cancelled" &&
        (cancelledAtMs == null || cancelledReason == null))
    ) {
      throw new Error("Invalid cancellation.");
    }
    const participantUids = normalizedUidList(data.participantUids);
    const counts: RoutineOccurrenceCounts = {
      participantCount: nonnegativeInteger(
        data.participantCount,
        participantUids.length
      ),
      pendingParticipantCount: nonnegativeInteger(
        data.pendingParticipantCount,
        participantUids.length
      ),
      completedParticipantCount: nonnegativeInteger(
        data.completedParticipantCount
      ),
      skippedParticipantCount: nonnegativeInteger(
        data.skippedParticipantCount
      ),
      excusedParticipantCount: nonnegativeInteger(
        data.excusedParticipantCount
      ),
    };
    if (
      counts.participantCount !== participantUids.length ||
      !hasValidRoutineOccurrenceCountInvariant(counts)
    ) {
      throw new Error("Invalid count invariant.");
    }
    const executionStatus =
      status === "cancelled"
        ? "cancelled"
        : normalizeRoutineOccurrenceStatus(data.executionStatus);
    const generatedAtMs = positiveNumber(data.generatedAtMs);
    const updatedAtMs = positiveNumber(data.updatedAtMs);
    if (updatedAtMs < generatedAtMs) throw new Error("Invalid update time.");
    const durationMinutes =
      data.durationMinutes == null
        ? null
        : typeof data.durationMinutes === "number" &&
            Number.isInteger(data.durationMinutes) &&
            data.durationMinutes >= 1 &&
            data.durationMinutes <= 10_080
          ? data.durationMinutes
          : (() => {
              throw new Error("Invalid duration.");
            })();
    return {
      id: stringValue(data.id, 500) as string,
      groupId: stringValue(data.groupId, 500) as string,
      routineId: stringValue(data.routineId, 500) as string,
      occurrenceKey: stringValue(data.occurrenceKey, 500) as string,
      calendarProjectionId: stringValue(data.calendarProjectionId, 500) as string,
      materializationVersion: 1,
      scheduleFingerprint: stringValue(data.scheduleFingerprint, 100) as string,
      contentFingerprint: stringValue(data.contentFingerprint, 100) as string,
      startAtMs,
      endAtMs,
      localDate,
      localStartTime,
      timezone,
      durationMinutes,
      status,
      executionStatus,
      executionUpdatedAtMs: nullablePositiveNumber(data.executionUpdatedAtMs),
      executionUpdatedByUid: nullableString(data.executionUpdatedByUid, 500),
      executionParticipantUid: nullableString(
        data.executionParticipantUid,
        500
      ),
      executionRevision: nonnegativeInteger(data.executionRevision),
      completedAtMs: nullablePositiveNumber(data.completedAtMs),
      completedByUid: nullableString(data.completedByUid, 500),
      skippedAtMs: nullablePositiveNumber(data.skippedAtMs),
      skippedByUid: nullableString(data.skippedByUid, 500),
      skipReason: nullableString(data.skipReason, 500),
      reopenedAtMs: nullablePositiveNumber(data.reopenedAtMs),
      reopenedByUid: nullableString(data.reopenedByUid, 500),
      participantUids,
      ...counts,
      routineTitleSnapshot: stringValue(data.routineTitleSnapshot, 120) as string,
      routineDescriptionSnapshot: stringValue(
        data.routineDescriptionSnapshot,
        2000,
        true
      ),
      routineLocationSnapshot: stringValue(
        data.routineLocationSnapshot,
        240,
        true
      ),
      routineCreatedByUid: stringValue(data.routineCreatedByUid, 500) as string,
      routineCreatedByName: stringValue(
        data.routineCreatedByName,
        160,
        true
      ),
      routineCreatedByEmail: stringValue(
        data.routineCreatedByEmail,
        320,
        true
      ),
      routineUpdatedAtMsSnapshot: positiveNumber(
        data.routineUpdatedAtMsSnapshot
      ),
      generatedAtMs,
      updatedAtMs,
      cancelledAtMs,
      cancelledReason,
      generatedAt: serverTimestampValue(data.generatedAt),
      updatedAt: serverTimestampValue(data.updatedAt),
    };
  } catch {
    console.warn("[GroupRoutineOccurrences] ignored malformed occurrence", {
      occurrenceId: documentId,
    });
    return null;
  }
}

export function mapGroupRoutineOccurrenceParticipantDoc(
  documentId: string,
  value: unknown
): GroupRoutineOccurrenceParticipantDoc | null {
  try {
    if (!value || typeof value !== "object") throw new Error("Invalid participant.");
    const data = value as Record<string, unknown>;
    if (data.id !== documentId || data.uid !== documentId) {
      throw new Error("Participant identity mismatch.");
    }
    return {
      id: documentId,
      uid: documentId,
      groupId: stringValue(data.groupId, 500) as string,
      routineId: stringValue(data.routineId, 500) as string,
      occurrenceId: stringValue(data.occurrenceId, 500) as string,
      status: normalizeRoutineParticipantStatus(data.status),
      statusRevision: nonnegativeInteger(data.statusRevision),
      note: normalizeRoutineCheckInNote(data.note),
      completedAtMs: nullablePositiveNumber(data.completedAtMs),
      skippedAtMs: nullablePositiveNumber(data.skippedAtMs),
      excusedAtMs: nullablePositiveNumber(data.excusedAtMs),
      updatedByUid: stringValue(data.updatedByUid, 500) as string,
      updatedAtMs: positiveNumber(data.updatedAtMs),
      createdAtMs: positiveNumber(data.createdAtMs),
    };
  } catch {
    console.warn("[GroupRoutineOccurrences] ignored malformed participant", {
      participantId: documentId,
    });
    return null;
  }
}

function occurrenceRef(occurrenceId: string) {
  return doc(db, "groupRoutineOccurrences", occurrenceId);
}

export function subscribeGroupRoutineOccurrence(
  occurrenceIdInput: string,
  onNext: (occurrence: GroupRoutineOccurrenceDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const occurrenceId = occurrenceIdInput.trim();
  if (!occurrenceId) {
    onNext(null);
    return () => {};
  }
  return onSnapshot(
    occurrenceRef(occurrenceId),
    (snapshot) =>
      onNext(
        snapshot.exists()
          ? mapGroupRoutineOccurrenceDoc(snapshot.id, snapshot.data())
          : null
      ),
    onError
  );
}

export function subscribeGroupRoutineOccurrenceParticipants(
  occurrenceIdInput: string,
  onNext: (participants: GroupRoutineOccurrenceParticipantDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const occurrenceId = occurrenceIdInput.trim();
  if (!occurrenceId) {
    onNext([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, "groupRoutineOccurrences", occurrenceId, "participants"),
    (snapshot) =>
      onNext(
        snapshot.docs
          .map((item) =>
            mapGroupRoutineOccurrenceParticipantDoc(item.id, item.data())
          )
          .filter(
            (item): item is GroupRoutineOccurrenceParticipantDoc => !!item
          )
      ),
    onError
  );
}

export function subscribeGroupRoutineOccurrencesForRange(
  groupIdInput: string,
  rangeStartMs: number,
  rangeEndMs: number,
  onNext: (occurrences: GroupRoutineOccurrenceDoc[]) => void,
  onError?: (error: unknown) => void,
  options?: { limit?: number; includeCancelled?: boolean }
): Unsubscribe {
  const groupId = groupIdInput.trim();
  const resultLimit = Math.max(1, Math.min(options?.limit ?? 200, 500));
  if (
    !groupId ||
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs
  ) {
    onNext([]);
    return () => {};
  }
  const constraints = [
    where("groupId", "==", groupId),
    ...(options?.includeCancelled ? [] : [where("status", "==", "scheduled")]),
    where("startAtMs", ">=", rangeStartMs),
    where("startAtMs", "<", rangeEndMs),
    orderBy("startAtMs", "asc"),
    limit(resultLimit),
  ];
  return onSnapshot(
    query(collection(db, "groupRoutineOccurrences"), ...constraints),
    (snapshot) =>
      onNext(
        snapshot.docs
          .map((item) => mapGroupRoutineOccurrenceDoc(item.id, item.data()))
          .filter((item): item is GroupRoutineOccurrenceDoc => item != null)
      ),
    (error) => {
      console.log("[GroupRoutineOccurrences] range subscription failed", {
        groupId,
      });
      onError?.(error);
    }
  );
}

export function subscribeRecentGroupRoutineOccurrences(
  routineIdInput: string,
  onNext: (occurrences: GroupRoutineOccurrenceDoc[]) => void,
  onError?: (error: unknown) => void,
  options?: { limit?: number }
) {
  const routineId = routineIdInput.trim();
  if (!routineId) {
    onNext([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "groupRoutineOccurrences"),
      where("routineId", "==", routineId),
      orderBy("startAtMs", "desc"),
      limit(Math.max(1, Math.min(options?.limit ?? 10, 25)))
    ),
    (snapshot) =>
      onNext(
        snapshot.docs
          .map((item) => mapGroupRoutineOccurrenceDoc(item.id, item.data()))
          .filter((item): item is GroupRoutineOccurrenceDoc => !!item)
      ),
    onError
  );
}

export function getRoutineCompletionMetrics(
  occurrences: GroupRoutineOccurrenceDoc[]
) {
  const completed = occurrences.filter(
    (item) => item.executionStatus === "completed"
  ).length;
  const skipped = occurrences.filter(
    (item) => item.executionStatus === "skipped"
  ).length;
  return {
    completed,
    skipped,
    resolved: completed + skipped,
    completionRate:
      completed + skipped > 0 ? completed / (completed + skipped) : null,
  };
}

async function updateParticipant(input: {
  occurrenceId: string;
  actorUid: string;
  participantUid: string;
  status?: GroupRoutineParticipantStatus;
  note?: string | null;
  nowMs?: number;
}) {
  const occurrenceId = stringValue(input.occurrenceId, 500) as string;
  const actorUid = stringValue(input.actorUid, 500) as string;
  const participantUid = stringValue(input.participantUid, 500) as string;
  const note =
    input.note === undefined ? undefined : normalizeRoutineCheckInNote(input.note);
  const nowMs = input.nowMs ?? Date.now();
  positiveNumber(nowMs);
  const callable = httpsCallable(functions, "mutateRoutineOccurrence");
  return (await callable({
    action: "participant", occurrenceId, participantUid,
    ...(input.status === undefined ? {} : {status: input.status}),
    ...(note === undefined ? {} : {note}),
    actorUid,
  })).data;
}

export function completeMyRoutineOccurrenceParticipation(input: {
  occurrenceId: string;
  uid: string;
  note?: string | null;
  nowMs?: number;
}) {
  return updateParticipant({
    occurrenceId: input.occurrenceId,
    actorUid: input.uid,
    participantUid: input.uid,
    status: "completed",
    note: input.note,
    nowMs: input.nowMs,
  });
}
export function skipMyRoutineOccurrenceParticipation(input: {
  occurrenceId: string;
  uid: string;
  note?: string | null;
  nowMs?: number;
}) {
  return updateParticipant({
    occurrenceId: input.occurrenceId,
    actorUid: input.uid,
    participantUid: input.uid,
    status: "skipped",
    note: input.note,
    nowMs: input.nowMs,
  });
}
export function reopenMyRoutineOccurrenceParticipation(input: {
  occurrenceId: string;
  uid: string;
  nowMs?: number;
}) {
  return updateParticipant({
    occurrenceId: input.occurrenceId,
    actorUid: input.uid,
    participantUid: input.uid,
    status: "pending",
    nowMs: input.nowMs,
  });
}
export function updateMyRoutineOccurrenceParticipationNote(input: {
  occurrenceId: string;
  uid: string;
  note: string | null;
  nowMs?: number;
}) {
  return updateParticipant({
    occurrenceId: input.occurrenceId,
    actorUid: input.uid,
    participantUid: input.uid,
    note: input.note,
    nowMs: input.nowMs,
  });
}
export function setRoutineOccurrenceParticipantStatus(input: {
  occurrenceId: string;
  actorUid: string;
  participantUid: string;
  status: GroupRoutineParticipantStatus;
  nowMs?: number;
}) {
  return updateParticipant(input);
}
export function excuseRoutineOccurrenceParticipant(
  input: Omit<
    Parameters<typeof setRoutineOccurrenceParticipantStatus>[0],
    "status"
  >
) {
  return setRoutineOccurrenceParticipantStatus({ ...input, status: "excused" });
}

async function setNoParticipantOccurrenceStatus(input: {
  occurrenceId: string;
  actorUid: string;
  status: "scheduled" | "completed" | "skipped";
  skipReason?: string | null;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  positiveNumber(nowMs);
  const reason =
    input.status === "skipped"
      ? normalizeRoutineCheckInNote(input.skipReason)
      : null;
  const callable = httpsCallable(functions, "mutateRoutineOccurrence");
  return (await callable({
    action: "empty", occurrenceId: input.occurrenceId,
    status: input.status, note: reason, actorUid: input.actorUid,
  })).data;
}
export function completeRoutineOccurrence(
  input: Omit<Parameters<typeof setNoParticipantOccurrenceStatus>[0], "status">
) {
  return setNoParticipantOccurrenceStatus({ ...input, status: "completed" });
}
export function skipRoutineOccurrence(
  input: Omit<Parameters<typeof setNoParticipantOccurrenceStatus>[0], "status">
) {
  return setNoParticipantOccurrenceStatus({ ...input, status: "skipped" });
}
export function reopenRoutineOccurrence(
  input: Omit<
    Parameters<typeof setNoParticipantOccurrenceStatus>[0],
    "status" | "skipReason"
  >
) {
  return setNoParticipantOccurrenceStatus({ ...input, status: "scheduled" });
}
