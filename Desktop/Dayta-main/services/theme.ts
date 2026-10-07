export type AppThemeId =
  | "daytaGold"
  | "indigoFocus"
  | "peachGrove"
  | "graphiteDark"
  | "paperWhite"
  | "roseQuartz";

export type AppThemeTokens = {
  id: AppThemeId;
  name: string;
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
primaryText: string;
primaryStrong: string;

navBackground: string;
navBorder: string;
navIconInactive: string;
navIconActive: string;

cardShadow: string;

gradientStart: string;
gradientEnd: string;

overlay: string;

danger: string;
    success: string;
    warning: string;
    badge: string;
    badgeText: string;
    inputBackground: string;
    successBackground: string;
successBorder: string;
successText: string;

warningBackground: string;
warningBorder: string;
warningText: string;

dangerBackground: string;
dangerBorder: string;
dangerText: string;

secondaryBackground: string;
secondaryBorder: string;
secondaryText: string;
  };
};

export const APP_THEMES: Record<AppThemeId, AppThemeTokens> = {
    daytaGold: {
    id: "daytaGold",
    name: "dayTa Gold",
    colors: {
      background: "#FFFBEB",
      surface: "#FFFFFF",
      surfaceMuted: "#F5EFD8",
      text: "#1A1A1A",
      textMuted: "#6B7280",
      border: "#E8DDB8",

      primary: "#EAB308",
      primaryText: "#1A1A1A",
      primaryStrong: "#CA9A06",

      navBackground: "#1A1A1A",
      navBorder: "#2A2A2A",
      navIconInactive: "#B0B0B0",
      navIconActive: "#EAB308",

      cardShadow: "#CA9A06",

      gradientStart: "#FFFBEB",
      gradientEnd: "#FDE68A",

      overlay: "rgba(26, 26, 26, 0.55)",

      danger: "#DC2626",
      success: "#16A34A",
      warning: "#CA9A06",
      badge: "#FEF3C7",
      badgeText: "#92400E",
      inputBackground: "#FFFFFF",

      successBackground: "#DCFCE7",
      successBorder: "#86EFAC",
      successText: "#166534",

      warningBackground: "#FEF3C7",
      warningBorder: "#FACC15",
      warningText: "#854D0E",

      dangerBackground: "#FEE2E2",
      dangerBorder: "#FCA5A5",
      dangerText: "#991B1B",

      secondaryBackground: "#F7F1DC",
      secondaryBorder: "#E8DDB8",
      secondaryText: "#44403C",
    },
  },
indigoFocus: {
  id: "indigoFocus",
  name: "Indigo Focus",
    colors: {
      background: "#F7F7FB",
      surface: "#FFFFFF",
      surfaceMuted: "#EEF2FF",
      text: "#111827",
      textMuted: "#6B7280",
      border: "#E5E7EB",
      primary: "#4F46E5",
      primaryText: "#FFFFFF",
      primaryStrong: "#4338CA",

navBackground: "#1A1A1A",
navBorder: "#2A2A2A",
navIconInactive: "#B0B0B0",
navIconActive: "#4F46E5",

cardShadow: "#4F46E5",

gradientStart: "#EEF2FF",
gradientEnd: "#C7D2FE",

overlay: "rgba(17, 24, 39, 0.55)",
      danger: "#DC2626",
      success: "#16A34A",
      warning: "#D97706",
      badge: "#EEF2FF",
      badgeText: "#4F46E5",
      inputBackground: "#FFFFFF",
      successBackground: "#DCFCE7",
successBorder: "#86EFAC",
successText: "#166534",

warningBackground: "#FEF3C7",
warningBorder: "#FCD34D",
warningText: "#92400E",

dangerBackground: "#FEE2E2",
dangerBorder: "#FCA5A5",
dangerText: "#991B1B",

secondaryBackground: "#F3F4F6",
secondaryBorder: "#D1D5DB",
secondaryText: "#374151",
    },
  },

  peachGrove: {
  id: "peachGrove",
  name: "Sage Journal",
  colors: {
    background: "#F3F1E7",
    surface: "#FBFAF6",
    surfaceMuted: "#E7E2D3",
    text: "#2F2B28",
    textMuted: "#6F6A63",
    border: "#D7CFBE",

    primary: "#718F3B",
    primaryText: "#FFFFFF",
    primaryStrong: "#4F6F1A",

    navBackground: "#1A1A1A",
    navBorder: "#2A2A2A",
    navIconInactive: "#B0B0B0",
    navIconActive: "#8FAF5A",

    cardShadow: "#6B8E23",

    gradientStart: "#F3F1E7",
    gradientEnd: "#DDE8CF",

    overlay: "rgba(47, 43, 40, 0.55)",

    danger: "#B84B5E",
    success: "#4D7C0F",
    warning: "#B8891E",
    badge: "#DDE8CF",
    badgeText: "#42592A",
    inputBackground: "#F8F6EF",

    successBackground: "#E4EED8",
    successBorder: "#A7C58A",
    successText: "#35511E",

    warningBackground: "#F5E8C8",
    warningBorder: "#D8B65A",
    warningText: "#715514",

    dangerBackground: "#F8DDE2",
    dangerBorder: "#E8A2AE",
    dangerText: "#7F1D2D",

    secondaryBackground: "#ECE6D8",
    secondaryBorder: "#D7CFBE",
    secondaryText: "#4B463F",
  },
},

  graphiteDark: {
    id: "graphiteDark",
    name: "Graphite Dark",
    colors: {
      background: "#0F172A",
      surface: "#111827",
      surfaceMuted: "#1F2937",
      text: "#F9FAFB",
      textMuted: "#9CA3AF",
      border: "#374151",
      primary: "#38BDF8",
      primaryText: "#020617",
      primaryStrong: "#0284C7",

navBackground: "#1A1A1A",
navBorder: "#2A2A2A",
navIconInactive: "#B0B0B0",
navIconActive: "#38BDF8",

cardShadow: "#38BDF8",

gradientStart: "#0F172A",
gradientEnd: "#082F49",

overlay: "rgba(2, 6, 23, 0.7)",
      danger: "#F87171",
      success: "#4ADE80",
      warning: "#FBBF24",
      badge: "#082F49",
      badgeText: "#7DD3FC",
      inputBackground: "#1F2937",
    successBackground: "#052E16",
successBorder: "#166534",
successText: "#86EFAC",

warningBackground: "#451A03",
warningBorder: "#92400E",
warningText: "#FCD34D",

dangerBackground: "#450A0A",
dangerBorder: "#991B1B",
dangerText: "#FCA5A5",

secondaryBackground: "#1F2937",
secondaryBorder: "#4B5563",
secondaryText: "#D1D5DB",
    },
  },

  paperWhite: {
  id: "paperWhite",
  name: "Paper White",
    colors: {
  background: "#FAFAF9",
  surface: "#FFFFFF",
  surfaceMuted: "#F5F5F4",
  text: "#1C1917",
  textMuted: "#78716C",
  border: "#E7E5E4",
  primary: "#2563EB",
  primaryText: "#FFFFFF",
  primaryStrong: "#1D4ED8",

  navBackground: "#1A1A1A",
  navBorder: "#2A2A2A",
  navIconInactive: "#B0B0B0",
  navIconActive: "#2563EB",

  cardShadow: "#2563EB",

  gradientStart: "#FFFFFF",
  gradientEnd: "#F5F5F4",

  overlay: "rgba(28, 25, 23, 0.5)",

  danger: "#DC2626",
  success: "#16A34A",
  warning: "#D97706",
  badge: "#EFF6FF",
  badgeText: "#1D4ED8",
  inputBackground: "#FFFFFF",

  successBackground: "#DCFCE7",
  successBorder: "#86EFAC",
  successText: "#166534",

  warningBackground: "#FEF3C7",
  warningBorder: "#FCD34D",
  warningText: "#92400E",

  dangerBackground: "#FEE2E2",
  dangerBorder: "#FCA5A5",
  dangerText: "#991B1B",

  secondaryBackground: "#F5F5F4",
  secondaryBorder: "#D6D3D1",
  secondaryText: "#44403C",
},

  },
  roseQuartz: {
  id: "roseQuartz",
  name: "Rose Quartz",
  colors: {
    background: "#FFF1F2",
    surface: "#FFFFFF",
    surfaceMuted: "#FFE4E6",
    text: "#2B1720",
    textMuted: "#7C5260",
    border: "#FECDD3",
    primary: "#E11D48",
    primaryText: "#FFFFFF",
    primaryStrong: "#BE123C",

    navBackground: "#1A1A1A",
    navBorder: "#2A2A2A",
    navIconInactive: "#B0B0B0",
    navIconActive: "#FB7185",

    cardShadow: "#FB7185",

    gradientStart: "#FFF1F2",
    gradientEnd: "#FFE4E6",

    overlay: "rgba(43, 23, 32, 0.55)",

    danger: "#DC2626",
    success: "#16A34A",
    warning: "#D97706",
    badge: "#FFE4E6",
    badgeText: "#BE123C",
    inputBackground: "#FFFFFF",

    successBackground: "#DCFCE7",
    successBorder: "#86EFAC",
    successText: "#166534",

    warningBackground: "#FEF3C7",
    warningBorder: "#FCD34D",
    warningText: "#92400E",

    dangerBackground: "#FEE2E2",
    dangerBorder: "#FCA5A5",
    dangerText: "#991B1B",

    secondaryBackground: "#FFF7F8",
    secondaryBorder: "#FECDD3",
    secondaryText: "#7C2D3D",
  },
},
};

export const DEFAULT_THEME_ID: AppThemeId = "daytaGold";

export const UI_SIZES = {
  radius: {
    xs: 8,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 22,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },

  buttonHeight: {
    sm: 36,
    md: 44,
    lg: 52,
  },

  chipHeight: {
    sm: 28,
    md: 34,
  },

  cardPadding: {
    sm: 12,
    md: 16,
    lg: 20,
  },
} as const;

export function getAppTheme(themeId?: string | null): AppThemeTokens {
if (
  themeId === "daytaGold" ||
  themeId === "indigoFocus" ||
  themeId === "peachGrove" ||
  themeId === "graphiteDark" ||
  themeId === "paperWhite" ||
  themeId === "roseQuartz"
) {
  return APP_THEMES[themeId];
}

  return APP_THEMES[DEFAULT_THEME_ID];
}