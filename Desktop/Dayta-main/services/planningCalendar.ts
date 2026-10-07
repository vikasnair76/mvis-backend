import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export const PLANNING_CALENDAR_EVENT_SCOPES = ["personal", "group"] as const;

export const PLANNING_CALENDAR_EVENT_TYPES = [
  "personal",
  "group",
  "goal",
  "board",
  "routine",
] as const;

export const PLANNING_CALENDAR_EVENT_VISIBILITIES = [
  "private",
  "group",
] as const;

export type PlanningCalendarEventScope =
  (typeof PLANNING_CALENDAR_EVENT_SCOPES)[number];

export type PlanningCalendarEventType =
  (typeof PLANNING_CALENDAR_EVENT_TYPES)[number];

export type PlanningCalendarEventVisibility =
  (typeof PLANNING_CALENDAR_EVENT_VISIBILITIES)[number];

export type PlanningCalendarEventDoc = {
  id: string;
  title: string;
  description?: string | null;

  scope: PlanningCalendarEventScope;
  type: PlanningCalendarEventType;
  visibility: PlanningCalendarEventVisibility;

  ownerUid?: string | null;
  groupId?: string | null;
  goalId?: string | null;
  boardId?: string | null;
  routineId?: string | null;

  startAtMs: number;
  endAtMs: number;

  allDay?: boolean;

  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;

  archived?: boolean;
};

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function requireNonEmptyString(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return trimmed;
}

