import { StyleSheet } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";

export const createHomeStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },

    container: {
      flexGrow: 1,
      backgroundColor: theme.colors.background,
      padding: 20,
      paddingTop: 60,
      paddingBottom: 32,
      alignItems: "center",
    },

    greeting: {
      marginTop: 36,
      fontSize: 20,
      fontWeight: "800",
      color: theme.colors.text,
    },
    card: {
      marginTop: 24,
      width: "100%",
      padding: 18,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    stateCard: {
      marginTop: 36,
      width: "100%",
      padding: 18,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    stateEyebrow: {
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: theme.colors.primary,
    },

    stateTitle: {
      marginTop: 8,
      fontSize: 22,
      fontWeight: "900",
      color: theme.colors.text,
    },

    stateBody: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.textMuted,
    },

    cardTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },

    cardSub: {
      marginTop: 6,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    decisionEyebrow: {
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
      color: theme.colors.text,
      letterSpacing: 0.6,
    },

    decisionGoal: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    decisionTitle: {
      marginTop: 4,
      fontSize: 20,
      fontWeight: "900",
      color: theme.colors.text,
    },

    decisionSub: {
      marginTop: 6,
      fontSize: 13,
      color: theme.colors.textMuted,
      lineHeight: 19,
    },
    primaryActionBtn: {
      marginTop: 14,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      backgroundColor: theme.colors.primary,
    },

    primaryActionText: {
      fontSize: 14,
      fontWeight: "800",
      color: theme.colors.primaryText,
    },
    primaryActionBtnDisabled: {
      opacity: 0.7,
    },
    actionRow: {
      marginTop: 14,
      gap: 8,
    },

    secondaryActionBtn: {
      marginTop: 12,
      paddingVertical: 11,
      borderRadius: 12,
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    secondaryActionText: {
      fontSize: 14,
      fontWeight: "800",
      color: theme.colors.text,
    },
    quickPlanBox: {
      marginTop: 14,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.secondaryBorder,
    },

    quickPlanTitle: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.secondaryText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },

    quickPlanRow: {
      marginTop: 8,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    quickPlanPill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    quickPlanPillText: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.text,
    },
    statsCard: {
      marginTop: 14,
      width: "100%",
      padding: 14,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    statsTitle: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },

    statsRow: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },

    statText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    statDot: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.colors.primary,
    },
    recoveryHintCard: {
      marginTop: 14,
      width: "100%",
      padding: 14,
      borderRadius: 16,
      backgroundColor: theme.colors.warningBackground,
      borderWidth: 1,
      borderColor: theme.colors.warningBorder,
      gap: 10,
    },

    recoveryHintTitle: {
      fontSize: 15,
      fontWeight: "900",
      color: theme.colors.warningText,
    },

    recoveryHintBody: {
      marginTop: 4,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.warningText,
    },

    recoveryHintAction: {
      alignSelf: "flex-start",
      marginTop: 4,
      fontSize: 14,
      fontWeight: "900",
      color: theme.colors.warningText,
      textDecorationLine: "underline",
    },
    section: {
      marginTop: 14,
      width: "100%",
      padding: 14,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },

    sectionTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: theme.colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },

    sectionMeta: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    sectionEmptyText: {
      marginTop: 10,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.textMuted,
    },
    miniList: {
      marginTop: 10,
      gap: 8,
    },

    miniItem: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },

    miniItemTextWrap: {
      flex: 1,
    },

    miniItemTitle: {
      fontSize: 14,
      fontWeight: "800",
      color: theme.colors.text,
    },

    miniItemMeta: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    miniItemTime: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.primary,
    },
    needsTimeItem: {
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.secondaryBorder,
    },

    needsTimeHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },

    needsTimeOpenText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    needsTimeActions: {
      marginTop: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    needsTimePill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },

    needsTimePillText: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.text,
    },
    doneItem: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.successBackground,
      borderWidth: 1,
      borderColor: theme.colors.successBorder,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    doneCheck: {
      width: 22,
      height: 22,
      borderRadius: 999,
      textAlign: "center",
      textAlignVertical: "center",
      fontSize: 14,
      fontWeight: "900",
      color: theme.colors.successText,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
    },

    doneItemTitle: {
      fontSize: 14,
      fontWeight: "800",
      color: theme.colors.successText,
    },

    doneItemMeta: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.successText,
    },
    cardOverdue: {
      backgroundColor: theme.colors.dangerBackground,
      borderColor: theme.colors.dangerBorder,
    },

    cardNow: {
      backgroundColor: theme.colors.successBackground,
      borderColor: theme.colors.successBorder,
    },

    cardNext: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },

    cardNeedsTime: {
      backgroundColor: theme.colors.warningBackground,
      borderColor: theme.colors.warningBorder,
    },

    cardAllClear: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
    },
    buttonPressed: {
      opacity: 0.86,
      transform: [{ scale: 0.98 }],
    },

    pillPressed: {
      opacity: 0.84,
      transform: [{ scale: 0.98 }],
    },
  });

export type HomeStyles = ReturnType<typeof createHomeStyles>;
