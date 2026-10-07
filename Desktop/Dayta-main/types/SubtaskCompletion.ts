export type SubtaskCompletion = {
  goalId: string;
  subtaskId: string;
  dayKey: string;        // "YYYY-MM-DD"
  completedAtMs: number; // Date.now()
  metricValue: number;
  createdAt: any;        // serverTimestamp()
};