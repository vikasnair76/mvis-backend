import {
    Goal,
    GoalFormInput,
    GoalStatus,
    MetricType,
    NormalizedGoalInput,
    Subtask,
    SubtaskFormInput,
} from "./goalTypes";

function computeProgress(current: number | null, target: number | null): number {
  if (target == null || target <= 0) return 0;
  const safeCurrent = current ?? 0;
  const pct = (safeCurrent / target) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function parseOptionalPositiveNumber(
  raw: string,
  fieldLabel: string
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldLabel} must be a number greater than 0.`);
  }

  return n;
}

function parseOptionalPositiveInteger(
  raw: string,
  fieldLabel: string
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${fieldLabel} must be a whole number greater than 0.`);
  }

  return n;
}

function normalizeGoalMetricUnit(
  metricType: MetricType,
  metricUnitInput: string
): string | null {
  switch (metricType) {
    case "none":
      return null;
    case "hours":
      return "hours";
    case "pages":
      return "pages";
    case "reps":
      return "reps";
    case "weight": {
      const trimmed = metricUnitInput.trim().toLowerCase();
      if (!trimmed) return "lbs";
      if (trimmed === "lb" || trimmed === "lbs" || trimmed === "kg") {
        return trimmed;
      }
      throw new Error('Weight unit must be "lb", "lbs", or "kg".');
    }
    case "custom": {
      const trimmed = metricUnitInput.trim();
      return trimmed ? trimmed : null;
    }
    default:
      return null;
  }
}

export function normalizeGoalInput(input: GoalFormInput): NormalizedGoalInput {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Please enter a goal title.");
  }

  const description = input.description.trim() || null;
  const metricType = input.metricType ?? "none";

  const metricUnit = normalizeGoalMetricUnit(metricType, input.metricUnitInput);

  const metricTargetValue =
    metricType === "none"
      ? null
      : parseOptionalPositiveNumber(input.metricTargetValueInput, "Metric target");

  const currentMetricValue = metricType === "none" ? null : 0;

  const progressPercentage = computeProgress(currentMetricValue, metricTargetValue);

  const shouldComplete =
    metricTargetValue != null &&
    metricTargetValue > 0 &&
    (currentMetricValue ?? 0) >= metricTargetValue;

  const status: GoalStatus = shouldComplete ? "completed" : "active";

  return {
    title,
    description,
    metricType,
    metricUnit,
    metricTargetValue,
    currentMetricValue,
    progressPercentage,
    status,
    completedAtMs: shouldComplete ? Date.now() : null,
  };
}

export function normalizeSubtaskInput(
  input: SubtaskFormInput,
  goal: Pick<Goal, "id" | "userId" | "metricType" | "metricUnit">
): Omit<
  Subtask,
  "id" | "createdAtMs" | "createdAt" | "updatedAt" | "firstCompletedAtMs"
> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Please enter a subtask title.");
  }

  const description = input.description.trim() || null;

  const scheduleType = input.scheduleType;
  const frequency =
    scheduleType === "oneTime" ? "once" : input.frequency;

  const weeklyDay =
    scheduleType === "recurring" && frequency === "weekly"
      ? input.weeklyDay
      : null;

  if (scheduleType === "recurring" && frequency === "weekly") {
    if (weeklyDay == null || weeklyDay < 0 || weeklyDay > 6) {
      throw new Error("Weekly subtasks require a valid weekday.");
    }
  }

 const scheduledDayKey =
  scheduleType === "oneTime"
    ? (input.scheduledDayKey?.trim() || null)
    : null;

  if (scheduleType === "oneTime" && !scheduledDayKey) {
    throw new Error("One-time subtasks require a scheduled date.");
  }

  const completionMode = input.completionMode;

  const targetCount =
    completionMode === "count"
      ? parseOptionalPositiveInteger(input.targetCountInput, "Target count")
      : null;

  if (completionMode === "count" && targetCount == null) {
    throw new Error("Count-based subtasks require a target count.");
  }

  const contributesToMetric =
    goal.metricType !== "none" && input.contributesToMetric === true;

  const metricValue = contributesToMetric
    ? parseOptionalPositiveNumber(input.metricValueInput, "Metric value")
    : null;

  if (contributesToMetric && metricValue == null) {
    throw new Error("Please enter a metric value greater than 0.");
  }

  return {
    goalId: goal.id,
    userId: goal.userId,

    title,
    description,

    scheduleType,
    frequency,
    weeklyDay,
    scheduledDayKey,
    dueAtMs: input.dueAtMs ?? null,

    completionMode,
    targetCount,

    contributesToMetric,
    metricValue,
    metricUnit: contributesToMetric ? goal.metricUnit ?? null : null,
  };
}