import {DateTime, IANAZone} from "luxon";

export const PLANNER_SNAPSHOT_VERSION = 1;
export const PLANNER_LOOKBACK_DAYS = 14;
export const PLANNER_LOOKAHEAD_DAYS = 14;
export const PLANNER_SOURCE_LIMITS = {
  goals: 100,
  subtasks: 250,
  boardCards: 200,
  calendarEvents: 250,
  routines: 100,
  routineOccurrences: 200,
  activeGroups: 20,
} as const;
export const PLANNER_PLANNING_HOURS = {startHour: 8, endHour: 20} as const;
export const PLANNER_DURATION_MINUTES = {default: 30, min: 15, max: 120} as const;

export type PlannerScope = "personal" | "group";
export type PlannerPriority = "low" | "medium" | "high";
export type PlannerSuggestionType =
  | "schedule_work" | "reschedule_work" | "resolve_conflict"
  | "prioritize_work" | "split_work" | "surface_neglected_work"
  | "move_board_card" | "adjust_deadline" | "routine_timing" | "focus_block";
export type PlannerEntityType =
  | "goal" | "milestone" | "subtask" | "board" | "board_card"
  | "calendar_event" | "routine" | "routine_occurrence";
export interface PlannerEntityRef {
  type: PlannerEntityType; id: string; ownerUid?: string | null;
  groupId?: string | null; goalId?: string | null; boardId?: string | null;
  routineId?: string | null;
}
export interface PlannerPreferencesSnapshot {
  enabled: boolean;
  allowPersonalSuggestions: boolean;
  allowGroupSuggestions: boolean;
  hiddenSuggestionTypes: PlannerSuggestionType[];
}
interface WorkBase {
  id: string; title: string; scope: PlannerScope; ownerUid: string;
  groupId: string | null; completed: boolean; archived: boolean;
  priority: PlannerPriority | null; dueAtMs: number | null;
  updatedAtMs: number | null; relevantToCurrentUser: boolean;
}
export interface PlannerGoalSnapshot extends WorkBase {
  subtaskCount: number; incompleteSubtaskCount: number;
  lastMeaningfulActivityAtMs: number | null;
}
export interface PlannerSubtaskSnapshot extends WorkBase {
  goalId: string; scheduledStartAtMs: number | null;
  scheduledEndAtMs: number | null; assignedToUid: string | null;
}
export interface PlannerBoardCardSnapshot extends WorkBase {
  boardId: string; columnId: string; backlog: boolean;
  assignedToUid: string | null; linkedItemType: string | null;
  linkedItemId: string | null;
}
export interface PlannerCalendarEventSnapshot {
  id: string; title: string; scope: PlannerScope; ownerUid: string | null;
  groupId: string | null; startAtMs: number; endAtMs: number;
  allDay: boolean; cancelled: boolean; generated: boolean;
  sourceType: string | null; linkedEntity: PlannerEntityRef | null;
  timeZone: string | null; blocksTime: boolean;
}
export interface PlannerRoutineSnapshot {
  id: string; groupId: string; title: string; active: boolean;
  archived: boolean; currentUserParticipant: boolean;
  updatedAtMs: number | null;
}
export interface PlannerRoutineOccurrenceSnapshot {
  id: string; routineId: string; groupId: string; title: string;
  startAtMs: number; endAtMs: number; schedulerStatus: string;
  executionStatus: string; assignedToCurrentUser: boolean;
  generatedEventId: string | null;
}
export interface PlannerInputSnapshot {
  ownerUid: string; generatedAtMs: number; timeZone: string;
  window: {startAtMs: number; endAtMs: number};
  preferences: PlannerPreferencesSnapshot;
  goals: PlannerGoalSnapshot[];
  subtasks: PlannerSubtaskSnapshot[];
  boardCards: PlannerBoardCardSnapshot[];
  calendarEvents: PlannerCalendarEventSnapshot[];
  routines: PlannerRoutineSnapshot[];
  routineOccurrences: PlannerRoutineOccurrenceSnapshot[];
  metadata: {
    sourceCounts: Record<string, number>;
    truncated: boolean; truncationReasons: string[]; version: number;
    authoritativeSources: string[];
  };
}
export interface PlannerRawSnapshotSources {
  preferences?: Record<string, unknown>;
  goals?: {id: string; data: Record<string, unknown>}[];
  subtasks?: {id: string; data: Record<string, unknown>}[];
  boardCards?: {id: string; data: Record<string, unknown>}[];
  calendarEvents?: {id: string; data: Record<string, unknown>}[];
  routines?: {id: string; data: Record<string, unknown>}[];
  routineOccurrences?: {id: string; data: Record<string, unknown>}[];
  truncatedSources?: string[];
  authoritativeSources?: string[];
}

