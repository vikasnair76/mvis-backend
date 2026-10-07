// services/subtasks.ts

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,} from "firebase/firestore";
import { db } from "./firebase";
import { dayKeyFromDate } from "./dateKey";
import {
  buildOneTimeSchedulePatch,
  buildRecurringTimedOverride,
  getScheduleOverrideKey,
  getScheduleType,
  type ScheduleOverrideRecord,
} from "./scheduling";
import {
  buildMediaAttachmentStoragePath,
  MAX_GIF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_ATTACHMENTS,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_MS,
  mapMediaAttachmentDoc,
  normalizeVideoLink,
  normalizeMediaAttachmentType,
  type MediaAttachmentDoc,
  type MediaAttachmentType,
} from "./mediaAttachments";

export const MAX_PROGRESS_ATTACHMENTS = MAX_MEDIA_ATTACHMENTS;
export const MAX_PROGRESS_COMMENT_LENGTH = 1000;
export const DEFAULT_PROGRESS_HISTORY_LIMIT = 100;

export type SubtaskProgressEventKind = "completion" | "increment" | "unknown";

export type ProgressAttachmentType = MediaAttachmentType;
export type ProgressAttachmentDoc = MediaAttachmentDoc;

export type SubtaskProgressEventDoc = {
  id: string;
  goalId: string;
  subtaskId: string;
  kind: SubtaskProgressEventKind;
  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;
  dayKey?: string | null;
  delta?: number | null;
  previousValue?: number | null;
  resultingValue?: number | null;
  targetValue?: number | null;
  unit?: string | null;
  metricContributionBefore?: number | null;
  metricContributionAfter?: number | null;
  metricContributionDelta?: number | null;
  metricContributionTarget?: number | null;
  metricUnitSnapshot?: string | null;
  completed?: boolean | null;
  comment?: string | null;
  attachments: ProgressAttachmentDoc[];
  reverted: boolean;
  revertedAtMs?: number | null;
  revertedByUid?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  legacyCompletion: boolean;
};

export type CreateSubtaskProgressEventInput = {
  goalId: string;
  subtaskId: string;
  kind: Exclude<SubtaskProgressEventKind, "unknown">;
  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;
  dayKey?: string | null;
  delta?: number | null;
  previousValue?: number | null;
  resultingValue?: number | null;
  targetValue?: number | null;
  unit?: string | null;
  completed?: boolean | null;
  comment?: string | null;
  attachments?: ProgressAttachmentDoc[];
};

export type RevertSubtaskProgressEventInput = {
  goalId: string;
  subtaskId: string;
  eventId: string;
  revertedByUid: string;
};

export type RecordSubtaskProgressInput = {
  goalId: string;
  subtaskId: string;
  dayKey: string;
  actorUid: string;
  actorName?: string | null;
  actorEmail?: string | null;
  action?: "toggle" | "complete" | "increment" | "undo";
  delta?: number | null;
  comment?: string | null;
  metricValueOverride?: number | null;
  progressEventId?: string | null;
  attachments?: MediaAttachmentDoc[];
};

export type RecordSubtaskProgressResult = {
  changed: boolean;
  action: "complete" | "increment" | "undo" | "none";
  eventId: string | null;
  appliedDelta: number;
  previousValue: number;
  resultingValue: number;
  targetValue: number;
  completed: boolean;
};

export function normalizeSubtaskProgressEventKind(
  value: unknown
): SubtaskProgressEventKind {
  return value === "completion" || value === "increment" ? value : "unknown";
}

export function normalizeProgressAttachmentType(
  value: unknown
): ProgressAttachmentType | null {
  return normalizeMediaAttachmentType(value);
}

