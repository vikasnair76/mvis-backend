import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { auth } from "../../../services/firebase";
import {
    approveJoinRequest,
    declineJoinRequest,
    subscribePendingJoinRequests,
    type GroupJoinRequestDoc,
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

export default function GroupJoinRequestsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [requests, setRequests] = useState<GroupJoinRequestDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewingIds, setReviewingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!groupId) {
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribePendingJoinRequests(
      groupId,
      (items) => {
        setRequests(items);
        setLoading(false);
      },
      (err) => {
        console.log("[GroupJoinRequests] failed loading requests", err);
        setError("Could not load join requests.");
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

  const handleApprove = async (request: GroupJoinRequestDoc) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || reviewingIds.has(request.id)) {
      return;
    }

    try {
      setReviewingIds((current) => new Set(current).add(request.id));

      await approveJoinRequest({
        groupId,
        requestUid: request.uid,
        reviewedByUid: currentUser.uid,
        reviewedByName: currentUser.displayName ?? currentUser.email ?? null,
      });

      Alert.alert("Request approved", "The member has been added to the group.");
    } catch (err: any) {
      console.log("[GroupJoinRequests] approve failed", err);
      Alert.alert("Approve failed", err?.message ?? "Please try again.");
    } finally {
      setReviewingIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
  };

  const handleDecline = async (request: GroupJoinRequestDoc) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || reviewingIds.has(request.id)) {
      return;
    }

    try {
      setReviewingIds((current) => new Set(current).add(request.id));

      await declineJoinRequest({
        groupId,
        requestUid: request.uid,
        reviewedByUid: currentUser.uid,
        reviewedByName: currentUser.displayName ?? currentUser.email ?? null,
      });
    } catch (err: any) {
      console.log("[GroupJoinRequests] decline failed", err);
      Alert.alert("Decline failed", err?.message ?? "Please try again.");
    } finally {
      setReviewingIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }
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
        <Text style={styles.title}>Join requests</Text>
        <Text style={styles.subtitle}>
          Review people asking to join this group.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>
          {requests.length} pending
        </Text>
        <Text style={styles.summaryText}>
          Approve trusted members or decline requests that do not fit.
        </Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading join requests...</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No pending requests</Text>
          <Text style={styles.helperText}>
            New requests from Explore will appear here for admin review.
          </Text>
        </View>
      ) : (
        requests.map((request) => {
          const busy = reviewingIds.has(request.id);

          return (
            <View key={request.id} style={styles.requestRow}>
              <Text style={styles.requestName}>
                {request.displayName ?? request.email ?? request.uid}
              </Text>

              {!!request.email ? (
                <Text style={styles.requestMeta}>{request.email}</Text>
              ) : null}

              <Text style={styles.requestMeta}>
                Requested {formatRelativeTime(request.createdAtMs)}
              </Text>

              {!!request.message ? (
                <Text style={styles.requestMessage}>{request.message}</Text>
              ) : null}

              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.declineButton, busy && styles.buttonDisabled]}
                  onPress={() => handleDecline(request)}
                  disabled={busy}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </Pressable>

                <Pressable
                  style={[styles.approveButton, busy && styles.buttonDisabled]}
                  onPress={() => handleApprove(request)}
                  disabled={busy}
                >
                  <Text style={styles.approveButtonText}>
                    {busy ? "Reviewing..." : "Approve"}
                  </Text>
                </Pressable>
              </View>
            </View>
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
    requestRow: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 10,
    },
    requestName: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },
    requestMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
      fontWeight: "700",
    },
    requestMessage: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 8,
    },
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    approveButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.primary,
    },
    approveButtonText: {
      color: theme.colors.primaryText,
      fontSize: 12,
      fontWeight: "900",
    },
    declineButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    declineButtonText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
  });