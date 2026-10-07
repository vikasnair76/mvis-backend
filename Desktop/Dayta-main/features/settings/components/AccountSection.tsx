import { Pressable, Text, View } from "react-native";
import type { SettingsStyles } from "../styles/settings.styles";

interface AccountSectionProps {
  styles: SettingsStyles;
  busy: boolean;
  isSignedIn: boolean;
  email?: string | null;
  onSignIn: () => void;
  onLogOut: () => void;
}

export function AccountSection({
  styles,
  busy,
  isSignedIn,
  email,
  onSignIn,
  onLogOut,
}: AccountSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Account</Text>

      <View style={styles.settingsCard}>
        {isSignedIn ? (
          <>
            <View style={styles.settingsRow}>
              <View>
                <Text style={styles.settingsRowTitle}>Google Account</Text>
                <Text style={styles.settingsRowSubtitle}>
                  {email ?? "Signed in"}
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.settingsRow}
              onPress={onLogOut}
            >
              <Text style={styles.destructiveText}>Sign Out</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.settingsRow}
            onPress={onSignIn}
            disabled={busy}
          >
            <View>
              <Text style={styles.settingsRowTitle}>
                Google Account
              </Text>

              <Text style={styles.settingsRowSubtitle}>
                {busy ? "Signing in..." : "Sign in to continue"}
              </Text>
            </View>

            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}