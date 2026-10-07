import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { initializeApp } from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  MAX_ROUTINES_PER_SCHEDULED_RUN,
  reconcileRoutine,
} from "./groupRoutineMaterialization.js";
import {
  classifyRoutineOccurrenceTransition,
  classifyRoutineParticipantManagerTransition,
  processRoutineTransition,
} from "./groupRoutineTransitionSideEffects.js";
import {
  claimRoutineNotificationRequest,
  getRoutineNotificationCandidates,
  processRoutineNotificationClaim,
} from "./routineNotificationQueue.js";
import {
  enqueueDuePlannerScheduleStates,
  enqueuePlannerGenerationRequest,
  enqueuePlannerSourceChange,
  scanPlannerGenerationRequests,
  scanPlannerSuggestionLifecycle,
  syncPlannerScheduleState,
} from "./plannerOrchestration.js";
import {
  executeTrustedPlannerSuggestion,
} from "./plannerActionExecution.js";
import {
  claimPlannerNotificationRequest,
  getPlannerNotificationCandidates,
  processPlannerNotificationClaim,
} from "./plannerNotifications.js";
import {
  classifyBoardCardHistoryEvent,
  classifyCalendarHistoryEvent,
  classifyGoalHistoryEvents,
  classifyMilestoneHistoryEvent,
  recordClassifiedHistoryEvents,
  recordSubtaskCompletionHistory,
} from "./personalHistoryLifecycle.js";
import {
  buildTrustedPersonalHistoryEventId,
  recordPersonalHistoryEvent,
} from "./personalHistoryRecording.js";
import {buildTrustedGroupHistoryEventId} from "./groupHistoryRecording.js";
import {
  FeedbackIntakeError,
  handleSubmitFeedback,
} from "./feedbackSubmission.js";
import {
  FEEDBACK_EMAIL_PROVIDER_API_KEY,
  FEEDBACK_EMAIL_SENDER,
  FEEDBACK_RECIPIENT_EMAIL,
  FeedbackDeliveryError,
  ResendFeedbackEmailProvider,
  processFeedbackDelivery,
} from "./feedbackEmailDelivery.js";
import {
  cleanupAbandonedFeedbackAttachments,
  reconcileStuckFeedbackDeliveries,
} from "./feedbackMaintenance.js";
import {
  groupHistoryFailureDiagnostic,
  groupHistoryDiagnostic,
  recordRoutineOccurrenceCompletion,
  recordSharedSubtaskCompletion,
} from "./groupHistoryLifecycle.js";
import {
  createTrustedMediaUploadSession,
  transitionTrustedMediaUploadSession,
} from "./mediaUploadSessionCallable.js";
import {mutateTrustedPlannerSuggestion} from "./plannerLifecycleCallable.js";
import {mutateTrustedRoutineOccurrence} from "./groupRoutineCheckInCallable.js";

setGlobalOptions({ maxInstances: 10 });

initializeApp();

const callableError = (error: unknown) => {
  const code = error instanceof Error ? error.message : "unknown";
  if (code === "invalid_request") {
    return new HttpsError("invalid-argument", "The request is invalid.");
  }
  if (code === "permission_denied") {
    return new HttpsError("permission-denied", "You cannot perform this action.");
  }
  if (["session_unavailable", "suggestion_unavailable",
    "occurrence_unavailable", "participant_unavailable",
    "invalid_transition"].includes(code)) {
    return new HttpsError("failed-precondition", "This item is no longer available.");
  }
  return new HttpsError("internal", "The operation could not be completed.");
};

export const createMediaUploadSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  try {
    return await createTrustedMediaUploadSession(
      getFirestore(), uid, request.data);
  } catch (error) {
    throw callableError(error);
  }
});

export const transitionMediaUploadSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  try {
    return await transitionTrustedMediaUploadSession(
      getFirestore(), uid, request.data);
  } catch (error) {
    throw callableError(error);
  }
});

export const mutatePlannerSuggestion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  try {
    return await mutateTrustedPlannerSuggestion(
      getFirestore(), uid, request.data);
  } catch (error) {
    throw callableError(error);
  }
});

export const mutateRoutineOccurrence = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  try {
    return await mutateTrustedRoutineOccurrence(
      getFirestore(), uid, request.data);
  } catch (error) {
    throw callableError(error);
  }
});

