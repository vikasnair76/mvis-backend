import React from "react";
import { Pressable, Text, View } from "react-native";
import { APP_THEMES, type AppThemeId, type AppThemeTokens } from "../../../services/theme";
import type { SettingsStyles } from "../styles/settings.styles";
import { getThemeDescription } from "../utils";

interface ThemeSectionProps {
  styles: SettingsStyles;
  selectedThemeId: AppThemeId | string;
  saving: boolean;
  onSelect: (themeId: AppThemeId) => void;
}

const THEME_OPTIONS = Object.values(APP_THEMES) as AppThemeTokens[];

/** Swatches shown per theme, in order: background, surface, primary, nav. */
const SWATCH_KEYS = ["background", "surface", "primary", "navBackground"] as const;

export function ThemeSection({ styles, selectedThemeId, saving, onSelect }: ThemeSectionProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Theme</Text>

      <Text style={styles.helperText}>
        Choose how the app looks. More screens will adopt this theme as the
        visual system rolls out.
      </Text>

      <View style={{ gap: 8, marginTop: 10 }}>
        {THEME_OPTIONS.map((option) => {
          const active = selectedThemeId === option.id;

          return (
            <Pressable
              key={option.id}
              onPress={() => onSelect(option.id)}
              disabled={saving}
              style={[styles.themeOption, active && styles.themeOptionActive]}
            >
              <View style={styles.themeOptionMain}>
                <View style={styles.themeSwatchRow}>
                  {SWATCH_KEYS.map((key) => (
                    <View
                      key={key}
                      style={[styles.themeSwatch, { backgroundColor: option.colors[key] }]}
                    />
                  ))}
                </View>

                <Text style={styles.themeOptionTitle}>{option.name}</Text>
                <Text style={styles.themeOptionDescription}>
                  {getThemeDescription(option.id)}
                </Text>
              </View>

              <Text style={styles.themeOptionCheck}>{active ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
