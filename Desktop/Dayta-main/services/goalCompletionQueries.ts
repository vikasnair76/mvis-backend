import {
    collectionGroup,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import { db } from "./firebase";

export type GoalCompletionRecord = {
  id: string;
  goalId: string;
  userId: string;

  titleSnapshot: string;
  descriptionSnapshot: string | null;

  metricType: string | null;
  metricUnit: string | null;
  metricTargetValue: number | null;
  currentMetricValue: number | null;
  progressPercentage: number;

  completedAtMs: number;
  dayKey: string;

  createdAtMs: number;
};

export function subscribeGoalCompletionsForRange(
  uid: string,
  startDayKey: string,
  endDayKey: string,
  onData: (rows: GoalCompletionRecord[]) => void,
  onError?: (err: any) => void
) {
  const qy = query(
    collectionGroup(db, "goalCompletions"),
    where("userId", "==", uid),
    where("dayKey", ">=", startDayKey),
    where("dayKey", "<=", endDayKey),
    orderBy("dayKey")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const rows: GoalCompletionRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<GoalCompletionRecord, "id">),
      }));
      onData(rows);
    },
    onError
  );
}

export async function getGoalCompletionsForDay(
  uid: string,
  dayKey: string
): Promise<GoalCompletionRecord[]> {
  const qy = query(
    collectionGroup(db, "goalCompletions"),
    where("userId", "==", uid),
    where("dayKey", "==", dayKey)
  );

  const snap = await getDocs(qy);

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<GoalCompletionRecord, "id">),
  }));
}