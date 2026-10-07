import type { SubtaskReminderPreset } from "./goalTypes";

export type ReminderInput = {
  dueAtMs: number | null;
  preset: SubtaskReminderPreset | null | undefined;
  customOffsetMinutes?: number | null;
};

export function getReminderAtMs({
  dueAtMs,
  preset,
  customOffsetMinutes,
}: ReminderInput): number | null {
  if (typeof dueAtMs !== "number") return null;

  switch (preset ?? "none") {
    case "none":
      return null;

    case "at_time":
      return dueAtMs;

    case "morning_of":
      return getMorningOfReminderAtMs(dueAtMs);

    case "day_before":
      return getDayBeforeReminderAtMs(dueAtMs);

    case "custom": {
      const offset =
        typeof customOffsetMinutes === "number" && customOffsetMinutes > 0
          ? customOffsetMinutes
          : null;

      if (offset == null) return null;

      return dueAtMs - offset * 60 * 1000;
    }

    default:
      return null;
  }
}

export function getMorningOfReminderAtMs(dueAtMs: number): number {
  const due = new Date(dueAtMs);

  return new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
    9,
    0,
    0,
    0
  ).getTime();
}

export function getDayBeforeReminderAtMs(dueAtMs: number): number {
  const due = new Date(dueAtMs);

  return new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate() - 1,
    9,
    0,
    0,
    0
  ).getTime();
}

export function isReminderInFuture(reminderAtMs: number | null): boolean {
  return typeof reminderAtMs === "number" && reminderAtMs > Date.now();
}

export function buildReminderPatch(input: ReminderInput) {
  const reminderAtMs = getReminderAtMs(input);

  return {
    reminderPreset: input.preset ?? "none",
    reminderAtMs,
    reminderCustomOffsetMinutes:
      input.preset === "custom" ? input.customOffsetMinutes ?? null : null,
  };
}