function normalizeEventTitle(value: string): string {
  const title = requireNonEmptyString(value, "Calendar event title");
  if (title.length > 160) {
    throw new Error("Calendar event title must be 160 characters or fewer.");
  }
  return title;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  fieldLabel: string
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldLabel} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: number, fieldLabel: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldLabel} must be a finite number.`);
  }
  return value;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizePlanningCalendarEventScope(
  value: unknown
): PlanningCalendarEventScope {
  return isOneOf(PLANNING_CALENDAR_EVENT_SCOPES, value) ? value : "personal";
}

export function normalizePlanningCalendarEventType(
  value: unknown,
  fallback?: unknown
): PlanningCalendarEventType {
  if (isOneOf(PLANNING_CALENDAR_EVENT_TYPES, value)) return value;
  if (isOneOf(PLANNING_CALENDAR_EVENT_TYPES, fallback)) return fallback;
  return "personal";
}

export function normalizePlanningCalendarEventVisibility(
  value: unknown,
  fallback?: unknown
): PlanningCalendarEventVisibility {
  if (isOneOf(PLANNING_CALENDAR_EVENT_VISIBILITIES, value)) return value;
  if (isOneOf(PLANNING_CALENDAR_EVENT_VISIBILITIES, fallback)) return fallback;
  return "private";
}

export function mapPlanningCalendarEventDoc(
  id: string,
  data: Record<string, any>
): PlanningCalendarEventDoc {
  const scope = normalizePlanningCalendarEventScope(data.scope);
  const defaultType = scope === "group" ? "group" : "personal";
  const defaultVisibility = scope === "group" ? "group" : "private";
  const createdAtMs = numberOrFallback(data.createdAtMs, 0);
  const updatedAtMs = numberOrFallback(data.updatedAtMs, createdAtMs);

  return {
    id,
    title: typeof data.title === "string" ? data.title : "",
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description
        : null,
    scope,
    type: normalizePlanningCalendarEventType(data.type, defaultType),
    visibility: normalizePlanningCalendarEventVisibility(
      data.visibility,
      defaultVisibility
    ),
    ownerUid: optionalStringOrNull(data.ownerUid),
    groupId: optionalStringOrNull(data.groupId),
    goalId: optionalStringOrNull(data.goalId),
    boardId: optionalStringOrNull(data.boardId),
    routineId: optionalStringOrNull(data.routineId),
    startAtMs: numberOrFallback(data.startAtMs, 0),
    endAtMs: numberOrFallback(data.endAtMs, 0),
    allDay: data.allDay === true,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAtMs,
    updatedAtMs,
    archived: data.archived === true,
  };
}

export async function createPlanningCalendarEvent(params: {
  title: string;
  description?: string | null;
  scope: PlanningCalendarEventScope;
  type?: PlanningCalendarEventType;
  visibility?: PlanningCalendarEventVisibility;
  ownerUid?: string | null;
  groupId?: string | null;
  goalId?: string | null;
  boardId?: string | null;
  routineId?: string | null;
  startAtMs: number;
  endAtMs: number;
  allDay?: boolean;
  createdByUid: string;
}): Promise<string> {
  const title = normalizeEventTitle(params.title);
  const description = normalizeOptionalText(
    params.description,
    1000,
    "Calendar event description"
  );
  const scope = normalizePlanningCalendarEventScope(params.scope);
  const createdByUid = requireNonEmptyString(
    params.createdByUid,
    "Created by UID"
  );
  const ownerUid = optionalStringOrNull(params.ownerUid);
  const groupId = optionalStringOrNull(params.groupId);
  const startAtMs = finiteNumber(params.startAtMs, "Start time");
  const endAtMs = finiteNumber(params.endAtMs, "End time");

  if (endAtMs <= startAtMs) {
    throw new Error("Calendar event end time must be after the start time.");
  }
  if (scope === "personal" && !ownerUid) {
    throw new Error("Personal calendar events require an owner UID.");
  }
  if (scope === "group" && !groupId) {
    throw new Error("Group calendar events require a group ID.");
  }

  const defaultType = scope === "group" ? "group" : "personal";
  const defaultVisibility = scope === "group" ? "group" : "private";
  const eventRef = doc(collection(db, "planningCalendarEvents"));
  const nowMs = Date.now();

  await setDoc(eventRef, {
    id: eventRef.id,
    title,
    description,
    scope,
    type: normalizePlanningCalendarEventType(params.type, defaultType),
    visibility: normalizePlanningCalendarEventVisibility(
      params.visibility,
      defaultVisibility
    ),
    ownerUid: scope === "personal" ? ownerUid : null,
    groupId: scope === "group" ? groupId : null,
    goalId: optionalStringOrNull(params.goalId),
    boardId: optionalStringOrNull(params.boardId),
    routineId: optionalStringOrNull(params.routineId),
    startAtMs,
    endAtMs,
    allDay: params.allDay === true,
    createdByUid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return eventRef.id;
}

export async function updatePlanningCalendarEvent(params: {
  eventId: string;
  title?: string;
  description?: string | null;
  type?: PlanningCalendarEventType;
  visibility?: PlanningCalendarEventVisibility;
  goalId?: string | null;
  boardId?: string | null;
  routineId?: string | null;
  startAtMs?: number;
  endAtMs?: number;
  allDay?: boolean;
}): Promise<void> {
  const eventId = requireNonEmptyString(params.eventId, "Calendar event ID");
  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };

  if (params.title !== undefined) {
    patch.title = normalizeEventTitle(params.title);
  }
  if (params.description !== undefined) {
    patch.description = normalizeOptionalText(
      params.description,
      1000,
      "Calendar event description"
    );
  }
  if (params.type !== undefined) {
    patch.type = normalizePlanningCalendarEventType(params.type);
  }
  if (params.visibility !== undefined) {
    patch.visibility = normalizePlanningCalendarEventVisibility(
      params.visibility
    );
  }
  if (params.goalId !== undefined) {
    patch.goalId = optionalStringOrNull(params.goalId);
  }
  if (params.boardId !== undefined) {
    patch.boardId = optionalStringOrNull(params.boardId);
  }
  if (params.routineId !== undefined) {
    patch.routineId = optionalStringOrNull(params.routineId);
  }
  if (params.startAtMs !== undefined) {
    patch.startAtMs = finiteNumber(params.startAtMs, "Start time");
  }
  if (params.endAtMs !== undefined) {
    patch.endAtMs = finiteNumber(params.endAtMs, "End time");
  }
  if (
    typeof patch.startAtMs === "number" &&
    typeof patch.endAtMs === "number" &&
    patch.endAtMs <= patch.startAtMs
  ) {
    throw new Error("Calendar event end time must be after the start time.");
  }
  if (params.allDay !== undefined) {
    patch.allDay = params.allDay === true;
  }

  await updateDoc(doc(db, "planningCalendarEvents", eventId), patch);
}

export async function archivePlanningCalendarEvent(params: {
  eventId: string;
}): Promise<void> {
  const eventId = requireNonEmptyString(params.eventId, "Calendar event ID");

  await updateDoc(doc(db, "planningCalendarEvents", eventId), {
    archived: true,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function deletePlanningCalendarEvent(params: {
  eventId: string;
}): Promise<void> {
  const eventId = requireNonEmptyString(params.eventId, "Calendar event ID");

  await deleteDoc(doc(db, "planningCalendarEvents", eventId));
}

export function subscribePersonalPlanningCalendarEvents(
  ownerUid: string,
  onNext: (events: PlanningCalendarEventDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeOwnerUid = ownerUid.trim();
  if (!safeOwnerUid) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningCalendarEvents"),
    where("scope", "==", "personal"),
    where("ownerUid", "==", safeOwnerUid),
    where("archived", "==", false),
    orderBy("startAtMs", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningCalendarEventDoc(d.id, d.data())));
    },
    onError
  );
}

export function subscribeGroupPlanningCalendarEvents(
  groupId: string,
  onNext: (events: PlanningCalendarEventDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGroupId = groupId.trim();
  if (!safeGroupId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningCalendarEvents"),
    where("scope", "==", "group"),
    where("groupId", "==", safeGroupId),
    where("archived", "==", false),
    orderBy("startAtMs", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningCalendarEventDoc(d.id, d.data())));
    },
    onError
  );
}
