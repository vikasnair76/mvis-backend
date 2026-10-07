import { auth } from "./firebase";
import {
  fetchPrimaryCalendarEventById,
  fetchPrimaryCalendarEvents,
} from "./googleCalendarApi";
import { connectGoogleCalendar } from "./googleCalendarAuth";
import { saveGoogleCalendarIntegration } from "./googleCalendarIntegration";
import { syncGoogleEventsToFirestore } from "./googleCalendarSync";

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

export function shouldAutoSync(lastSyncAtMs?: number | null) {
  if (!lastSyncAtMs) return true;
  return Date.now() - lastSyncAtMs > AUTO_SYNC_INTERVAL_MS;
}

export async function runGoogleCalendarAutoSync(
  
  integration: {
    connected: boolean;
    lastSyncAtMs?: number | null;
  } | null,
  options?: {
    force?: boolean;
    linkedEventIds?: string[];
  }
) {
  
  const uid = auth.currentUser?.uid;

  if (!uid) return { skipped: true, reason: "not_signed_in" };
  if (!integration?.connected) return { skipped: true, reason: "not_connected" };
  const force = options?.force === true;
  
  const linkedEventIds = Array.isArray(options?.linkedEventIds)
  ? Array.from(new Set(options!.linkedEventIds.filter(Boolean)))
  : [];
  console.log("[GoogleAutoSync] run invoked", {
  force,
  linkedEventIds,
  lastSyncAtMs: integration?.lastSyncAtMs ?? null,
});
  console.log("[GoogleAutoSync] linkedEventIds", linkedEventIds);

if (!force && !shouldAutoSync(integration.lastSyncAtMs)) {
  return { skipped: true, reason: "recently_synced" };
}

  const token = await connectGoogleCalendar();

  const now = new Date();
  const timeMin = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7
  ).toISOString();

  const timeMax = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  ).toISOString();

  const eventsResponse = await fetchPrimaryCalendarEvents(token, timeMin, timeMax);
const rangeEvents = eventsResponse.items ?? [];

const linkedEvents: any[] = [];


for (const eventId of linkedEventIds) {
  try {
    const event = await fetchPrimaryCalendarEventById(token, eventId);
    linkedEvents.push(event);
  } catch (e) {
    console.error("[GoogleAutoSync] linked event fetch failed", {
      eventId,
      error: e,
    });
  }
}

const mergedById = new Map<string, any>();

for (const event of rangeEvents) {
  if (event?.id) {
    mergedById.set(String(event.id), event);
  }
}

for (const event of linkedEvents) {
  if (event?.id) {
    mergedById.set(String(event.id), event);
  }
}

const events = Array.from(mergedById.values());
console.log("[GoogleAutoSync] sync payload counts", {
  rangeEvents: rangeEvents.length,
  linkedEvents: linkedEvents.length,
  mergedEvents: events.length,
});
const syncResult = await syncGoogleEventsToFirestore(uid, events, "primary");

  await saveGoogleCalendarIntegration(uid, {
    connected: true,
    googleEmail: auth.currentUser?.email ?? null,
    selectedCalendarId: "primary",
    lastSyncAtMs: Date.now(),
    lastError: null,
  });

  return {
    skipped: false,
    eventsCount: events.length,
     scanned: syncResult.scanned,
    written: syncResult.written,
    deleted: syncResult.deleted,
    skippedCancelled: syncResult.skippedCancelled,
  };
}