const DAY_MS = 86_400_000;
const str = (value: unknown, max = 160) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const bool = (value: unknown) => value === true;
const priority = (value: unknown): PlannerPriority | null =>
  value === "low" || value === "medium" || value === "high" ? value : null;
const scopeFor = (data: Record<string, unknown>): PlannerScope =>
  str(data.groupId) || data.scope === "group" ? "group" : "personal";
const compareId = <T extends {id: string}>(left: T, right: T) =>
  left.id.localeCompare(right.id);
const validId = (value: unknown) => {
  const result = str(value, 200);
  return result && !result.includes("/") ? result : null;
};

export function normalizePlannerTimeZone(value: unknown, fallback = "UTC") {
  const candidate = str(value, 100);
  if (candidate && IANAZone.isValidZone(candidate)) return candidate;
  return IANAZone.isValidZone(fallback) ? fallback : "UTC";
}
export function getPlannerLocalDayKey(atMs: number, timeZone: string) {
  if (!Number.isFinite(atMs)) throw new Error("invalid_planner_time");
  return DateTime.fromMillis(atMs, {zone: normalizePlannerTimeZone(timeZone)})
    .toISODate()!;
}
export function getPlannerLocalWeekKey(atMs: number, timeZone: string) {
  const value = DateTime.fromMillis(atMs, {zone: normalizePlannerTimeZone(timeZone)});
  return `${value.weekYear}-W${String(value.weekNumber).padStart(2, "0")}`;
}
export function getPlannerDayStartMs(atMs: number, timeZone: string) {
  return DateTime.fromMillis(atMs, {zone: normalizePlannerTimeZone(timeZone)})
    .startOf("day").toMillis();
}
export function getPlannerDayEndMs(atMs: number, timeZone: string) {
  return DateTime.fromMillis(atMs, {zone: normalizePlannerTimeZone(timeZone)})
    .plus({days: 1}).startOf("day").toMillis();
}
export function buildPlannerWindow(nowMs: number, timeZone: string,
  lookbackDays = PLANNER_LOOKBACK_DAYS,
  lookaheadDays = PLANNER_LOOKAHEAD_DAYS) {
  if (!Number.isFinite(nowMs) || lookbackDays < 0 || lookaheadDays < 0) {
    throw new Error("invalid_planner_window");
  }
  const local = DateTime.fromMillis(nowMs, {zone: normalizePlannerTimeZone(timeZone)});
  return {
    startAtMs: local.startOf("day").minus({days: lookbackDays}).toMillis(),
    endAtMs: local.startOf("day").plus({days: lookaheadDays + 1}).toMillis(),
  };
}

export interface PlannerInterval {startAtMs: number; endAtMs: number; sourceIds: string[]}
export function normalizePlannerInterval(value: {
  startAtMs: unknown; endAtMs: unknown; sourceId?: unknown;
}): PlannerInterval | null {
  const startAtMs = num(value.startAtMs);
  const endAtMs = num(value.endAtMs);
  if (startAtMs == null || endAtMs == null || endAtMs <= startAtMs) return null;
  return {startAtMs, endAtMs, sourceIds: str(value.sourceId) ? [str(value.sourceId)!] : []};
}
export function mergePlannerIntervals(values: PlannerInterval[]) {
  const sorted = values.slice().sort((a, b) =>
    a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs ||
    a.sourceIds.join().localeCompare(b.sourceIds.join()));
  const merged: PlannerInterval[] = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || current.startAtMs > previous.endAtMs) {
      merged.push({...current, sourceIds: [...current.sourceIds]});
    } else {
      previous.endAtMs = Math.max(previous.endAtMs, current.endAtMs);
      previous.sourceIds = Array.from(new Set([...previous.sourceIds, ...current.sourceIds])).sort();
    }
  }
  return merged;
}
export const plannerIntervalsConflict = (left: PlannerInterval, right: PlannerInterval) =>
  left.startAtMs < right.endAtMs && right.startAtMs < left.endAtMs;
