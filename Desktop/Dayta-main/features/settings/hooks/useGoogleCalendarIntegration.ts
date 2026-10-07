import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../../services/firebase";
import { fetchPrimaryCalendarEvents } from "../../../services/googleCalendarApi";
import { connectGoogleCalendar } from "../../../services/googleCalendarAuth";
import { runGoogleCalendarAutoSync } from "../../../services/googleCalendarAutoSync";
import { disconnectGoogleCalendar } from "../../../services/googleCalendarDisconnect";
import { saveGoogleCalendarIntegration } from "../../../services/googleCalendarIntegration";
import { syncGoogleEventsToFirestore } from "../../../services/googleCalendarSync";
import type {
  CalendarIntegrationState,
  GoogleCalendarSyncSummary,
} from "../types/settings.types";
import { getManualSyncWindow } from "../utils";

/**
 * Google Calendar integration for the current user: the live integration
 * doc, a background auto-sync once connected, and the connect / sync /
 * disconnect actions.
 */
export function useGoogleCalendarIntegration(userId: string | null) {
  const [integration, setIntegration] = useState<CalendarIntegrationState>(null);
  const [busy, setBusy] = useState(false);

  // Live integration document
  useEffect(() => {
    if (!userId) {
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
        console.error("[Settings] googleCalendar integration subscription failed", err);
      }
    );

    return () => unsub();
  }, [userId]);

  // Background sync once the doc reports connected.
  const connected = !!integration?.connected;
  useEffect(() => {
    if (!connected) return;

    runGoogleCalendarAutoSync(integration).catch((err) => {
      console.log("[Settings] google auto-sync skipped", err);
    });
    // Re-running on every lastSyncAtMs write would loop the sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  /**
   * Full manual pull: acquire a calendar token, fetch a window of primary
   * events, write them to Firestore, and mark the integration connected.
   */
  const runManualSync = useCallback(async (): Promise<GoogleCalendarSyncSummary | null> => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in first.");
      return null;
    }

    const token = await connectGoogleCalendar();
    const { timeMin, timeMax } = getManualSyncWindow();

    const eventsResponse = await fetchPrimaryCalendarEvents(token, timeMin, timeMax);
    const events = eventsResponse.items ?? [];

    const syncResult = await syncGoogleEventsToFirestore(uid, events, "primary");

    await saveGoogleCalendarIntegration(uid, {
      connected: true,
      googleEmail: auth.currentUser?.email ?? null,
      selectedCalendarId: "primary",
      lastSyncAtMs: Date.now(),
      lastError: null,
    });

    return { eventsCount: events.length, written: syncResult.written };
  }, []);

  /** Connect and sync share one path; only the alert wording differs. */
  const connectOrSync = useCallback(
    async (mode: "connect" | "sync") => {
      if (busy) return;

      try {
        setBusy(true);
        const result = await runManualSync();
        if (!result) return;

        Alert.alert(
          mode === "connect" ? "Google Connected" : "Google Calendar Synced",
          `Fetched ${result.eventsCount} event(s)\nSaved ${result.written} event(s) to Firestore.`
        );
      } catch (err: any) {
        console.error("[Settings] google calendar sync failed", err);

        const uid = auth.currentUser?.uid;
        if (uid) {
          await saveGoogleCalendarIntegration(uid, {
            connected: false,
            lastError: err?.message ?? "Unknown error",
          }).catch(() => undefined);
        }

        Alert.alert(
          mode === "connect" ? "Google connection failed" : "Google sync failed",
          err?.message ?? "Unknown error"
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, runManualSync]
  );

  const disconnect = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in first.");
      return;
    }
    if (busy) return;

    try {
      setBusy(true);
      const result = await disconnectGoogleCalendar(uid);
      Alert.alert(
        "Google Calendar disconnected",
        `Removed ${result.deleted} synced event(s).`
      );
    } catch (err: any) {
      console.error("[Settings] disconnect failed", err);
      Alert.alert("Disconnect failed", err?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return {
    integration,
    busy,
    connect: () => connectOrSync("connect"),
    sync: () => connectOrSync("sync"),
    disconnect,
  };
}
