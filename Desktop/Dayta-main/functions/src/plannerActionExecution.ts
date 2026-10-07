import {
  FieldValue,
  Firestore,
  type DocumentData,
  type DocumentReference,
} from "firebase-admin/firestore";
import {writePersonalHistoryEventTx} from "./personalHistoryRecording.js";

export const PLANNER_EXECUTABLE_ACTION_TYPES = ["schedule_entity"] as const;
export const PLANNER_EXECUTION_ACTION_VERSION = 1;
export const PLANNER_EXECUTION_CALENDAR_LIMIT = 250;
export const PLANNER_EXECUTION_MIN_DURATION_MS = 15 * 60 * 1000;
export const PLANNER_EXECUTION_MAX_DURATION_MS = 4 * 60 * 60 * 1000;
export const PLANNER_EXECUTION_CLOCK_SKEW_MS = 60 * 1000;

export type PlannerActionExecutionClass =
  | "executable"
  | "navigation_only"
  | "informational_only"
  | "deferred";

export type PlannerExecutionResultCode =
  | "applied"
  | "already_applied"
  | "already_processing"
  | "suggestion_not_found"
  | "suggestion_not_active"
  | "suggestion_expired"
  | "suggestion_snoozed"
  | "suggestion_terminal"
  | "unsupported_action"
  | "unsupported_action_version"
  | "target_missing"
  | "target_archived"
  | "permission_lost"
  | "stale_evidence"
  | "time_window_no_longer_available"
  | "calendar_conflict_detected"
  | "validation_failed"
  | "planner_disabled";

export type PlannerExecutionResult = {
  ok: boolean;
  status: PlannerExecutionResultCode;
  suggestionId: string;
  targetType?: "calendar_event";
  targetId?: string;
};

type EntityRef = {
  type?: unknown;
  id?: unknown;
  ownerUid?: unknown;
  groupId?: unknown;
  goalId?: unknown;
  boardId?: unknown;
};

type ValidScheduleAction = {
  type: "schedule_entity";
  target: {
    type: "goal" | "subtask" | "board_card";
    id: string;
    ownerUid: string | null;
    groupId: null;
    goalId: string | null;
    boardId: string | null;
  };
  proposedStartAtMs: number;
  proposedEndAtMs: number;
  timeZone: string | null;
};

const safeId = (value: unknown) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 500 &&
  !value.includes("/")
    ? value.trim()
    : null;
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function classifyPlannerAction(
  actionType: unknown,
  scope: unknown
): PlannerActionExecutionClass {
  if (actionType === "schedule_entity") {
    return scope === "personal" ? "executable" : "deferred";
  }
  if (actionType === "review_entity") return "navigation_only";
  if (
    actionType === "reschedule_entity" ||
    actionType === "set_priority" ||
    actionType === "set_due_date" ||
    actionType === "move_board_card" ||
    actionType === "create_focus_block"
  ) return "deferred";
  return "informational_only";
}

export function plannerIntervalsOverlap(
  left: {startAtMs: number; endAtMs: number},
  right: {startAtMs: number; endAtMs: number}
) {
  return left.startAtMs < right.endAtMs && right.startAtMs < left.endAtMs;
}

function validateScheduleAction(
  suggestion: DocumentData,
  ownerUid: string,
  nowMs: number
): ValidScheduleAction | PlannerExecutionResultCode {
  if (suggestion.scope !== "personal" || suggestion.groupId != null) {
    return "unsupported_action";
  }
  if (suggestion.source?.ruleId !== "open_window_scheduling_opportunity") {
    return "unsupported_action";
  }
  if (suggestion.source?.ruleVersion !== PLANNER_EXECUTION_ACTION_VERSION) {
    return "unsupported_action_version";
  }
  const action = suggestion.proposedAction;
  if (!action || action.type !== "schedule_entity") return "unsupported_action";
  const target = action.target as EntityRef | undefined;
  const type = target?.type;
  const id = safeId(target?.id);
  if (!["goal", "subtask", "board_card"].includes(String(type)) || !id) {
    return "validation_failed";
  }
  const owner = target?.ownerUid == null ? null : safeId(target.ownerUid);
  if (owner != null && owner !== ownerUid) return "permission_lost";
  if (target?.groupId != null) return "unsupported_action";
  const goalId = target?.goalId == null ? null : safeId(target.goalId);
  const boardId = target?.boardId == null ? null : safeId(target.boardId);
  if (type === "subtask" && !goalId) return "validation_failed";
  if (type === "board_card" && !boardId) return "validation_failed";
  const start = finite(action.proposedStartAtMs);
  const end = finite(action.proposedEndAtMs);
  if (start == null || end == null || end <= start) return "validation_failed";
  const duration = end - start;
  if (
    duration < PLANNER_EXECUTION_MIN_DURATION_MS ||
    duration > PLANNER_EXECUTION_MAX_DURATION_MS
  ) return "validation_failed";
  if (start < nowMs - PLANNER_EXECUTION_CLOCK_SKEW_MS) {
    return "time_window_no_longer_available";
  }
  return {
    type: "schedule_entity",
    target: {
      type: type as ValidScheduleAction["target"]["type"],
      id,
      ownerUid: owner,
      groupId: null,
      goalId,
      boardId,
    },
    proposedStartAtMs: start,
    proposedEndAtMs: end,
    timeZone:
      typeof action.timeZone === "string" && action.timeZone.length <= 100
        ? action.timeZone
        : null,
  };
}

