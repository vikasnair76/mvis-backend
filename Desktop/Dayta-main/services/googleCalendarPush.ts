import type { Goal, Subtask } from "./goalTypes";
import { connectGoogleCalendar } from "./googleCalendarAuth";

/**
 * 6C outbound calendar export helpers.
 *
 * Firestore field names still use "calendarPush" / "pushed..."
 * for backward compatibility with existing goal and subtask docs.
 *
 * User-facing UI should say "Calendar Export" / "exported".
 */



const GOOGLE_CALENDAR_EVENTS_BASE =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type GoalPushResult = {
  eventId: string;
  calendarId: string;
  htmlLink?: string | null;
};

function buildReminderOverrides(
  preset: "none" | "10m" | "30m" | "60m" | undefined
) {
  if (!preset || preset === "none") {
    return {
      useDefault: false,
      overrides: [],
    };
  }

  const minutes =
    preset === "10m" ? 10 :
    preset === "30m" ? 30 :
    preset === "60m" ? 60 :
    null;

  if (minutes == null) {
    return {
      useDefault: false,
      overrides: [],
    };
  }

  return {
    useDefault: false,
    overrides: [
      {
        method: "popup",
        minutes,
      },
    ],
  };
}

function formatLocalDateForAllDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

function formatReminderPresetForExport(
  preset: "none" | "10m" | "30m" | "60m" | undefined
): string {
  if (!preset || preset === "none") return "None";
  if (preset === "10m") return "10 minutes before";
  if (preset === "30m") return "30 minutes before";
  if (preset === "60m") return "60 minutes before";
  return "None";
}

function formatSubtaskScheduleForExport(subtask: Subtask): string {
  if (subtask.scheduleType === "oneTime" || subtask.frequency === "once") {
    return "One-time";
  }

  if (subtask.frequency === "daily") {
    return "Daily";
  }

  if (subtask.frequency === "weekly") {
    return "Weekly";
  }

  return subtask.frequency ?? "Unknown";
}

function formatMetricContributionForExport(subtask: Subtask): string | null {
  if (!subtask.contributesToMetric || typeof subtask.metricValue !== "number") {
    return null;
  }

  return `+${subtask.metricValue}${subtask.metricUnit ? ` ${subtask.metricUnit}` : ""}`;
}

function buildGoalEventDescription(goal: Goal, subtasks: Subtask[]): string {
  const lines: string[] = [];

  if (goal.description?.trim()) {
    lines.push(goal.description.trim());
    lines.push("");
  }

  lines.push("—");
  lines.push("Created by GoalApp");
  lines.push("Export type: Goal");
  lines.push(`Goal: ${goal.title}`);
  lines.push(`Reminder: ${formatReminderPresetForExport(goal.calendarPush?.reminderPreset)}`);

  if (goal.metricType && goal.metricType !== "none") {
    lines.push(
      `Metric: ${goal.currentMetricValue ?? 0}/${goal.metricTargetValue ?? "?"}${
        goal.metricUnit ? ` ${goal.metricUnit}` : ""
      }`
    );
  }

  if (subtasks.length > 0) {
    lines.push("");
    lines.push(`Subtasks (${subtasks.length}):`);
    subtasks.forEach((s) => {
      lines.push(`- ${s.title}`);
    });
  }

  return lines.join("\n").trim();
}

function buildSubtaskEventDescription(goal: Goal, subtask: Subtask): string {
  const lines: string[] = [];

  if (subtask.description?.trim()) {
    lines.push(subtask.description.trim());
    lines.push("");
  }

  lines.push("—");
  lines.push("Created by GoalApp");
  lines.push("Export type: Subtask");
  lines.push(`Goal: ${goal.title}`);
  lines.push(`Subtask: ${subtask.title}`);
  lines.push(`Schedule: ${formatSubtaskScheduleForExport(subtask)}`);
  lines.push(`Reminder: ${formatReminderPresetForExport(goal.calendarPush?.reminderPreset)}`);

  const metricContribution = formatMetricContributionForExport(subtask);
  if (metricContribution) {
    lines.push(`Metric contribution: ${metricContribution}`);
  }

  return lines.join("\n").trim();
}

function pickGoalOnlyEventWindow(goal: Goal, subtasks: Subtask[]) {
  const anchorSubtask = [...subtasks]
    .filter(
      (s) =>
        typeof s.dueAtMs === "number" ||
        (typeof s.scheduledDayKey === "string" && s.scheduledDayKey.trim())
    )
    .sort((a, b) => {
      const aMs =
        typeof a.dueAtMs === "number"
          ? a.dueAtMs
          : Date.parse(`${a.scheduledDayKey}T00:00:00`);

      const bMs =
        typeof b.dueAtMs === "number"
          ? b.dueAtMs
          : Date.parse(`${b.scheduledDayKey}T00:00:00`);

      return aMs - bMs;
    })[0];

  if (!anchorSubtask) {
    throw new Error(
      "Smart Goal Export needs at least one subtask with a scheduled date."
    );
  }

  if (typeof anchorSubtask.dueAtMs === "number") {
    const start = new Date(anchorSubtask.dueAtMs);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    return {
start: {
  dateTime: start.toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
},
end: {
  dateTime: end.toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
},
    };
  }

  const startDate = anchorSubtask.scheduledDayKey;

  if (typeof startDate !== "string" || !startDate.trim()) {
    throw new Error(
      "Smart Goal Export needs at least one subtask with a scheduled date."
    );
  }

  const [y, m, d] = startDate.split("-").map(Number);
  const nextDay = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1);

  return {
    start: {
      date: startDate,
    },
    end: {
      date: formatLocalDateForAllDay(nextDay),
    },
  };
}

