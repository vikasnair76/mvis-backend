import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { auth } from "../../../services/firebase";
import type { AppThemeId } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import { saveUserThemePreference } from "../../../services/userPreferences";

/** The active theme id and the persisted selection action. */
export function useThemePreference() {
  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const [saving, setSaving] = useState(false);

  const select = useCallback(async (themeId: AppThemeId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in to save your theme.");
      return;
    }

    try {
      setSaving(true);
      await saveUserThemePreference(uid, themeId);
    } catch (e: any) {
      console.error("[Settings] failed to save theme", e);
      Alert.alert("Theme not saved", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }, []);

  return { selectedThemeId, saving, select };
}
