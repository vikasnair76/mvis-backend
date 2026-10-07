export type GoalStatus = "active" | "paused" | "completed";

export type MetricType =
  | "none"
  | "hours"
  | "weight"
  | "pages"
  | "reps"
  | "custom";

export type WeightUnit = "lb" | "lbs" | "kg";

export type CalendarPushMode = "off" | "goal_only" | "subtasks";

export type CalendarReminderPreset = "none" | "10m" | "30m" | "60m";

export type GoalCalendarPushState = {
  mode: CalendarPushMode;
  reminderPreset: CalendarReminderPreset;
  lastSyncedAtMs?: number | null;
  pushedGoalEventId?: string | null;
  pushedGoalCalendarId?: string | null;
  exportBehavior?: "single" | "recurring";
  autoSync?: boolean;
};

export type Goal = {
  id: string;
  userId: string;
  title: string;
  description: string | null;

  metricType: MetricType;
  metricUnit: string | null;
  metricTargetValue: number | null;
  currentMetricValue: number | null;

  progressPercentage: number;
  status: GoalStatus;
    calendarPush?: GoalCalendarPushState | null;
  completedAtMs: number | null;
  

  createdAtMs: number;
  createdAt?: any;
  updatedAt?: any;

visibility?: "private" | "group_shared";
sharedGroupIds?: string[];

sharedGroupId?: string | null;
sharedGroupName?: string | null;
sharedAccessRole?: "owner" | "assigned_member" | null;
};

export type GoalFormInput = {
  title: string;
  description: string;
  metricType: MetricType;
  metricUnitInput: string;
  metricTargetValueInput: string;
};

export type NormalizedGoalInput = {
  title: string;
  description: string | null;

  metricType: MetricType;
  metricUnit: string | null;
  metricTargetValue: number | null;
  currentMetricValue: number | null;

  progressPercentage: number;
  status: GoalStatus;
  completedAtMs: number | null;
};

export type SubtaskScheduleType = "recurring" | "oneTime";
export type SubtaskFrequency = "once" | "daily" | "weekly";
export type SubtaskCompletionMode = "binary" | "count";

export type SubtaskReminderPreset =
  | "none"
  | "at_time"
  | "morning_of"
  | "day_before"
  | "custom";

export type SubtaskCalendarPushState = {
  pushedEventId?: string | null;
  pushedCalendarId?: string | null;
  lastSyncedAtMs?: number | null;
};

export type SubtaskNotificationState = {
  enabled?: boolean;
  reminderOffsetMinutes?: number;
  scheduledNotificationId?: string | null;
};

export type Subtask = {
  id: string;
  goalId: string;
  userId: string;

  title: string;
  description: string | null;

  scheduleType: SubtaskScheduleType;
  frequency: SubtaskFrequency;
  weeklyDay: number | null;
  scheduledDayKey: string | null;
  dueAtMs: number | null;

    reminderPreset?: SubtaskReminderPreset | null;
  reminderAtMs?: number | null;
  reminderCustomOffsetMinutes?: number | null;
  notificationId?: string | null;

  completionMode: SubtaskCompletionMode;
  targetCount: number | null;

  contributesToMetric: boolean;
  metricValue: number | null;
  metricUnit: string | null;

  firstCompletedAtMs: number | null;

  createdAtMs: number;
  createdAt?: any;
  updatedAt?: any;
    calendarPush?: SubtaskCalendarPushState | null;
    notifications?: SubtaskNotificationState | null;

    sharedCalendarPushByUid?: Record<
  string,
  {
    ownerUid: string | null;
source: "assigned_shared_subtask";
goalId: string | null;
subtaskId: string | null;
    pushedEventId: string | null;
    pushedCalendarId: string | null;
    lastSyncedAtMs: number | null;
    status: "linked" | "failed" | "removed";
  }
> | null;

    assignedToUid?: string | null;
assignedToName?: string | null;
assignedToEmail?: string | null;
assignedByUid?: string | null;
assignedAtMs?: number | null;
};

export type SubtaskFormInput = {
  title: string;
  description: string;

  scheduleType: SubtaskScheduleType;
  frequency: SubtaskFrequency;
  weeklyDay: number | null;
  scheduledDayKey: string | null;
  dueAtMs: number | null;

  completionMode: SubtaskCompletionMode;
  targetCountInput: string;

  contributesToMetric: boolean;
  metricValueInput: string;
};





