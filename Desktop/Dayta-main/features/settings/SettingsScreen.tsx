import React, { useMemo } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { useAppTheme } from "../../services/useAppTheme";
import {
  AccountSection,
  GoogleCalendarSection,
  NotificationsSection,
  PlannerPreferencesSection,
  StatusFooter,
  SupportSection,
  ThemeSection,
} from "./components";
import {
  useAuthUser,
  useGoogleCalendarIntegration,
  useGoogleSignIn,
  usePlannerPreferences,
  usePushNotifications,
  useThemePreference,
} from "./hooks";
import { createSettingsStyles } from "./styles/settings.styles";

export function SettingsScreen() {
  const user = useAuthUser();
  const uid = user?.uid ?? null;

  const themePreference = useThemePreference();
  const theme = useAppTheme(themePreference.selectedThemeId);
  const styles = useMemo(() => createSettingsStyles(theme), [theme]);

  const googleSignIn = useGoogleSignIn();
  const googleCalendar = useGoogleCalendarIntegration(uid);
  const push = usePushNotifications();
  const planner = usePlannerPreferences(uid);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Account */}
      <AccountSection
        styles={styles}
        busy={googleSignIn.busy}
        onSignIn={() => void googleSignIn.signIn()}
        onLogOut={() => void googleSignIn.logOut()}
      />

      {/* 2. Google Calendar connect / sync / disconnect */}
      <GoogleCalendarSection
        styles={styles}
        integration={googleCalendar.integration}
        busy={googleCalendar.busy}
        onConnect={() => void googleCalendar.connect()}
        onSync={() => void googleCalendar.sync()}
        onDisconnect={() => void googleCalendar.disconnect()}
      />

      {/* 3. Automation preferences link + Feedback & Support */}
      <SupportSection styles={styles} theme={theme} />

      {/* 4. Push token + OS permission */}
      <NotificationsSection
        styles={styles}
        pushBusy={push.busy}
        onRegisterPush={() => void push.register()}
        onDisablePush={() => void push.disable()}
        onRequestPermission={() => void push.requestPermission()}
      />

      {/* 5. Planner suggestion preferences */}
      <PlannerPreferencesSection
        styles={styles}
        theme={theme}
        preferences={planner.preferences}
        saving={planner.saving}
        onSave={(patch) => void planner.save(patch)}
      />

      {/* 6. Test notification */}
      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => void push.sendTest()}
      >
        <Text style={styles.secondaryButtonText}>Send test notification</Text>
      </Pressable>

      {/* 7. Theme picker */}
      <ThemeSection
        styles={styles}
        selectedThemeId={themePreference.selectedThemeId}
        saving={themePreference.saving}
        onSelect={(id) => void themePreference.select(id)}
      />

      {/* 8. Diagnostics */}
      <StatusFooter
        styles={styles}
        user={user}
        integration={googleCalendar.integration}
      />
    </ScrollView>
  );
}
