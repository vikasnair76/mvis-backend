import { StyleSheet } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";

export const createSettingsStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      alignItems: "center",
      padding: 20,
      paddingTop: 48,
      backgroundColor: theme.colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      marginBottom: 16,
      color: theme.colors.text,
    },
    button: {
      width: "100%",
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: "center",
      marginTop: 10,
      backgroundColor: theme.colors.primary,
    },
    secondary: {
      backgroundColor: theme.colors.surfaceMuted,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonText: {
      color: theme.colors.primaryText,
      fontSize: 16,
      fontWeight: "600",
    },
    small: {
      marginTop: 14,
      color: theme.colors.textMuted,
    },
    themeOption: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    themeOptionMain: {
      flex: 1,
      minWidth: 0,
    },

    themeSwatchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 8,
    },

    themeSwatch: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    themeOptionDescription: {
      marginTop: 5,
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 17,
    },

    themeOptionActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    themeOptionTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.colors.text,
    },

    themeOptionCheck: {
      fontSize: 18,
      fontWeight: "800",
      color: theme.colors.primary,
    },
    card: {
      width: "100%",
      marginTop: 16,
      padding: 14,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    section: {
      width: "100%",
      marginTop: 16,
    },
    
    sectionTitle: {
      marginBottom: 8,
      paddingHorizontal: 4,
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    
    settingsCard: {
      width: "100%",
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    
    settingsRow: {
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    
    settingsRowTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.colors.text,
    },
    
    settingsRowSubtitle: {
      marginTop: 3,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    
    destructiveText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#D92D20",
    },
    
    chevron: {
      fontSize: 24,
      fontWeight: "400",
      color: theme.colors.textMuted,
    },
    settingHeader: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
    },
    settingCopy: { flex: 1 },
    supportRow: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 8,
      paddingVertical: 8,
    },
    supportRowPressed: { opacity: 0.7 },
    supportCopy: { flex: 1, minWidth: 0 },
    supportTitle: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    settingLabel: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "800",
      flex: 1,
    },
    plannerTypeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    plannerTypeChip: {
      minHeight: 42,
      justifyContent: "center",
      borderRadius: 999,
      borderColor: theme.colors.border,
      borderWidth: 1,
      backgroundColor: theme.colors.surfaceMuted,
      paddingHorizontal: 12,
    },
    plannerTypeChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },
    plannerTypeText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
    },
    plannerTypeTextActive: { color: theme.colors.badgeText },

    cardTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.colors.text,
    },

    helperText: {
      marginTop: 6,
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 17,
    },
    secondaryButtonText: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "600",
    },
  });

export type SettingsStyles = ReturnType<typeof createSettingsStyles>;