export function findPlannerFreeWindows(input: {
  busy: PlannerInterval[]; rangeStartAtMs: number; rangeEndAtMs: number;
  minimumDurationMs: number;
}) {
  if (input.rangeEndAtMs <= input.rangeStartAtMs || input.minimumDurationMs <= 0) return [];
  const clipped = input.busy.map((item) => ({
    ...item,
    startAtMs: Math.max(item.startAtMs, input.rangeStartAtMs),
    endAtMs: Math.min(item.endAtMs, input.rangeEndAtMs),
  })).filter((item) => item.endAtMs > item.startAtMs);
  const result: PlannerInterval[] = [];
  let cursor = input.rangeStartAtMs;
  for (const item of mergePlannerIntervals(clipped)) {
    if (item.startAtMs - cursor >= input.minimumDurationMs) {
      result.push({startAtMs: cursor, endAtMs: item.startAtMs, sourceIds: []});
    }
    cursor = Math.max(cursor, item.endAtMs);
  }
  if (input.rangeEndAtMs - cursor >= input.minimumDurationMs) {
    result.push({startAtMs: cursor, endAtMs: input.rangeEndAtMs, sourceIds: []});
  }
  return result;
}

function normalizePreferences(value: Record<string, unknown> | undefined):
PlannerPreferencesSnapshot {
  const hidden = Array.isArray(value?.hiddenSuggestionTypes) ?
    Array.from(new Set(value.hiddenSuggestionTypes.filter((item):
      item is PlannerSuggestionType => typeof item === "string"))).slice(0, 10) : [];
  return {
    enabled: value?.enabled !== false,
    allowPersonalSuggestions: value?.allowPersonalSuggestions !== false,
    allowGroupSuggestions: value?.allowGroupSuggestions !== false,
    hiddenSuggestionTypes: hidden,
  };
}
function normalizeGoal(ownerUid: string, item: {id: string; data: Record<string, unknown>}):
PlannerGoalSnapshot | null {
  const id = validId(item.id);
  const owner = str(item.data.userId) || str(item.data.ownerUid);
  if (!id || owner !== ownerUid) return null;
  const status = str(item.data.status);
  return {
    id, ownerUid: ownerUid, groupId: str(item.data.sharedGroupId),
    scope: str(item.data.sharedGroupId) ? "group" : "personal",
    title: str(item.data.title) || "Untitled goal",
    completed: status === "completed", archived: bool(item.data.archived),
    priority: priority(item.data.priority), dueAtMs: num(item.data.dueAtMs),
    updatedAtMs: num(item.data.updatedAtMs) || num(item.data.createdAtMs),
    lastMeaningfulActivityAtMs: num(item.data.lastActivityAtMs) ||
      num(item.data.updatedAtMs) || num(item.data.createdAtMs),
    subtaskCount: Math.max(0, num(item.data.subtaskCount) || 0),
    incompleteSubtaskCount: Math.max(0, num(item.data.incompleteSubtaskCount) || 0),
    relevantToCurrentUser: true,
  };
}
function normalizeSubtask(ownerUid: string, item: {id: string; data: Record<string, unknown>}):
PlannerSubtaskSnapshot | null {
  const id = validId(item.id); const goalId = validId(item.data.goalId);
  const owner = str(item.data.userId) || str(item.data.ownerUid);
  if (!id || !goalId || owner !== ownerUid) return null;
  const assigned = str(item.data.assignedToUid);
  const scheduled = num(item.data.scheduledStartAtMs);
  return {
    id, goalId, ownerUid, groupId: str(item.data.groupId) || str(item.data.sharedGroupId),
    scope: scopeFor(item.data), title: str(item.data.title) || "Untitled subtask",
    completed: num(item.data.firstCompletedAtMs) != null || item.data.completed === true,
    archived: bool(item.data.archived), priority: priority(item.data.priority),
    dueAtMs: num(item.data.dueAtMs), scheduledStartAtMs: scheduled,
    scheduledEndAtMs: num(item.data.scheduledEndAtMs), assignedToUid: assigned,
    updatedAtMs: num(item.data.updatedAtMs) || num(item.data.createdAtMs),
    relevantToCurrentUser: !assigned || assigned === ownerUid,
  };
}
function normalizeBoardCard(ownerUid: string, item: {id: string; data: Record<string, unknown>}):
PlannerBoardCardSnapshot | null {
  const id = validId(item.id); const boardId = validId(item.data.boardId);
  if (!id || !boardId) return null;
  const cardOwner = str(item.data.ownerUid);
  const groupId = str(item.data.groupId);
  if (!groupId && cardOwner !== ownerUid) return null;
  const columnId = str(item.data.columnId) || "ideas";
  const assigned = str(item.data.assignedToUid);
  return {
    id, boardId, ownerUid: cardOwner || ownerUid, groupId,
    scope: groupId ? "group" : "personal",
    title: str(item.data.title) || "Untitled card", columnId,
    completed: columnId === "completed" || columnId === "done" ||
      item.data.status === "done", backlog: columnId === "backlog" || columnId === "ideas",
    archived: bool(item.data.archived), priority: priority(item.data.priority),
    dueAtMs: num(item.data.dueAtMs), assignedToUid: assigned,
    linkedItemType: str(item.data.linkedItemType),
    linkedItemId: str(item.data.linkedItemId),
    updatedAtMs: num(item.data.updatedAtMs) || num(item.data.createdAtMs),
    relevantToCurrentUser: !assigned || assigned === ownerUid || cardOwner === ownerUid,
  };
}
function normalizeCalendarEvent(ownerUid: string,
  item: {id: string; data: Record<string, unknown>}): PlannerCalendarEventSnapshot | null {
  const id = validId(item.id);
  const start = num(item.data.startAtMs) || num(item.data.sortStartMs);
  const end = num(item.data.endAtMs) || num(item.data.sortEndMs);
  if (!id || start == null || end == null || end <= start) return null;
  const groupId = str(item.data.groupId);
  const sourceType = str(item.data.sourceType);
  return {
    id, title: str(item.data.title) || "Busy", scope: groupId ? "group" : "personal",
    ownerUid: str(item.data.ownerUid) || (groupId ? null : ownerUid), groupId,
    startAtMs: start, endAtMs: end, allDay: bool(item.data.allDay),
    cancelled: item.data.status === "cancelled" || bool(item.data.archived),
    generated: !!sourceType || ["goal", "board", "routine"].includes(String(item.data.type)),
    sourceType, linkedEntity: sourceType === "group_routine" && str(item.data.sourceOccurrenceId) ?
      {type: "routine_occurrence", id: str(item.data.sourceOccurrenceId)!,
        groupId, routineId: str(item.data.sourceRoutineId)} : null,
    timeZone: str(item.data.timezone) || str(item.data.timeZone),
    blocksTime: item.data.blocksTime !== false,
  };
}
function normalizeRoutine(ownerUid: string, item: {id: string; data: Record<string, unknown>}):
PlannerRoutineSnapshot | null {
  const id = validId(item.id); const groupId = validId(item.data.groupId);
  if (!id || !groupId) return null;
  const participants = Array.isArray(item.data.participantUids) ?
    item.data.participantUids.slice(0, 50) : [];
  return {
    id, groupId, title: str(item.data.title) || "Untitled routine",
    active: item.data.status === "active", archived: item.data.status === "archived",
    currentUserParticipant: participants.includes(ownerUid),
    updatedAtMs: num(item.data.updatedAtMs),
  };
}
function normalizeOccurrence(ownerUid: string,
  item: {id: string; data: Record<string, unknown>}):