export const submitFeedback = onCall(async (request) => {
  try {
    const result = await handleSubmitFeedback({
      uid: request.auth?.uid ?? null,
      data: request.data,
      firestore: getFirestore(),
      auth: getAuth(),
      bucket: getStorage().bucket(),
    });
    logger.info("feedback_intake", {
      operation: "submit", result: result.alreadyExisted ?
        "already_exists" : "accepted",
    });
    return result;
  } catch (error) {
    const code = error instanceof FeedbackIntakeError ? error.code : "unknown";
    logger.warn("feedback_intake", {
      operation: "submit", result: "rejected", errorCode: code,
    });
    if (code === "unauthenticated") {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    if (code === "rate_limited") {
      throw new HttpsError("resource-exhausted",
        "You have sent several feedback messages recently. Try again later.");
    }
    if (code === "submission_conflict") {
      throw new HttpsError("already-exists",
        "This feedback draft conflicts with an existing submission.");
    }
    if (code === "invalid_request" || code === "invalid_attachment") {
      throw new HttpsError("invalid-argument",
        "The feedback submission is invalid.");
    }
    throw new HttpsError("unavailable",
      "Feedback could not be sent right now. Please try again.");
  }
});

export const processFeedbackEmailDelivery = onDocumentCreated({
  document: "feedbackSubmissions/{feedbackId}",
  retry: true,
  secrets: [FEEDBACK_EMAIL_PROVIDER_API_KEY],
}, async (event) => {
  try {
    const result = await processFeedbackDelivery({
      firestore: getFirestore(),
      bucket: getStorage().bucket(),
      provider: new ResendFeedbackEmailProvider(
        FEEDBACK_EMAIL_PROVIDER_API_KEY.value()),
      feedbackId: event.params.feedbackId,
      eventId: event.id,
      recipient: FEEDBACK_RECIPIENT_EMAIL.value(),
      sender: FEEDBACK_EMAIL_SENDER.value(),
    });
    logger.info("feedback_delivery", {
      operation: "email", result: result.status,
    });
  } catch (error) {
    logger.warn("feedback_delivery", {
      operation: "email", result: "retry",
      errorCode: error instanceof FeedbackDeliveryError ?
        error.code : "unknown",
    });
    throw error;
  }
});

export const cleanupAbandonedFeedbackAttachmentsScheduled = onSchedule({
  schedule: "30 3 * * *", timeZone: "UTC", timeoutSeconds: 540,
  memory: "512MiB", maxInstances: 1, retryCount: 0,
}, async (event) => {
  const result = await cleanupAbandonedFeedbackAttachments({
    firestore: getFirestore(), bucket: getStorage().bucket(),
    owner: `scheduled-${event.scheduleTime}`, nowMs: Date.now(),
  });
  logger.info("feedback_maintenance", {
    operation: "orphan_cleanup", result: result.status,
    inspected: "inspected" in result ? result.inspected : 0,
    deleted: "deleted" in result ? result.deleted : 0,
    errors: "errors" in result ? result.errors : 0,
  });
});

export const reconcileStuckFeedbackDeliveriesScheduled = onSchedule({
  schedule: "every 15 minutes", timeZone: "UTC", timeoutSeconds: 300,
  memory: "512MiB", maxInstances: 1, retryCount: 0,
  secrets: [FEEDBACK_EMAIL_PROVIDER_API_KEY],
}, async (event) => {
  const result = await reconcileStuckFeedbackDeliveries({
    firestore: getFirestore(), bucket: getStorage().bucket(),
    provider: new ResendFeedbackEmailProvider(
      FEEDBACK_EMAIL_PROVIDER_API_KEY.value()),
    recipient: FEEDBACK_RECIPIENT_EMAIL.value(),
    sender: FEEDBACK_EMAIL_SENDER.value(),
    owner: `scheduled-${event.scheduleTime}`,
  });
  logger.info("feedback_maintenance", {
    operation: "delivery_reconciliation", result: result.status,
    recovered: "recovered" in result ? result.recovered : 0,
    errors: "errors" in result ? result.errors : 0,
  });
});

const plannerSourceTrigger = (
  path: string,
  kind: Parameters<typeof enqueuePlannerSourceChange>[1]["kind"],
  reasonCode: Parameters<typeof enqueuePlannerSourceChange>[1]["reasonCode"]
) => onDocumentWritten(path, async (event) => {
  const result = await enqueuePlannerSourceChange(getFirestore(), {
    kind, reasonCode, before: event.data?.before.data(),
    after: event.data?.after.data(), nowMs: Date.now(),
  });
  if (result.meaningful) {
    logger.info("[Planner] source refresh enqueued", {
      sourceKind: kind, recipientCount: result.recipients,
    });
  }
});

export const requestPlannerRefresh = onCall(async (request) => {
  const ownerUid = request.auth?.uid;
  if (!ownerUid) throw new HttpsError("unauthenticated", "Authentication required.");
  const payload = request.data;
  if (payload && typeof payload === "object" && Object.keys(payload).length > 0) {
    throw new HttpsError("invalid-argument", "Planner refresh accepts no parameters.");
  }
  const nowMs = Date.now();
  const preference = await getFirestore().collection("users").doc(ownerUid)
    .collection("settings").doc("planner").get();
  if (preference.data()?.enabled === false) {
    return {accepted: false, reasonCode: "planner_disabled"};
  }
  const result = await enqueuePlannerGenerationRequest(getFirestore(), {
    ownerUid, trigger: "manual", reasonCodes: ["manual_refresh"],
    priority: "high", requestedAtMs: nowMs, notBeforeAtMs: nowMs,
  });
  return {accepted: result.outcome !== "malformed", requestId: result.requestId,
    deduplicated: result.outcome !== "created"};
});

export const executePlannerSuggestion = onCall(async (request) => {
  const ownerUid = request.auth?.uid;
  if (!ownerUid) throw new HttpsError("unauthenticated", "Authentication required.");
  const payload = request.data;
  if (
    !payload ||
    typeof payload !== "object" ||
    Object.keys(payload).length !== 1 ||
    typeof payload.suggestionId !== "string"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Planner execution accepts only a suggestion ID."
    );
  }
  try {
    return await executeTrustedPlannerSuggestion({
      firestore: getFirestore(),
      ownerUid,
      suggestionId: payload.suggestionId,
    });
  } catch (error) {
    logger.error("[Planner] action execution failed", {
      ownerUid, suggestionId: payload.suggestionId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError(
      "unavailable",
      "The planner action could not be completed. Please try again."
    );
  }
});

export const recordPlannerNotificationOpened = onCall(async (request) => {
  const ownerUid = request.auth?.uid;
  if (!ownerUid) throw new HttpsError("unauthenticated", "Authentication required.");
  const payload = request.data;
  if (!payload || typeof payload !== "object" ||
    Object.keys(payload).length !== 1 ||
    typeof payload.generationRunId !== "string" ||
    !payload.generationRunId.trim() ||
    payload.generationRunId.includes("/")) {
    throw new HttpsError("invalid-argument", "A valid generation run ID is required.");
  }
  const db = getFirestore();
  const requestRef = db.collection("plannerNotificationRequests")
    .doc(`plannerNotification_${payload.generationRunId.trim()}`);
  const metricRef = db.collection("users").doc(ownerUid)
    .collection("plannerMetrics").doc("summary");
  const recorded = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists || snapshot.data()?.ownerUid !== ownerUid ||
      snapshot.data()?.openedAtMs != null) return false;
    const nowMs = Date.now();
    transaction.update(requestRef, {openedAtMs: nowMs, updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp()});
    transaction.set(metricRef, {
      notificationOpenedCount: FieldValue.increment(1),
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });
  if (!recorded) return {recorded: false};
  logger.info("planner_notification_opened", {
    ownerUid, generationRunId: payload.generationRunId.trim(),
  });
  return {recorded: true};
});

export const plannerGoalChanged = plannerSourceTrigger(
  "goals/{goalId}", "goal", "goal_changed");
export const plannerSubtaskChanged = plannerSourceTrigger(
  "goals/{goalId}/subtasks/{subtaskId}", "subtask", "subtask_changed");
export const plannerBoardCardChanged = plannerSourceTrigger(
  "planningBoards/{boardId}/cards/{cardId}", "board_card", "board_card_changed");
export const plannerCalendarEventChanged = plannerSourceTrigger(
  "planningCalendarEvents/{eventId}", "calendar", "calendar_changed");
export const plannerRoutineChanged = plannerSourceTrigger(
  "groupRoutines/{routineId}", "routine", "routine_changed");
export const plannerRoutineOccurrenceChanged = plannerSourceTrigger(
  "groupRoutineOccurrences/{occurrenceId}", "occurrence",
  "routine_occurrence_changed");
export const plannerMembershipChanged = plannerSourceTrigger(
  "groupMemberships/{membershipId}", "membership", "membership_changed");

export const recordPersonalGoalHistory = onDocumentWritten(
  "goals/{goalId}",
  async (event) => {
    const inputs = classifyGoalHistoryEvents(
      event.params.goalId,
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!inputs.length) return;
    const results = await recordClassifiedHistoryEvents(getFirestore(), inputs);
    logger.info("personal_history_recorded", {
      eventTypes: inputs.map((input) => input.eventType),
      resultCodes: results.map((result) => result.status),
    });
  }
);

export const recordPersonalSubtaskCompletionHistory = onDocumentWritten(
  "goals/{goalId}/subtasks/{subtaskId}/completions/{completionId}",
  async (event) => {
    const result = await recordSubtaskCompletionHistory({
      firestore: getFirestore(),
      goalId: event.params.goalId,
      subtaskId: event.params.subtaskId,
      completionId: event.params.completionId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
    });
    if (result) logger.info("personal_history_recorded", {
      eventType: "subtask_completed", resultCode: result.status,
    });
  }
);

export const recordSharedSubtaskGroupHistory = onDocumentWritten(
  {
    document:
      "goals/{goalId}/subtasks/{subtaskId}/progressEvents/{progressEventId}",
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const progress = event.data?.after.data();
    const sourceEventId =
      `subtask_progress:${event.params.goalId}:` +
      `${event.params.subtaskId}:${event.params.progressEventId}`;
    if (before?.reverted !== true && progress?.reverted === true) {
      const goal = await getFirestore().collection("goals")
        .doc(event.params.goalId).get();
      const groupIds = Array.isArray(goal.data()?.sharedGroupIds) ?
        goal.data()!.sharedGroupIds.filter(
          (value: unknown): value is string =>
            typeof value === "string" && !!value.trim()) : [];
      const actorUid = typeof progress.authorUid === "string" ?
        progress.authorUid.trim() : "";
      if (goal.data()?.visibility === "group_shared" &&
        groupIds.length === 1 && actorUid) {
        const batch = getFirestore().batch();
        batch.delete(getFirestore().collection("groups").doc(groupIds[0])
          .collection("historyEvents").doc(buildTrustedGroupHistoryEventId({
            groupId: groupIds[0],
            eventType: "shared_subtask_completed",
            sourceEventId,
          })));
        batch.delete(getFirestore().collection("users").doc(actorUid)
          .collection("historyEvents").doc(buildTrustedPersonalHistoryEventId(
            actorUid, `shared_${sourceEventId}`)));
        await batch.commit();
        logger.info("shared_subtask_history_reverted", {
          groupId: groupIds[0],
          goalId: event.params.goalId,
          subtaskId: event.params.subtaskId,
          actorUid,
        });
      }
      return;
    }
    if (before || !progress) return;
    let result;
    try {
      result = await recordSharedSubtaskCompletion({
        firestore: getFirestore(),
        goalId: event.params.goalId,
        subtaskId: event.params.subtaskId,
        progressEventId: event.params.progressEventId,
        progress,
        nowMs: Date.now(),
      });
    } catch (error) {
      logger.error("group_history_recording_failed",
        groupHistoryFailureDiagnostic({
          sourceKind: "shared_subtask",
          error,
        }));
      throw error;
    }
    const diagnostic = groupHistoryDiagnostic({
      sourceKind: "shared_subtask",
      result,
    });
    if (result.status === "conflict") {
      logger.error("group_history_recording_conflict", diagnostic);
    } else if (result.status === "skipped") {
      logger.info("group_history_recording_skipped", diagnostic);
    } else {
      logger.info(
        result.status === "created" ?
          "group_history_recording_created" :
          "group_history_recording_already_exists",
        diagnostic
      );
    }
    if (!["created", "already_exists"].includes(result.status)) return;
    const actorUid = typeof progress.authorUid === "string" ?
      progress.authorUid.trim() : "";
    if (!actorUid) return;
    const subtask = await getFirestore().collection("goals")
      .doc(event.params.goalId).collection("subtasks")
      .doc(event.params.subtaskId).get();
    const displayTitle = typeof subtask.data()?.title === "string" ?
      subtask.data()!.title.trim().slice(0, 160) : "Shared subtask";
    await recordPersonalHistoryEvent(getFirestore(), {
      ownerUid: actorUid,
      eventType: "subtask_completed",
      entityId: event.params.subtaskId,
      parentEntityId: event.params.goalId,
      occurredAtMs: progress.createdAtMs,
      displayTitle,
      sourceEventId: `shared_${sourceEventId}`,
      metadata: {
        goalId: event.params.goalId,
        groupShared: true,
        progressEventId: event.params.progressEventId,
      },
    });
    logger.info("personal_history_recorded", {
      eventType: "subtask_completed",
      shared: true,
      actorUid,
    });
  }
);

export const recordPersonalCalendarHistory = onDocumentWritten(
  "planningCalendarEvents/{eventId}",
  async (event) => {
    const input = classifyCalendarHistoryEvent(
      event.params.eventId,
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!input) return;
    const result = await recordPersonalHistoryEvent(getFirestore(), input);
    logger.info("personal_history_recorded", {
      eventType: input.eventType, resultCode: result.status,
    });
  }
);

export const recordPersonalBoardCardHistory = onDocumentWritten(
  "planningBoards/{boardId}/cards/{cardId}",
  async (event) => {
    const input = classifyBoardCardHistoryEvent(
      event.params.boardId,
      event.params.cardId,
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!input) return;
    const board = await getFirestore().collection("planningBoards")
      .doc(event.params.boardId).get();
    if (!board.exists || board.data()?.scope !== "personal" ||
      board.data()?.ownerUid !== input.ownerUid) return;
    const result = await recordPersonalHistoryEvent(getFirestore(), input);
    logger.info("personal_history_recorded", {
      eventType: input.eventType, resultCode: result.status,
    });
  }
);

export const recordPersonalMilestoneHistory = onDocumentWritten(
  "goals/{goalId}/milestones/{milestoneId}",
  async (event) => {
    const goal = await getFirestore().collection("goals")
      .doc(event.params.goalId).get();
    const ownerUid = goal.exists && goal.data()?.groupId == null &&
      typeof goal.data()?.userId === "string" ? goal.data()!.userId : null;
    const input = classifyMilestoneHistoryEvent(
      event.params.goalId,
      event.params.milestoneId,
      event.data?.before.data(),
      event.data?.after.data(),
      ownerUid
    );
    if (!input) return;
    const result = await recordPersonalHistoryEvent(getFirestore(), input);
    logger.info("personal_history_recorded", {
      eventType: input.eventType, resultCode: result.status,
    });
  }
);

export const plannerPreferencesChanged = onDocumentWritten(
  "users/{ownerUid}/settings/planner",
  async (event) => {
    const ownerUid = event.params.ownerUid;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const nowMs = Date.now();
    const enabled = after?.enabled !== false;
    await syncPlannerScheduleState(getFirestore(), ownerUid, enabled, nowMs);
    if (after) {
      await enqueuePlannerSourceChange(getFirestore(), {
        kind: "preferences", reasonCode: "preferences_changed",
        before, after: {...after, ownerUid}, nowMs,
      });
    }
  }
);

export const scanPlannerGenerationQueue = onSchedule(
  {schedule: "every 5 minutes", timeZone: "UTC", timeoutSeconds: 540},
  async () => {
    const nowMs = Date.now();
    const schedule = await enqueueDuePlannerScheduleStates(getFirestore(), nowMs);
    const queue = await scanPlannerGenerationRequests(getFirestore(), nowMs,
      `planner_${nowMs}`);
    logger.info("[Planner] queue scan complete", {...schedule, ...queue});
  }
);

export const scanPlannerLifecycle = onSchedule(
  {schedule: "every 15 minutes", timeZone: "UTC", timeoutSeconds: 540},
  async () => {
    const result = await scanPlannerSuggestionLifecycle(getFirestore(), Date.now());
    logger.info("[Planner] lifecycle scan complete", result);
  }
);

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const REMINDER_EXPIRATION_MS = 24 * 60 * 60 * 1000;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const SENT_REMINDER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_REMINDER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const EXPIRED_REMINDER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 100;

const routineTriggerRelevantFields = [
  "groupId", "title", "description", "location", "status", "frequency",
  "interval", "weekdays", "monthlyMode", "dayOfMonth", "weekOfMonth",
  "weekdayOfMonth", "localStartTime", "durationMinutes", "timezone",
  "startDate", "endDate", "createdByUid", "createdByName", "createdByEmail",
  "updatedAtMs",
] as const;

function routineTriggerSignature(value: Record<string, unknown> | undefined) {
  if (!value) return null;
  return JSON.stringify(
    routineTriggerRelevantFields.map((field) => value[field] ?? null)
  );
}

function isRoutineValidationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code.startsWith("invalid_") || code === "routine_id_mismatch";
}

