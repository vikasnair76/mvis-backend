import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { dayKeyFromMs, getUserTz } from "./dateKey";
import { db } from "./firebase";

//export type GoalMetricType = "hours" | "weight" | "pages" | "reps" | "custom" | null;
export type GoalMetricType = string | null;
export type GoalCompletionSnapshotInput = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  metricType: GoalMetricType;
  metricUnit: string | null;
  metricTargetValue: number | null;
  currentMetricValue: number | null;
  progressPercentage: number;
};

export async function writeGoalCompletion(
  goal: GoalCompletionSnapshotInput,
  completedAtMs: number
) {
  const tz = getUserTz();
  const dayKey = dayKeyFromMs(completedAtMs, tz);
  const completionId = `${goal.id}_${completedAtMs}`;

  const ref = doc(db, "goals", goal.id, "goalCompletions", completionId);

  await setDoc(ref, {
    goalId: goal.id,
    userId: goal.userId,

    titleSnapshot: goal.title,
    descriptionSnapshot: goal.description ?? null,

    metricType: goal.metricType ?? null,
    metricUnit: goal.metricUnit ?? null,
    metricTargetValue: goal.metricTargetValue ?? null,
    currentMetricValue: goal.currentMetricValue ?? null,
    progressPercentage: goal.progressPercentage ?? 0,

    completedAtMs,
    dayKey,

    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });
}