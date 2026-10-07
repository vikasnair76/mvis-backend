import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import {
  archivePlanningCalendarEvent,
  createPlanningCalendarEvent,
  mapPlanningCalendarEventDoc,
  subscribePersonalPlanningCalendarEvents,
  type PlanningCalendarEventDoc,
} from "../../../services/planningCalendar";

export function usePlanningEvents(userId: string | null | undefined, isReady: boolean) {
  const [planningEvents, setPlanningEvents] = useState<PlanningCalendarEventDoc[]>([]);
  const [loading, setLoading] = useState(false);

  const reloadEvents = useCallback(async () => {
    if (!userId) {
      setPlanningEvents([]);
      return;
    }

    try {
      setLoading(true);
      const q = query(
        collection(db, "planningCalendarEvents"),
        where("scope", "==", "personal"),
        where("ownerUid", "==", userId),
        where("archived", "==", false),
        orderBy("startAtMs", "asc")
      );

      const snap = await getDocs(q);
      const events = snap.docs.map((d) =>
        mapPlanningCalendarEventDoc(d.id, d.data())
      );
      setPlanningEvents(events);
    } catch (err) {
      console.log("[usePlanningEvents] reload failed", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isReady || !userId) {
      setPlanningEvents([]);
      return;
    }

    setLoading(true);
    const unsub = subscribePersonalPlanningCalendarEvents(
      userId,
      (events) => {
        setPlanningEvents(events);
        setLoading(false);
      },
      (err) => {
        console.log("[usePlanningEvents] subscription failed", err);
        setPlanningEvents([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isReady, userId]);

  const addEvent = useCallback(
    async (params: {
      title: string;
      description?: string | null;
      startAtMs: number;
      endAtMs: number;
      allDay?: boolean;
    }) => {
      if (!userId) throw new Error("No user logged in");
      return createPlanningCalendarEvent({
        scope: "personal",
        ownerUid: userId,
        createdByUid: userId,
        title: params.title,
        description: params.description ?? null,
        startAtMs: params.startAtMs,
        endAtMs: params.endAtMs,
        allDay: params.allDay,
      });
    },
    [userId]
  );

  const removeEvent = useCallback(
    async (eventId: string) => {
      if (!userId) throw new Error("No user logged in");
      return archivePlanningCalendarEvent({
        eventId,
      });
    },
    [userId]
  );

  return {
    planningEvents,
    loading,
    reloadEvents,
    addEvent,
    removeEvent,
  };
}