export const reconcileGroupRoutineOnWrite = onDocumentWritten(
  "groupRoutines/{routineId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || routineTriggerSignature(before) === routineTriggerSignature(after)) {
      return;
    }
    const routineId = event.params.routineId;
    const startedAtMs = Date.now();
    let result;
    try {
      result = await reconcileRoutine(getFirestore(), routineId, startedAtMs);
    } catch (error) {
      if (isRoutineValidationError(error)) {
        logger.warn("[GroupRoutineMaterialization] malformed routine skipped", {
          routineId,
          groupId: typeof after.groupId === "string" ? after.groupId : null,
          reasonCode: error instanceof Error ? error.message : "invalid_routine",
        });
        return;
      }
      throw error;
    }
    logger.info("[GroupRoutineMaterialization] targeted reconciliation complete", {
      routineId,
      groupId: typeof after.groupId === "string" ? after.groupId : null,
      created: result.created,
      updated: result.updated,
      cancelled: result.cancelled,
      unchanged: result.unchanged,
      cacheChanged: result.cacheChanged,
      durationMs: Date.now() - startedAtMs,
    });
  }
);

export const processGroupRoutineOccurrenceTransition = onDocumentWritten(
  {
    document: "groupRoutineOccurrences/{occurrenceId}",
    retry: true,
  },
  async (event) => {
    const transition = classifyRoutineOccurrenceTransition(
      event.params.occurrenceId,
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!transition) return;
    const result = await processRoutineTransition(getFirestore(), transition);
    logger.info("[GroupRoutineTransition] occurrence processed", {
      eventId: result.eventId,
      occurrenceId: transition.occurrenceId,
      transitionType: transition.type,
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      inboxRecipientCount: result.inboxRecipientCount,
      pushRequestCount: result.pushRequestCount,
    });
    let historyResult;
    try {
      historyResult = await recordRoutineOccurrenceCompletion({
        firestore: getFirestore(),
        transition,
        occurrence: event.data?.after.data(),
        nowMs: Date.now(),
      });
    } catch (error) {
      logger.error("group_history_recording_failed",
        groupHistoryFailureDiagnostic({
          sourceKind: "routine_occurrence",
          error,
        }));
      throw error;
    }
    const diagnostic = groupHistoryDiagnostic({
      sourceKind: "routine_occurrence",
      result: historyResult,
    });
    if (historyResult.status === "conflict") {
      logger.error("group_history_recording_conflict", diagnostic);
    } else if (historyResult.status === "skipped") {
      logger.info("group_history_recording_skipped", diagnostic);
    } else {
      logger.info(
        historyResult.status === "created" ?
          "group_history_recording_created" :
          "group_history_recording_already_exists",
        diagnostic
      );
    }
  }
);