export function normalizeProgressEventComment(
  value: unknown
): string | null {
  if (typeof value !== "string") return null;
  const comment = value.trim();
  if (!comment) return null;
  if (comment.length > MAX_PROGRESS_COMMENT_LENGTH) {
    throw new Error(
      `Progress comments must be ${MAX_PROGRESS_COMMENT_LENGTH} characters or fewer.`
    );
  }
  return comment;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function mapProgressEventComment(value: unknown): string | null {
  try {
    return normalizeProgressEventComment(value);
  } catch {
    return null;
  }
}

function mapMetricContributionSnapshot(data: Record<string, unknown>) {
  const before = nullableFiniteNumber(data.metricContributionBefore);
  const after = nullableFiniteNumber(data.metricContributionAfter);
  const delta = nullableFiniteNumber(data.metricContributionDelta);
  const target = nullableFiniteNumber(data.metricContributionTarget);
  const unit = nullableString(data.metricUnitSnapshot);
  const hasAny = [
    "metricContributionBefore",
    "metricContributionAfter",
    "metricContributionDelta",
    "metricContributionTarget",
    "metricUnitSnapshot",
  ].some((key) => key in data);
  const valid =
    before != null &&
    before >= 0 &&
    after != null &&
    after >= 0 &&
    delta != null &&
    target != null &&
    target > 0 &&
    after <= target &&
    roundMetricValue(after - before) === delta &&
    (data.metricUnitSnapshot == null ||
      (unit != null && unit.length <= 64));
  return hasAny && valid
    ? {
        metricContributionBefore: before,
        metricContributionAfter: after,
        metricContributionDelta: delta,
        metricContributionTarget: target,
        metricUnitSnapshot: unit,
      }
    : {
        metricContributionBefore: null,
        metricContributionAfter: null,
        metricContributionDelta: null,
        metricContributionTarget: null,
        metricUnitSnapshot: null,
      };
}

export function mapProgressAttachmentDoc(
  value: unknown
): ProgressAttachmentDoc | null {
  return mapMediaAttachmentDoc(value);
}

export function mapSubtaskProgressEventDoc(
  id: string,
  data: Record<string, unknown>,
  fallback?: { goalId?: string; subtaskId?: string }
): SubtaskProgressEventDoc {
  const createdAtMs =
    nullableFiniteNumber(data.createdAtMs) ??
    nullableFiniteNumber(data.completedAtMs) ??
    timestampMillis(data.createdAt) ??
    0;
  const updatedAtMs =
    nullableFiniteNumber(data.updatedAtMs) ??
    timestampMillis(data.updatedAt) ??
    createdAtMs;
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
        .slice(0, MAX_PROGRESS_ATTACHMENTS)
        .map(mapProgressAttachmentDoc)
        .filter((item): item is ProgressAttachmentDoc => item != null)
    : [];
  const metricSnapshot = mapMetricContributionSnapshot(data);

  return {
    id,
    goalId: nullableString(data.goalId) ?? fallback?.goalId ?? "",
    subtaskId: nullableString(data.subtaskId) ?? fallback?.subtaskId ?? "",
    kind: normalizeSubtaskProgressEventKind(data.kind),
    authorUid:
      nullableString(data.authorUid) ?? nullableString(data.userId) ?? "",
    authorName: nullableString(data.authorName),
    authorEmail: nullableString(data.authorEmail),
    dayKey: nullableString(data.dayKey) ?? id,
    delta: nullableFiniteNumber(data.delta),
    previousValue: nullableFiniteNumber(data.previousValue),
    resultingValue:
      nullableFiniteNumber(data.resultingValue) ??
      nullableFiniteNumber(data.completionCount),
    targetValue: nullableFiniteNumber(data.targetValue),
    unit:
      nullableString(data.unit) ??
      nullableString(data.metricContributionUnit),
    ...metricSnapshot,
    completed:
      typeof data.completed === "boolean"
        ? data.completed
        : data.completedAtMs != null,
    comment: mapProgressEventComment(data.comment),
    attachments,
    reverted: data.reverted === true,
    revertedAtMs: nullableFiniteNumber(data.revertedAtMs),
    revertedByUid: nullableString(data.revertedByUid),
    createdAtMs,
    updatedAtMs,
    legacyCompletion: data.kind == null,
  };
}

export function subscribeSubtaskProgressEvents(
  goalId: string,
  subtaskId: string,
  onNext: (events: SubtaskProgressEventDoc[], hasMore: boolean) => void,
  onError?: (error: unknown) => void,
  historyLimit = DEFAULT_PROGRESS_HISTORY_LIMIT
): Unsubscribe {
  const safeGoalId = goalId.trim();
  const safeSubtaskId = subtaskId.trim();
  if (!safeGoalId || !safeSubtaskId) {
    onNext([], false);
    return () => {};
  }

  const qy = query(
    collection(
      db,
      "goals",
      safeGoalId,
      "subtasks",
      safeSubtaskId,
      "progressEvents"
    ),
    orderBy("createdAtMs", "desc"),
    limit(Math.min(Math.max(1, historyLimit) + 1, 251))
  );

  return onSnapshot(
    qy,
    (snap) => {
      const requestedLimit = Math.max(1, Math.min(historyLimit, 250));
      const mapped = snap.docs
          .map((item) =>
            mapSubtaskProgressEventDoc(item.id, item.data(), {
              goalId: safeGoalId,
              subtaskId: safeSubtaskId,
            })
          )
          .sort(
            (a, b) =>
              b.createdAtMs - a.createdAtMs ||
              (b.dayKey ?? "").localeCompare(a.dayKey ?? "") ||
              b.id.localeCompare(a.id)
          );
      onNext(mapped.slice(0, requestedLimit), mapped.length > requestedLimit);
    },
    onError
  );
}

/**
 * Goal progress: 0..100, target required
 */
function computeProgress(current: number | null, target: number | null): number {
  if (target == null || target <= 0) return 0;
  const safeCurrent = current ?? 0;
  const pct = (safeCurrent / target) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Toggle completion for a specific dayKey.
 *
 * ✅ Behavior:
 * - Creates/deletes goals/{goalId}/subtasks/{subtaskId}/completions/{dayKey}
 * - Updates goal rollup ONLY if:
 *    subtask.contributesToMetric === true AND subtask.metricValue is a valid number
 *  * - For "once" subtasks:
 *    - First completion sets firstCompletedAtMs (and we block re-complete after that)
 *    - Undoing todayKey clears firstCompletedAtMs (allows re-complete)
 */

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}


function roundMetricValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getStoredMetricContribution(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampCount(value: number, targetCount: number): number {
  return Math.max(0, Math.min(targetCount, value));
}

function validateProgressAttachments(input: {
  attachments?: MediaAttachmentDoc[];
  actorUid: string;
  goalId: string;
  subtaskId: string;
  progressEventId: string;
}): MediaAttachmentDoc[] {
  const rawAttachments = input.attachments ?? [];
  if (rawAttachments.length > MAX_PROGRESS_ATTACHMENTS) {
    throw new Error(
      `A progress update can include up to ${MAX_PROGRESS_ATTACHMENTS} attachments.`
    );
  }

  const ids = new Set<string>();
  let videoLinkCount = 0;
  let uploadedVideoCount = 0;
  return rawAttachments.map((rawAttachment) => {
    const attachment = mapMediaAttachmentDoc(rawAttachment);
    if (!attachment || attachment.uploadedByUid !== input.actorUid) {
      throw new Error("One or more progress attachments are invalid.");
    }
    if (ids.has(attachment.id)) {
      throw new Error("Duplicate progress attachments are not allowed.");
    }
    ids.add(attachment.id);

    if (attachment.type === "video_link") {
      videoLinkCount += 1;
      const normalized = attachment.externalUrl
        ? normalizeVideoLink(attachment.externalUrl)
        : null;
      if (
        videoLinkCount > 1 ||
        !normalized ||
        attachment.provider !== normalized.provider ||
        attachment.providerMediaId !== normalized.providerMediaId ||
        attachment.thumbnailUrl !== normalized.thumbnailUrl ||
        attachment.title !== normalized.displayLabel
      ) {
        throw new Error("The video link attachment is invalid.");
      }
      return attachment;
    }

    const isImage =
      attachment.type === "image" &&
      !!attachment.mimeType &&
      ["image/jpeg", "image/png", "image/webp"].includes(
        attachment.mimeType
      );
    const isGif =
      attachment.type === "gif" && attachment.mimeType === "image/gif";
    const isVideo =
      attachment.type === "video" && attachment.mimeType === "video/mp4";
    if (isVideo) uploadedVideoCount += 1;
    const maxBytes = isVideo
      ? MAX_VIDEO_BYTES
      : isGif
      ? MAX_GIF_BYTES
      : MAX_IMAGE_BYTES;
    if (
      (!isImage && !isGif && !isVideo) ||
      uploadedVideoCount > 1 ||
      !attachment.storagePath ||
      !attachment.downloadUrl ||
      !attachment.downloadUrl.startsWith("https://") ||
      !attachment.mimeType ||
      attachment.sizeBytes == null ||
      attachment.sizeBytes <= 0 ||
      attachment.sizeBytes > maxBytes ||
      (isVideo &&
        (attachment.durationMs == null ||
          attachment.durationMs <= 0 ||
          attachment.durationMs > MAX_VIDEO_DURATION_MS)) ||
      (!isVideo && attachment.durationMs != null) ||
      (attachment.width != null && attachment.width <= 0) ||
      (attachment.height != null && attachment.height <= 0) ||
      attachment.externalUrl != null ||
      attachment.provider != null ||
      attachment.providerMediaId != null ||
      attachment.title != null
    ) {
      throw new Error("One or more uploaded attachments are invalid.");
    }

    const expectedPath = buildMediaAttachmentStoragePath({
      uploaderUid: input.actorUid,
      goalId: input.goalId,
      subtaskId: input.subtaskId,
      progressEventId: input.progressEventId,
      attachmentId: attachment.id,
      mimeType: attachment.mimeType,
    });
    if (attachment.storagePath !== expectedPath) {
      throw new Error("Attachment ownership could not be verified.");
    }
    return attachment;
  });
}

export function createSubtaskProgressEventId(
  goalId: string,
  subtaskId: string
): string {
  const safeGoalId = goalId.trim();
  const safeSubtaskId = subtaskId.trim();
  if (!safeGoalId || !safeSubtaskId) {
    throw new Error("Progress event IDs require a goal and subtask.");
  }
  return doc(
    collection(
      db,
      "goals",
      safeGoalId,
      "subtasks",
      safeSubtaskId,
      "progressEvents"
    )
  ).id;
}

export async function recordSubtaskProgressTx(
  input: RecordSubtaskProgressInput
): Promise<RecordSubtaskProgressResult> {
  const goalId = input.goalId.trim();
  const subtaskId = input.subtaskId.trim();
  const dayKey = input.dayKey.trim();
  const userId = input.actorUid.trim();
  const requestedAction = input.action ?? "toggle";
  const normalizedComment = normalizeProgressEventComment(input.comment);

  if (!goalId || !subtaskId || !dayKey || !userId) {
    throw new Error("Progress update is missing required identifiers.");
  }

  if (
    input.delta != null &&
    (!Number.isFinite(input.delta) ||
      input.delta <= 0 ||
      !Number.isInteger(input.delta))
  ) {
    throw new Error("Enter a positive whole-number progress amount.");
  }

  const suppliedProgressEventId = input.progressEventId?.trim() ?? "";
  if (suppliedProgressEventId.includes("/")) {
    throw new Error("Progress event ID is invalid.");
  }
  const progressEventId =
    suppliedProgressEventId ||
    createSubtaskProgressEventId(goalId, subtaskId);
  const progressAttachments = validateProgressAttachments({
    attachments: input.attachments,
    actorUid: userId,
    goalId,
    subtaskId,
    progressEventId,
  });
  if (input.action === "undo" && progressAttachments.length > 0) {
    throw new Error("Undo actions cannot add attachments.");
  }

  const goalRef = doc(db, "goals", goalId);
  const subtaskRef = doc(db, "goals", goalId, "subtasks", subtaskId);
  const completionRef = doc(
    db,
    "goals",
    goalId,
    "subtasks",
    subtaskId,
    "completions",
    dayKey
  );
  const progressEventRef = doc(
    collection(db, "goals", goalId, "subtasks", subtaskId, "progressEvents"),
    progressEventId
  );

  return runTransaction(db, async (tx) => {
    const goalSnap = await tx.get(goalRef);
    const subtaskSnap = await tx.get(subtaskRef);
    const completionSnap = await tx.get(completionRef);

    if (!goalSnap.exists()) throw new Error("Goal not found");
    if (!subtaskSnap.exists()) throw new Error("Subtask not found");

    const goal = goalSnap.data() as any;
    const subtask = subtaskSnap.data() as any;

const isGoalOwner = goal.userId === userId;
const isAssignedToUser = subtask.assignedToUid === userId;

if (!isGoalOwner && !isAssignedToUser) {
  throw new Error("Not allowed");
}

    const frequency = (subtask.frequency ?? "once") as "once" | "daily" | "weekly";
    const completionMode = subtask.completionMode === "count" ? "count" : "binary";
    const targetCount =
      completionMode === "count" && isPositiveInteger(subtask.targetCount)
        ? subtask.targetCount
        : null;

    if (completionMode === "count" && targetCount == null) {
      throw new Error("Count-based subtasks require a valid target count.");
    }

    const completedEver =
      typeof subtask.firstCompletedAtMs === "number" && subtask.firstCompletedAtMs > 0;

    const contributes = subtask.contributesToMetric === true;

    const baseMetricValue = isPositiveFiniteNumber(subtask.metricValue)
      ? subtask.metricValue
      : null;

    const metricValue = isPositiveFiniteNumber(input.metricValueOverride)
      ? input.metricValueOverride
      : baseMetricValue;

    const existingCompletion = completionSnap.exists()
      ? (completionSnap.data() as any)
      : null;

    const existingCompletionCount = isPositiveInteger(existingCompletion?.completionCount)
      ? existingCompletion.completionCount
      : completionSnap.exists()
      ? 1
      : 0;

    const existingMetricContribution = getStoredMetricContribution(
      existingCompletion?.metricContributionValue ?? existingCompletion?.metricValue
    );

    const applyGoalMetricDelta = (rawDelta: number) => {
      const metricDelta = roundMetricValue(rawDelta);
      if (!contributes || metricValue == null || metricDelta === 0) return;

      const current =
        typeof goal.currentMetricValue === "number" ? goal.currentMetricValue : 0;

      const nextCurrent = roundMetricValue(Math.max(0, current + metricDelta));

      const target =
        typeof goal.metricTargetValue === "number" ? goal.metricTargetValue : null;

      const nextPct = computeProgress(nextCurrent, target);
      const shouldComplete = target != null && target > 0 && nextCurrent >= target;

tx.update(goalRef, {
  currentMetricValue: nextCurrent,
  progressPercentage: nextPct,
  status: shouldComplete
    ? "completed"
    : goal.status === "completed"
    ? "active"
    : goal.status,
  completedAtMs: shouldComplete ? goal.completedAtMs ?? Date.now() : null,
  lastProgressActorUid: userId,
  lastProgressSubtaskId: subtaskId,
  updatedAt: serverTimestamp(),
});
    };

    const wasCompletedForDayBinary = completionSnap.exists();

    const wasCompletedForDayCount =
      completionMode === "count" &&
      targetCount != null &&
      existingCompletionCount >= targetCount;

    const resolvedAction =
      requestedAction === "toggle"
        ? completionMode === "count"
          ? "increment"
          : wasCompletedForDayBinary
          ? "undo"
          : "complete"
        : requestedAction;

    if (completionMode === "count" && resolvedAction !== "increment") {
      throw new Error("Count progress only supports positive increments.");
    }

    if (
      completionMode === "binary" &&
      resolvedAction !== "complete" &&
      resolvedAction !== "undo"
    ) {
      throw new Error("This progress action is not valid for a binary subtask.");
    }

    const nowMs = Date.now();
    const writeProgressEvent = (event: {
      kind: Exclude<SubtaskProgressEventKind, "unknown">;
      delta?: number;
      previousValue: number;
      resultingValue: number;
      targetValue: number;
      completed: boolean;
      metricSnapshot?: {
        before: number;
        after: number;
        target: number;
        delta: number;
        unit: string | null;
      };
    }) => {
      tx.set(progressEventRef, {
        goalId,
        subtaskId,
        kind: event.kind,
        authorUid: userId,
        authorName: nullableString(input.actorName),
        authorEmail: nullableString(input.actorEmail),
        dayKey,
        ...(event.delta == null ? {} : { delta: event.delta }),
        previousValue: event.previousValue,
        resultingValue: event.resultingValue,
        targetValue: event.targetValue,
        unit: null,
        completed: event.completed,
        ...(event.metricSnapshot
          ? {
              metricContributionBefore: event.metricSnapshot.before,
              metricContributionAfter: event.metricSnapshot.after,
              metricContributionDelta: event.metricSnapshot.delta,
              metricContributionTarget: event.metricSnapshot.target,
              metricUnitSnapshot: event.metricSnapshot.unit,
            }
          : {}),
        ...(normalizedComment == null ? {} : { comment: normalizedComment }),
        attachments: progressAttachments,
        reverted: false,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    };

    if (completionMode === "binary") {
      const nextCompletedForDay = resolvedAction === "complete";

      if (nextCompletedForDay === wasCompletedForDayBinary) {
        return {
          changed: false,
          action: "none",
          eventId: null,
          appliedDelta: 0,
          previousValue: wasCompletedForDayBinary ? 1 : 0,
          resultingValue: wasCompletedForDayBinary ? 1 : 0,
          targetValue: 1,
          completed: wasCompletedForDayBinary,
        };
      }

      if (frequency === "once" && nextCompletedForDay && completedEver) {
        throw new Error("This 'once' subtask is already completed.");
      }

      const nextMetricContribution =
        nextCompletedForDay && contributes && metricValue != null
          ? metricValue
          : 0;

      if (nextCompletedForDay) {
        tx.set(completionRef, {
          userId,
          goalId,
          subtaskId,
          dayKey,
          completedAtMs: nowMs,
          completionCount: 1,
          latestProgressEventId: progressEventRef.id,
          metricValue: nextMetricContribution || null,
          metricContributionValue: nextMetricContribution || null,
          metricContributionUnit: subtask.metricUnit ?? null,
          metricContributionAppliedAtMs: nextMetricContribution ? Date.now() : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (frequency === "once") {
          tx.update(subtaskRef, {
            firstCompletedAtMs: nowMs,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(subtaskRef, { updatedAt: serverTimestamp() });
        }

        writeProgressEvent({
          kind: "completion",
          previousValue: 0,
          resultingValue: 1,
          targetValue: 1,
          completed: true,
          ...(contributes && metricValue != null
            ? {
                metricSnapshot: {
                  before: existingMetricContribution,
                  after: nextMetricContribution,
                  target: metricValue,
                  delta: roundMetricValue(
                    nextMetricContribution - existingMetricContribution
                  ),
                  unit: nullableString(subtask.metricUnit)?.slice(0, 64) ?? null,
                },
              }
            : {}),
        });
      } else {
        const linkedEventId = nullableString(
          existingCompletion?.latestProgressEventId
        );
        const linkedEventRef = linkedEventId
          ? doc(
              db,
              "goals",
              goalId,
              "subtasks",
              subtaskId,
              "progressEvents",
              linkedEventId
            )
          : null;
        const linkedEventSnap = linkedEventRef
          ? await tx.get(linkedEventRef)
          : null;

        tx.delete(completionRef);
        if (frequency === "once") {
          tx.update(subtaskRef, {
            firstCompletedAtMs: null,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(subtaskRef, { updatedAt: serverTimestamp() });
        }

        if (
          linkedEventRef &&
          linkedEventSnap?.exists() &&
          linkedEventSnap.data().goalId === goalId &&
          linkedEventSnap.data().subtaskId === subtaskId &&
          linkedEventSnap.data().dayKey === dayKey &&
          linkedEventSnap.data().reverted !== true
        ) {
          tx.update(linkedEventRef, {
            reverted: true,
            revertedAtMs: nowMs,
            revertedByUid: userId,
            updatedAtMs: nowMs,
          });
        }
      }

      applyGoalMetricDelta(nextMetricContribution - existingMetricContribution);
      return {
        changed: true,
        action: nextCompletedForDay ? "complete" : "undo",
        eventId: nextCompletedForDay ? progressEventRef.id : null,
        appliedDelta: nextCompletedForDay ? 1 : -1,
        previousValue: nextCompletedForDay ? 0 : 1,
        resultingValue: nextCompletedForDay ? 1 : 0,
        targetValue: 1,
        completed: nextCompletedForDay,
      };
    }

    if (frequency === "once") {
      if (completedEver && !completionSnap.exists()) {
        throw new Error("This 'once' subtask is already completed.");
      }
    }

    if (wasCompletedForDayCount) {
      return {
        changed: false,
        action: "none",
        eventId: null,
        appliedDelta: 0,
        previousValue: existingCompletionCount,
        resultingValue: existingCompletionCount,
        targetValue: targetCount ?? 0,
        completed: true,
      };
    }

    const requestedDelta = input.delta ?? 1;
    const nextCount = clampCount(
      existingCompletionCount + requestedDelta,
      targetCount ?? 1
    );
    const appliedDelta = nextCount - existingCompletionCount;
    if (appliedDelta <= 0) {
      return {
        changed: false,
        action: "none",
        eventId: null,
        appliedDelta: 0,
        previousValue: existingCompletionCount,
        resultingValue: existingCompletionCount,
        targetValue: targetCount ?? 0,
        completed: wasCompletedForDayCount,
      };
    }
    const nextCompletedForDayCount = nextCount >= (targetCount ?? 1);

    const nextMetricContribution =
      contributes && metricValue != null && targetCount != null
        ? roundMetricValue((metricValue * nextCount) / targetCount)
        : 0;

    tx.set(
      completionRef,
      {
        userId,
        goalId,
        subtaskId,
        dayKey,
        completedAtMs: nextCompletedForDayCount ? Date.now() : null,
        completionCount: nextCount,
        latestProgressEventId: progressEventRef.id,
        metricValue: nextMetricContribution || null,
        metricContributionValue: nextMetricContribution || null,
        metricContributionUnit: subtask.metricUnit ?? null,
        metricContributionAppliedAtMs: nextMetricContribution ? Date.now() : null,
        createdAt: completionSnap.exists()
          ? existingCompletion?.createdAt ?? serverTimestamp()
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(subtaskRef, {
      ...(frequency === "once"
        ? {
            firstCompletedAtMs: nextCompletedForDayCount
              ? subtask.firstCompletedAtMs ?? nowMs
              : subtask.firstCompletedAtMs ?? null,
          }
        : {}),
      updatedAt: serverTimestamp(),
    });
    applyGoalMetricDelta(nextMetricContribution - existingMetricContribution);
    writeProgressEvent({
      kind: "increment",
      delta: appliedDelta,
      previousValue: existingCompletionCount,
      resultingValue: nextCount,
      targetValue: targetCount ?? 1,
      completed: nextCompletedForDayCount,
      ...(contributes && metricValue != null
        ? {
            metricSnapshot: {
              before: existingMetricContribution,
              after: nextMetricContribution,
              target: metricValue,
              delta: roundMetricValue(
                nextMetricContribution - existingMetricContribution
              ),
              unit: nullableString(subtask.metricUnit)?.slice(0, 64) ?? null,
            },
          }
        : {}),
    });

    return {
      changed: true,
      action: "increment",
      eventId: progressEventRef.id,
      appliedDelta,
      previousValue: existingCompletionCount,
      resultingValue: nextCount,
      targetValue: targetCount ?? 1,
      completed: nextCompletedForDayCount,
    };
  });
}

export async function toggleSubtaskCompletedTx(
  goalId: string,
  subtaskId: string,
  dayKey: string,
  userId: string,
  metricValueOverride?: number | null
) {
  return recordSubtaskProgressTx({
    goalId,
    subtaskId,
    dayKey,
    actorUid: userId,
    action: "toggle",
    metricValueOverride,
  });
}

/**
 * ✅ Delete subtask AND ALL completion docs under it, AND roll back goal metric
 * based on the completion docs' metricValue sum.
 *
 * This is not a transaction because we must query the completions subcollection.
 * But we do it in a single batch commit for consistency.
 */
export async function deleteSubtaskAndCompletions(goalId: string, subtaskId: string) {
  const goalRef = doc(db, "goals", goalId);
  const subtaskRef = doc(db, "goals", goalId, "subtasks", subtaskId);
  const completionsCol = collection(
    db,
    "goals",
    goalId,
    "subtasks",
    subtaskId,
    "completions"
  );

  // Load goal + subtask + all completion docs
  const [goalSnap, subtaskSnap, completionsSnap] = await Promise.all([
    getDoc(goalRef),
    getDoc(subtaskRef),
    getDocs(completionsCol),
  ]);

  if (!goalSnap.exists()) throw new Error("Goal not found");
  if (!subtaskSnap.exists()) return; // already gone

  const goal = goalSnap.data() as any;
  const subtask = subtaskSnap.data() as any;

  const contributes = subtask.contributesToMetric === true;

  // Sum metricValue from completion docs (only if contributes)
  let sum = 0;
  if (contributes) {
    completionsSnap.forEach((d) => {
      const data = d.data() as any;
      const mv = data?.metricContributionValue ?? data?.metricValue;
if (typeof mv === "number" && Number.isFinite(mv)) sum += mv;
    });
  }

  const current =
    typeof goal.currentMetricValue === "number" ? goal.currentMetricValue : 0;

  const nextCurrent = Math.max(0, current - sum);

  const target = typeof goal.metricTargetValue === "number" ? goal.metricTargetValue : null;
  const nextPct = computeProgress(nextCurrent, target);

  const shouldComplete = target != null && target > 0 && nextCurrent >= target;

  const batch = writeBatch(db);

  // Delete all completion docs
  completionsSnap.forEach((d) => batch.delete(d.ref));

  // Delete the subtask doc
  batch.delete(subtaskRef);

  // Update goal if needed
  if (contributes && sum !== 0) {
    batch.update(goalRef, {
      currentMetricValue: nextCurrent,
      progressPercentage: nextPct,
      status: shouldComplete ? "completed" : goal.status === "completed" ? "active" : goal.status,
      completedAtMs: shouldComplete ? goal.completedAtMs ?? Date.now() : null,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Legacy delete (does NOT delete completion docs reliably).
 * Keep only if some old screen still calls it.
 *
 * I'd recommend updating callers to deleteSubtaskAndCompletions().
 */
export async function deleteSubtaskTx(goalId: string, subtaskId: string) {
  const subtaskRef = doc(db, "goals", goalId, "subtasks", subtaskId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(subtaskRef);
    if (!snap.exists()) return;
    tx.delete(subtaskRef);
  });
}

export async function applySubtaskMetricProgressTx(
  goalId: string,
  subtaskId: string,
  userId: string,
  metricValueDelta: number,
  options?: {
    /**
     * When set, the progress is recorded as auto-applied from this calendar
     * event and the transaction becomes idempotent for it: a second call with
     * the same event id is a no-op. Required for any automatic caller, since
     * nothing else on the subtask records that an event was already counted.
     */
    autoAppliedEventId?: string;
  }
): Promise<{ applied: boolean }> {
  
  if (!Number.isFinite(metricValueDelta) || metricValueDelta <= 0) {
    throw new Error("Metric value must be greater than 0.");
  }

  const goalRef = doc(db, "goals", goalId);
  const subtaskRef = doc(db, "goals", goalId, "subtasks", subtaskId);
  const autoAppliedEventId = options?.autoAppliedEventId ?? null;

  let applied = false;

  await runTransaction(db, async (tx) => {
    const goalSnap = await tx.get(goalRef);
    const subtaskSnap = await tx.get(subtaskRef);

    if (!goalSnap.exists()) throw new Error("Goal not found");
    if (!subtaskSnap.exists()) throw new Error("Subtask not found");

    const goal = goalSnap.data() as any;
    const subtask = subtaskSnap.data() as any;

    if (autoAppliedEventId) {
      const alreadyApplied: string[] = Array.isArray(
        subtask.autoAppliedDurationEventIds
      )
        ? subtask.autoAppliedDurationEventIds
        : [];

      if (alreadyApplied.includes(autoAppliedEventId)) {
        applied = false;
        return;
      }
    }

const isGoalOwner = goal.userId === userId;
const isAssignedToUser = subtask.assignedToUid === userId;

if (!isGoalOwner && !isAssignedToUser) {
  throw new Error("Not allowed");
}

    if (subtask.contributesToMetric !== true) {
      throw new Error("This subtask does not contribute to goal progress.");
    }

    const current =
      typeof goal.currentMetricValue === "number" ? goal.currentMetricValue : 0;

    const nextCurrent = Math.max(0, current + metricValueDelta);

    const target =
      typeof goal.metricTargetValue === "number" ? goal.metricTargetValue : null;

    const nextPct = computeProgress(nextCurrent, target);

    const shouldComplete = target != null && target > 0 && nextCurrent >= target;

tx.update(goalRef, {
  currentMetricValue: nextCurrent,
  progressPercentage: nextPct,
  status: shouldComplete
    ? "completed"
    : goal.status === "completed"
    ? "active"
    : goal.status,
  completedAtMs: shouldComplete ? Date.now() : null,
  lastProgressActorUid: userId,
  lastProgressSubtaskId: subtaskId,
  updatedAt: serverTimestamp(),
});

    // Rules enforce this marker list as append-only for assigned non-owners
    // (at most one new id per write), so keep this a single arrayUnion.
    tx.update(subtaskRef, {
      updatedAt: serverTimestamp(),
      ...(autoAppliedEventId
        ? { autoAppliedDurationEventIds: arrayUnion(autoAppliedEventId) }
        : {}),
    });

    applied = true;
  });

  return { applied };
}

/**
 * Moves a subtask's due time to `eventStartMs`. One-time subtasks get their
 * schedule patched directly; recurring ones get a per-day override.
 *
 * Returns the override written (keyed for a `scheduleOverridesByKey` map) so
 * the caller can merge it into local state, or null for the one-time path.
 */
export async function applyEventTimeToSubtask(args: {
  userId: string;
  tz: string;
  goalId: string;
  subtaskId: string;
  baseSubtask: any;
  eventStartMs: number;
  source?: "suggestedTime" | "snooze";
}): Promise<{ key: string; record: ScheduleOverrideRecord } | null> {
  const { userId, tz, goalId, subtaskId, baseSubtask, eventStartMs } = args;
  const source = args.source ?? "suggestedTime";

  const targetDayKey = dayKeyFromDate(new Date(eventStartMs), tz);

  if (getScheduleType(baseSubtask) === "oneTime") {
    await updateDoc(
      doc(db, "goals", goalId, "subtasks", subtaskId),
      buildOneTimeSchedulePatch(targetDayKey, eventStartMs)
    );
    return null;
  }

  await setDoc(
    doc(db, "goals", goalId, "subtasks", subtaskId, "scheduleOverrides", targetDayKey),
    buildRecurringTimedOverride({
      userId,
      goalId,
      subtaskId,
      dayKey: targetDayKey,
      dueAtMs: eventStartMs,
      source,
    }),
    { merge: true }
  );

  return {
    key: getScheduleOverrideKey(subtaskId, targetDayKey),
    record: {
      dueAtMs: eventStartMs,
      isSkipped: false,
      isUnscheduled: false,
      source,
    },
  };
}
