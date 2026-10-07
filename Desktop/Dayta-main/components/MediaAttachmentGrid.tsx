import { Image as ExpoImage } from "expo-image";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MediaAttachmentDoc } from "../services/mediaAttachments";
import type { AppThemeTokens } from "../services/theme";
import {
  getViewableMediaAttachments,
  mediaAttachmentAccessibilityType,
} from "./media/mediaViewerHelpers";

export type MediaAttachmentGridProps = {
  attachments: MediaAttachmentDoc[];
  theme: AppThemeTokens;
  onPressImage?: (attachment: MediaAttachmentDoc) => void;
  onAttachmentPress?: (
    attachment: MediaAttachmentDoc,
    index: number
  ) => void;
};

export function MediaAttachmentGrid({
  attachments,
  theme,
  onPressImage,
  onAttachmentPress,
}: MediaAttachmentGridProps) {
  const items = useMemo(
    () => getViewableMediaAttachments(attachments).slice(0, 4),
    [attachments]
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  return (
    <View style={styles.grid}>
      {items.map((attachment, index) => {
        const isImage =
          attachment.type === "image" || attachment.type === "gif";
        const failed = failedIds.has(attachment.id);
        const loading = loadingIds.has(attachment.id);
        const interactive = Boolean(
          onAttachmentPress || (onPressImage && isImage)
        );
        return (
          <Pressable
            accessibilityRole={interactive ? "button" : "image"}
            accessibilityLabel={`Open ${mediaAttachmentAccessibilityType(
              attachment
            )} ${index + 1} of ${items.length}${
              failed ? ", unavailable" : ""
            }`}
            disabled={!interactive || failed}
            key={attachment.id}
            onPress={(event) => {
              event.stopPropagation();
              if (onAttachmentPress) onAttachmentPress(attachment, index);
              else if (isImage) onPressImage?.(attachment);
            }}
            style={[
              styles.tile,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {failed ? (
              <View style={styles.fallback}>
                <Text style={[styles.fallbackText, { color: theme.colors.textMuted }]}>
                  Media unavailable
                </Text>
              </View>
            ) : isImage || attachment.thumbnailUrl ? (
              <ExpoImage
                source={{
                  uri: isImage
                    ? attachment.downloadUrl!
                    : attachment.thumbnailUrl!,
                }}
                contentFit={attachment.type === "gif" ? "contain" : "cover"}
                onLoadStart={() =>
                  setLoadingIds((previous) =>
                    new Set(previous).add(attachment.id)
                  )
                }
                onLoadEnd={() =>
                  setLoadingIds((previous) => {
                    const next = new Set(previous);
                    next.delete(attachment.id);
                    return next;
                  })
                }
                onError={() =>
                  setFailedIds((previous) =>
                    new Set(previous).add(attachment.id)
                  )
                }
                style={styles.image}
              />
            ) : (
              <View style={styles.videoFallback}>
                <Text style={styles.videoLabel}>
                  {attachment.type === "video_link" ? "YOUTUBE" : "VIDEO"}
                </Text>
              </View>
            )}
            {loading && !failed ? (
              <View style={[styles.loading, { backgroundColor: theme.colors.overlay }]}>
                <Text style={styles.loadingText}>Loading…</Text>
              </View>
            ) : null}
            {attachment.type === "gif" && !failed ? (
              <View style={styles.gifBadge}>
                <Text style={styles.badgeText}>GIF</Text>
              </View>
            ) : null}
            {(attachment.type === "video" ||
              attachment.type === "video_link") &&
            !failed ? (
              <View style={styles.playBadge}>
                <Text style={styles.playText}>▶</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: "47%",
    minWidth: 120,
    flexGrow: 1,
    aspectRatio: 1,
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
  },
  image: { width: "100%", height: "100%" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  fallbackText: { textAlign: "center", fontSize: 12, fontWeight: "700" },
  videoFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
  },
  videoLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  gifBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  playBadge: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  playText: { color: "#FFFFFF", fontSize: 18 },
});
