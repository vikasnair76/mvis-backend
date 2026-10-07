import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { DateTime, IANAZone } from "luxon";
import { db } from "./firebase";
import type { GroupMemberStatus, GroupRole } from "./groups";

export const GROUP_CALENDAR_TITLE_MAX_LENGTH = 160;
export const GROUP_CALENDAR_DESCRIPTION_MAX_LENGTH = 2000;
export const GROUP_CALENDAR_LOCATION_MAX_LENGTH = 240;
export const GROUP_CALENDAR_TIMEZONE_MAX_LENGTH = 100;
export const GROUP_CALENDAR_ATTENDEE_MAX_COUNT = 50;
export const MAX_GROUP_CALENDAR_TIMED_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_GROUP_CALENDAR_ALL_DAY_SPAN_DAYS = 366;
export const DEFAULT_UPCOMING_GROUP_CALENDAR_LIMIT = 10;
export const MAX_UPCOMING_GROUP_CALENDAR_LIMIT = 100;
export const DEFAULT_GROUP_CALENDAR_RANGE_LIMIT = 200;
export const MAX_GROUP_CALENDAR_RANGE_LIMIT = 500;

export type GroupCalendarEventStatus = "scheduled" | "cancelled";

export type GroupCalendarEventDoc = {
  id: string;
  scope: "group";
  type: "group";
  visibility: "group";
  groupId: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startAtMs: number | null;
  endAtMs: number | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  sortStartMs: number;
  sortEndMs: number;
  createdByUid: string;
  createdByName: string | null;
  createdByEmail: string | null;
  attendeeUids: string[];
  status: GroupCalendarEventStatus;
  cancelledAtMs: number | null;
  cancelledByUid: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  sourceType: "group_routine" | null;
  sourceRoutineId: string | null;
  sourceOccurrenceId: string | null;
  sourceScheduleFingerprint: string | null;
};

export type GroupCalendarTimingInput = {
  allDay: boolean;
  startAtMs?: number | null;
  endAtMs?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone: string;
};

export type CreateGroupCalendarEventInput = GroupCalendarTimingInput & {
  groupId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  createdByUid: string;
  createdByName?: string | null;
  createdByEmail?: string | null;
  attendeeUids?: string[];
};

export type UpdateGroupCalendarEventInput = {
  eventId: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  attendeeUids?: string[];
  allDay?: boolean;
  startAtMs?: number | null;
  endAtMs?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string;
};

