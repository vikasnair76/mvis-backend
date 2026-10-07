import type {DocumentData, Firestore} from "firebase-admin/firestore";
import {
  recordPersonalHistoryEvent,
  type PersonalHistoryWriteInput,
} from "./personalHistoryRecording.js";

const safeId = (value: unknown) =>
  typeof value === "string" && value.trim() && !value.includes("/") ?
    value.trim() : null;
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ?
    value : null;
const title = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ?
    value.trim().slice(0, 160) : fallback;
const terminalColumn = (value: unknown) =>
  value === "completed" || value === "done";

export function classifyGoalHistoryEvents(
  goalId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined
): PersonalHistoryWriteInput[] {
  if (!after) return [];
  const ownerUid = safeId(after.userId);
  if (!ownerUid || after.groupId != null) return [];
  const events: PersonalHistoryWriteInput[] = [];
  const goalTitle = title(after.title, "Untitled goal");
  const createdAtMs = finite(after.createdAtMs);
  if (!before && createdAtMs != null) {
    events.push({
      ownerUid, eventType: "goal_created", entityId: goalId,
      occurredAtMs: createdAtMs, displayTitle: goalTitle,
      sourceEventId: `goal_created:${goalId}`,
    });
  }
  const completedAtMs = finite(after.completedAtMs);
  if (before?.status !== "completed" && after.status === "completed" &&
    completedAtMs != null) {
    events.push({
      ownerUid, eventType: "goal_completed", entityId: goalId,
      occurredAtMs: completedAtMs, displayTitle: goalTitle,
      sourceEventId: `goal_completed:${goalId}:${completedAtMs}`,
    });
  }
  return events;
}

export function classifyCalendarHistoryEvent(
  eventId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined
): PersonalHistoryWriteInput | null {
  if (before || !after || after.scope !== "personal" || after.groupId != null ||
    after.archived === true || after.blocksTime === false ||
    after.plannerSuggestionId != null || after.routineId != null) return null;
  const ownerUid = safeId(after.ownerUid);
  const occurredAtMs = finite(after.createdAtMs);
  if (!ownerUid || occurredAtMs == null || after.createdByUid !== ownerUid) {
    return null;
  }
  return {
    ownerUid, eventType: "calendar_block_created", entityId: eventId,
    occurredAtMs, displayTitle: title(after.title, "Calendar block"),
    sourceEventId: `calendar_block_created:${eventId}`,
    metadata: {sourceType: safeId(after.type) ?? "personal"},
  };
}

export function classifyBoardCardHistoryEvent(
  boardId: string,
  cardId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined
): PersonalHistoryWriteInput | null {
  if (!before || !after || terminalColumn(before.columnId) ||
    !terminalColumn(after.columnId) || after.archived === true ||
    after.groupId != null) return null;
  const ownerUid = safeId(after.ownerUid);
  const occurredAtMs = finite(after.updatedAtMs);
  if (!ownerUid || occurredAtMs == null) return null;
  return {
    ownerUid, eventType: "planning_board_card_completed",
    entityId: cardId, parentEntityId: boardId, occurredAtMs,
    displayTitle: title(after.title, "Planning card"),
    sourceEventId: `board_card_completed:${boardId}:${cardId}:${occurredAtMs}`,
    metadata: {boardId},
  };
}

export function classifyMilestoneHistoryEvent(
  goalId: string,
  milestoneId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined,
  ownerUid: string | null
): PersonalHistoryWriteInput | null {
  const completedAtMs = finite(after?.completedAtMs);
  if (!before || !after || before.status === "completed" ||
    after.status !== "completed" || completedAtMs == null || !ownerUid) {
    return null;
  }
  return {
    ownerUid, eventType: "milestone_completed", entityId: milestoneId,
    parentEntityId: goalId, occurredAtMs: completedAtMs,
    displayTitle: title(after.title, "Milestone"),
    sourceEventId: `milestone_completed:${goalId}:${milestoneId}:${completedAtMs}`,
    metadata: {goalId},
  };
}

export async function recordSubtaskCompletionHistory(input: {
  firestore: Firestore;
  goalId: string;
  subtaskId: string;
  completionId: string;
  before: DocumentData | undefined;
  after: DocumentData | undefined;
}) {
  const {firestore, goalId, subtaskId, after} = input;
  if (!after) return null;
  const completedAtMs = finite(after.completedAtMs);
  const sourceTransitionId = safeId(after.latestProgressEventId);
  const ownerUid = safeId(after.userId);
  if (completedAtMs == null || !sourceTransitionId || !ownerUid) return null;
  const previousCompletedAtMs = finite(input.before?.completedAtMs);
  if (previousCompletedAtMs != null) return null;
  const [goal, subtask] = await Promise.all([
    firestore.collection("goals").doc(goalId).get(),
    firestore.collection("goals").doc(goalId)
      .collection("subtasks").doc(subtaskId).get(),
  ]);
  const goalData = goal.data();
  const subtaskData = subtask.data();
  if (!goal.exists || !subtask.exists || goalData?.userId !== ownerUid ||
    goalData?.groupId != null || subtaskData?.groupId != null) return null;
  return recordPersonalHistoryEvent(firestore, {
    ownerUid, eventType: "subtask_completed", entityId: subtaskId,
    parentEntityId: goalId, occurredAtMs: completedAtMs,
    displayTitle: title(subtaskData?.title, "Subtask"),
    sourceEventId:
      `subtask_completion:${goalId}:${subtaskId}:${sourceTransitionId}`,
    metadata: {
      goalId,
      completionMode: subtaskData?.completionMode === "count" ?
        "count" : "binary",
      completionId: input.completionId,
    },
  });
}

export async function recordClassifiedHistoryEvents(
  firestore: Firestore,
  inputs: PersonalHistoryWriteInput[]
) {
  return Promise.all(inputs.map((input) =>
    recordPersonalHistoryEvent(firestore, input)));
}
