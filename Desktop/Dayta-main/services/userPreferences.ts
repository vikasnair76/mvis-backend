import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { DEFAULT_THEME_ID, getAppTheme, type AppThemeId } from "./theme";

export type UserPreferences = {
  themeId: AppThemeId;
};

export async function getUserPreferences(uid: string): Promise<UserPreferences> {
  const ref = doc(db, "users", uid, "settings", "preferences");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return {
      themeId: DEFAULT_THEME_ID,
    };
  }

  const data = snap.data();
  const theme = getAppTheme(data.themeId);

  return {
    themeId: theme.id,
  };
}

export async function saveUserThemePreference(
  uid: string,
  themeId: AppThemeId
) {
  const ref = doc(db, "users", uid, "settings", "preferences");

  await setDoc(
    ref,
    {
      themeId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}