function requiredString(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function boundedOptionalString(
  value: unknown,
  maximum: number,
  label: string
): string | null {
  if (value == null) return null;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeGroupCalendarEventTitle(value: unknown): string {
  const title = requiredString(value, "Event title");
  if (title.length > GROUP_CALENDAR_TITLE_MAX_LENGTH) {
    throw new Error(
      `Event title must be ${GROUP_CALENDAR_TITLE_MAX_LENGTH} characters or fewer.`
    );
  }
  return title;
}

export function normalizeGroupCalendarDescription(value: unknown): string | null {
  return boundedOptionalString(
    value,
    GROUP_CALENDAR_DESCRIPTION_MAX_LENGTH,
    "Event description"
  );
}

export function normalizeGroupCalendarLocation(value: unknown): string | null {
  return boundedOptionalString(
    value,
    GROUP_CALENDAR_LOCATION_MAX_LENGTH,
    "Event location"
  );
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timezone = value.trim();
  return (
    timezone.length > 0 &&
    timezone.length <= GROUP_CALENDAR_TIMEZONE_MAX_LENGTH &&
    IANAZone.isValidZone(timezone)
  );
}

export function normalizeIanaTimeZone(value: unknown): string {
  if (!isValidIanaTimeZone(value)) {
    throw new Error("The timezone is invalid.");
  }
  return value.trim();
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = DateTime.fromFormat(value, "yyyy-LL-dd", {
    zone: "UTC",
    locale: "en",
  });
  return parsed.isValid && parsed.toFormat("yyyy-LL-dd") === value;
}

export function compareDateOnly(a: string, b: string): number {
  if (!isValidDateOnly(a) || !isValidDateOnly(b)) {
    throw new Error("All-day dates are invalid.");
  }
  return a.localeCompare(b);
}

export function normalizeGroupCalendarAttendeeUids(
  value: unknown,
  creatorUid?: string | null
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Event attendees are invalid.");
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const uid = typeof item === "string" ? item.trim() : "";
    if (!uid) throw new Error("Event attendees are invalid.");
    if (uid === creatorUid || seen.has(uid)) continue;
    seen.add(uid);
    unique.push(uid);
  }
  if (unique.length > GROUP_CALENDAR_ATTENDEE_MAX_COUNT) {
    throw new Error("Too many attendees were selected.");
  }
  return unique;
}

export function normalizeGroupCalendarEventStatus(
  value: unknown
): GroupCalendarEventStatus | null {
  return value === "scheduled" || value === "cancelled" ? value : null;
}

export function normalizeGroupCalendarTiming(input: GroupCalendarTimingInput) {
  const timezone = normalizeIanaTimeZone(input.timezone);
  if (input.allDay) {
    if (!isValidDateOnly(input.startDate) || !isValidDateOnly(input.endDate)) {
      throw new Error("All-day dates are invalid.");
    }
    if (input.startAtMs != null || input.endAtMs != null) {
      throw new Error("All-day events cannot include timed values.");
    }
    if (compareDateOnly(input.startDate, input.endDate) >= 0) {
      throw new Error("The all-day event must end after it starts.");
    }
    const start = DateTime.fromFormat(input.startDate, "yyyy-LL-dd", {
      zone: timezone,
    }).startOf("day");
    const end = DateTime.fromFormat(input.endDate, "yyyy-LL-dd", {
      zone: timezone,
    }).startOf("day");
    const spanDays = end.diff(start, "days").days;
    if (
      !Number.isFinite(spanDays) ||
      spanDays <= 0 ||
      spanDays > MAX_GROUP_CALENDAR_ALL_DAY_SPAN_DAYS
    ) {
      throw new Error("This all-day event is too long.");
    }
    return {
      allDay: true as const,
      startAtMs: null,
      endAtMs: null,
      startDate: input.startDate,
      endDate: input.endDate,
      timezone,
      sortStartMs: start.toMillis(),
      sortEndMs: end.toMillis(),
    };
  }

  const startAtMs = finitePositiveNumber(input.startAtMs);
  const endAtMs = finitePositiveNumber(input.endAtMs);
  if (startAtMs == null || endAtMs == null) {
    throw new Error("Choose a valid event time.");
  }
  if (input.startDate != null || input.endDate != null) {
    throw new Error("Timed events cannot include all-day dates.");
  }
  if (endAtMs <= startAtMs) {
    throw new Error("The event must end after it starts.");
  }
  if (endAtMs - startAtMs > MAX_GROUP_CALENDAR_TIMED_DURATION_MS) {
    throw new Error("This timed event is too long.");
  }
  return {
    allDay: false as const,
    startAtMs,
    endAtMs,
    startDate: null,
    endDate: null,
    timezone,
    sortStartMs: startAtMs,
    sortEndMs: endAtMs,
  };
}

export function normalizeGroupCalendarEventInput(
  input: CreateGroupCalendarEventInput
) {
  const groupId = requiredString(input.groupId, "Group ID");
  const createdByUid = requiredString(input.createdByUid, "Creator UID");
  return {
    scope: "group" as const,
    type: "group" as const,
    visibility: "group" as const,
    groupId,
    title: normalizeGroupCalendarEventTitle(input.title),
    description: normalizeGroupCalendarDescription(input.description),
    location: normalizeGroupCalendarLocation(input.location),
    ...normalizeGroupCalendarTiming(input),
    createdByUid,
    createdByName: boundedOptionalString(
      input.createdByName,
      160,
      "Creator name"
    ),
    createdByEmail: boundedOptionalString(
      input.createdByEmail,
      320,
      "Creator email"
    ),
    attendeeUids: normalizeGroupCalendarAttendeeUids(
      input.attendeeUids,
      createdByUid
    ),
  };
}

export function mapGroupCalendarEventDoc(
  eventId: string,
  value: unknown
): GroupCalendarEventDoc | null {
  if (!eventId.trim() || !value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.scope !== "group" ||
    data.type !== "group" ||
    data.visibility !== "group"
  ) {
    return null;
  }
  try {
    const id = requiredString(data.id, "Event ID");
    if (id !== eventId) return null;
    const groupId = requiredString(data.groupId, "Group ID");
    const createdByUid = requiredString(data.createdByUid, "Creator UID");
    const timing = normalizeGroupCalendarTiming({
      allDay: data.allDay === true,
      startAtMs: data.startAtMs as number | null,
      endAtMs: data.endAtMs as number | null,
      startDate: data.startDate as string | null,
      endDate: data.endDate as string | null,
      timezone: String(data.timezone ?? ""),
    });
    if (
      data.sortStartMs !== timing.sortStartMs ||
      data.sortEndMs !== timing.sortEndMs
    ) {
      return null;
    }
    const status = normalizeGroupCalendarEventStatus(data.status);
    const cancelledAtMs = finitePositiveNumber(data.cancelledAtMs);
    const cancelledByUid = nullableString(data.cancelledByUid);
    if (
      !status ||
      (status === "scheduled" &&
        (data.cancelledAtMs != null || data.cancelledByUid != null)) ||
      (status === "cancelled" && (!cancelledAtMs || !cancelledByUid))
    ) {
      return null;
    }
    const createdAtMs = finitePositiveNumber(data.createdAtMs);
    const updatedAtMs = finitePositiveNumber(data.updatedAtMs);
    if (!createdAtMs || !updatedAtMs || updatedAtMs < createdAtMs) return null;
    const hasAnySourceField =
      "sourceType" in data ||
      "sourceRoutineId" in data ||
      "sourceOccurrenceId" in data ||
      "sourceScheduleFingerprint" in data;
    const generated =
      data.sourceType === "group_routine" &&
      typeof data.sourceRoutineId === "string" &&
      !!data.sourceRoutineId.trim() &&
      typeof data.sourceOccurrenceId === "string" &&
      !!data.sourceOccurrenceId.trim() &&
      typeof data.sourceScheduleFingerprint === "string" &&
      !!data.sourceScheduleFingerprint.trim();
    if (hasAnySourceField && !generated) return null;
    return {
      id,
      scope: "group",
      type: "group",
      visibility: "group",
      groupId,
      title: normalizeGroupCalendarEventTitle(data.title),
      description: normalizeGroupCalendarDescription(data.description),
      location: normalizeGroupCalendarLocation(data.location),
      ...timing,
      createdByUid,
      createdByName: boundedOptionalString(data.createdByName, 160, "Creator name"),
      createdByEmail: boundedOptionalString(data.createdByEmail, 320, "Creator email"),
      attendeeUids: normalizeGroupCalendarAttendeeUids(
        data.attendeeUids,
        createdByUid
      ),
      status,
      cancelledAtMs: status === "cancelled" ? cancelledAtMs : null,
      cancelledByUid: status === "cancelled" ? cancelledByUid : null,
      createdAtMs,
      updatedAtMs,
      sourceType: generated ? "group_routine" : null,
      sourceRoutineId: generated ? data.sourceRoutineId as string : null,
      sourceOccurrenceId: generated ? data.sourceOccurrenceId as string : null,
      sourceScheduleFingerprint: generated
        ? data.sourceScheduleFingerprint as string
        : null,
    };
  } catch {
    console.warn("[GroupCalendar] ignored malformed event", { eventId });
    return null;
  }
}

export function canCreateGroupCalendarEvent(
  role: GroupRole | null | undefined,
  status: GroupMemberStatus = "active"
): boolean {
  return (
    status === "active" &&
    (role === "owner" ||
      role === "admin" ||
      role === "moderator" ||
      role === "member")
  );
}

export function canManageGroupCalendarEvent(input: {
  role: GroupRole | null | undefined;
  status?: GroupMemberStatus;
  currentUid?: string | null;
  createdByUid?: string | null;
  sourceType?: GroupCalendarEventDoc["sourceType"];
}): boolean {
  if (
    input.sourceType === "group_routine" ||
    (input.status ?? "active") !== "active" ||
    !input.currentUid
  ) return false;
  return (
    input.currentUid === input.createdByUid ||
    input.role === "owner" ||
    input.role === "admin" ||
    input.role === "moderator"
  );
}

export function isRoutineGeneratedCalendarEvent(
  event: Pick<GroupCalendarEventDoc, "sourceType">
) {
  return event.sourceType === "group_routine";
}

export async function createGroupCalendarEvent(
  input: CreateGroupCalendarEventInput
): Promise<string> {
  const normalized = normalizeGroupCalendarEventInput(input);
  const eventRef = doc(collection(db, "planningCalendarEvents"));
  const nowMs = Date.now();
  await setDoc(eventRef, {
    id: eventRef.id,
    ...normalized,
    status: "scheduled",
    cancelledAtMs: null,
    cancelledByUid: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return eventRef.id;
}

export async function updateGroupCalendarEvent(
  input: UpdateGroupCalendarEventInput
): Promise<void> {
  const eventId = requiredString(input.eventId, "Event ID");
  const eventRef = doc(db, "planningCalendarEvents", eventId);
  const snapshot = await getDoc(eventRef);
  const current = snapshot.exists()
    ? mapGroupCalendarEventDoc(snapshot.id, snapshot.data())
    : null;
  if (!current) throw new Error("The group calendar event was not found.");
  if (current.status === "cancelled") {
    throw new Error("Cancelled events cannot be edited.");
  }
  const timingChanged = [
    input.allDay,
    input.startAtMs,
    input.endAtMs,
    input.startDate,
    input.endDate,
    input.timezone,
  ].some((value) => value !== undefined);
  const timing = timingChanged
    ? normalizeGroupCalendarTiming({
        allDay: input.allDay ?? current.allDay,
        startAtMs: input.startAtMs !== undefined ? input.startAtMs : current.startAtMs,
        endAtMs: input.endAtMs !== undefined ? input.endAtMs : current.endAtMs,
        startDate: input.startDate !== undefined ? input.startDate : current.startDate,
        endDate: input.endDate !== undefined ? input.endDate : current.endDate,
        timezone: input.timezone ?? current.timezone,
      })
    : null;
  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };
  if (input.title !== undefined) patch.title = normalizeGroupCalendarEventTitle(input.title);
  if (input.description !== undefined) {
    patch.description = normalizeGroupCalendarDescription(input.description);
  }
  if (input.location !== undefined) {
    patch.location = normalizeGroupCalendarLocation(input.location);
  }
  if (input.attendeeUids !== undefined) {
    patch.attendeeUids = normalizeGroupCalendarAttendeeUids(
      input.attendeeUids,
      current.createdByUid
    );
  }
  if (timing) Object.assign(patch, timing);
  await updateDoc(eventRef, patch);
}

export async function cancelGroupCalendarEvent(input: {
  eventId: string;
  cancelledByUid: string;
}): Promise<void> {
  const eventId = requiredString(input.eventId, "Event ID");
  const cancelledByUid = requiredString(input.cancelledByUid, "Cancellation actor");
  const eventRef = doc(db, "planningCalendarEvents", eventId);
  const snapshot = await getDoc(eventRef);
  const current = snapshot.exists()
    ? mapGroupCalendarEventDoc(snapshot.id, snapshot.data())
    : null;
  if (!current) throw new Error("The group calendar event was not found.");
  if (current.status === "cancelled") {
    throw new Error("This event is already cancelled.");
  }
  const nowMs = Date.now();
  await updateDoc(eventRef, {
    status: "cancelled",
    cancelledAtMs: nowMs,
    cancelledByUid,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeGroupCalendarEvent(
  eventId: string,
  onNext: (event: GroupCalendarEventDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeEventId = eventId.trim();
  if (!safeEventId) {
    onNext(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, "planningCalendarEvents", safeEventId),
    (snapshot) =>
      onNext(
        snapshot.exists()
          ? mapGroupCalendarEventDoc(snapshot.id, snapshot.data())
          : null
      ),
    (error) => {
      console.error("[GroupCalendar] event subscription failed");
      onError?.(error);
    }
  );
}

export function subscribeUpcomingGroupCalendarEvents(
  groupId: string,
  options: { lowerBoundMs?: number; limit?: number } | undefined,
  onNext: (events: GroupCalendarEventDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGroupId = groupId.trim();
  if (!safeGroupId) {
    onNext([]);
    return () => {};
  }
  const resultLimit = Math.max(
    1,
    Math.min(options?.limit ?? DEFAULT_UPCOMING_GROUP_CALENDAR_LIMIT, MAX_UPCOMING_GROUP_CALENDAR_LIMIT)
  );
  const lowerBoundMs = finitePositiveNumber(options?.lowerBoundMs) ?? Date.now();
  const qy = query(
    collection(db, "planningCalendarEvents"),
    where("groupId", "==", safeGroupId),
    where("status", "==", "scheduled"),
    where("sortStartMs", ">=", lowerBoundMs),
    orderBy("sortStartMs", "asc"),
    limit(resultLimit)
  );
  return onSnapshot(
    qy,
    (snapshot) =>
      onNext(
        snapshot.docs
          .map((item) => mapGroupCalendarEventDoc(item.id, item.data()))
          .filter((item): item is GroupCalendarEventDoc => item != null)
      ),
    (error) => {
      console.error("[GroupCalendar] upcoming subscription failed");
      onError?.(error);
    }
  );
}

export function subscribeGroupCalendarEventsForRange(
  groupId: string,
  rangeStartMs: number,
  rangeEndMs: number,
  options: { limit?: number } | undefined,
  onNext: (events: GroupCalendarEventDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGroupId = groupId.trim();
  if (!safeGroupId) {
    onNext([]);
    return () => {};
  }
  if (
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs
  ) {
    throw new Error("Choose a valid calendar range.");
  }
  const resultLimit = Math.max(
    1,
    Math.min(options?.limit ?? DEFAULT_GROUP_CALENDAR_RANGE_LIMIT, MAX_GROUP_CALENDAR_RANGE_LIMIT)
  );
  const qy = query(
    collection(db, "planningCalendarEvents"),
    where("groupId", "==", safeGroupId),
    where("status", "==", "scheduled"),
    where(
      "sortStartMs",
      ">=",
      rangeStartMs -
        (MAX_GROUP_CALENDAR_ALL_DAY_SPAN_DAYS + 1) * 24 * 60 * 60 * 1000
    ),
    where("sortStartMs", "<", rangeEndMs),
    orderBy("sortStartMs", "asc"),
    limit(resultLimit)
  );
  return onSnapshot(
    qy,
    (snapshot) => {
      const events = snapshot.docs
        .map((item) => mapGroupCalendarEventDoc(item.id, item.data()))
        .filter(
          (item): item is GroupCalendarEventDoc =>
            item != null && item.sortEndMs > rangeStartMs
        );
      onNext(events);
    },
    (error) => {
      console.log("[GroupCalendar] range subscription failed", {
  code:
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String(error.code)
      : "unknown",
  message:
    typeof error === "object" &&
    error !== null &&
    "message" in error
      ? String(error.message)
      : "Unknown group-calendar subscription error",
});
      onError?.(error);
    }
  );
}
