import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { auth } from "../../../services/firebase";
import {
  getNotificationPermissionStatus,
  requestGoalAppNotificationPermission,
  scheduleGoalAppTestNotification,
} from "../../../services/notifications";
import {
  disableExpoPushNotificationsAsync,
  registerForExpoPushNotificationsAsync,
} from "../../../services/pushNotifications";

/** Expo push token registration, OS permission prompt, and the test ping. */
export function usePushNotifications() {
  const [busy, setBusy] = useState(false);

  const register = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in first.");
      return;
    }
    if (busy) return;

    try {
      setBusy(true);
      const result = await registerForExpoPushNotificationsAsync(uid);

      if (!result.ok) {
        Alert.alert("Push registration failed", result.reason);
        return;
      }

      Alert.alert(
        "Push registered",
        `Expo push token saved.\n\n${result.expoPushToken.slice(0, 24)}...`
      );
    } catch (e: any) {
      console.error("[Push] register failed", e);
      Alert.alert("Push registration failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disable = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in first.");
      return;
    }
    if (busy) return;

    try {
      setBusy(true);
      await disableExpoPushNotificationsAsync(uid);
      Alert.alert("Push disabled", "Push notifications are disabled for this account.");
    } catch (e: any) {
      console.error("[Push] disable failed", e);
      Alert.alert("Push disable failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const requestPermission = useCallback(async () => {
    const before = await getNotificationPermissionStatus();
    const after = await requestGoalAppNotificationPermission();
    Alert.alert("Notification permission", `Before: ${before}\nAfter: ${after}`);
  }, []);

  const sendTest = useCallback(async () => {
    try {
      const id = await scheduleGoalAppTestNotification();
      Alert.alert(
        "Notification scheduled",
        `Test notification scheduled in 5 seconds.\n\nID: ${id}`
      );
    } catch (e: any) {
      Alert.alert("Notification failed", e?.message ?? "Unknown error");
    }
  }, []);

  return { busy, register, disable, requestPermission, sendTest };
}
