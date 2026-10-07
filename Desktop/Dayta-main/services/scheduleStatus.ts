export type ScheduleStatusSource =
  | "override"
  | "suggested"
  | "default"
  | "none";

export type DailyScheduleStatus =
  | {
      kind: "skipped";
      dueAtMs: null;
      source: "override";
      isSkipped: true;
      isUnscheduled: false;
    }
  | {
      kind: "unscheduled";
      dueAtMs: null;
      source: "override";
      isSkipped: false;
      isUnscheduled: true;
    }
  | {
      kind: "scheduled";
      dueAtMs: number;
      source: ScheduleStatusSource;
      isSkipped: false;
      isUnscheduled: false;
    }
  | {
      kind: "none";
      dueAtMs: null;
      source: "none";
      isSkipped: false;
      isUnscheduled: false;
    };

type OverrideLike = {
  dueAtMs?: number | null;
  skipped?: boolean;
  unscheduled?: boolean;
  isSkipped?: boolean;
  isUnscheduled?: boolean;
};

type Args = {
  baseDueAtMs?: number | null;
  override?: OverrideLike | null;
  suggestedDueAtMs?: number | null;
};

export function getDailyScheduleStatus({
  baseDueAtMs,
  override,
  suggestedDueAtMs,
}: Args): DailyScheduleStatus {
  const skipped = !!(override?.skipped || override?.isSkipped);
  const unscheduled = !!(override?.unscheduled || override?.isUnscheduled);

  if (skipped) {
    return {
      kind: "skipped",
      dueAtMs: null,
      source: "override",
      isSkipped: true,
      isUnscheduled: false,
    };
  }

  if (unscheduled) {
    return {
      kind: "unscheduled",
      dueAtMs: null,
      source: "override",
      isSkipped: false,
      isUnscheduled: true,
    };
  }

  if (typeof override?.dueAtMs === "number") {
    return {
      kind: "scheduled",
      dueAtMs: override.dueAtMs,
      source: "override",
      isSkipped: false,
      isUnscheduled: false,
    };
  }

  if (typeof suggestedDueAtMs === "number") {
    return {
      kind: "scheduled",
      dueAtMs: suggestedDueAtMs,
      source: "suggested",
      isSkipped: false,
      isUnscheduled: false,
    };
  }

  if (typeof baseDueAtMs === "number") {
    return {
      kind: "scheduled",
      dueAtMs: baseDueAtMs,
      source: "default",
      isSkipped: false,
      isUnscheduled: false,
    };
  }

  return {
    kind: "none",
    dueAtMs: null,
    source: "none",
    isSkipped: false,
    isUnscheduled: false,
  };
}