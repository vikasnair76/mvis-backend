import {
    doc,
    serverTimestamp,
    setDoc,
    updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export type PushReminderStatus =
  | "scheduled"
  | "sent"
  | "cancelled"
  | "failed";

export type UpsertPushReminderQueueInput = {
  uid: string;
  goalId: string;
  subtaskId: string;
  title: string;
  reminderAtMs: number | null;
  expoPushToken: string | null;
};

export function getPushReminderId(goalId: string, subtaskId: string): string {
  return `${goalId}_${subtaskId}`;
}

export async function upsertPushReminderQueueDoc({
  uid,
  goalId,
  subtaskId,
  title,
  reminderAtMs,
  expoPushToken,
}: UpsertPushReminderQueueInput): Promise<string | null> {
  if (!uid) return null;
  if (!goalId) return null;
  if (!subtaskId) return null;
  if (typeof reminderAtMs !== "number") return null;
  if (!expoPushToken) return null;

  const reminderId = getPushReminderId(goalId, subtaskId);

  await setDoc(
    doc(db, "scheduledReminders", reminderId),
    {
      id: reminderId,
      uid,
      goalId,
      subtaskId,
      title,
      reminderAtMs,
      expoPushToken,
      status: "scheduled" as PushReminderStatus,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return reminderId;
}

export async function cancelPushReminderQueueDoc(params: {
  goalId: string;
  subtaskId: string;
}) {
  const reminderId = getPushReminderId(params.goalId, params.subtaskId);

  await updateDoc(doc(db, "scheduledReminders", reminderId), {
    status: "cancelled" as PushReminderStatus,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}