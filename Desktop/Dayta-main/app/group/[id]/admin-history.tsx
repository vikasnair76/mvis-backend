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

import {
    subscribeGroupAdminLogs,
    type GroupAdminLogDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

function formatRelativeTime(ms?: number | null): string {
  if (!ms) return "Recently";

  const diffMs = Date.now() - ms;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

export default function GroupAdminHistoryScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [logs, setLogs] = useState<GroupAdminLogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribeGroupAdminLogs(
      groupId,
      (items) => {
        setLogs(items);
        setLoading(false);
      },
      (err) => {
        console.log("[GroupAdminHistory] failed loading logs", err);
        setError("Could not load admin history.");
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

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
        <Text style={styles.title}>Admin history</Text>
        <Text style={styles.subtitle}>
          Review member, invite, role, and safety actions for this group.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>
          {logs.length} action{logs.length === 1 ? "" : "s"}
        </Text>
        <Text style={styles.summaryText}>Most recent actions appear first.</Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading admin history...</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No admin actions yet</Text>
          <Text style={styles.helperText}>
            Role changes, member removals, invite actions, and moderation actions
            will appear here.
          </Text>
        </View>
      ) : (
        logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <Text style={styles.logMessage}>{log.message}</Text>

            <Text style={styles.logMeta}>
              {log.actorName ?? log.actorEmail ?? "Someone"} ·{" "}
              {formatRelativeTime(log.createdAtMs)}
            </Text>
          </View>
        ))
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
    summaryCard: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
    },
    summaryTitle: {
      color: theme.colors.text,
      fontSize: 20,
      fontWeight: "900",
    },
    summaryText: {
      color: theme.colors.textMuted,
      marginTop: 4,
      fontSize: 13,
      fontWeight: "800",
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
    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
    },
    logRow: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 10,
    },
    logMessage: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "900",
      lineHeight: 20,
    },
    logMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
      fontWeight: "700",
    },
  });