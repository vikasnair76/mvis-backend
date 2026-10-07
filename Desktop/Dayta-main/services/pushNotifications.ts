import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "./firebase";

export type PushRegistrationResult =
  | {
      ok: true;
      expoPushToken: string;
    }
  | {
      ok: false;
      reason: string;
    };

export async function registerForExpoPushNotificationsAsync(
  uid: string
): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return {
      ok: false,
      reason: "Push notifications require a physical device.",
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#4F46E5",
    });
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  let finalStatus = existingPermissions.status;

  if (finalStatus !== "granted") {
    const requestedPermissions = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermissions.status;
  }

  if (finalStatus !== "granted") {
    await savePushRegistrationState(uid, {
      pushNotificationsEnabled: false,
      expoPushToken: null,
      pushTokenError: "Permission not granted.",
    });

    return {
      ok: false,
      reason: "Notification permission was not granted.",
    };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    return {
      ok: false,
      reason: "Missing EAS projectId for Expo push token registration.",
    };
  }

  const token = (
    await Notifications.getExpoPushTokenAsync({
      projectId,
    })
  ).data;

  await savePushRegistrationState(uid, {
    pushNotificationsEnabled: true,
    expoPushToken: token,
    pushTokenError: null,
  });

  return {
    ok: true,
    expoPushToken: token,
  };
}

export async function disableExpoPushNotificationsAsync(uid: string) {
  await savePushRegistrationState(uid, {
    pushNotificationsEnabled: false,
  });
}

async function savePushRegistrationState(
  uid: string,
  patch: {
    pushNotificationsEnabled?: boolean;
    expoPushToken?: string | null;
    pushTokenError?: string | null;
  }
) {
  await updateDoc(doc(db, "users", uid), {
    ...patch,
    pushTokenUpdatedAtMs: Date.now(),
    pushTokenUpdatedAt: serverTimestamp(),
  });
}