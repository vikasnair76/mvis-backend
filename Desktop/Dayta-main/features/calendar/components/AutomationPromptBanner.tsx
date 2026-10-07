import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { AppThemeTokens } from "../../../services/theme";
import {
  getAutomationPromptBody,
  getAutomationPromptPrimaryLabel,
  getAutomationPromptTitle,
} from "../utils";

export interface AutomationPromptBannerProps {
  prompt: {
    eventTitle: string;
    goalId: string;
    subtaskId: string;
    subtaskTitle: string;
    promptType: "suggest_subtask" | "auto_link" | "auto_apply_duration";
  };
  onAccept: () => void | Promise<void>;
  onDismiss: () => void;
  onLayout?: (y: number) => void;
}

export function AutomationPromptBanner({
  prompt,
  onAccept,
  onDismiss,
  onLayout,
}: AutomationPromptBannerProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  return (
    <View
      style={styles.card}
      onLayout={(e) => {
        onLayout?.(e.nativeEvent.layout.y);
      }}
    >
      <Text style={styles.title}>
        {getAutomationPromptTitle(prompt.promptType)}
      </Text>

      <Text style={styles.stepHint}>
        {prompt.promptType === "suggest_subtask"
          ? "Step 1 of 2 • Improve future suggestions"
          : "Step 2 of 2 • Optional automation"}
      </Text>

      <Text style={styles.body}>
        {getAutomationPromptBody({
          promptType: prompt.promptType,
          subtaskTitle: prompt.subtaskTitle,
          eventTitle: prompt.eventTitle,
        })}
      </Text>

      <Pressable onPress={onAccept} style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>
          {getAutomationPromptPrimaryLabel(prompt.promptType)}
        </Text>
      </Pressable>

      <Pressable onPress={onDismiss} style={styles.secondaryBtn}>
        <Text style={styles.secondaryBtnText}>Not now</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    card: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: theme.colors.secondaryBorder,
      backgroundColor: theme.colors.secondaryBackground,
      borderRadius: 14,
      padding: 12,
      gap: 8,
    },
    title: {
      fontSize: 14,
      fontWeight: "800",
      color: theme.colors.text,
    },
    stepHint: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    body: {
      fontSize: 13,
      color: theme.colors.secondaryText,
    },
    primaryBtn: {
      marginTop: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.badge,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      alignItems: "center",
    },
    primaryBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    secondaryBtn: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
    },
    secondaryBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.text,
    },
  });
}