function targetReference(
  firestore: Firestore,
  action: ValidScheduleAction
): DocumentReference {
  if (action.target.type === "goal") {
    return firestore.collection("goals").doc(action.target.id);
  }
  if (action.target.type === "subtask") {
    return firestore.collection("goals").doc(action.target.goalId!)
      .collection("subtasks").doc(action.target.id);
  }
  return firestore.collection("planningBoards").doc(action.target.boardId!)
    .collection("cards").doc(action.target.id);
}

function validateTarget(
  action: ValidScheduleAction,
  target: DocumentData,
  ownerUid: string
): PlannerExecutionResultCode | {title: string; type: "goal" | "board"} {
  const owner = safeId(target.userId) || safeId(target.ownerUid);
  if (owner !== ownerUid) return "permission_lost";
  if (target.sharedGroupId != null || target.groupId != null) {
    return "unsupported_action";
  }
  if (target.archived === true) return "target_archived";
  if (
    target.status === "completed" ||
    target.status === "done" ||
    target.completed === true ||
    finite(target.firstCompletedAtMs) != null ||
    target.columnId === "completed" ||
    target.columnId === "done"
  ) return "stale_evidence";
  if (
    action.target.type === "subtask" &&
    safeId(target.goalId) !== action.target.goalId
  ) return "stale_evidence";
  if (
    action.target.type === "board_card" &&
    safeId(target.boardId) !== action.target.boardId
  ) return "stale_evidence";
  const title =
    typeof target.title === "string" && target.title.trim()
      ? target.title.trim().slice(0, 160)
      : "Planned work";
  return {title, type: action.target.type === "board_card" ? "board" : "goal"};
}

function executionResult(
  suggestionId: string,
  status: PlannerExecutionResultCode,
  targetId?: string
): PlannerExecutionResult {
  const ok = status === "applied" || status === "already_applied";
  return {
    ok,
    status,
    suggestionId,
    ...(targetId ? {targetType: "calendar_event" as const, targetId} : {}),
  };
}