export const processGroupRoutineParticipantTransition = onDocumentWritten(
  "groupRoutineOccurrences/{occurrenceId}/participants/{participantUid}",
  async (event) => {
    const transition = classifyRoutineParticipantManagerTransition(
      event.params.occurrenceId,
      event.params.participantUid,
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!transition) return;
    const result = await processRoutineTransition(getFirestore(), transition);
    logger.info("[GroupRoutineTransition] participant processed", {
      eventId: result.eventId,
      occurrenceId: transition.occurrenceId,
      participantUid: transition.participantUid,
      transitionType: transition.type,
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      inboxRecipientCount: result.inboxRecipientCount,
      pushRequestCount: result.pushRequestCount,
    });
  }
);

export const reconcileActiveGroupRoutines = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "UTC",
    timeoutSeconds: 540,
  },
  async () => {
    const firestore = getFirestore();
    const startedAtMs = Date.now();
    const checkpointRef = firestore
      .collection("groupRoutineReconciliationState")
      .doc("active-scheduler");
    const checkpoint = (await checkpointRef.get()).data();
    let scanQuery = firestore
      .collection("groupRoutines")
      .where("status", "==", "active")
      .orderBy("updatedAtMs", "asc")
      .orderBy(FieldPath.documentId(), "asc");
    if (
      typeof checkpoint?.lastUpdatedAtMs === "number" &&
      typeof checkpoint?.lastRoutineId === "string"
    ) {
      scanQuery = scanQuery.startAfter(
        checkpoint.lastUpdatedAtMs,
        checkpoint.lastRoutineId
      );
    }
    let snapshot = await scanQuery.limit(MAX_ROUTINES_PER_SCHEDULED_RUN).get();
    if (snapshot.empty && checkpoint?.lastRoutineId) {
      snapshot = await firestore
        .collection("groupRoutines")
        .where("status", "==", "active")
        .orderBy("updatedAtMs", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .limit(MAX_ROUTINES_PER_SCHEDULED_RUN)
        .get();
    }
    let succeeded = 0;
    for (const routineSnapshot of snapshot.docs) {
      try {
        await reconcileRoutine(firestore, routineSnapshot.id, startedAtMs);
        succeeded += 1;
      } catch (error) {
        if (isRoutineValidationError(error)) {
          logger.warn("[GroupRoutineMaterialization] malformed scheduled routine skipped", {
            routineId: routineSnapshot.id,
            groupId:
              typeof routineSnapshot.data().groupId === "string"
                ? routineSnapshot.data().groupId
                : null,
            reasonCode: error instanceof Error ? error.message : "invalid_routine",
          });
          continue;
        }
        logger.error("[GroupRoutineMaterialization] scheduled routine failed", {
          routineId: routineSnapshot.id,
          groupId:
            typeof routineSnapshot.data().groupId === "string"
              ? routineSnapshot.data().groupId
              : null,
          errorCode: error instanceof Error ? error.message : "unknown",
        });
        throw error;
      }
    }
    const last = snapshot.docs[snapshot.docs.length - 1];
    if (last) {
      await checkpointRef.set({
        lastUpdatedAtMs: last.data().updatedAtMs,
        lastRoutineId: last.id,
        updatedAtMs: Date.now(),
      });
    }
    logger.info("[GroupRoutineMaterialization] scheduled reconciliation complete", {
      scanned: snapshot.size,
      succeeded,
      durationMs: Date.now() - startedAtMs,
    });
  }
);


