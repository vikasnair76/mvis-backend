import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import { dayKeyFromDate } from "../../../services/dateKey";
import { runGoogleCalendarAutoSync } from "../../../services/googleCalendarAutoSync";
import type {
  CalendarRangeDayKeys,
  GoogleCalendarEvent,
} from "../types/calendar.types";
import { addDays, doesEventOverlapDate } from "../utils";

export type GoogleCalendarIntegration = {
  connected: boolean;
  googleEmail: string | null;
  selectedCalendarId: string | null;
  lastSyncAtMs: number | null;
  lastError: string | null;
};

/**
 * Google Calendar integration state: connection doc, synced events for the
 * visible range, background auto-sync, and manual refresh.
 */
export function useGoogleCalendar(args: {
  userId: string | null | undefined;
  isReady: boolean;
  rangeKeys: CalendarRangeDayKeys;
  selectedDate: Date;
  tz: string;
}) {
  const { userId, isReady, rangeKeys, selectedDate, tz } = args;

  const [integration, setIntegration] =
    useState<GoogleCalendarIntegration | null>(null);
  const [eventsByDayKey, setEventsByDayKey] = useState<
    Record<string, GoogleCalendarEvent[]>
  >({});
  const [manualSyncing, setManualSyncing] = useState(false);

  const autoSyncInFlightRef = useRef(false);

  const connected = !!integration?.connected;

  // Integration document
  useEffect(() => {
    if (!isReady || !userId) {
      setIntegration(null);
      return;
    }

    const ref = doc(db, "users", userId, "integrations", "googleCalendar");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setIntegration(null);
          return;
        }

        const data = snap.data() as any;
        setIntegration({
          connected: !!data.connected,
          googleEmail: data.googleEmail ?? null,
          selectedCalendarId: data.selectedCalendarId ?? null,
          lastSyncAtMs: data.lastSyncAtMs ?? null,
          lastError: data.lastError ?? null,
        });
      },
      (err) => {
        console.error("[useGoogleCalendar] integration subscription failed", err);
      }
    );

    return () => unsub();
  }, [isReady, userId]);

  // Synced events overlapping the visible range, fanned out per day key so
  // multi-day events appear on every day they cover.
  useEffect(() => {
    if (!isReady || !userId || !connected) {
      setEventsByDayKey({});
      return;
    }

    const qy = query(
      collection(db, "users", userId, "calendarEvents"),
      where("startDayKey", "<=", rangeKeys.endDayKey),
      where("endDayKey", ">=", rangeKeys.startDayKey),
      orderBy("startDayKey"),
      orderBy("startMs")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const next: Record<string, GoogleCalendarEvent[]> = {};

        snap.forEach((docSnap) => {
          const data = docSnap.data() as GoogleCalendarEvent;

          const startKey = data.startDayKey;
          const finalKey = data.endDayKey || data.startDayKey;
          if (!startKey || !finalKey || finalKey < startKey) return;

          let cursor = startKey;

          while (cursor <= finalKey) {
            if (!next[cursor]) next[cursor] = [];
            next[cursor].push({ ...data, id: docSnap.id });

            const cursorDate = new Date(`${cursor}T12:00:00`);
            cursor = dayKeyFromDate(addDays(cursorDate, 1), tz);
          }
        });

        Object.values(next).forEach((events) => {
          events.sort((a, b) => a.startMs - b.startMs);
        });

        setEventsByDayKey(next);
      },
      (err) => {
        console.error("[useGoogleCalendar] events subscription failed", err);
      }
    );

    return () => unsub();
  }, [
    isReady,
    userId,
    connected,
    rangeKeys.startDayKey,
    rangeKeys.endDayKey,
    tz,
  ]);

  // Background sync once the integration reports connected.
  useEffect(() => {
    if (!isReady || !userId || !connected) return;
    if (autoSyncInFlightRef.current) return;

    autoSyncInFlightRef.current = true;

    runGoogleCalendarAutoSync(integration)
      .catch((err) => console.error("[useGoogleCalendar] auto-sync failed", err))
      .finally(() => {
        autoSyncInFlightRef.current = false;
      });
    // `integration` is intentionally read fresh but not tracked: re-running on
    // every lastSyncAtMs write would loop the sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, userId, connected]);

  const allEvents = useMemo(() => {
    const seen = new Set<string>();
    const out: GoogleCalendarEvent[] = [];

    for (const dayKey of Object.keys(eventsByDayKey)) {
      for (const event of eventsByDayKey[dayKey] ?? []) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        out.push(event);
      }
    }

    out.sort((a, b) => a.startMs - b.startMs);
    return out;
  }, [eventsByDayKey]);

  const allEventsById = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent>();
    for (const event of allEvents) map.set(event.id, event);
    return map;
  }, [allEvents]);

  const selectedDayEvents = useMemo(
    () => allEvents.filter((event) => doesEventOverlapDate(event, selectedDate)),
    [allEvents, selectedDate]
  );

  const refresh = useCallback(async () => {
    if (manualSyncing) return;

    try {
      setManualSyncing(true);

      const result = await runGoogleCalendarAutoSync(integration, {
        force: true,
      });

      if (result?.skipped && result.reason === "not_signed_in") {
        Alert.alert("Sync unavailable", "Please sign in first.");
        return;
      }

      if (result?.skipped && result.reason === "not_connected") {
        Alert.alert(
          "Sync unavailable",
          "Connect Google Calendar in Settings before refreshing."
        );
        return;
      }

      Alert.alert("Google Calendar refreshed", "Sync completed successfully.");
    } catch (e: any) {
      console.error("[useGoogleCalendar] manual refresh failed", e);
      Alert.alert("Refresh failed", e?.message ?? "Unknown error");
    } finally {
      setManualSyncing(false);
    }
  }, [manualSyncing, integration]);

  return {
    integration,
    connected,
    eventsByDayKey,
    allEvents,
    allEventsById,
    selectedDayEvents,
    manualSyncing,
    refresh,
  };
}
