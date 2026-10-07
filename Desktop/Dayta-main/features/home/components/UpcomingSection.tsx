import React from "react";
import { Pressable, Text, View } from "react-native";
import type { HomeTaskItem } from "../../../services/nowDecision";
import type { HomeStyles } from "../styles/home.styles";
import { formatMiniTime, taskKey } from "../utils";

interface UpcomingSectionProps {
  styles: HomeStyles;
  items: HomeTaskItem[];
  onOpenGoal: (item: HomeTaskItem) => void;
}

export function UpcomingSection({ styles, items, onOpenGoal }: UpcomingSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Upcoming</Text>
        <Text style={styles.sectionMeta}>Next 3</Text>
      </View>

      {items.length === 0 ? (
        <Text style={styles.sectionEmptyText}>
          No timed tasks coming up. Add a time to a subtask when you want it to
          appear here.
        </Text>
      ) : (
        <View style={styles.miniList}>
          {items.map((item) => (
            <Pressable key={taskKey(item)} onPress={() => onOpenGoal(item)} style={styles.miniItem}>
              <View style={styles.miniItemTextWrap}>
                <Text style={styles.miniItemTitle}>{item.title}</Text>
                <Text style={styles.miniItemMeta}>{item.goalTitle}</Text>
              </View>
              <Text style={styles.miniItemTime}>{formatMiniTime(item.dueAtMs)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
