import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { MediaAttachmentDoc } from "../../services/mediaAttachments";

type Props = {
  attachment: MediaAttachmentDoc;
  isActive: boolean;
  viewerVisible: boolean;
  lifecyclePauseToken: number;
};

export function MediaAttachmentVideoPlayer({
  attachment,
  isActive,
  viewerVisible,
  lifecyclePauseToken,
}: Props) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <VideoPlayerInstance
      key={`${attachment.id}:${retryKey}`}
      attachment={attachment}
      isActive={isActive}
      viewerVisible={viewerVisible}
      lifecyclePauseToken={lifecyclePauseToken}
      onRetry={() => setRetryKey((value) => value + 1)}
    />
  );
}

function VideoPlayerInstance({
  attachment,
  isActive,
  viewerVisible,
  lifecyclePauseToken,
  onRetry,
}: Props & { onRetry: () => void }) {
  const source = attachment.downloadUrl!;
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
  });
  const status = useEvent(player, "statusChange", {
    status: player.status,
    error: undefined,
  });

  useEffect(() => {
    if (!isActive || !viewerVisible) player.pause();
  }, [isActive, player, viewerVisible]);

  useEffect(() => {
    player.pause();
  }, [lifecyclePauseToken, player]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  if (status?.status === "error") {
    return (
      <View style={styles.fallback}>
        <Ionicons name="warning-outline" size={34} color="#FFFFFF" />
        <Text style={styles.message}>This video could not be played.</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Retry video"
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.action}
          >
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open video externally"
            accessibilityRole="link"
            onPress={() => Linking.openURL(source).catch(() => undefined)}
            style={styles.action}
          >
            <Text style={styles.actionText}>Open externally</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <VideoView
        accessibilityLabel="Uploaded video player"
        accessibilityRole="adjustable"
        contentFit="contain"
        nativeControls
        player={player}
        style={styles.video}
      />
      {status?.status === "loading" ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.message}>Loading media…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000000" },
  video: { width: "100%", height: "100%" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  fallback: {
    width: "100%",
    aspectRatio: 16 / 9,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    backgroundColor: "#171717",
  },
  message: { color: "#FFFFFF", textAlign: "center", fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  actionText: { color: "#FFFFFF", fontWeight: "800" },
});
