import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { AppThemeTokens } from "../../../services/theme";
import type { SettingsStyles } from "../styles/settings.styles";

interface SupportSectionProps {
  styles: SettingsStyles;
  theme: AppThemeTokens;
}

/** Automation preferences link + the Feedback & Support card. */
export function SupportSection({ styles, theme }: SupportSectionProps) {
  return (
    <>
      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => router.push("/settings/automation")}
        android_ripple={{ color: "#4b5563" }}
      >
        <Text style={styles.secondaryButtonText}>Automation Preferences</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Feedback & Support"
          accessibilityHint="Opens the Feedback & Support form"
          onPress={() => router.push("/settings/feedback" as any)}
          style={({ pressed }) => [
            styles.supportRow,
            pressed && styles.supportRowPressed,
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={theme.colors.primary}
            name="chatbubble-ellipses-outline"
            size={24}
          />
          <View style={styles.supportCopy}>
            <Text style={styles.supportTitle}>Feedback & Support</Text>
            <Text style={styles.helperText}>
              Share feedback, request a feature, or report a problem.
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={theme.colors.textMuted}
            name="chevron-forward"
            size={20}
          />
        </Pressable>
      </View>
    </>
  );
}
