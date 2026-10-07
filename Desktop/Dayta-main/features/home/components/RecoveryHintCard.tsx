import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { HomeStyles } from "../styles/home.styles";
import type { RecoveryHint } from "../types/home.types";

/** "N overdue" / "N need a time" nudge that deep-links to the Today tab. */
export function RecoveryHintCard({ styles, hint }: { styles: HomeStyles; hint: RecoveryHint }) {
  return (
    <Pressable onPress={() => router.push("/(tabs)/today")} style={styles.recoveryHintCard}>
      <View>
        <Text style={styles.recoveryHintTitle}>{hint.title}</Text>
        <Text style={styles.recoveryHintBody}>{hint.body}</Text>
      </View>
      <Text style={styles.recoveryHintAction}>{hint.action}</Text>
    </Pressable>
  );
}
