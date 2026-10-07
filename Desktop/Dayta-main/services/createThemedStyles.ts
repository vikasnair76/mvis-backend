import { StyleSheet } from "react-native";
import type { AppThemeTokens } from "./theme";

export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: AppThemeTokens) => T
) {
  return (theme: AppThemeTokens) => StyleSheet.create(factory(theme));
}