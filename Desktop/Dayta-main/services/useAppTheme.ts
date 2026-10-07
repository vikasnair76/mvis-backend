import { useMemo } from "react";
import { DEFAULT_THEME_ID, getAppTheme, type AppThemeId } from "./theme";

export function useAppTheme(themeId?: AppThemeId | string | null) {
  const theme = useMemo(() => {
    return getAppTheme(themeId ?? DEFAULT_THEME_ID);
  }, [themeId]);

  return theme;
}