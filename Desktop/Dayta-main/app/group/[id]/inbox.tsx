import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth } from "../../../services/firebase";
import {
  markGroupInboxItemRead,
  subscribeMyGroupInbox,
  type GroupInboxItemDoc
} from "../../../services/groups";
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

function getInboxIcon(type: GroupInboxItemDoc["type"]) {
  switch (type) {
    case "assignment":
      return "📌";
    case "comment":
      return "💬";
    case "activity":
      return "🔔";
    default:
      return "•";
  }
}

export default function GroupInboxScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [items, setItems] = useState<GroupInboxItemDoc[]>([]);
  const [loading, setLoading] = useState(true);

  

  const groupItems = useMemo(() => {
    return items
      .filter((item) => item.groupId === groupId)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [items, groupId]);

  const unreadCount = groupItems.filter((item) => !item.readAtMs).length;

  useEffect(() => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = subscribeMyGroupInbox(
      currentUser.uid,
      (next) => {
        setItems(next);
        setLoading(false);
      },
      (err) => {
        console.log("[GroupInbox] failed loading inbox", err);
        setLoading(false);
      }
    );

    return unsub;
  }, []);

  const handleOpenItem = (item: GroupInboxItemDoc) => {
    const currentUser = auth.currentUser;

    if (currentUser?.uid && !item.readAtMs) {
      markGroupInboxItemRead({
        uid: currentUser.uid,
        itemId: item.id,
      }).catch((err) => {
        console.log("[GroupInbox] mark item read failed", err);
      });
    }

    if (item.moderation || item.title === "New moderation report") {
  router.push({
    pathname: "/group/[id]",
    params: {
      id: item.groupId,
      focus: "moderation",
      reportId: item.reportId ?? "",
    },
  });
  return;
}

    if (item.type === "comment" && item.subtaskId && !item.goalId) {
      router.push(`/group/${item.groupId}/task/${item.subtaskId}`);
      return;
    }

    if (item.goalId) {
      router.push({
        pathname: "/goal/[id]",
        params: item.subtaskId
          ? {
              id: item.goalId,
              highlightSubtaskId: item.subtaskId,
            }
          : { id: item.goalId },
      });
    }
    if (item.groupId) {
  router.push(`/group/${item.groupId}`);
}
  };

  const handleMarkAllRead = async () => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid) return;

    const unreadItems = groupItems.filter((item) => !item.readAtMs);

    await Promise.all(
      unreadItems.map((item) =>
        markGroupInboxItemRead({
          uid: currentUser.uid,
          itemId: item.id,
        }).catch((err) => {
          console.log("[GroupInbox] mark all item failed", err);
        })
      )
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Group</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Group inbox</Text>
        <Text style={styles.subtitle}>
          Assignments, comments, mentions, and group updates for this group.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryTitle}>
            {unreadCount} unread
          </Text>
          <Text style={styles.summaryText}>
            {groupItems.length} total inbox item
            {groupItems.length === 1 ? "" : "s"}
          </Text>
        </View>

        {unreadCount > 0 ? (
          <Pressable style={styles.markAllButton} onPress={handleMarkAllRead}>
            <Text style={styles.markAllButtonText}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading inbox...</Text>
        </View>
      ) : groupItems.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.helperText}>
            New assignments, comments, mentions, and activity will appear here.
          </Text>
        </View>
      ) : (
        groupItems.map((item) => {
          const unread = !item.readAtMs;

          return (
            <Pressable
              key={item.id}
              style={[
                styles.inboxRow,
                unread && styles.inboxRowUnread,
              ]}
              onPress={() => handleOpenItem(item)}
            >
              <View style={styles.inboxIcon}>
                <Text style={styles.inboxIconText}>
                  {getInboxIcon(item.type)}
                </Text>
              </View>

              <View style={styles.inboxBody}>
                <View style={styles.inboxTitleRow}>
                  <Text style={styles.inboxTitle} numberOfLines={1}>
                    {item.title}
                  </Text>

                  {unread ? (
                    <View style={styles.unreadDot} />
                  ) : null}
                </View>

                {!!item.body ? (
                  <Text style={styles.inboxBodyText} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}

                <Text style={styles.inboxMeta}>
                  {formatRelativeTime(item.createdAtMs)}
                  {item.actorName ? ` · ${item.actorName}` : ""}
                </Text>
              </View>
            </Pressable>
          );
        })
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
      gap: 4,
      alignSelf: "flex-start",
      marginBottom: 18,
    },

    backButtonText: {
      color: theme.colors.primary,
      fontWeight: "800",
      fontSize: 15,
    },

    header: {
      marginBottom: 18,
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

    summaryCard: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },

    summaryTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
    },

    summaryText: {
      color: theme.colors.textMuted,
      marginTop: 4,
      fontSize: 13,
      fontWeight: "700",
    },

    markAllButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },

    markAllButtonText: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },

    card: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
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

    inboxRow: {
      flexDirection: "row",
      gap: 12,
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 10,
    },

    inboxRowUnread: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    inboxIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted,
    },

    inboxIconText: {
      fontSize: 16,
    },

    inboxBody: {
      flex: 1,
      minWidth: 0,
    },

    inboxTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },

    inboxTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },

    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.primary,
    },

    inboxBodyText: {
      color: theme.colors.textMuted,
      marginTop: 4,
      lineHeight: 18,
      fontSize: 13,
    },

    inboxMeta: {
      color: theme.colors.textMuted,
      marginTop: 6,
      fontSize: 11,
      fontWeight: "800",
    },
  });