export async function executeTrustedPlannerSuggestion(input: {
  firestore: Firestore;
  ownerUid: string;
  suggestionId: string;
  nowMs?: number;
}): Promise<PlannerExecutionResult> {
  const {firestore, ownerUid} = input;
  const suggestionId = safeId(input.suggestionId);
  if (!suggestionId) return executionResult("", "validation_failed");
  const nowMs = input.nowMs ?? Date.now();
  const suggestionRef = firestore.collection("users").doc(ownerUid)
    .collection("plannerSuggestions").doc(suggestionId);
  const executionRef = firestore.collection("users").doc(ownerUid)
    .collection("plannerSuggestionExecutions").doc(suggestionId);
  const eventRef = firestore.collection("planningCalendarEvents")
    .doc(`planner_${suggestionId}`);

  return firestore.runTransaction(async (transaction) => {
    const suggestionSnapshot = await transaction.get(suggestionRef);
    const executionSnapshot = await transaction.get(executionRef);
    const preferenceSnapshot = await transaction.get(
      firestore.collection("users").doc(ownerUid)
        .collection("settings").doc("planner")
    );
    const existingExecution = executionSnapshot.data();
    if (existingExecution?.status === "completed") {
      return executionResult(
        suggestionId,
        "already_applied",
        safeId(existingExecution.targetId) ?? undefined
      );
    }
    if (existingExecution?.status === "processing") {
      return executionResult(suggestionId, "already_processing");
    }
    if (!suggestionSnapshot.exists) {
      return executionResult(suggestionId, "suggestion_not_found");
    }
    const suggestion = suggestionSnapshot.data()!;
    if (suggestion.ownerUid !== ownerUid) {
      return executionResult(suggestionId, "suggestion_not_found");
    }
    if (preferenceSnapshot.data()?.enabled === false) {
      return executionResult(suggestionId, "planner_disabled");
    }
    if (suggestion.status === "snoozed" &&
      finite(suggestion.snoozedUntilMs)! > nowMs) {
      return executionResult(suggestionId, "suggestion_snoozed");
    }
    if (finite(suggestion.expiresAtMs) != null &&
      finite(suggestion.expiresAtMs)! <= nowMs) {
      return executionResult(suggestionId, "suggestion_expired");
    }
    if (suggestion.status === "accepted") {
      return executionResult(
        suggestionId, "already_applied",
        safeId(suggestion.executionResult?.targetId) ?? undefined
      );
    }
    if (!["active", "snoozed"].includes(suggestion.status)) {
      return executionResult(suggestionId, "suggestion_terminal");
    }
    const action = validateScheduleAction(suggestion, ownerUid, nowMs);
    if (typeof action === "string") {
      transaction.set(executionRef, {
        id: suggestionId, ownerUid, suggestionId,
        actionType: suggestion.proposedAction?.type ?? "unknown",
        actionVersion: suggestion.source?.ruleVersion ?? null,
        status: "rejected", resultCode: action, targetType: null, targetId: null,
        startedAtMs: nowMs, completedAtMs: nowMs, executionAttemptCount: 1,
        createdAtMs: nowMs, updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: false});
      transaction.update(suggestionRef, {
        status: "invalidated", invalidatedAtMs: nowMs,
        invalidationReason: "target_changed", snoozedUntilMs: null,
        updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
      });
      return executionResult(suggestionId, action);
    }

    const targetRef = targetReference(firestore, action);
    const targetSnapshot = await transaction.get(targetRef);
    if (!targetSnapshot.exists) {
      transaction.set(executionRef, {
        id: suggestionId, ownerUid, suggestionId, actionType: action.type,
        actionVersion: PLANNER_EXECUTION_ACTION_VERSION, status: "rejected",
        resultCode: "target_missing", targetType: null, targetId: null,
        startedAtMs: nowMs, completedAtMs: nowMs, executionAttemptCount: 1,
        createdAtMs: nowMs, updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: false});
      transaction.update(suggestionRef, {
        status: "invalidated", invalidatedAtMs: nowMs,
        invalidationReason: "target_missing", snoozedUntilMs: null,
        updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
      });
      return executionResult(suggestionId, "target_missing");
    }
    const target = validateTarget(action, targetSnapshot.data()!, ownerUid);
    if (typeof target === "string") {
      transaction.set(executionRef, {
        id: suggestionId, ownerUid, suggestionId, actionType: action.type,
        actionVersion: PLANNER_EXECUTION_ACTION_VERSION, status: "rejected",
        resultCode: target, targetType: null, targetId: null,
        startedAtMs: nowMs, completedAtMs: nowMs, executionAttemptCount: 1,
        createdAtMs: nowMs, updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: false});
      transaction.update(suggestionRef, {
        status: "invalidated", invalidatedAtMs: nowMs,
        invalidationReason: target === "permission_lost" ?
          "permission_lost" : "source_changed",
        snoozedUntilMs: null, updatedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return executionResult(suggestionId, target);
    }

    const calendarQuery = firestore.collection("planningCalendarEvents")
      .where("ownerUid", "==", ownerUid)
      .where("startAtMs", "<", action.proposedEndAtMs)
      .orderBy("startAtMs", "desc")
      .limit(PLANNER_EXECUTION_CALENDAR_LIMIT + 1);
    const calendarSnapshot = await transaction.get(calendarQuery);
    const existingEvent = await transaction.get(eventRef);
    if (existingEvent.exists) {
      const data = existingEvent.data()!;
      if (
        data.ownerUid === ownerUid &&
        data.plannerSuggestionId === suggestionId
      ) {
        await writePersonalHistoryEventTx(firestore, transaction, {
          ownerUid,
          eventType: "planner_suggestion_applied",
          entityId: suggestionId,
          occurredAtMs: finite(data.createdAtMs) ?? nowMs,
          displayTitle: target.title,
          summary: "Scheduled on your calendar",
          sourceEventId: `planner_execution:${suggestionId}`,
          metadata: {
            calendarEventId: eventRef.id,
            sourceType: action.target.type,
            sourceId: action.target.id,
          },
        });
        transaction.set(executionRef, {
          id: suggestionId, ownerUid, suggestionId, actionType: action.type,
          actionVersion: PLANNER_EXECUTION_ACTION_VERSION, status: "completed",
          resultCode: "applied", targetType: "calendar_event",
          targetId: eventRef.id, startedAtMs: nowMs, completedAtMs: nowMs,
          executionAttemptCount:
            Math.max(1, finite(existingExecution?.executionAttemptCount) ?? 0) + 1,
          createdAtMs: finite(existingExecution?.createdAtMs) ?? nowMs,
          updatedAtMs: nowMs, createdAt: existingExecution?.createdAt ??
            FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, {merge: false});
        transaction.update(suggestionRef, {
          status: "accepted", acceptedAtMs: nowMs, acceptedByUid: ownerUid,
          actedAtMs: nowMs, snoozedUntilMs: null,
          executionResult: {code: "applied", targetType: "calendar_event",
            targetId: eventRef.id, completedAtMs: nowMs},
          updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
        });
        return executionResult(suggestionId, "already_applied", eventRef.id);
      }
      return executionResult(suggestionId, "validation_failed");
    }
    if (calendarSnapshot.size > PLANNER_EXECUTION_CALENDAR_LIMIT) {
      return executionResult(suggestionId, "validation_failed");
    }
    const conflict = calendarSnapshot.docs.some((document) => {
      const event = document.data();
      const startAtMs = finite(event.startAtMs);
      const endAtMs = finite(event.endAtMs);
      return startAtMs != null && endAtMs != null &&
        event.archived !== true && event.status !== "cancelled" &&
        event.blocksTime !== false &&
        plannerIntervalsOverlap(
          {startAtMs, endAtMs},
          {startAtMs: action.proposedStartAtMs, endAtMs: action.proposedEndAtMs}
        );
    });
    if (conflict) {
      transaction.set(executionRef, {
        id: suggestionId, ownerUid, suggestionId, actionType: action.type,
        actionVersion: PLANNER_EXECUTION_ACTION_VERSION, status: "rejected",
        resultCode: "calendar_conflict_detected", targetType: null,
        targetId: null, startedAtMs: nowMs, completedAtMs: nowMs,
        executionAttemptCount: 1, createdAtMs: nowMs, updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: false});
      transaction.update(suggestionRef, {
        status: "invalidated", invalidatedAtMs: nowMs,
        invalidationReason: "source_changed", snoozedUntilMs: null,
        updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
      });
      return executionResult(suggestionId, "calendar_conflict_detected");
    }

    await writePersonalHistoryEventTx(firestore, transaction, {
      ownerUid,
      eventType: "planner_suggestion_applied",
      entityId: suggestionId,
      occurredAtMs: nowMs,
      displayTitle: target.title,
      summary: "Scheduled on your calendar",
      sourceEventId: `planner_execution:${suggestionId}`,
      metadata: {
        calendarEventId: eventRef.id,
        sourceType: action.target.type,
        sourceId: action.target.id,
      },
    });
    transaction.create(eventRef, {
      id: eventRef.id, title: target.title, description: null,
      scope: "personal", type: target.type, visibility: "private",
      ownerUid, groupId: null,
      goalId: action.target.type === "goal" ? action.target.id :
        action.target.type === "subtask" ? action.target.goalId : null,
      boardId: action.target.type === "board_card" ? action.target.boardId : null,
      routineId: null, startAtMs: action.proposedStartAtMs,
      endAtMs: action.proposedEndAtMs, allDay: false,
      createdByUid: ownerUid, archived: false, blocksTime: true,
      plannerSuggestionId: suggestionId,
      plannerExecutionId: suggestionId,
      plannerSourceType: action.target.type,
      plannerSourceId: action.target.id,
      createdAtMs: nowMs, updatedAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(executionRef, {
      id: suggestionId, ownerUid, suggestionId, actionType: action.type,
      actionVersion: PLANNER_EXECUTION_ACTION_VERSION, status: "completed",
      resultCode: "applied", targetType: "calendar_event",
      targetId: eventRef.id, startedAtMs: nowMs, completedAtMs: nowMs,
      executionAttemptCount:
        Math.max(1, finite(existingExecution?.executionAttemptCount) ?? 0) + 1,
      createdAtMs: finite(existingExecution?.createdAtMs) ?? nowMs,
      updatedAtMs: nowMs, createdAt: existingExecution?.createdAt ??
        FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, {merge: false});
    transaction.update(suggestionRef, {
      status: "accepted", acceptedAtMs: nowMs, acceptedByUid: ownerUid,
      actedAtMs: nowMs, snoozedUntilMs: null,
      executionResult: {code: "applied", targetType: "calendar_event",
        targetId: eventRef.id, completedAtMs: nowMs},
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    return executionResult(suggestionId, "applied", eventRef.id);
  });
}