PlannerRoutineOccurrenceSnapshot | null {
  const id = validId(item.id); const routineId = validId(item.data.routineId);
  const groupId = validId(item.data.groupId);
  const start = num(item.data.startAtMs);
  const end = num(item.data.endAtMs) ||
    (start != null ? start + Math.max(PLANNER_DURATION_MINUTES.min,
      Math.min(PLANNER_DURATION_MINUTES.max, num(item.data.durationMinutes) ||
      PLANNER_DURATION_MINUTES.default)) * 60_000 : null);
  if (!id || !routineId || !groupId || start == null || end == null || end <= start) return null;
  const participants = Array.isArray(item.data.participantUids) ?
    item.data.participantUids.slice(0, 50) : [];
  return {
    id, routineId, groupId,
    title: str(item.data.routineTitleSnapshot) || "Routine occurrence",
    startAtMs: start, endAtMs: end,
    schedulerStatus: str(item.data.status) || "scheduled",
    executionStatus: str(item.data.executionStatus) || "scheduled",
    assignedToCurrentUser: participants.includes(ownerUid),
    generatedEventId: str(item.data.calendarProjectionId),
  };
}
function normalizeList<T extends {id: string}>(items: {id: string; data: Record<string, unknown>}[] | undefined,
  mapper: (item: {id: string; data: Record<string, unknown>}) => T | null,
  limit: number): T[] {
  const byId = new Map<string, T>();
  for (const item of items || []) {
    try {
      const mapped = mapper(item);
      if (mapped) byId.set(mapped.id, mapped);
    } catch {
      // A malformed source is intentionally isolated from the rest of the snapshot.
    }
  }
  return Array.from(byId.values()).sort(compareId).slice(0, limit);
}
export function buildPlannerInputSnapshot(input: {
  ownerUid: string; generatedAtMs: number; timeZone: string;
  sources: PlannerRawSnapshotSources; window?: {startAtMs: number; endAtMs: number};
}): PlannerInputSnapshot {
  const ownerUid = validId(input.ownerUid);
  if (!ownerUid || !Number.isFinite(input.generatedAtMs)) throw new Error("invalid_planner_snapshot");
  const timeZone = normalizePlannerTimeZone(input.timeZone);
  const window = input.window || buildPlannerWindow(input.generatedAtMs, timeZone);
  if (window.endAtMs <= window.startAtMs) throw new Error("invalid_planner_window");
  const goals = normalizeList(input.sources.goals, (item) =>
    normalizeGoal(ownerUid, item), PLANNER_SOURCE_LIMITS.goals);
  const subtasks = normalizeList(input.sources.subtasks, (item) =>
    normalizeSubtask(ownerUid, item), PLANNER_SOURCE_LIMITS.subtasks);
  const boardCards = normalizeList(input.sources.boardCards, (item) =>
    normalizeBoardCard(ownerUid, item), PLANNER_SOURCE_LIMITS.boardCards);
  const calendarEvents = normalizeList(input.sources.calendarEvents, (item) =>
    normalizeCalendarEvent(ownerUid, item), PLANNER_SOURCE_LIMITS.calendarEvents);
  const routines = normalizeList(input.sources.routines, (item) =>
    normalizeRoutine(ownerUid, item), PLANNER_SOURCE_LIMITS.routines);
  const routineOccurrences = normalizeList(input.sources.routineOccurrences, (item) =>
    normalizeOccurrence(ownerUid, item), PLANNER_SOURCE_LIMITS.routineOccurrences);
  const reasons = Array.from(new Set(input.sources.truncatedSources || [])).sort();
  return {
    ownerUid, generatedAtMs: input.generatedAtMs, timeZone, window,
    preferences: normalizePreferences(input.sources.preferences),
    goals, subtasks, boardCards, calendarEvents, routines, routineOccurrences,
    metadata: {
      sourceCounts: {
        goals: goals.length, subtasks: subtasks.length, boardCards: boardCards.length,
        calendarEvents: calendarEvents.length, routines: routines.length,
        routineOccurrences: routineOccurrences.length,
      },
      truncated: reasons.length > 0, truncationReasons: reasons,
      version: PLANNER_SNAPSHOT_VERSION,
      authoritativeSources: Array.from(new Set(input.sources.authoritativeSources || [])).sort(),
    },
  };
}

export function getPlanningDayBounds(dayMs: number, timeZone: string,
  hours = PLANNER_PLANNING_HOURS) {
  const day = DateTime.fromMillis(dayMs, {zone: normalizePlannerTimeZone(timeZone)})
    .startOf("day");
  return {
    startAtMs: day.set({hour: hours.startHour}).toMillis(),
    endAtMs: day.set({hour: hours.endHour}).toMillis(),
  };
}

export const PLANNER_DAY_MS_FOR_TESTS = DAY_MS;
