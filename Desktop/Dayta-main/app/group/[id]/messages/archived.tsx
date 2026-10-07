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

import { auth } from "../../../../services/firebase";
import {
    subscribeMyArchivedGroupConversations,
    type GroupConversationDoc,
} from "../../../../services/groups";
import { useAppTheme } from "../../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

function normalizeArchivedSearchText(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatRelativeTime(ms?: number | null): string {
  if (!ms) return "No messages yet";

  const diffMs = Date.now() - ms;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

export default function ArchivedGroupMessagesScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const currentUid = auth.currentUser?.uid ?? "";

  const [archivedConversations, setArchivedConversations] = useState<
    GroupConversationDoc[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");

const normalizedSearchText = normalizeArchivedSearchText(searchText);

const groupArchivedConversations = useMemo(
  () =>
    archivedConversations
      .filter((conversation) => conversation.groupId === groupId)
      .sort(
        (a, b) =>
          (b.lastMessageAtMs ?? b.updatedAtMs ?? b.createdAtMs ?? 0) -
          (a.lastMessageAtMs ?? a.updatedAtMs ?? a.createdAtMs ?? 0)
      ),
  [archivedConversations, groupId]
);

const searchedArchivedConversations = useMemo(() => {
  if (!normalizedSearchText) return groupArchivedConversations;

  return groupArchivedConversations.filter((conversation) => {
    const searchable = normalizeArchivedSearchText(
      [
        conversation.title,
        conversation.subject,
        conversation.lastMessagePreview,
        `${conversation.memberUids.length} members`,
      ]
        .filter(Boolean)
        .join(" ")
    );

    return searchable.includes(normalizedSearchText);
  });
}, [groupArchivedConversations, normalizedSearchText]);

  useEffect(() => {
    if (!currentUid) {
      setArchivedConversations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    const unsub = subscribeMyArchivedGroupConversations(
      currentUid,
      (items) => {
        setArchivedConversations(items);
        setLoading(false);
      },
      (err) => {
        console.log("[ArchivedMessages] subscription failed", err);
        setErrorText("Could not load archived conversations.");
        setLoading(false);
      }
    );

    return unsub;
  }, [currentUid]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Messages</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Archived conversations</Text>
<Text style={styles.subtitle}>
  {groupArchivedConversations.length === 0
    ? "Archived conversations will appear here when you move threads out of your active list."
    : `${groupArchivedConversations.length} archived conversation${
        groupArchivedConversations.length === 1 ? "" : "s"
      }`}
</Text>
      </View>

      {!loading && groupArchivedConversations.length > 0 ? (
        <View style={styles.searchCard}>
          <Ionicons
            name="search-outline"
            size={17}
            color={theme.colors.textMuted}
          />

          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search archived conversations..."
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {searchText.trim() ? (
            <Pressable onPress={() => setSearchText("")}>
              <Text style={styles.clearSearchText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading archived conversations...</Text>
        </View>
      ) : errorText ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
    ) : groupArchivedConversations.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No archived conversations</Text>
          <Text style={styles.helperText}>
            Archived group conversations will appear here.
          </Text>
        </View>
) : searchedArchivedConversations.length === 0 ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>No matching archived conversations</Text>
    <Text style={styles.helperText}>
      Try another title, subject, member count, or message preview.
    </Text>
  </View>
) : (
  <View style={styles.list}>
    {searchedArchivedConversations.map((conversation) => (
            <Pressable
              key={conversation.id}
              style={styles.row}
              onPress={() =>
                router.push(
                  `/group/${groupId}/conversation/${conversation.id}` as any
                )
              }
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>🗃️</Text>
              </View>

              <View style={styles.body}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {conversation.title}
                </Text>

                <Text style={styles.preview} numberOfLines={2}>
{conversation.lastMessagePreview ??
  conversation.subject ??
  "No messages yet — open to review or move back to active."}
                </Text>

<Text style={styles.meta}>
  Archived · {conversation.memberUids.length} member
  {conversation.memberUids.length === 1 ? "" : "s"}
</Text>

<Text style={styles.restoreHint}>Open to move back to active</Text>
              </View>

<View style={styles.rightMeta}>
  <Text style={styles.archivedPill}>Archived</Text>

  <Text style={styles.time}>
    {formatRelativeTime(
      conversation.lastMessageAtMs ?? conversation.updatedAtMs
    )}
  </Text>
</View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 20,
      paddingTop: 70,
      paddingBottom: 140,
      backgroundColor: theme.colors.background,
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 18,
    },
    backButtonText: {
      color: theme.colors.primary,
      fontSize: 14,
      fontWeight: "900",
    },
    header: {
      marginBottom: 16,
    },
    title: {
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: "900",
    },
    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 8,
      fontSize: 15,
      lineHeight: 21,
    },
    card: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    loadingText: {
      color: theme.colors.textMuted,
      marginTop: 10,
      textAlign: "center",
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
      marginBottom: 8,
    },
    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
    },
    list: {
      gap: 10,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    avatarText: {
      fontSize: 18,
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },
    preview: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 3,
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
      marginTop: 5,
    },
    time: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
    },
    searchCard: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderRadius: 16,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 14,
},

searchInput: {
  flex: 1,
  minWidth: 0,
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "700",
  paddingVertical: 0,
},

clearSearchText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

rightMeta: {
  alignItems: "flex-end",
  gap: 6,
},

archivedPill: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  overflow: "hidden",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

restoreHint: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
  marginTop: 5,
},
  });