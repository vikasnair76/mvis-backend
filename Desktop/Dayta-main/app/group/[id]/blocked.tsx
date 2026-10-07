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
    subscribeBlockedUsers,
    unblockUserFromGroup,
    type GroupBlockedUserDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

export default function GroupBlockedUsersScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [blockedUsers, setBlockedUsers] = useState<GroupBlockedUserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!groupId) {
      setBlockedUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = subscribeBlockedUsers(
      groupId,
      (items) => {
        setBlockedUsers(items);
        setLoading(false);
      },
      (err) => {
        console.log("[BlockedUsers] subscription failed", err);
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

 const handleUnblock = async (user: GroupBlockedUserDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  const label =
    user.blockedUserDisplayName ?? user.blockedUserEmail ?? "this user";

  Alert.alert(
    "Unblock user?",
    `${label} will be able to request access or rejoin if invited again.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unblock",
        onPress: async () => {
          try {
            setUnblockingIds((current) => new Set(current).add(user.uid));

            await unblockUserFromGroup({
              groupId,
              uid: user.uid,
              unblockedByUid: currentUser.uid,
              unblockedByName: currentUser.displayName ?? currentUser.email ?? null,
              unblockedByEmail: currentUser.email ?? null,
            });
          } catch (err: any) {
            console.log("[BlockedUsers] unblock failed", err);
            Alert.alert("Unblock failed", err?.message ?? "Please try again.");
          } finally {
            setUnblockingIds((current) => {
              const next = new Set(current);
              next.delete(user.uid);
              return next;
            });
          }
        },
      },
    ]
  );
};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Group</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Blocked users</Text>
        <Text style={styles.subtitle}>
          Users blocked from joining or rejoining this group.
        </Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading blocked users...</Text>
        </View>
      ) : blockedUsers.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No blocked users</Text>
          <Text style={styles.helperText}>
            Blocked users will appear here for admins and moderators.
          </Text>
        </View>
      ) : (
        blockedUsers.map((user) => {
          const busy = unblockingIds.has(user.uid);

          return (
            <View key={user.uid} style={styles.card}>
              <Text style={styles.emptyTitle}>
                {user.blockedUserDisplayName ??
                  user.blockedUserEmail ??
                  user.uid}
              </Text>

              {!!user.blockedUserEmail ? (
                <Text style={styles.helperText}>{user.blockedUserEmail}</Text>
              ) : null}

              <Text style={styles.helperText}>
                Blocked{" "}
                {user.createdAtMs
                  ? new Date(user.createdAtMs).toLocaleString()
                  : "recently"}
              </Text>

              <Text style={styles.helperText}>
                By{" "}
                {user.blockedByDisplayName ??
                  user.blockedByEmail ??
                  user.blockedByUid}
              </Text>

              {!!user.reason ? (
                <Text style={styles.reasonText}>Reason: {user.reason}</Text>
              ) : null}

              <Pressable
                style={[styles.unblockButton, busy && styles.buttonDisabled]}
                onPress={() => handleUnblock(user)}
                disabled={busy}
              >
                <Text style={styles.unblockButtonText}>
                  {busy ? "Unblocking..." : "Unblock"}
                </Text>
              </Pressable>
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
    card: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 12,
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
    },
    helperText: {
      color: theme.colors.textMuted,
      marginTop: 8,
      lineHeight: 20,
    },
    reasonText: {
      color: theme.colors.text,
      marginTop: 10,
      lineHeight: 20,
      fontWeight: "700",
    },
    unblockButton: {
      marginTop: 14,
      alignSelf: "flex-start",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },
    unblockButtonText: {
      color: theme.colors.primary,
      fontWeight: "900",
      fontSize: 12,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
  });