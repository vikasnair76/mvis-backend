import type {DocumentData, Firestore} from "firebase-admin/firestore";
import {
  GroupHistoryRecordingError,
  recordGroupHistoryEvent,
  type GroupHistoryEventType,
  type GroupHistoryWriteResult,
} from "./groupHistoryRecording.js";
import {
  getRoutineTransitionEventId,
  type OccurrenceTransition,
} from "./groupRoutineTransitionSideEffects.js";

export type GroupHistoryRecordingSkipReason =
  | "not_group_scoped"
  | "ambiguous_group_tenancy"
  | "unsupported_source"
  | "invalid_source_identity"
  | "invalid_occurred_time"
  | "missing_parent"
  | "invalid_actor_evidence"
  | "unsupported_count_mode"
  | "unsupported_repeat_completion"
  | "malformed_source"
  | "tenancy_mismatch";
export type GroupHistoryRecordingResult =
  | GroupHistoryWriteResult
  | {status: "skipped"; reason: GroupHistoryRecordingSkipReason};

const safeId = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 &&
  value.trim().length <= 500 && !value.includes("/") ? value.trim() : null;
const positiveTimestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ?
    Math.trunc(value) : null;
const boundedName = (value: unknown) =>
  typeof value === "string" && value.trim() ?
    value.trim().slice(0, 80) : null;
const boundedTitle = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ?
    value.trim().slice(0, 160) : fallback;

function isCompletionProgress(data: DocumentData) {
  if (data.completed !== true) return false;
  if (data.kind === "completion") {
    return Number(data.previousValue) === 0 &&
      Number(data.resultingValue) === 1 &&
      Number(data.targetValue) === 1;
  }
  if (data.kind !== "increment") return false;
  const previous = Number(data.previousValue);
  const resulting = Number(data.resultingValue);
  const target = Number(data.targetValue);
  return Number.isFinite(previous) && Number.isFinite(resulting) &&
    Number.isFinite(target) && target > 0 &&
    previous < target && resulting >= target;
}

export async function recordSharedSubtaskCompletion(input: {
  firestore: Firestore;
  goalId: string;
  subtaskId: string;
  progressEventId: string;
  progress: DocumentData | undefined;
  nowMs?: number;
}): Promise<GroupHistoryRecordingResult> {
  const {firestore, progress} = input;
  const goalId = safeId(input.goalId);
  const subtaskId = safeId(input.subtaskId);
  const progressEventId = safeId(input.progressEventId);
  if (!progress || !goalId || !subtaskId || !progressEventId) {
    return {status: "skipped", reason: "invalid_source_identity"};
  }
  if (!isCompletionProgress(progress) || progress.reverted === true) {
    return {status: "skipped", reason: "unsupported_source"};
  }
  if (progress.goalId !== goalId || progress.subtaskId !== subtaskId) {
    return {status: "skipped", reason: "tenancy_mismatch"};
  }
  const occurredAtMs = positiveTimestamp(progress.createdAtMs);
  const actorUid = safeId(progress.authorUid);
  if (occurredAtMs == null) {
    return {status: "skipped", reason: "invalid_occurred_time"};
  }
  if (!actorUid) {
    return {status: "skipped", reason: "invalid_actor_evidence"};
  }
  let goalSnapshot;
  let subtaskSnapshot;
  try {
    [goalSnapshot, subtaskSnapshot] = await Promise.all([
      firestore.collection("goals").doc(goalId).get(),
      firestore.collection("goals").doc(goalId)
        .collection("subtasks").doc(subtaskId).get(),
    ]);
  } catch {
    throw new GroupHistoryRecordingError("source_read_failed", true);
  }
  if (!goalSnapshot.exists || !subtaskSnapshot.exists) {
    return {status: "skipped", reason: "missing_parent"};
  }
  const goal = goalSnapshot.data()!;
  const subtask = subtaskSnapshot.data()!;
  const groupIds = Array.isArray(goal.sharedGroupIds) ?
    Array.from(new Set(goal.sharedGroupIds.map(safeId).filter(
      (value): value is string => !!value))) : [];
  if (goal.visibility !== "group_shared" || groupIds.length === 0) {
    return {status: "skipped", reason: "not_group_scoped"};
  }
  if (groupIds.length !== 1) {
    return {status: "skipped", reason: "ambiguous_group_tenancy"};
  }
  const groupId = groupIds[0];
  let groupSnapshot;
  let linkSnapshot;
  try {
    [groupSnapshot, linkSnapshot] = await Promise.all([
      firestore.collection("groups").doc(groupId).get(),
      firestore.collection("groups").doc(groupId)
        .collection("sharedGoals").doc(goalId).get(),
    ]);
  } catch {
    throw new GroupHistoryRecordingError("source_read_failed", true);
  }
  const link = linkSnapshot.data();
  if (!groupSnapshot.exists || !linkSnapshot.exists ||
    link?.groupId !== groupId || link?.goalId !== goalId ||
    link?.status !== "active") {
    return {status: "skipped", reason: "tenancy_mismatch"};
  }
  const creditedMemberUid = subtask.assignedToUid == null ? null :
    safeId(subtask.assignedToUid);
  if (subtask.assignedToUid != null && !creditedMemberUid) {
    return {status: "skipped", reason: "malformed_source"};
  }
  return recordGroupHistoryEvent(firestore, {
    groupId,
    eventType: "shared_subtask_completed",
    entityId: subtaskId,
    parentEntityId: goalId,
    sourceEventId:
      `subtask_progress:${goalId}:${subtaskId}:${progressEventId}`,
    occurredAtMs,
    createdAtMs: input.nowMs,
    displayTitle: boundedTitle(subtask.title, "Shared subtask"),
    summary: null,
    actorUid,
    actorDisplayName: boundedName(progress.authorName),
    creditedMemberUid,
    creditedMemberDisplayName: boundedName(subtask.assignedToName),
    metadata: {
      kind: "shared_subtask_completed",
      assignmentUid: creditedMemberUid,
    },
  });
}