const expo = new Expo();



const clearUserPushToken = async ({
  uid,
  expoPushToken,
  reason,
}: {
  uid?: string;
  expoPushToken?: string | null;
  reason: string;
}) => {
  if (!uid || !expoPushToken) return;

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) return;

  const userData = userSnap.data() ?? {};

  // Only clear if the stored token still matches this failed token.
  // This avoids deleting a newer valid token from another app launch.
  if (userData.expoPushToken !== expoPushToken) {
    logger.info("[Push] skipped clearing token because user token changed", {
      uid,
      reason,
    });
    return;
  }

  await userRef.update({
    expoPushToken: null,
    pushNotificationsEnabled: false,
    pushTokenError: reason,
    pushTokenInvalidatedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });

  logger.warn("[Push] cleared invalid Expo push token", {
    uid,
    reason,
  });
};

type ScheduledReminderDoc = {
  uid?: string;
  goalId?: string;
  subtaskId?: string;
  title?: string;
  reminderAtMs?: number;
  expoPushToken?: string;
  status?: string;

  attemptCount?: number;
  lastAttemptAtMs?: number;
  nextRetryAtMs?: number;
  errorMessage?: string;
  expiredAtMs?: number;
  processingAtMs?: number;
};

type AssignmentNotificationRequestDoc = {
  groupId?: string;
  goalId?: string;
  goalTitle?: string | null;
  subtaskId?: string;
  subtaskTitle?: string | null;
  boardId?: string;
  boardTitle?: string | null;
  cardId?: string;
  cardTitle?: string | null;
  targetUid?: string;
  targetName?: string | null;
  actorUid?: string;
  actorName?: string | null;
  type?: string;
  status?: string;
  createdAtMs?: number;
  processingAtMs?: number;
  expoPushToken?: string | null;
};

type MentionNotificationRequestDoc = {
  groupId?: string;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;

  targetUid?: string;
  targetName?: string | null;

  actorUid?: string;
  actorName?: string | null;

  bodyPreview?: string | null;

  status?: string;
  type?: string;

  createdAtMs?: number;
  updatedAtMs?: number;

  processingAtMs?: number;
  failedAtMs?: number;
  sentAtMs?: number;

  attemptCount?: number;
  nextRetryAtMs?: number;

  errorMessage?: string | null;
};

type MessageNotificationRequestDoc = {
  groupId?: string;
  targetUid?: string;
  targetName?: string | null;
  actorUid?: string;
  actorName?: string | null;
  title?: string;
  body?: string;
  type?: "dm_message" | "conversation_message";
  dmId?: string | null;
  conversationId?: string | null;
  status?: string;
  createdAtMs?: number;
  processingAtMs?: number;
  failedAtMs?: number;
  sentAtMs?: number;
  errorMessage?: string | null;
};

export const scanScheduledReminders = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/New_York",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    logger.info("[Push] scanScheduledReminders started", { nowMs });

    const snap = await db
      .collection("scheduledReminders")
      .where("status", "in", ["scheduled", "retry", "processing"])
      .where("reminderAtMs", "<=", nowMs)
      .limit(25)
      .get();

    logger.info("[Push] due reminders found", {
      count: snap.size,
    });

    for (const docSnap of snap.docs) {
  const data = docSnap.data() as ScheduledReminderDoc;
  const nowAttemptMs = Date.now();

  const attemptCount =
  typeof data.attemptCount === "number"
    ? data.attemptCount
    : 0;

    const processingAtMs =
  typeof data.processingAtMs === "number" ? data.processingAtMs : null;

if (data.status === "processing") {
  if (
    processingAtMs != null &&
    nowAttemptMs - processingAtMs <= PROCESSING_TIMEOUT_MS
  ) {
    logger.info("[Push] skipping active processing reminder", {
      id: docSnap.id,
      processingAtMs,
    });

    continue;
  }

  logger.warn("[Push] reclaiming stale processing reminder", {
    id: docSnap.id,
    processingAtMs,
    nowAttemptMs,
  });

  await docSnap.ref.update({
    status: "scheduled",
    processingAtMs: null,
    errorMessage: "Recovered from stale processing state.",
    updatedAtMs: nowAttemptMs,
  });
}

if (data.status === "retry") {
  const nextRetryAtMs =
    typeof data.nextRetryAtMs === "number" ? data.nextRetryAtMs : null;

  if (nextRetryAtMs != null && nextRetryAtMs > nowAttemptMs) {
    logger.info("[Push] skipping retry reminder until nextRetryAtMs", {
      id: docSnap.id,
      nextRetryAtMs,
      nowAttemptMs,
    });

    continue;
  }
}

    const reminderAtMs =
  typeof data.reminderAtMs === "number"
    ? data.reminderAtMs
    : null;

if (
  reminderAtMs != null &&
  nowAttemptMs - reminderAtMs > REMINDER_EXPIRATION_MS
) {
  logger.warn("[Push] reminder expired", {
    id: docSnap.id,
    reminderAtMs,
    nowAttemptMs,
  });

  await docSnap.ref.update({
    status: "expired",
    expiredAtMs: nowAttemptMs,
    errorMessage: "Reminder expired before delivery.",
    updatedAtMs: nowAttemptMs,
  });

  continue;
}

  // Processing lock: prevents duplicate sends if scheduler overlaps.
  await docSnap.ref.update({
  status: "processing",
  processingAtMs: nowAttemptMs,
  lastAttemptAtMs: nowAttemptMs,
  attemptCount: attemptCount + 1,
  updatedAtMs: nowAttemptMs,
});

  const expoPushToken =
    typeof data.expoPushToken === "string" ? data.expoPushToken : null;

 if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
  const failedAtMs = Date.now();
  const errorMessage = "Invalid Expo push token.";

  logger.warn("[Push] invalid Expo push token", {
    id: docSnap.id,
    uid: data.uid,
    expoPushToken,
  });

  await clearUserPushToken({
    uid: data.uid,
    expoPushToken,
    reason: errorMessage,
  });

  await docSnap.ref.update({
    status: "failed",
    failedAtMs,
    errorMessage,
    updatedAtMs: failedAtMs,
  });

  continue;
}



  const reminderTitle =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : "Goal reminder";

  const pushMessage: ExpoPushMessage = {
    to: expoPushToken,
    sound: "default",
    title: "Dayta reminder",
    body: reminderTitle,
    data: {
      reminderId: docSnap.id,
      goalId: data.goalId ?? null,
      subtaskId: data.subtaskId ?? null,
    },
  };

  const markRetry = async (errorMessage: string) => {
  const nextRetryAtMs = Date.now() + RETRY_DELAY_MS;

  logger.warn("[Push] scheduling retry", {
    id: docSnap.id,
    attemptCount: attemptCount + 1,
    nextRetryAtMs,
    errorMessage,
  });

  await docSnap.ref.update({
    status:
      attemptCount + 1 >= MAX_RETRY_COUNT
        ? "failed"
        : "retry",
    failedAtMs:
      attemptCount + 1 >= MAX_RETRY_COUNT
        ? Date.now()
        : null,
    nextRetryAtMs:
      attemptCount + 1 >= MAX_RETRY_COUNT
        ? null
        : nextRetryAtMs,
    errorMessage,
    updatedAtMs: Date.now(),
  });
};

  try {
    const tickets = await expo.sendPushNotificationsAsync([pushMessage]);
    const ticket = tickets[0];

    logger.info("[Push] sent reminder ticket", {
      id: docSnap.id,
      ticket,
    });

    if (!ticket || ticket.status !== "ok") {
      const errorMessage =
        ticket?.details?.error ??
        ticket?.message ??
        "Expo push ticket returned an error.";

      const permanentExpoErrors = [
  "DeviceNotRegistered",
  "InvalidCredentials",
];

if (
  ticket?.details?.error &&
  permanentExpoErrors.includes(ticket.details.error)
) {
  const failedAtMs = Date.now();

  await clearUserPushToken({
    uid: data.uid,
    expoPushToken,
    reason: errorMessage,
  });

  await docSnap.ref.update({
    status: "failed",
    failedAtMs,
    errorMessage,
    ticket,
    updatedAtMs: failedAtMs,
  });
} else {
  await markRetry(errorMessage);
}

continue;
    }

    await docSnap.ref.update({
      status: "sent",
      sentAtMs: Date.now(),
      ticket,
      errorMessage: null,
      updatedAtMs: Date.now(),
    });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown push send error";

    logger.error("[Push] send failed", {
      id: docSnap.id,
      errorMessage,
    });

    await markRetry(errorMessage);
  }
}
  }
);

