import React from "react";
import { Pressable, Text, View } from "react-native";
import type { HomeTaskItem } from "../../../services/nowDecision";
import type { HomeStyles } from "../styles/home.styles";
import { taskKey } from "../utils";

interface DoneTodaySectionProps {
  styles: HomeStyles;
  items: HomeTaskItem[];
  onOpenGoal: (item: HomeTaskItem) => void;
}

export function DoneTodaySection({ styles, items, onOpenGoal }: DoneTodaySectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Done today</Text>
        <Text style={styles.sectionMeta}>{items.length} shown</Text>
      </View>

      {items.length === 0 ? (
        <Text style={styles.sectionEmptyText}>
          Completed tasks will appear here as you build momentum.
        </Text>
      ) : (
        <View style={styles.miniList}>
          {items.map((item) => (
            <Pressable key={taskKey(item)} onPress={() => onOpenGoal(item)} style={styles.doneItem}>
              <Text style={styles.doneCheck}>✓</Text>
              <View style={styles.miniItemTextWrap}>
                <Text style={styles.doneItemTitle}>{item.title}</Text>
                <Text style={styles.doneItemMeta}>{item.goalTitle}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
