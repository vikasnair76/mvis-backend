import React from "react";
import { Text, View } from "react-native";
import type { User } from "firebase/auth";
import type { SettingsStyles } from "../styles/settings.styles";
import type { CalendarIntegrationState } from "../types/settings.types";
import { formatLastSync } from "../utils";

interface StatusFooterProps {
  styles: SettingsStyles;
  user: User | null;
  integration: CalendarIntegrationState;
}

/** Diagnostic lines at the bottom: integration state, auth state, uid. */
export function StatusFooter({ styles, user, integration }: StatusFooterProps) {
  return (
    <>
      <View style={{ width: "100%", marginTop: 16 }}>
        <Text style={styles.small}>
          Google Calendar: {integration?.connected ? "Connected" : "Not connected"}
        </Text>

        {integration?.googleEmail ? (
          <Text style={styles.small}>Google account: {integration.googleEmail}</Text>
        ) : null}

        <Text style={styles.small}>
          Last sync: {formatLastSync(integration?.lastSyncAtMs)}
        </Text>

        {integration?.lastError ? (
          <Text style={styles.small}>Last error: {integration.lastError}</Text>
        ) : null}
      </View>

      <Text style={styles.small}>
        Status: {user ? `Signed in as ${user.email}` : "Signed out"}
      </Text>

      <Text style={styles.small}>UID: {user?.uid ?? "none"}</Text>
    </>
  );
}
