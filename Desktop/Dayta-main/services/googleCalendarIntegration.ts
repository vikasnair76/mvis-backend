import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export async function saveGoogleCalendarIntegration(
  uid: string,
  data: {
    connected: boolean;
    googleEmail?: string | null;
    selectedCalendarId?: string | null;
    lastSyncAtMs?: number | null;
    lastError?: string | null;
  }
) {
  await setDoc(
    doc(db, "users", uid, "integrations", "googleCalendar"),
    {
      connected: data.connected,
      googleEmail: data.googleEmail ?? null,
      selectedCalendarId: data.selectedCalendarId ?? "primary",
      lastSyncAtMs: data.lastSyncAtMs ?? null,
      lastError: data.lastError ?? null,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}