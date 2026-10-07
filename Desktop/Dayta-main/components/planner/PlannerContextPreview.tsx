import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../../services/theme";
import {
  subscribeActivePlannerSuggestions,
  type PlannerSuggestionDoc,
} from "../../services/plannerSuggestions";
import { getPlannerSuggestionDocPresentation } from "../../services/plannerPresentation";

export function PlannerContextPreview({ownerUid, theme}: {
  ownerUid: string; theme: AppThemeTokens;
}) {
  const [items, setItems] = useState<PlannerSuggestionDoc[]>([]);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  useEffect(() => subscribeActivePlannerSuggestions(ownerUid,
    (suggestions) => setItems(suggestions.slice(0, 2)), () => setItems([])), [ownerUid]);
  if (!items.length) return (
    <Pressable style={styles.compact} onPress={() => router.push("/planner" as any)}
      accessibilityRole="button" accessibilityLabel="Open Planner suggestions">
      <Text style={styles.eyebrow}>PLANNER</Text>
      <Text style={styles.compactText}>Review planning suggestions</Text>
    </Pressable>
  );
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>PLANNER</Text>
          <Text style={styles.title}>Planning suggestions</Text>
        </View>
        <Pressable onPress={() => router.push("/planner" as any)} accessibilityRole="button"
          accessibilityLabel="See all Planner suggestions">
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      {items.map((item) => (
        <Pressable key={item.id} style={styles.item} onPress={() => router.push("/planner" as any)}
          accessibilityRole="button" accessibilityLabel={`Open suggestion: ${item.title}`}>
          <Text style={styles.itemLabel}>{getPlannerSuggestionDocPresentation(item).label}</Text>
          <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const makeStyles = (theme: AppThemeTokens) => StyleSheet.create({
  card: {backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    borderWidth: 1, borderRadius: 18, padding: 15, gap: 10, marginBottom: 16},
  compact: {minHeight: 64, justifyContent: "center", backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 16, marginBottom: 16},
  compactText: {color: theme.colors.text, fontWeight: "800", marginTop: 3},
  header: {flexDirection: "row", justifyContent: "space-between", alignItems: "center"},
  eyebrow: {color: theme.colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1},
  title: {color: theme.colors.text, fontSize: 17, fontWeight: "900", marginTop: 3},
  link: {color: theme.colors.primary, fontWeight: "900", paddingVertical: 12},
  item: {backgroundColor: theme.colors.surfaceMuted, borderRadius: 12, padding: 12},
  itemLabel: {color: theme.colors.textMuted, fontSize: 11, fontWeight: "800"},
  itemTitle: {color: theme.colors.text, fontSize: 14, lineHeight: 19,
    fontWeight: "800", marginTop: 3},
});