export const cleanupOldScheduledReminders = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/New_York",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    logger.info("[PushCleanup] cleanupOldScheduledReminders started", {
      nowMs,
    });

    const cleanupByStatus = async ({
      status,
      timestampField,
      retentionMs,
    }: {
      status: string;
      timestampField: string;
      retentionMs: number;
    }) => {
      const cutoffMs = nowMs - retentionMs;

      const snap = await db
        .collection("scheduledReminders")
        .where("status", "==", status)
        .where(timestampField, "<=", cutoffMs)
        .limit(CLEANUP_BATCH_LIMIT)
        .get();

      if (snap.empty) {
        logger.info("[PushCleanup] no old reminders found", {
          status,
          timestampField,
          cutoffMs,
        });

        return 0;
      }

      const batch = db.batch();

      snap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();

      logger.info("[PushCleanup] deleted old reminders", {
        status,
        timestampField,
        count: snap.size,
        cutoffMs,
      });

      return snap.size;
    };

    const sentDeleted = await cleanupByStatus({
      status: "sent",
      timestampField: "sentAtMs",
      retentionMs: SENT_REMINDER_RETENTION_MS,
    });

    const failedDeleted = await cleanupByStatus({
      status: "failed",
      timestampField: "failedAtMs",
      retentionMs: FAILED_REMINDER_RETENTION_MS,
    });

    const expiredDeleted = await cleanupByStatus({
      status: "expired",
      timestampField: "expiredAtMs",
      retentionMs: EXPIRED_REMINDER_RETENTION_MS,
    });

    logger.info("[PushCleanup] cleanupOldScheduledReminders finished", {
      sentDeleted,
      failedDeleted,
      expiredDeleted,
    });
  }
);
export const scanAssignmentNotificationRequests = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/New_York",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    logger.info("[Assignments] scanAssignmentNotificationRequests started", {
      nowMs,
    });

    const snap = await db
      .collection("assignmentNotificationRequests")
      .where("status", "==", "queued")
      .where("type", "in", [
        "task_assigned",
        "planning_board_card_assignment",
      ])
      .orderBy("createdAtMs", "asc")
      .limit(25)
      .get();

    if (snap.empty) {
      logger.info("[Assignments] no queued assignment notifications");
      return;
    }

    logger.info("[Assignments] queued requests found", {
      count: snap.size,
    });

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as AssignmentNotificationRequestDoc;
      const nowAttemptMs = Date.now();

      const targetUid =
        typeof data.targetUid === "string" ? data.targetUid : null;

      if (!targetUid) {
        await docSnap.ref.update({
          status: "failed",
          failedAtMs: nowAttemptMs,
          errorMessage: "Missing target uid.",
          updatedAtMs: nowAttemptMs,
        });
        continue;
      }

      const userSnap = await db.collection("users").doc(targetUid).get();
      const userData = userSnap.data();

      const expoPushToken =
        typeof userData?.expoPushToken === "string"
          ? userData.expoPushToken
          : null;

      if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
        const errorMessage = "Missing or invalid Expo push token.";

        await clearUserPushToken({
          uid: targetUid,
          expoPushToken,
          reason: errorMessage,
        });

        await docSnap.ref.update({
          status: "failed",
          failedAtMs: nowAttemptMs,
          errorMessage,
          updatedAtMs: nowAttemptMs,
        });

        continue;
      }

      await docSnap.ref.update({
        status: "processing",
        processingAtMs: nowAttemptMs,
        expoPushToken,
        updatedAtMs: nowAttemptMs,
      });

      const actorName =
        typeof data.actorName === "string" && data.actorName.trim()
          ? data.actorName.trim()
          : "Someone";

      const subtaskTitle =
        typeof data.subtaskTitle === "string" && data.subtaskTitle.trim()
          ? data.subtaskTitle.trim()
          : "a task";

      const goalTitle =
        typeof data.goalTitle === "string" && data.goalTitle.trim()
          ? data.goalTitle.trim()
          : "a shared goal";
      const isPlanningBoardAssignment =
        data.type === "planning_board_card_assignment";
      const cardTitle =
        typeof data.cardTitle === "string" && data.cardTitle.trim()
          ? data.cardTitle.trim()
          : "a board card";
      const boardTitle =
        typeof data.boardTitle === "string" && data.boardTitle.trim()
          ? data.boardTitle.trim()
          : "Planning board";

      const pushMessage: ExpoPushMessage = {
        to: expoPushToken,
        sound: "default",
        title: isPlanningBoardAssignment
          ? "New board assignment"
          : "Dayta assignment",
        body: isPlanningBoardAssignment
          ? `${actorName} assigned “${cardTitle}” to you on ${boardTitle}.`
          : `${actorName} assigned you "${subtaskTitle}" in "${goalTitle}"`,
        data: {
          requestId: docSnap.id,
          type: data.type ?? "task_assigned",
          goalId: data.goalId ?? null,
          subtaskId: data.subtaskId ?? null,
          boardId: data.boardId ?? null,
          cardId: data.cardId ?? null,
          groupId: data.groupId ?? null,
        },
      };

      try {
        const tickets = await expo.sendPushNotificationsAsync([pushMessage]);
        const ticket = tickets[0];

        logger.info("[Assignments] sent assignment ticket", {
          id: docSnap.id,
          ticket,
        });

        if (!ticket || ticket.status !== "ok") {
          const errorMessage =
            ticket?.details?.error ??
            ticket?.message ??
            "Expo push ticket returned an error.";

          const permanentExpoErrors = [
            "DeviceNotRegistered",
            "InvalidCredentials",
          ];

          if (
            ticket?.details?.error &&
            permanentExpoErrors.includes(ticket.details.error)
          ) {
            await clearUserPushToken({
              uid: targetUid,
              expoPushToken,
              reason: errorMessage,
            });
          }

          await docSnap.ref.update({
            status: "failed",
            failedAtMs: Date.now(),
            errorMessage,
            ticket,
            updatedAtMs: Date.now(),
          });

          continue;
        }

        await docSnap.ref.update({
          status: "sent",
          sentAtMs: Date.now(),
          ticket,
          errorMessage: null,
          updatedAtMs: Date.now(),
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown assignment push error.";

        logger.error("[Assignments] send failed", {
          id: docSnap.id,
          errorMessage,
        });

        await docSnap.ref.update({
          status: "failed",
          failedAtMs: Date.now(),
          errorMessage,
          updatedAtMs: Date.now(),
        });
      }
    }
  }
);
export const scanMessageNotificationRequests = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/New_York",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    logger.info("[Messages] scanMessageNotificationRequests started", {
      nowMs,
    });

    const snap = await db
      .collection("messageNotificationRequests")
      .where("status", "==", "queued")
      .orderBy("createdAtMs", "asc")
      .limit(25)
      .get();

    if (snap.empty) {
      logger.info("[Messages] no queued message notifications");
      return;
    }

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as MessageNotificationRequestDoc;
      const nowAttemptMs = Date.now();

      const targetUid =
        typeof data.targetUid === "string" ? data.targetUid : null;

      if (!targetUid) {
        await docSnap.ref.update({
          status: "failed",
          failedAtMs: nowAttemptMs,
          errorMessage: "Missing target uid.",
          updatedAtMs: nowAttemptMs,
        });
        continue;
      }

      const userSnap = await db.collection("users").doc(targetUid).get();
      const userData = userSnap.data();

      const expoPushToken =
        typeof userData?.expoPushToken === "string"
          ? userData.expoPushToken
          : null;

      if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
        const errorMessage = "Missing or invalid Expo push token.";

        await clearUserPushToken({
          uid: targetUid,
          expoPushToken,
          reason: errorMessage,
        });

        await docSnap.ref.update({
          status: "failed",
          failedAtMs: nowAttemptMs,
          errorMessage,
          updatedAtMs: nowAttemptMs,
        });

        continue;
      }

      await docSnap.ref.update({
        status: "processing",
        processingAtMs: nowAttemptMs,
        expoPushToken,
        updatedAtMs: nowAttemptMs,
      });

      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : data.type === "conversation_message"
          ? "New group conversation message"
          : "New direct message";

      const body =
        typeof data.body === "string" && data.body.trim()
          ? data.body.trim()
          : "Open Dayta to view the message.";

      const pushMessage: ExpoPushMessage = {
        to: expoPushToken,
        sound: "default",
        title,
        body,
        data: {
          requestId: docSnap.id,
          type: data.type ?? "dm_message",
          groupId: data.groupId ?? null,
          dmId: data.dmId ?? null,
          conversationId: data.conversationId ?? null,
        },
      };

      try {
        const tickets = await expo.sendPushNotificationsAsync([pushMessage]);
        const ticket = tickets[0];

        logger.info("[Messages] sent message ticket", {
          id: docSnap.id,
          ticket,
        });

        if (!ticket || ticket.status !== "ok") {
          const errorMessage =
            ticket?.details?.error ??
            ticket?.message ??
            "Expo push ticket returned an error.";

          const permanentExpoErrors = [
            "DeviceNotRegistered",
            "InvalidCredentials",
          ];

          if (
            ticket?.details?.error &&
            permanentExpoErrors.includes(ticket.details.error)
          ) {
            await clearUserPushToken({
              uid: targetUid,
              expoPushToken,
              reason: errorMessage,
            });
          }

          await docSnap.ref.update({
            status: "failed",
            failedAtMs: Date.now(),
            errorMessage,
            ticket,
            updatedAtMs: Date.now(),
          });

          continue;
        }

        await docSnap.ref.update({
          status: "sent",
          sentAtMs: Date.now(),
          ticket,
          errorMessage: null,
          updatedAtMs: Date.now(),
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown message push error.";

        logger.error("[Messages] send failed", {
          id: docSnap.id,
          errorMessage,
        });

        await docSnap.ref.update({
          status: "failed",
          failedAtMs: Date.now(),
          errorMessage,
          updatedAtMs: Date.now(),
        });
      }
    }
  }
);

