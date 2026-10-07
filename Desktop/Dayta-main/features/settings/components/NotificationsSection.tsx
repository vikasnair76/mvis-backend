import React from "react";
import { Pressable, Text, View } from "react-native";
import type { SettingsStyles } from "../styles/settings.styles";

interface NotificationsSectionProps {
  styles: SettingsStyles;
  pushBusy: boolean;
  onRegisterPush: () => void;
  onDisablePush: () => void;
  onRequestPermission: () => void;
}

/** Push-token card plus the OS permission button. */
export function NotificationsSection({
  styles,
  pushBusy,
  onRegisterPush,
  onDisablePush,
  onRequestPermission,
}: NotificationsSectionProps) {
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Push Notifications</Text>

        <Text style={styles.helperText}>
          Register this device for future server-sent reminders. Local reminders
          still work separately for now.
        </Text>

        <Pressable
          style={[styles.button, pushBusy && styles.buttonDisabled]}
          onPress={onRegisterPush}
          disabled={pushBusy}
        >
          <Text style={styles.buttonText}>
            {pushBusy ? "Registering..." : "Register push token"}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.secondary, pushBusy && styles.buttonDisabled]}
          onPress={onDisablePush}
          disabled={pushBusy}
        >
          <Text style={styles.secondaryButtonText}>
            {pushBusy ? "Working..." : "Disable push notifications"}
          </Text>
        </Pressable>
      </View>

      <Pressable style={styles.button} onPress={onRequestPermission}>
        <Text style={styles.buttonText}>Enable notifications</Text>
      </Pressable>
    </>
  );
}
