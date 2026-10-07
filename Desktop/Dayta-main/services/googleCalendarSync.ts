import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { dayKeyFromMs, getUserTz, startOfDayMs } from "./dateKey";
import { db } from "./firebase";

function parseGoogleEventTime(event: any) {
  const tz = getUserTz();

  const startDateTime = event?.start?.dateTime ?? null;
  const endDateTime = event?.end?.dateTime ?? null;

  const startDate = event?.start?.date ?? null;
  const endDate = event?.end?.date ?? null;

  const allDay = !!startDate && !startDateTime;

  if (allDay) {
    const startMs = startDate ? startOfDayMs(startDate, tz) : null;
    const endMs = endDate ? startOfDayMs(endDate, tz) : startMs;

    return { startMs, endMs, allDay };
  }

  const startRaw = startDateTime ?? startDate ?? null;
  const endRaw = endDateTime ?? endDate ?? null;

  const startMs = startRaw ? new Date(startRaw).getTime() : null;
  const endMs = endRaw ? new Date(endRaw).getTime() : null;

  return { startMs, endMs, allDay };
}

function parseGoogleEventUpdatedMs(event: any) {
  const rawUpdated = event?.updated ?? null;
  if (!rawUpdated) return null;

  const updatedMs = new Date(rawUpdated).getTime();
  return Number.isFinite(updatedMs) ? updatedMs : null;
}

export async function syncGoogleEventsToFirestore(
  uid: string,
  events: any[],
  calendarId = "primary"
) {
  const tz = getUserTz();
  const ref = collection(db, "users", uid, "calendarEvents");

  let written = 0;
  let deleted = 0;
  let skippedCancelled = 0;

  const fetchedEventIds = new Set<string>();

 for (const event of events) {
  console.log("[GoogleSync] incoming event", {
  eventId: String(event?.id ?? ""),
  recurringEventId: event?.recurringEventId ?? null,
  status: event?.status ?? null,
  updated: event?.updated ?? null,
  start: event?.start?.dateTime ?? event?.start?.date ?? null,
  summary: event?.summary ?? null,
});
  const status = event?.status ?? null;

  if (status === "cancelled") {
  skippedCancelled += 1;
  continue;
}

  const { startMs, endMs, allDay } = parseGoogleEventTime(event);
  const updatedMs = parseGoogleEventUpdatedMs(event);

  if (!startMs) continue;

  const eventId = String(event.id);
  fetchedEventIds.add(eventId);

    const startDayKey = dayKeyFromMs(startMs, tz);
    const endDayKey = endMs ? dayKeyFromMs(endMs, tz) : startDayKey;

    await setDoc(doc(ref, eventId), {
      id: eventId,
      userId: uid,

      source: "google",
      externalId: eventId,
      calendarId,

      title: event.summary ?? "(Untitled event)",
      description: event.description ?? null,
      location: event.location ?? null,

      startMs,
      endMs: endMs ?? null,
      allDay,

      startDayKey,
      endDayKey,

      status: event.status ?? null,
      htmlLink: event.htmlLink ?? null,
      rawUpdated: event.updated ?? null,
      updatedMs,

      syncedAtMs: Date.now(),
      syncedAt: serverTimestamp(),
    });

    written += 1;
  }

  const existingSnap = await getDocs(
    query(
      ref,
      where("source", "==", "google"),
      where("calendarId", "==", calendarId)
    )
  );

  for (const docSnap of existingSnap.docs) {
    const existingId = docSnap.id;

    if (!fetchedEventIds.has(existingId)) {
      await deleteDoc(doc(ref, existingId));
      deleted += 1;
    }
  }

  return {
  written,
  deleted,
  scanned: events.length,
  skippedCancelled,
};
}