export const scanRoutineNotificationRequests = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
  },
  async () => {
    const db = getFirestore();
    const candidateIds = await getRoutineNotificationCandidates(db, Date.now());
    for (const requestId of candidateIds) {
      const claim = await claimRoutineNotificationRequest(
        db,
        requestId,
        Date.now()
      );
      if (!claim) continue;
      const result = await processRoutineNotificationClaim(db, claim, {
        nowMs: Date.now(),
        validToken: Expo.isExpoPushToken,
        send: async (data, expoPushToken) => {
          const message: ExpoPushMessage = {
            to: expoPushToken,
            sound: "default",
            title: data.title ?? "Routine update",
            body:
              data.body ?? "Open Dayta to view the routine occurrence.",
            data: {
              requestId,
              type: data.type ?? "routine_transition",
              groupId: data.groupId ?? null,
              routineId: data.routineId ?? null,
              occurrenceId: data.occurrenceId ?? null,
              deepLink: data.deepLink ?? null,
            },
          };
          try {
            const ticket = (
              await expo.sendPushNotificationsAsync([message])
            )[0];
            if (ticket?.status === "ok") return { ok: true, receipt: ticket };
            const errorMessage =
              ticket?.details?.error ??
              ticket?.message ??
              "Expo push ticket returned an error.";
            return {
              ok: false,
              errorMessage,
              permanent:
                ticket?.details?.error != null &&
                ["DeviceNotRegistered", "InvalidCredentials"].includes(
                  ticket.details.error
                ),
              receipt: ticket,
            };
          } catch (error) {
            return {
              ok: false,
              errorMessage:
                error instanceof Error
                  ? error.message
                  : "Unknown routine push error.",
            };
          }
        },
      });
      logger.info("[GroupRoutineTransition] push request processed", {
        requestId,
        status: result.status,
        reasonCode: result.reasonCode,
      });
    }
  }
);

