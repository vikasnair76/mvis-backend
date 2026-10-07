import React from "react";
import { Pressable, Text } from "react-native";
import type { SettingsStyles } from "../styles/settings.styles";
import type { CalendarIntegrationState } from "../types/settings.types";

interface GoogleCalendarSectionProps {
  styles: SettingsStyles;
  integration: CalendarIntegrationState;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}

export function GoogleCalendarSection({
  styles,
  integration,
  busy,
  onConnect,
  onSync,
  onDisconnect,
}: GoogleCalendarSectionProps) {
  return (
    <>
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={onConnect}
        disabled={busy}
      >
        <Text style={styles.buttonText}>
          {busy ? "Working..." : "Connect Google Calendar"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={onSync}
        disabled={busy}
      >
        <Text style={styles.buttonText}>
          {busy ? "Working..." : "Sync Google Calendar"}
        </Text>
      </Pressable>

      {integration?.connected ? (
        <Pressable
          style={[styles.button, styles.secondary, busy && styles.buttonDisabled]}
          onPress={onDisconnect}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>
            {busy ? "Working..." : "Disconnect Google Calendar"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}
