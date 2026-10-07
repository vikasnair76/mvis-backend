import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { MediaAttachmentDoc } from "../../services/mediaAttachments";
import { MediaAttachmentVideoPlayer } from "./MediaAttachmentVideoPlayer";
import {
  clampMediaViewerIndex,
  getViewableMediaAttachments,
} from "./mediaViewerHelpers";

export type MediaAttachmentViewerProps = {
  visible: boolean;
  attachments: readonly MediaAttachmentDoc[];
  initialIndex?: number;
  onRequestClose: () => void;
  presentationTitle?: string | null;
};

export function MediaAttachmentViewer({
  visible,
  attachments,
  initialIndex = 0,
  onRequestClose,
  presentationTitle,
}: MediaAttachmentViewerProps) {
  const { width, height } = useWindowDimensions();
  const pageWidth = width;
  const contentWidth = Math.min(width, 1100);
  const contentHeight = Math.max(240, height - 150);
  const items = useMemo(
    () => getViewableMediaAttachments(attachments),
    [attachments]
  );
  const requestedIndex = clampMediaViewerIndex(initialIndex, items.length);
  const [currentIndex, setCurrentIndex] = useState(requestedIndex);
  const [pauseToken, setPauseToken] = useState(0);
  const listRef = useRef<FlatList<MediaAttachmentDoc>>(null);
  const isFocused = useIsFocused();

  const pausePlayback = useCallback(() => {
    setPauseToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setCurrentIndex(requestedIndex);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: requestedIndex * pageWidth,
        animated: false,
      });
    });
  }, [pageWidth, requestedIndex, visible]);

  useEffect(() => {
    if (!visible) pausePlayback();
  }, [pausePlayback, visible]);

  useEffect(() => {
    if (!isFocused && visible) {
      pausePlayback();
      onRequestClose();
    }
  }, [isFocused, onRequestClose, pausePlayback, visible]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") pausePlayback();
    });
    return () => subscription.remove();
  }, [pausePlayback]);

  const close = useCallback(() => {
    pausePlayback();
    onRequestClose();
  }, [onRequestClose, pausePlayback]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = clampMediaViewerIndex(
        Math.round(event.nativeEvent.contentOffset.x / pageWidth),
        items.length
      );
      if (next !== currentIndex) {
        pausePlayback();
        setCurrentIndex(next);
      }
    },
    [currentIndex, items.length, pageWidth, pausePlayback]
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.root}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Close media viewer"
            accessibilityRole="button"
            hitSlop={12}
            onPress={close}
            style={styles.close}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>
            {presentationTitle || "Media"}
          </Text>
          <Text
            accessibilityLabel={`Attachment ${currentIndex + 1} of ${items.length}`}
            style={styles.position}
          >
            {items.length ? `${currentIndex + 1} of ${items.length}` : ""}
          </Text>
        </View>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Media unavailable</Text>
            <Text style={styles.emptyText}>
              This attachment could not be displayed.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            horizontal
            pagingEnabled
            initialScrollIndex={requestedIndex}
            getItemLayout={(_, index) => ({
              length: pageWidth,
              offset: pageWidth * index,
              index,
            })}
            keyExtractor={(item) => item.id}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScrollToIndexFailed={({ index }) =>
              listRef.current?.scrollToOffset({
                offset: clampMediaViewerIndex(index, items.length) * pageWidth,
                animated: false,
              })
            }
            renderItem={({ item, index }) => (
              <View
                style={[
                  styles.page,
                  { width: pageWidth, height: contentHeight },
                ]}
              >
                <View style={{ width: contentWidth, maxHeight: contentHeight }}>
                  <ViewerPage
                    attachment={item}
                    isActive={index === currentIndex}
                    pauseToken={pauseToken}
                    visible={visible && isFocused}
                  />
                </View>
              </View>
            )}
            showsHorizontalScrollIndicator={false}
            windowSize={3}
          />
        )}
      </View>
    </Modal>
  );
}

function ViewerPage({
  attachment,
  isActive,
  pauseToken,
  visible,
}: {
  attachment: MediaAttachmentDoc;
  isActive: boolean;
  pauseToken: number;
  visible: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  if (attachment.type === "video") {
    return (
      <MediaAttachmentVideoPlayer
        attachment={attachment}
        isActive={isActive}
        lifecyclePauseToken={pauseToken}
        viewerVisible={visible}
      />
    );
  }

  if (attachment.type === "video_link") {
    return (
      <View style={styles.youtube}>
        {attachment.thumbnailUrl ? (
          <ExpoImage
            source={{ uri: attachment.thumbnailUrl }}
            contentFit="contain"
            style={styles.youtubeImage}
          />
        ) : (
          <Ionicons name="logo-youtube" size={64} color="#FF3B30" />
        )}
        <Pressable
          accessibilityLabel="Open YouTube video"
          accessibilityRole="link"
          onPress={() =>
            Linking.openURL(attachment.externalUrl!).catch(() => undefined)
          }
          style={styles.youtubeButton}
        >
          <Text style={styles.youtubeButtonText}>Open YouTube</Text>
        </Pressable>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>
          This {attachment.type === "gif" ? "GIF" : "image"} could not be
          displayed.
        </Text>
        <Pressable
          accessibilityLabel={`Retry ${attachment.type === "gif" ? "GIF" : "image"}`}
          accessibilityRole="button"
          onPress={() => {
            setFailed(false);
            setLoading(true);
          }}
          style={styles.youtubeButton}
        >
          <Text style={styles.youtubeButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.imageFrame}>
      <ExpoImage
        accessibilityLabel={
          attachment.type === "gif" ? "Full-screen GIF" : "Full-screen image"
        }
        source={{ uri: attachment.downloadUrl! }}
        contentFit="contain"
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onLoad={() => setLoading(false)}
        onLoadStart={() => setLoading(true)}
        style={styles.image}
      />
      {loading ? (
        <View style={styles.imageLoading}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.emptyText}>Loading media…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050505", paddingTop: 24 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 12,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  title: { flex: 1, color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  position: { minWidth: 54, color: "#FFFFFF", textAlign: "right", fontWeight: "700" },
  page: { alignItems: "center", justifyContent: "center", padding: 12 },
  imageFrame: { width: "100%", height: "100%", maxHeight: 900 },
  image: { width: "100%", height: "100%" },
  imageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyText: { color: "#C7C7CC", textAlign: "center" },
  youtube: { width: "100%", alignItems: "center", justifyContent: "center", gap: 18 },
  youtubeImage: { width: "100%", maxWidth: 720, aspectRatio: 16 / 9 },
  youtubeButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  youtubeButtonText: { color: "#111111", fontWeight: "900" },
});
