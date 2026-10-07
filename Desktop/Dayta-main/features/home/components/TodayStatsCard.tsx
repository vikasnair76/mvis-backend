import React from "react";
import { Text, View } from "react-native";
import type { HomeStyles } from "../styles/home.styles";
import type { TodayStats } from "../types/home.types";

export function TodayStatsCard({ styles, stats }: { styles: HomeStyles; stats: TodayStats }) {
  return (
    <View style={styles.statsCard}>
      <Text style={styles.statsTitle}>Today</Text>
      <View style={styles.statsRow}>
        <Text style={styles.statText}>{stats.upcoming} upcoming</Text>
        <Text style={styles.statDot}>•</Text>
        <Text style={styles.statText}>{stats.needTime} need time</Text>
        <Text style={styles.statDot}>•</Text>
        <Text style={styles.statText}>{stats.done} done</Text>
      </View>
    </View>
  );
}
