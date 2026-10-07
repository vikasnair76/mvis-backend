import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { MediaAttachmentGrid } from "../../../components/MediaAttachmentGrid";
import { MediaAttachmentViewer } from "../../../components/media/MediaAttachmentViewer";
import {
    subscribeGroupBulletins,
    type GroupBulletinDoc,
} from "../../../services/groups";
import type { MediaAttachmentDoc } from "../../../services/mediaAttachments";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

function formatRelativeTime(ms?: number | null): string {
  if (!ms) return "Recently";

  const diffMs = Date.now() - ms;
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSeconds < 10) return "Just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(ms).toLocaleDateString();
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function GroupBulletinsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [bulletins, setBulletins] = useState<GroupBulletinDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [viewer, setViewer] = useState<{
    attachments: MediaAttachmentDoc[];
    index: number;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (!groupId) {
      setBulletins([]);
      setLoading(false);
      setErrorText("Missing group.");
      return;
    }

    setLoading(true);
    setErrorText(null);

    const unsub = subscribeGroupBulletins(
      groupId,
      (items) => {
        setBulletins(items.filter((item) => item.hiddenByModeration !== true && !item.deletedByAuthor));
        setLoading(false);
      },
      (err) => {
        console.log("[GroupBulletins] subscription failed", err);
        setErrorText("Could not load bulletins.");
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

  const filteredBulletins = useMemo(() => {
    const query = normalizeSearchText(searchText);

    if (!query) return bulletins;

    return bulletins.filter((bulletin) => {
      const haystack = normalizeSearchText(
        [
          bulletin.title,
          bulletin.body,
          bulletin.authorName,
          bulletin.authorEmail,
        ]
          .filter(Boolean)
          .join(" ")
      );

      return haystack.includes(query);
    });
  }, [bulletins, searchText]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Group</Text>
      </Pressable>

      <View style={styles.headerCard}>
        <Text style={styles.eyebrow}>Bulletins</Text>
        <Text style={styles.title}>All bulletins</Text>
        <Text style={styles.subtitle}>
          Search announcements, updates, and group-wide posts.
        </Text>

        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search bulletins"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
        />

        <Text style={styles.resultMeta}>
          {filteredBulletins.length} result
          {filteredBulletins.length === 1 ? "" : "s"}
        </Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading bulletins...</Text>
        </View>
      ) : errorText ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Could not load bulletins</Text>
          <Text style={styles.emptyText}>{errorText}</Text>
        </View>
      ) : filteredBulletins.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No bulletins found</Text>
          <Text style={styles.emptyText}>
            Try a different search, or check back when the group has more updates.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredBulletins.map((bulletin) => (
            <Pressable
              key={bulletin.id}
              style={styles.bulletinRow}
              onPress={() =>
                router.push({
                  pathname: "/group/[id]/bulletin/[bulletinId]",
                  params: {
                    id: groupId,
                    bulletinId: bulletin.id,
                  },
                })
              }
            >
              <Text style={styles.bulletinTitle}>{bulletin.title}</Text>

              <Text style={styles.bulletinBody} numberOfLines={3}>
                {bulletin.body}
              </Text>

              <MediaAttachmentGrid
                attachments={bulletin.attachments}
                theme={theme}
                onAttachmentPress={(_, index) =>
                  setViewer({
                    attachments: bulletin.attachments,
                    index,
                    title: bulletin.title,
                  })
                }
              />

              <Text style={styles.bulletinMeta}>
                {bulletin.authorName ?? bulletin.authorEmail ?? "Someone"} ·{" "}
                {formatRelativeTime(bulletin.createdAtMs)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <MediaAttachmentViewer
        attachments={viewer?.attachments ?? []}
        initialIndex={viewer?.index ?? 0}
        onRequestClose={() => setViewer(null)}
        presentationTitle={viewer?.title}
        visible={viewer !== null}
      />
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    container: {
      padding: 18,
      paddingBottom: 40,
      backgroundColor: theme.colors.background,
      gap: 14,
    },

    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 8,
    },

    backButtonText: {
      color: theme.colors.primary,
      fontWeight: "900",
      fontSize: 14,
    },

    headerCard: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 22,
      padding: 16,
    },

    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 22,
      padding: 16,
    },

    eyebrow: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 8,
    },

    title: {
      color: theme.colors.text,
      fontSize: 24,
      fontWeight: "900",
    },

    subtitle: {
      color: theme.colors.textMuted,
      lineHeight: 20,
      marginTop: 8,
    },

    searchInput: {
      marginTop: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.text,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },

    resultMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 10,
    },

    list: {
      gap: 10,
    },

    bulletinRow: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },

    bulletinTitle: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "900",
    },

    bulletinBody: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 6,
    },

    bulletinMeta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
      marginTop: 8,
    },

    loadingText: {
      color: theme.colors.textMuted,
      fontWeight: "800",
      marginTop: 10,
      textAlign: "center",
    },

    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
    },

    emptyText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
      marginTop: 8,
    },
  });
}