function getGoogleCalendarByDay(weeklyDay: number | null | undefined): string | null {
  if (weeklyDay == null) return null;

  const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return dayMap[weeklyDay] ?? null;
}

function buildSubtaskRecurrence(goal: Goal, subtask: Subtask): string[] | undefined {
  const exportBehavior = goal.calendarPush?.exportBehavior ?? "single";

  if (exportBehavior !== "recurring") {
    return undefined;
  }

  if (subtask.scheduleType === "oneTime" || subtask.frequency === "once") {
    return undefined;
  }

  if (subtask.frequency === "daily") {
    return ["RRULE:FREQ=DAILY"];
  }

  if (subtask.frequency === "weekly") {
    const byDay = getGoogleCalendarByDay(subtask.weeklyDay);

    if (!byDay) {
      return undefined;
    }

    return [`RRULE:FREQ=WEEKLY;BYDAY=${byDay}`];
  }

  return undefined;
}

function pickSubtaskEventWindow(subtask: Subtask) {
  if (typeof subtask.dueAtMs === "number") {
    const start = new Date(subtask.dueAtMs);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    return {
start: {
  dateTime: start.toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
},
end: {
  dateTime: end.toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
},
    };
  }

  if (typeof subtask.scheduledDayKey === "string" && subtask.scheduledDayKey) {
    const startDate = subtask.scheduledDayKey;

    const [y, m, d] = startDate.split("-").map(Number);
    const nextDay = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1);

    return {
      start: {
        date: startDate,
      },
      end: {
        date: formatLocalDateForAllDay(nextDay),
      },
    };
  }

throw new Error(
  "Subtask needs a scheduled date before it can be exported."
);
}

export async function pushGoalOnlyToGoogleCalendar(params: {
  goal: Goal;
  subtasks: Subtask[];
  existingEventId?: string | null;
}): Promise<GoalPushResult> {
  const { goal, subtasks, existingEventId } = params;

  const accessToken = await connectGoogleCalendar();

  const body = {
    summary: goal.title,
    description: buildGoalEventDescription(goal, subtasks),
    ...pickGoalOnlyEventWindow(goal, subtasks),
    reminders: buildReminderOverrides(goal.calendarPush?.reminderPreset),
  };

  const isUpdate = !!existingEventId;
  const url = isUpdate
    ? `${GOOGLE_CALENDAR_EVENTS_BASE}/${existingEventId}`
    : GOOGLE_CALENDAR_EVENTS_BASE;

  const method = isUpdate ? "PUT" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar push failed (${response.status}): ${text}`);
  }

  const json = await response.json();

  return {
    eventId: json.id,
    calendarId: "primary",
    htmlLink: json.htmlLink ?? null,
  };
}

export async function pushSubtaskToGoogleCalendar(params: {
  goal: Goal;
  subtask: Subtask;
  existingEventId?: string | null;
}): Promise<GoalPushResult> {
  const { goal, subtask, existingEventId } = params;

  const accessToken = await connectGoogleCalendar();

const recurrence = buildSubtaskRecurrence(goal, subtask);

const body = {
  summary: subtask.title,
  description: buildSubtaskEventDescription(goal, subtask),
  ...pickSubtaskEventWindow(subtask),
  reminders: buildReminderOverrides(goal.calendarPush?.reminderPreset),
  ...(recurrence ? { recurrence } : {}),
};

  const isUpdate = !!existingEventId;
  const url = isUpdate
    ? `${GOOGLE_CALENDAR_EVENTS_BASE}/${existingEventId}`
    : GOOGLE_CALENDAR_EVENTS_BASE;

  const method = isUpdate ? "PUT" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar subtask push failed (${response.status}): ${text}`);
  }

  const json = await response.json();

  return {
    eventId: json.id,
    calendarId: "primary",
    htmlLink: json.htmlLink ?? null,
  };
}

export async function removeGoalOnlyFromGoogleCalendar(params: {
  eventId: string;
}): Promise<void> {
  const { eventId } = params;
  const accessToken = await connectGoogleCalendar();

  const response = await fetch(
    `${GOOGLE_CALENDAR_EVENTS_BASE}/${eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404 || response.status === 410) {
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar remove failed (${response.status}): ${text}`);
  }
}

export async function removeSubtaskFromGoogleCalendar(params: {
  eventId: string;
}): Promise<void> {
  const { eventId } = params;
  const accessToken = await connectGoogleCalendar();

  const response = await fetch(
    `${GOOGLE_CALENDAR_EVENTS_BASE}/${eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404 || response.status === 410) {
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar subtask remove failed (${response.status}): ${text}`);
  }
}