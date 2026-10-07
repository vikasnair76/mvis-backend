import { useEffect, useState, useCallback } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../services/firebase";
import {
  createCalendarRule,
  createSuggestSubtaskRule,
  deleteCalendarRules,
  type CalendarRuleRecord,
  type CalendarRuleType,
} from "../../../services/calendarRules";

export function useCalendarRules(userId: string | null | undefined, isReady: boolean) {
  const [calendarRules, setCalendarRules] = useState<CalendarRuleRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isReady || !userId) {
      setCalendarRules([]);
      return;
    }

    setLoading(true);
    const rulesRef = collection(db, "users", userId, "calendarRules");

    const unsub = onSnapshot(
      rulesRef,
      (snap) => {
        const next: CalendarRuleRecord[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<CalendarRuleRecord, "id">),
        }));
        setCalendarRules(next);
        setLoading(false);
      },
      (err) => {
        console.error("[useCalendarRules] subscription error", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isReady, userId]);

  const saveRule = useCallback(
    async (params: {
      type: CalendarRuleType;
      eventTitle: string;
      goalId: string;
      subtaskId: string;
    }) => {
      if (!userId) throw new Error("No user logged in");
      return createCalendarRule({
        userId,
        type: params.type,
        eventTitle: params.eventTitle,
        goalId: params.goalId,
        subtaskId: params.subtaskId,
      });
    },
    [userId]
  );

  const saveSuggestRule = useCallback(
    async (params: {
      eventTitle: string;
      goalId: string;
      subtaskId: string;
    }) => {
      if (!userId) throw new Error("No user logged in");
      return createSuggestSubtaskRule({
        userId,
        eventTitle: params.eventTitle,
        goalId: params.goalId,
        subtaskId: params.subtaskId,
      });
    },
    [userId]
  );

  const removeRules = useCallback(
    async (params: {
      type: CalendarRuleType;
      eventTitle: string;
      goalId: string;
      subtaskId: string;
    }) => {
      if (!userId) throw new Error("No user logged in");
      return deleteCalendarRules({
        userId,
        type: params.type,
        eventTitle: params.eventTitle,
        goalId: params.goalId,
        subtaskId: params.subtaskId,
      });
    },
    [userId]
  );

  return {
    calendarRules,
    loading,
    saveRule,
    saveSuggestRule,
    removeRules,
  };
}
