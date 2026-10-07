// services/completionsHeatmap.ts
import {
    collectionGroup,
    getDocs,
    orderBy,
    query,
    QueryConstraint,
    where,
} from "firebase/firestore";
import { db } from "./firebase";

export type DayAgg = {
  count: number;
  metricSum: number;
};

export type HeatmapByDayKey = Record<string, DayAgg>;

export async function fetchCompletionsHeatmapByDayKey(params: {
  userId: string;
  startDayKeyInclusive: string;
  endDayKeyInclusive: string;
  goalId?: string;
}): Promise<HeatmapByDayKey> {
  const { userId, startDayKeyInclusive, endDayKeyInclusive, goalId } = params;

  const constraints: QueryConstraint[] = [
    where("userId", "==", userId),
    where("dayKey", ">=", startDayKeyInclusive),
    where("dayKey", "<=", endDayKeyInclusive),
  ];

  if (goalId) constraints.push(where("goalId", "==", goalId));

  // ✅ orderBy goes here (last is fine)
  const qy = query(
    collectionGroup(db, "completions"),
    ...constraints,
    orderBy("dayKey")
  );

  const snap = await getDocs(qy);

  const heat: HeatmapByDayKey = {};

  snap.forEach((docSnap) => {
    const data = docSnap.data() as any;
    const dayKey = String(data.dayKey ?? "");
    if (!dayKey) return;

    const mv = data?.metricValue;
    const metricValue = typeof mv === "number" && Number.isFinite(mv) ? mv : 0;

    if (!heat[dayKey]) heat[dayKey] = { count: 0, metricSum: 0 };

    heat[dayKey].count += 1;
    heat[dayKey].metricSum += metricValue;
  });

  return heat;
}