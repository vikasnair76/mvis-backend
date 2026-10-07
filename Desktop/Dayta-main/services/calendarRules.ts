import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

export type CalendarRuleType =
  | "suggest_subtask"
  | "auto_link"
  | "auto_apply_duration";

export type CalendarRuleRecord = {
  id: string;
  userId: string;
  type: CalendarRuleType;
  matchText: string;
  goalId: string;
  subtaskId: string;
  createdAtMs: number;
};

export function normalizeCalendarRuleMatchText(value: unknown) {
  if (typeof value !== "string") return "";

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createSuggestSubtaskRule(params: {
  userId: string;
  eventTitle: string;
  goalId: string;
  subtaskId: string;
}) {
  const matchText = normalizeCalendarRuleMatchText(params.eventTitle);
  if (!matchText) return null;

  const rulesRef = collection(db, "users", params.userId, "calendarRules");

  const existingSnap = await getDocs(
    query(
      rulesRef,
      where("type", "==", "suggest_subtask"),
      where("matchText", "==", matchText),
      where("goalId", "==", params.goalId),
      where("subtaskId", "==", params.subtaskId),
      limit(1)
    )
  );

  if (!existingSnap.empty) {
    return existingSnap.docs[0].id;
  }

  const docRef = await addDoc(rulesRef, {
    userId: params.userId,
    type: "suggest_subtask",
    matchText,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  return docRef.id;
}

export async function createCalendarRule(params: {
  userId: string;
  type: CalendarRuleType;
  eventTitle: string;
  goalId: string;
  subtaskId: string;
}) {
  const matchText = normalizeCalendarRuleMatchText(params.eventTitle);
  if (!matchText) return null;

  const rulesRef = collection(db, "users", params.userId, "calendarRules");

  const existingSnap = await getDocs(
    query(
      rulesRef,
      where("type", "==", params.type),
      where("matchText", "==", matchText),
      where("goalId", "==", params.goalId),
      where("subtaskId", "==", params.subtaskId),
      limit(1)
    )
  );

  if (!existingSnap.empty) {
    return existingSnap.docs[0].id;
  }

  const docRef = await addDoc(rulesRef, {
    userId: params.userId,
    type: params.type,
    matchText,
    goalId: params.goalId,
    subtaskId: params.subtaskId,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  return docRef.id;
}

export function getSuggestSubtaskRuleBoost(params: {
  eventTitle: string;
  ruleMatchText?: string | null;
}) {
  const eventText = normalizeCalendarRuleMatchText(params.eventTitle);
  const ruleText = normalizeCalendarRuleMatchText(params.ruleMatchText ?? "");

  if (!eventText || !ruleText) return 0;

  if (eventText === ruleText) return 35;
  if (eventText.includes(ruleText) || ruleText.includes(eventText)) return 18;

  return 0;
}
export async function deleteCalendarRules(params: {
  userId: string;
  type: CalendarRuleType;
  eventTitle: string;
  goalId: string;
  subtaskId: string;
}) {
  const matchText = normalizeCalendarRuleMatchText(params.eventTitle);
  if (!matchText) return 0;

  const rulesRef = collection(db, "users", params.userId, "calendarRules");

  const snap = await getDocs(
    query(
      rulesRef,
      where("type", "==", params.type),
      where("matchText", "==", matchText),
      where("goalId", "==", params.goalId),
      where("subtaskId", "==", params.subtaskId)
    )
  );

  let deletedCount = 0;

  for (const docSnap of snap.docs) {
    await deleteDoc(docSnap.ref);
    deletedCount += 1;
  }

  return deletedCount;
}