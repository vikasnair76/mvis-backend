import { Image as ExpoImage } from "expo-image";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AppThemeTokens } from "../../services/theme";
import type { PendingCommentMedia } from "./commentMediaPicker";

export function CommentMediaCandidateTray({
  items,
  theme,
  disabled,
  onRemove,
}: {
  items: readonly PendingCommentMedia[];
  theme: AppThemeTokens;
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      {items.map((item, index) => (
        <View
          key={item.id}
          style={[
            styles.tile,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
            },
          ]}
        >
          {item.candidate.type === "video" ? (
            <View style={styles.video}>
              <Text style={styles.videoText}>VIDEO</Text>
            </View>
          ) : (
            <ExpoImage
              accessibilityLabel={
                item.candidate.type === "gif"
                  ? `Selected GIF ${index + 1} of ${items.length}`
                  : `Selected image ${index + 1} of ${items.length}`
              }
              contentFit="cover"
              source={{ uri: item.candidate.localUri }}
              style={styles.image}
            />
          )}
          <Text style={[styles.count, { color: theme.colors.text }]}>
            {index + 1} of {items.length}
          </Text>
          <Pressable
            accessibilityLabel={`Remove attachment ${index + 1}`}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onRemove(item.id)}
            style={styles.remove}
          >
            <Text style={styles.removeText}>×</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export const MediaCandidateTray = CommentMediaCandidateTray;

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tile: {
    width: 112,
    height: 112,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  video: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
  },
  videoText: { color: "#FFFFFF", fontWeight: "900" },
  count: {
    position: "absolute",
    left: 5,
    bottom: 5,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: "rgba(255,255,255,0.85)",
    fontSize: 10,
    fontWeight: "800",
  },
  remove: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  removeText: { color: "#FFFFFF", fontSize: 22, lineHeight: 24 },
});