export const scanPlannerNotificationRequests = onSchedule(
  {schedule: "every 1 minutes", timeZone: "UTC"},
  async () => {
    const db = getFirestore();
    const candidates = await getPlannerNotificationCandidates(db, Date.now());
    for (const requestId of candidates) {
      const claim = await claimPlannerNotificationRequest(
        db, requestId, Date.now()
      );
      if (!claim) {
        logger.info("planner_notification_duplicate", {requestId});
        continue;
      }
      const result = await processPlannerNotificationClaim(db, claim, {
        nowMs: Date.now(),
        validToken: Expo.isExpoPushToken,
        send: async (data, expoPushToken) => {
          const message: ExpoPushMessage = {
            to: expoPushToken, sound: "default",
            title: data.title ?? "Planner update",
            body: data.body ?? "Open Planner to review new suggestions.",
            data: {type: "planner_suggestion_batch", deepLink: "/planner",
              plannerGenerationRunId: data.generationRunId ?? null},
          };
          try {
            const ticket = (await expo.sendPushNotificationsAsync([message]))[0];
            return {ok: ticket?.status === "ok",
              permanent: ticket?.status === "error" &&
                ticket.details?.error != null &&
                ["DeviceNotRegistered", "InvalidCredentials"]
                  .includes(ticket.details.error),
              receipt: ticket};
          } catch {
            return {ok: false};
          }
        },
      });
      logger.info(result.status === "sent" ?
        "planner_notification_sent" : "planner_notification_suppressed",
      {requestId, status: result.status, reasonCode: result.reasonCode});
    }
  }
);
export const scanMentionNotificationRequests = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/New_York",
  },
  async () => {
    const nowMs = Date.now();
    const db = getFirestore();

    const snap = await db
      .collection("mentionNotificationRequests")
      .where("status", "in", ["queued"])
      .orderBy("createdAtMs", "asc")
      .limit(25)
      .get();

    if (snap.empty) return;

    await Promise.all(
      snap.docs.map(async (docSnap) => {
        const request = docSnap.data() as MentionNotificationRequestDoc;
        const requestRef = docSnap.ref;
        const nextRetryAtMs =
  typeof request.nextRetryAtMs === "number" ? request.nextRetryAtMs : null;

if (nextRetryAtMs != null && nextRetryAtMs > Date.now()) {
  return;
}

        try {
          await requestRef.update({
            status: "processing",
            processingAtMs: nowMs,
            updatedAtMs: nowMs,
          });

          const targetUid = request.targetUid;
          if (!targetUid) {
            await requestRef.update({
              status: "failed",
              errorMessage: "missing_target_uid",
              updatedAtMs: Date.now(),
            });
            return;
          }

          const userSnap = await db.collection("users").doc(targetUid).get();
          const expoPushToken = userSnap.data()?.expoPushToken;

          if (!expoPushToken) {
            await requestRef.update({
              status: "failed",
failedAtMs: Date.now(),
errorMessage: "Missing Expo push token.",
              updatedAtMs: Date.now(),
            });
            return;
          }

         const title = `${request.actorName ?? "Someone"} mentioned you`;
const body = request.bodyPreview ?? "Open Dayta to view the mention.";

const pushMessage: ExpoPushMessage = {
  to: expoPushToken,
  sound: "default",
  title,
  body,
  data: {
    type: "group_mention",
    groupId: request.groupId ?? "",
    goalId: request.goalId ?? "",
    subtaskId: request.taskId ?? "",
    taskId: request.taskId ?? "",
  },
};

const tickets = await expo.sendPushNotificationsAsync([pushMessage]);
const ticket = tickets[0];

if (!ticket || ticket.status !== "ok") {
  const errorMessage =
    ticket?.details?.error ??
    ticket?.message ??
    "Expo push ticket returned an error.";

  const permanentExpoErrors = [
    "DeviceNotRegistered",
    "InvalidCredentials",
  ];

  if (
    ticket?.details?.error &&
    permanentExpoErrors.includes(ticket.details.error)
  ) {
    await clearUserPushToken({
      uid: targetUid,
      expoPushToken,
      reason: errorMessage,
    });
  }

  await requestRef.update({
    status: "failed",
    failedAtMs: Date.now(),
    errorMessage,
    ticket,
    updatedAtMs: Date.now(),
  });

  return;
}

await requestRef.update({
  status: "sent",
  sentAtMs: Date.now(),
  ticket,
  errorMessage: null,
  updatedAtMs: Date.now(),
});
        } catch (err: unknown) {
  const errorMessage =
    err instanceof Error ? err.message : "Unknown mention push error.";

  logger.error("[MentionPush] send failed", {
    id: docSnap.id,
    errorMessage,
  });

  const attemptCount =
    typeof request.attemptCount === "number" ? request.attemptCount : 0;

  const nextAttemptCount = attemptCount + 1;

  await requestRef.update({
    status: nextAttemptCount >= MAX_RETRY_COUNT ? "failed" : "queued",
    attemptCount: nextAttemptCount,
    failedAtMs: nextAttemptCount >= MAX_RETRY_COUNT ? Date.now() : null,
    nextRetryAtMs:
      nextAttemptCount >= MAX_RETRY_COUNT
        ? null
        : Date.now() + RETRY_DELAY_MS,
    errorMessage,
    updatedAtMs: Date.now(),
  });
}
      })
    );
  }
);
export const cleanupOldMentionNotificationRequests = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/New_York",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    logger.info("[MentionPushCleanup] cleanup started", {
      nowMs,
    });

    const cleanupByStatus = async ({
      status,
      timestampField,
      retentionMs,
    }: {
      status: string;
      timestampField: string;
      retentionMs: number;
    }) => {
      const cutoffMs = nowMs - retentionMs;

      const snap = await db
        .collection("mentionNotificationRequests")
        .where("status", "==", status)
        .where(timestampField, "<=", cutoffMs)
        .limit(CLEANUP_BATCH_LIMIT)
        .get();

      if (snap.empty) {
        logger.info("[MentionPushCleanup] nothing to cleanup", {
          status,
          cutoffMs,
        });

        return 0;
      }

      const batch = db.batch();

      snap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();

      logger.info("[MentionPushCleanup] deleted old requests", {
        status,
        count: snap.size,
      });

      return snap.size;
    };

    const sentDeleted = await cleanupByStatus({
      status: "sent",
      timestampField: "sentAtMs",
      retentionMs: SENT_REMINDER_RETENTION_MS,
    });

    const failedDeleted = await cleanupByStatus({
      status: "failed",
      timestampField: "failedAtMs",
      retentionMs: FAILED_REMINDER_RETENTION_MS,
    });

    logger.info("[MentionPushCleanup] cleanup finished", {
      sentDeleted,
      failedDeleted,
    });
  }
);