export async function recordRoutineOccurrenceCompletion(input: {
  firestore: Firestore;
  transition: OccurrenceTransition;
  occurrence: DocumentData | undefined;
  nowMs?: number;
}): Promise<GroupHistoryRecordingResult> {
  const {firestore, transition, occurrence} = input;
  if (transition.type !== "occurrence_completed") {
    return {status: "skipped", reason: "unsupported_source"};
  }
  const groupId = safeId(transition.groupId);
  const routineId = safeId(transition.routineId);
  const occurrenceId = safeId(transition.occurrenceId);
  const actorUid = safeId(transition.actorUid);
  if (!groupId || !routineId || !occurrenceId) {
    return {status: "skipped", reason: "invalid_source_identity"};
  }
  if (!actorUid) {
    return {status: "skipped", reason: "invalid_actor_evidence"};
  }
  if (!occurrence ||
    occurrence.groupId !== groupId ||
    occurrence.routineId !== routineId ||
    occurrence.executionStatus !== "completed" ||
    Number(occurrence.executionRevision) < transition.revision) {
    return {status: "skipped", reason: "tenancy_mismatch"};
  }
  const occurredAtMs = positiveTimestamp(occurrence.completedAtMs);
  if (occurredAtMs == null) {
    return {status: "skipped", reason: "invalid_occurred_time"};
  }
  let groupSnapshot;
  let routineSnapshot;
  try {
    [groupSnapshot, routineSnapshot] = await Promise.all([
      firestore.collection("groups").doc(groupId).get(),
      firestore.collection("groupRoutines").doc(routineId).get(),
    ]);
  } catch {
    throw new GroupHistoryRecordingError("source_read_failed", true);
  }
  if (!groupSnapshot.exists || !routineSnapshot.exists) {
    return {status: "skipped", reason: "missing_parent"};
  }
  const routine = routineSnapshot.data()!;
  if (routine.groupId !== groupId) {
    return {status: "skipped", reason: "tenancy_mismatch"};
  }
  const participantCount = Array.isArray(occurrence.participantUids) ?
    Math.min(new Set(occurrence.participantUids.filter(
      (value: unknown) => !!safeId(value))).size, 500) : 0;
  return recordGroupHistoryEvent(firestore, {
    groupId,
    eventType: "group_routine_occurrence_completed",
    entityId: occurrenceId,
    parentEntityId: routineId,
    sourceEventId:
      `routine_transition:${getRoutineTransitionEventId(transition)}`,
    occurredAtMs,
    createdAtMs: input.nowMs,
    displayTitle: boundedTitle(
      occurrence.routineTitle ?? routine.title,
      "Group routine"
    ),
    summary: null,
    actorUid,
    actorDisplayName: null,
    creditedMemberUid: null,
    creditedMemberDisplayName: null,
    metadata: {
      kind: "group_routine_occurrence_completed",
      participantCount,
    },
  });
}

export function groupHistoryDiagnostic(input: {
  sourceKind: "shared_subtask" | "routine_occurrence";
  result: GroupHistoryRecordingResult;
}) {
  const eventType: GroupHistoryEventType =
    input.sourceKind === "shared_subtask" ?
      "shared_subtask_completed" :
      "group_routine_occurrence_completed";
  return {
    eventType,
    sourceKind: input.sourceKind,
    result: input.result.status,
    reason: "reason" in input.result ? input.result.reason : null,
    schemaVersion: 1,
    retryable: false,
  };
}

export function groupHistoryFailureDiagnostic(input: {
  sourceKind: "shared_subtask" | "routine_occurrence";
  error: unknown;
}) {
  return {
    eventType: input.sourceKind === "shared_subtask" ?
      "shared_subtask_completed" :
      "group_routine_occurrence_completed",
    sourceKind: input.sourceKind,
    result: "failed",
    reason: input.error instanceof GroupHistoryRecordingError ?
      input.error.code : "event_write_failed",
    schemaVersion: 1,
    retryable: input.error instanceof GroupHistoryRecordingError ?
      input.error.retryable : true,
  };
}
