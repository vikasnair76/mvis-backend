import React from "react";
import { DaytaLogo } from "../../../components/DayTaLogo";
import type { AppThemeTokens } from "../../../services/theme";

/** The brand accent is fixed gold regardless of theme, as in the original. */
const LOGO_ACCENT = "#EAB308";

export function HomeLogo({ theme }: { theme: AppThemeTokens }) {
  return (
    <DaytaLogo
      variant="full"
      width={220}
      textColor={theme.colors.text}
      accentColor={LOGO_ACCENT}
      mutedColor={theme.colors.textMuted}
      counterColor={theme.colors.surface}
      showTagline
    />
  );
}
