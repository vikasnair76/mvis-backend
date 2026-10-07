import type { AppThemeId } from "../../../services/theme";

export function formatLastSync(lastSyncAtMs?: number | null): string {
  if (!lastSyncAtMs) return "Never";
  return new Date(lastSyncAtMs).toLocaleString();
}

const THEME_DESCRIPTIONS: Record<string, string> = {
  daytaGold: "Official dayTa brand theme with warm gold accents.",
  indigoFocus: "Refined productivity theme with violet accents.",
  peachGrove: "Grounded sage-and-paper theme for calm planning.",
  graphiteDark: "Dark mode for focused use.",
  roseQuartz: "Soft rose theme for a warmer, social feel.",
};

export function getThemeDescription(themeId: AppThemeId | string): string {
  return THEME_DESCRIPTIONS[themeId] ?? "Ultra-clean minimal productivity theme.";
}

/**
 * The window a manual Google Calendar sync pulls: 7 days back to one month
 * ahead, as ISO strings for the Calendar API.
 */
export function getManualSyncWindow(now: Date = new Date()): {
  timeMin: string;
  timeMax: string;
} {
  const timeMin = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7
  ).toISOString();

  const timeMax = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  ).toISOString();

  return { timeMin, timeMax };
}
