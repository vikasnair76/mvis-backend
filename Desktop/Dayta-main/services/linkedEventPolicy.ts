export type LinkedEventPolicyReason =
  | "no_change"
  | "missing_times"
  | "skipped"
  | "unscheduled"
  | "manual_schedule_change"
  | "still_following_old_event_time";

export type LinkedEventPolicyDecision =
  | "metadata_only"
  | "auto_propagate";

export type LinkedEventPolicyResult = {
  decision: LinkedEventPolicyDecision;
  reason: LinkedEventPolicyReason;
  effectiveDueAtMs: number | null;
  isStillFollowingOldEventTime: boolean;
};

export type ScheduleOverrideLike = {
  dueAtMs?: number | null;
  isSkipped?: boolean;
  isUnscheduled?: boolean;
  source?: string | null;
} | null;

export function getLinkedEventPolicyDecision(args: {
  previousHandledStartMs: number | null;
  currentEventStartMs: number | null;
  override: ScheduleOverrideLike;
  subtaskDueAtMs: number | null;
}): LinkedEventPolicyResult {
  const {
    previousHandledStartMs,
    currentEventStartMs,
    override,
    subtaskDueAtMs,
  } = args;

  if (
    previousHandledStartMs === null ||
    currentEventStartMs === null
  ) {
    return {
      decision: "metadata_only",
      reason: "missing_times",
      effectiveDueAtMs: subtaskDueAtMs,
      isStillFollowingOldEventTime: false,
    };
  }

  if (previousHandledStartMs === currentEventStartMs) {
    return {
      decision: "metadata_only",
      reason: "no_change",
      effectiveDueAtMs: subtaskDueAtMs,
      isStillFollowingOldEventTime: false,
    };
  }

  const effectiveDueAtMs =
    typeof override?.dueAtMs === "number"
      ? override.dueAtMs
      : subtaskDueAtMs;

  const isStillFollowingOldEventTime =
    effectiveDueAtMs === previousHandledStartMs;

  if (override?.isSkipped) {
    return {
      decision: "metadata_only",
      reason: "skipped",
      effectiveDueAtMs,
      isStillFollowingOldEventTime,
    };
  }

  if (override?.isUnscheduled) {
    return {
      decision: "metadata_only",
      reason: "unscheduled",
      effectiveDueAtMs,
      isStillFollowingOldEventTime,
    };
  }

  if (!isStillFollowingOldEventTime) {
    return {
      decision: "metadata_only",
      reason: "manual_schedule_change",
      effectiveDueAtMs,
      isStillFollowingOldEventTime,
    };
  }

  return {
    decision: "auto_propagate",
    reason: "still_following_old_event_time",
    effectiveDueAtMs,
    isStillFollowingOldEventTime,
  };
}