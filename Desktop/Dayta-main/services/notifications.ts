import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getNotificationPermissionStatus() {
  const result = await Notifications.getPermissionsAsync();
  return result.status;
}

export async function requestGoalAppNotificationPermission() {
  const existing = await Notifications.getPermissionsAsync();

  if (existing.status === "granted") {
    return existing.status;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status;
}
export async function scheduleGoalAppTestNotification() {
  const status = await requestGoalAppNotificationPermission();

  if (status !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "GoalApp reminder",
      body: "This is your first local notification test.",
      data: {
        source: "goalapp_test",
      },
    },
    trigger: {
  type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
  seconds: 5,
},
  });
}
export async function scheduleSubtaskNotification(params: {
  goalId: string;
  subtaskId: string;
  title: string;
  dueAtMs: number;
}) {
  const status = await requestGoalAppNotificationPermission();

  if (status !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const triggerDate = new Date(params.dueAtMs);

  if (triggerDate.getTime() <= Date.now()) {
    throw new Error("Cannot schedule a notification in the past.");
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "GoalApp reminder",
      body: params.title,
      data: {
        source: "goalapp_subtask",
        goalId: params.goalId,
        subtaskId: params.subtaskId,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}
export async function cancelScheduledSubtaskNotification(
  scheduledNotificationId?: string | null
) {
  if (!scheduledNotificationId) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(
      scheduledNotificationId
    );
  } catch (error) {
    console.warn("[Notifications] Failed to cancel scheduled notification", {
      scheduledNotificationId,
      error,
    });
  }
}