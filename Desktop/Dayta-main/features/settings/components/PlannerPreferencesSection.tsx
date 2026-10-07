import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { getPlannerSuggestionPresentation } from "../../../services/plannerPresentation";
import {
  PLANNER_SUGGESTION_TYPES,
  type PlannerPreferencesDoc,
} from "../../../services/plannerSuggestions";
import type { AppThemeTokens } from "../../../services/theme";
import type { PlannerPreferencePatch } from "../hooks/usePlannerPreferences";
import type { SettingsStyles } from "../styles/settings.styles";

interface PlannerPreferencesSectionProps {
  styles: SettingsStyles;
  theme: AppThemeTokens;
  preferences: PlannerPreferencesDoc;
  saving: boolean;
  onSave: (patch: PlannerPreferencePatch) => void;
}

/** Notification toggles, in display order. Each depends on the master toggle. */
const NOTIFICATION_TOGGLES = [
  ["Planner notifications", "notificationsEnabled"],
  ["Personal suggestions", "personalNotificationsEnabled"],
  ["Group-related suggestions", "groupNotificationsEnabled"],
  ["Scheduling conflicts", "conflictNotificationsEnabled"],
  ["Scheduling opportunities", "opportunityNotificationsEnabled"],
] as const;

export function PlannerPreferencesSection({
  styles,
  theme,
  preferences,
  saving,
  onSave,
}: PlannerPreferencesSectionProps) {
  const switchColors = {
    trackColor: { false: theme.colors.surfaceMuted, true: theme.colors.primary },
    thumbColor: theme.colors.surface,
  };

  const disabled = saving || !preferences.enabled;

  return (
    <View style={styles.card}>
      <View style={styles.settingHeader}>
        <View style={styles.settingCopy}>
          <Text style={styles.cardTitle}>Planner suggestions</Text>
          <Text style={styles.helperText}>
            Dayta uses structured planning facts such as due dates and calendar
            availability. It does not read messages, comments, notes, or media.
          </Text>
        </View>
        <Switch
          value={preferences.enabled}
          onValueChange={(value) => onSave({ enabled: value })}
          disabled={saving}
          {...switchColors}
          accessibilityLabel="Enable Planner suggestions"
        />
      </View>

      <Text style={styles.settingLabel}>Suggestion types</Text>
      <Text style={styles.helperText}>Tap a type to show or hide it.</Text>
      <View style={styles.plannerTypeGrid}>
        {PLANNER_SUGGESTION_TYPES.map((type) => {
          const visible = !preferences.hiddenSuggestionTypes.includes(type);
          const label = getPlannerSuggestionPresentation(type).label;

          return (
            <Pressable
              key={type}
              style={[styles.plannerTypeChip, visible && styles.plannerTypeChipActive]}
              disabled={disabled}
              onPress={() =>
                onSave({
                  hiddenSuggestionTypes: visible
                    ? [...preferences.hiddenSuggestionTypes, type]
                    : preferences.hiddenSuggestionTypes.filter((t) => t !== type),
                })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: visible }}
              accessibilityLabel={`${label} suggestions`}
            >
              <Text style={[styles.plannerTypeText, visible && styles.plannerTypeTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>Personal planning suggestions</Text>
        <Switch
          value={preferences.allowPersonalSuggestions}
          onValueChange={(value) => onSave({ allowPersonalSuggestions: value })}
          disabled={disabled}
          {...switchColors}
          accessibilityLabel="Allow personal Planner suggestions"
        />
      </View>

      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>Shared group suggestions</Text>
        <Switch
          value={preferences.allowGroupSuggestions}
          onValueChange={(value) => onSave({ allowGroupSuggestions: value })}
          disabled={disabled}
          {...switchColors}
          accessibilityLabel="Allow shared group Planner suggestions"
        />
      </View>

      <Text style={styles.settingLabel}>Planner notifications</Text>
      <Text style={styles.helperText}>
        Planner notifications are batched suggestions. Opening one never applies
        an action.
      </Text>
      {NOTIFICATION_TOGGLES.map(([label, key]) => (
        <View key={key} style={styles.settingHeader}>
          <Text style={styles.settingLabel}>{label}</Text>
          <Switch
            value={preferences[key]}
            onValueChange={(next) => onSave({ [key]: next })}
            disabled={
              disabled ||
              (key !== "notificationsEnabled" && !preferences.notificationsEnabled)
            }
            {...switchColors}
            accessibilityLabel={`Enable ${label.toLowerCase()}`}
          />
        </View>
      ))}

      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => router.push("/planner" as any)}
        accessibilityRole="button"
        accessibilityLabel="Open Planner suggestion center"
      >
        <Text style={styles.secondaryButtonText}>Open Planner</Text>
      </Pressable>
    </View>
  );
}
