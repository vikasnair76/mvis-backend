import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebase";
import { DEFAULT_THEME_ID, getAppTheme, type AppThemeId } from "./theme";

function normalizeThemeId(value: unknown): AppThemeId {
 if (
  value === "daytaGold" ||
  value === "indigoFocus" ||
  value === "peachGrove" ||
  value === "graphiteDark" ||
  value === "paperWhite" ||
  value === "roseQuartz"
) {
  return value;
}

  return DEFAULT_THEME_ID;
}

export function useCurrentAppTheme() {
  const [themeId, setThemeId] = useState<AppThemeId>(DEFAULT_THEME_ID);
  const [loadingTheme, setLoadingTheme] = useState(true);

  useEffect(() => {
    let unsubscribePrefs: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribePrefs?.();
      unsubscribePrefs = null;

      if (!user) {
        setThemeId(DEFAULT_THEME_ID);
        setLoadingTheme(false);
        return;
      }

      setLoadingTheme(true);

      const ref = doc(db, "users", user.uid, "settings", "preferences");

      unsubscribePrefs = onSnapshot(
        ref,
        (snap) => {
          const nextThemeId = normalizeThemeId(snap.data()?.themeId);
          setThemeId(nextThemeId);
          setLoadingTheme(false);
        },
        (error) => {
          console.error("[Theme] failed to subscribe to preferences", error);
          setThemeId(DEFAULT_THEME_ID);
          setLoadingTheme(false);
        }
      );
    });

    return () => {
      unsubscribePrefs?.();
      unsubscribeAuth();
    };
  }, []);

  const theme = useMemo(() => getAppTheme(themeId), [themeId]);

  return {
    themeId,
    theme,
    loadingTheme,
  };
}