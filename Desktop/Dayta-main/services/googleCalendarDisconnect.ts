import {
    collection,
    getDocs,
    writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { saveGoogleCalendarIntegration } from "./googleCalendarIntegration";

export async function disconnectGoogleCalendar(uid: string) {
  const eventsRef = collection(db, "users", uid, "calendarEvents");
  const snap = await getDocs(eventsRef);

  let deleted = 0;

  if (!snap.empty) {
    const batch = writeBatch(db);

    // 🔹 THIS is where that snippet goes
    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.source === "google") {
        batch.delete(docSnap.ref);
        deleted += 1;
      }
    });

    await batch.commit();
  }

  await saveGoogleCalendarIntegration(uid, {
    connected: false,
    googleEmail: null,
    selectedCalendarId: null,
    lastSyncAtMs: null,
    lastError: null,
  });

  return { deleted };
}