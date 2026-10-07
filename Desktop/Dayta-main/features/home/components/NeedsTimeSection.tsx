import React from "react";
import { Pressable, Text, View } from "react-native";
import type { HomeTaskItem } from "../../../services/nowDecision";
import type { HomeStyles } from "../styles/home.styles";
import type { QuickPlanOption } from "../types/home.types";
import { taskKey } from "../utils";

interface NeedsTimeSectionProps {
  styles: HomeStyles;
  items: HomeTaskItem[];
  onOpenGoal: (item: HomeTaskItem) => void;
  onQuickPlan: (item: HomeTaskItem, option: QuickPlanOption) => void;
}

export function NeedsTimeSection({ styles, items, onOpenGoal, onQuickPlan }: NeedsTimeSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Needs a time</Text>
        <Text style={styles.sectionMeta}>Top 3</Text>
      </View>

      {items.length === 0 ? (
        <Text style={styles.sectionEmptyText}>
          Nice — every relevant task already has a plan.
        </Text>
      ) : (
        <View style={styles.miniList}>
          {items.map((item) => (
            <View key={taskKey(item)} style={styles.needsTimeItem}>
              <Pressable onPress={() => onOpenGoal(item)} style={styles.needsTimeHeader}>
                <View style={styles.miniItemTextWrap}>
                  <Text style={styles.miniItemTitle}>{item.title}</Text>
                  <Text style={styles.miniItemMeta}>{item.goalTitle}</Text>
                </View>
                <Text style={styles.needsTimeOpenText}>Open</Text>
              </Pressable>

              <View style={styles.needsTimeActions}>
                <Pressable
                  onPress={() => onQuickPlan(item, "today_evening")}
                  style={({ pressed }) => [styles.needsTimePill, pressed && styles.pillPressed]}
                >
                  <Text style={styles.needsTimePillText}>Today evening</Text>
                </Pressable>
                <Pressable
                  onPress={() => onQuickPlan(item, "tomorrow_morning")}
                  style={({ pressed }) => [styles.needsTimePill, pressed && styles.pillPressed]}
                >
                  <Text style={styles.needsTimePillText}>Tomorrow morning</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
