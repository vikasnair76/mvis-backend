import React from "react";
import { ScrollView, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import type { HomeStyles } from "../styles/home.styles";
import { HomeLogo } from "./HomeLogo";

interface HomeStateScreenProps {
  styles: HomeStyles;
  theme: AppThemeTokens;
  eyebrow: string;
  title: string;
  body: string;
}

/** Full-screen placeholder for the loading and signed-out states. */
export function HomeStateScreen({ styles, theme, eyebrow, title, body }: HomeStateScreenProps) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <HomeLogo theme={theme} />

      <View style={styles.stateCard}>
        <Text style={styles.stateEyebrow}>{eyebrow}</Text>
        <Text style={styles.stateTitle}>{title}</Text>
        <Text style={styles.stateBody}>{body}</Text>
      </View>
    </ScrollView>
  );
}
