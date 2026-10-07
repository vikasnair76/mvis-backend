import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  PlanningPriority,
  PlanningStatus,
  normalizePlanningPriority,
  normalizePlanningStatus,
} from "./planning";

export type GoalMilestoneDoc = {
  id: string;
  goalId: string;
  title: string;
  description?: string | null;
  status: PlanningStatus;
  priority?: PlanningPriority | null;
  sortOrder: number;
  targetMetricValue?: number | null;
  currentMetricValue?: number | null;
  progressPercentage?: number | null;
  dueAtMs?: number | null;
  completedAtMs?: number | null;
  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
  archived?: boolean;
};

function requireNonEmptyString(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return trimmed;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  fieldLabel: string
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldLabel} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

function normalizeTitle(value: string): string {
  const title = requireNonEmptyString(value, "Milestone title");
  if (title.length > 160) {
    throw new Error("Milestone title must be 160 characters or fewer.");
  }
  return title;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalPriority(value: unknown): PlanningPriority | null {
  return value == null ? null : normalizePlanningPriority(value);
}

export function mapGoalMilestoneDoc(
  id: string,
  data: Record<string, any>
): GoalMilestoneDoc {
  const createdAtMs = numberOrFallback(data.createdAtMs, 0);
  const updatedAtMs = numberOrFallback(data.updatedAtMs, createdAtMs);

  return {
    id,
    goalId: typeof data.goalId === "string" ? data.goalId : "",
    title: typeof data.title === "string" ? data.title : "",
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description
        : null,
    status: normalizePlanningStatus(data.status),
    priority: normalizeOptionalPriority(data.priority),
    sortOrder: numberOrFallback(data.sortOrder, createdAtMs),
    targetMetricValue: numberOrNull(data.targetMetricValue),
    currentMetricValue: numberOrNull(data.currentMetricValue),
    progressPercentage: numberOrNull(data.progressPercentage),
    dueAtMs: numberOrNull(data.dueAtMs),
    completedAtMs: numberOrNull(data.completedAtMs),
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAtMs,
    updatedAtMs,
    archived: data.archived === true,
  };
}

export async function createGoalMilestone(params: {
  goalId: string;
  title: string;
  description?: string | null;
  createdByUid: string;
  priority?: PlanningPriority | null;
  dueAtMs?: number | null;
  targetMetricValue?: number | null;
}): Promise<string> {
  const goalId = requireNonEmptyString(params.goalId, "Goal ID");
  const title = normalizeTitle(params.title);
  const description = normalizeOptionalText(
    params.description,
    1000,
    "Milestone description"
  );
  const createdByUid = requireNonEmptyString(
    params.createdByUid,
    "Created by UID"
  );
  const nowMs = Date.now();
  const milestoneRef = doc(collection(db, "goals", goalId, "milestones"));

  await setDoc(milestoneRef, {
    id: milestoneRef.id,
    goalId,
    title,
    description,
    status: "active",
   priority: normalizeOptionalPriority(params.priority),
    sortOrder: nowMs,
    targetMetricValue: nullableFiniteNumber(params.targetMetricValue),
    currentMetricValue: null,
    progressPercentage: 0,
    dueAtMs: nullableFiniteNumber(params.dueAtMs),
    completedAtMs: null,
    createdByUid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return milestoneRef.id;
}

export async function updateGoalMilestone(params: {
  goalId: string;
  milestoneId: string;
  title?: string;
  description?: string | null;
  status?: PlanningStatus;
  priority?: PlanningPriority | null;
  sortOrder?: number;
  targetMetricValue?: number | null;
  currentMetricValue?: number | null;
  progressPercentage?: number | null;
  dueAtMs?: number | null;
}): Promise<void> {
  const goalId = requireNonEmptyString(params.goalId, "Goal ID");
  const milestoneId = requireNonEmptyString(
    params.milestoneId,
    "Milestone ID"
  );
  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };

  if (params.title !== undefined) {
    patch.title = normalizeTitle(params.title);
  }
  if (params.description !== undefined) {
    patch.description = normalizeOptionalText(
      params.description,
      1000,
      "Milestone description"
    );
  }
  if (params.status !== undefined) {
    patch.status = normalizePlanningStatus(params.status);
  }
  if (params.priority !== undefined) {
    patch.priority = normalizeOptionalPriority(params.priority);
  }
  if (params.sortOrder !== undefined) {
   patch.sortOrder = numberOrFallback(params.sortOrder, Date.now());
  }
  if (params.targetMetricValue !== undefined) {
   patch.targetMetricValue = nullableFiniteNumber(params.targetMetricValue);
  }
  if (params.currentMetricValue !== undefined) {
   patch.currentMetricValue = nullableFiniteNumber(params.currentMetricValue);
  }
  if (params.progressPercentage !== undefined) {
    patch.progressPercentage = nullableFiniteNumber(params.progressPercentage);
  }
  if (params.dueAtMs !== undefined) {
    patch.dueAtMs = nullableFiniteNumber(params.dueAtMs);
  }

  await updateDoc(doc(db, "goals", goalId, "milestones", milestoneId), patch);
}

export async function completeGoalMilestone(params: {
  goalId: string;
  milestoneId: string;
}): Promise<void> {
  const goalId = requireNonEmptyString(params.goalId, "Goal ID");
  const milestoneId = requireNonEmptyString(
    params.milestoneId,
    "Milestone ID"
  );
  const nowMs = Date.now();

  await updateDoc(doc(db, "goals", goalId, "milestones", milestoneId), {
    status: "completed",
    progressPercentage: 100,
    completedAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveGoalMilestone(params: {
  goalId: string;
  milestoneId: string;
}): Promise<void> {
  const goalId = requireNonEmptyString(params.goalId, "Goal ID");
  const milestoneId = requireNonEmptyString(
    params.milestoneId,
    "Milestone ID"
  );

  await updateDoc(doc(db, "goals", goalId, "milestones", milestoneId), {
    archived: true,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteGoalMilestone(params: {
  goalId: string;
  milestoneId: string;
}): Promise<void> {
  const goalId = requireNonEmptyString(params.goalId, "Goal ID");
  const milestoneId = requireNonEmptyString(
    params.milestoneId,
    "Milestone ID"
  );

  await deleteDoc(doc(db, "goals", goalId, "milestones", milestoneId));
}

export function subscribeGoalMilestones(
  goalId: string,
  onNext: (milestones: GoalMilestoneDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGoalId = goalId.trim();
  if (!safeGoalId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "goals", safeGoalId, "milestones"),
    orderBy("sortOrder", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const milestones = snap.docs
        .map((d) => mapGoalMilestoneDoc(d.id, d.data()))
        .filter((milestone) => milestone.archived !== true);
      onNext(milestones);
    },
    onError
  );
}
