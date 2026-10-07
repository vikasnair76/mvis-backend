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
  cancelJoinRequest,
  getDiscoverableGroupPreview,
  joinOpenGroup,
  requestToJoinGroup,
  subscribeMyGroupMemberships,
  subscribeMyJoinRequestForGroup,
  type GroupDiscoverySummary,
  type GroupJoinRequestDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

function getJoinFailureCopy(err: unknown): {
  title: string;
  body: string;
} {
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err ?? "").toLowerCase();

  if (
    message.includes("permission") ||
    message.includes("insufficient permissions") ||
    message.includes("blocked") ||
    message.includes("no longer join")
  ) {
    return {
      title: "Unable to join",
      body: "You may no longer be allowed to join this group. If this seems wrong, contact the group owner.",
    };
  }

  if (message.includes("not available")) {
    return {
      title: "Group unavailable",
      body: "This group is not currently available for joining.",
    };
  }

  return {
    title: "Action failed",
    body: "Please try again.",
  };
}

export default function GroupPreviewScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

const [group, setGroup] = useState<GroupDiscoverySummary | null>(null);
const [joinRequest, setJoinRequest] = useState<GroupJoinRequestDoc | null>(null);

const hasPendingRequest = joinRequest?.status === "pending";
const [isCurrentMember, setIsCurrentMember] = useState(false);
const [loading, setLoading] = useState(true);
const [joinActionPending, setJoinActionPending] = useState(false);

const currentUser = auth.currentUser;
const isSignedIn = !!currentUser?.uid;

const [error, setError] = useState<string | null>(null);

useEffect(() => {
  let active = true;

  if (!groupId) {
    setGroup(null);
    setLoading(false);
    setError("Missing group.");
    return;
  }

  setLoading(true);

  getDiscoverableGroupPreview(groupId)
    .then((preview) => {
      if (!active) return;

      setGroup(preview);
      setLoading(false);
      setError(preview ? null : "This group is not available for preview.");
    })
    .catch((err) => {
      console.log("[GroupPreview] failed to load preview", err);

      if (!active) return;

      setGroup(null);
      setLoading(false);
      setError("Failed to load group preview.");
    });

  return () => {
    active = false;
  };
}, [groupId]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid) {
    setJoinRequest(null);
    return;
  }

  return subscribeMyJoinRequestForGroup(
    groupId,
    currentUser.uid,
    setJoinRequest,
    (err) => {
      console.log("[GroupPreview] join request subscription failed", err);
      setJoinRequest(null);
    }
  );
}, [groupId]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid) {
    setIsCurrentMember(false);
    return;
  }

  return subscribeMyGroupMemberships(
    currentUser.uid,
    (memberships) => {
      setIsCurrentMember(
        memberships.some((membership) => membership.groupId === groupId)
      );
    },
    (err) => {
      console.log("[GroupPreview] membership subscription failed", err);
      setIsCurrentMember(false);
    }
  );
}, [groupId]);

const handleJoinOpenGroup = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in to join this group.");
    return;
  }

  if (!group) {
    Alert.alert("Group unavailable", "This group preview is not available.");
    return;
  }

  try {
    setJoinActionPending(true);

    await joinOpenGroup({
      groupId: group.id,
      uid: currentUser.uid,
      email: currentUser.email ?? null,
      displayName: currentUser.displayName ?? null,
      groupName: group.name,
    });

    Alert.alert("Joined group", `You joined ${group.name}.`, [
      {
        text: "Open group",
        onPress: () =>
          router.replace({
            pathname: "/group/[id]",
            params: { id: group.id },
          }),
      },
    ]);
    } catch (err: any) {
    console.log("[GroupPreview] open join failed", err);

    const copy = getJoinFailureCopy(err);
    Alert.alert(copy.title, copy.body);
  } finally {
    setJoinActionPending(false);
  }
};

const handleRequestToJoin = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in to request access.");
    return;
  }

  if (!group) {
    Alert.alert("Group unavailable", "This group preview is not available.");
    return;
  }

  try {
    setJoinActionPending(true);

    await requestToJoinGroup({
      groupId: group.id,
      uid: currentUser.uid,
      email: currentUser.email ?? null,
      displayName: currentUser.displayName ?? null,
    });

    Alert.alert("Request sent", `Your request to join ${group.name} was sent.`);
    } catch (err: any) {
    console.log("[GroupPreview] request to join failed", err);

    const copy = getJoinFailureCopy(err);
    Alert.alert(copy.title, copy.body);
  } finally {
    setJoinActionPending(false);
  }
};

const handleCancelJoinRequest = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !group) return;

  try {
    setJoinActionPending(true);

    await cancelJoinRequest({
      groupId: group.id,
      uid: currentUser.uid,
    });

    Alert.alert("Request cancelled", "Your join request was cancelled.");
  } catch (err: any) {
    console.log("[GroupPreview] cancel join request failed", err);
    Alert.alert("Cancel failed", err?.message ?? "Please try again.");
  } finally {
    setJoinActionPending(false);
  }
};

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Explore</Text>
      </Pressable>

      {loading ? (
  <View style={[styles.card, styles.centerCard]}>
  <ActivityIndicator color={theme.colors.primary} />
  <Text style={styles.loadingText}>Loading group preview...</Text>
</View>
) : error ? (
  <View style={styles.card}>
    <View style={styles.iconWrap}>
      <Ionicons
        name="lock-closed-outline"
        size={26}
        color={theme.colors.primary}
      />
    </View>

    <Text style={styles.cardTitle}>Preview unavailable</Text>

    <Text style={styles.helperText}>{error}</Text>
  </View>
) : group ? (
  <>
    <View style={styles.header}>
      <View style={styles.iconWrap}>
        <Ionicons
          name="people-outline"
          size={26}
          color={theme.colors.primary}
        />
      </View>

      <Text style={styles.title}>{group.name}</Text>

      {!!group.summary ? (
        <Text style={styles.subtitle}>{group.summary}</Text>
      ) : (
        <Text style={styles.subtitle}>
          Public accountability community.
        </Text>
      )}
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>About this group</Text>

      <Text style={styles.helperText}>
        {group.description || group.summary || "No description yet."}
      </Text>

      <View style={styles.metaGrid}>
        <View style={styles.metaPill}>
          <Ionicons
            name="people-outline"
            size={14}
            color={theme.colors.primary}
          />
          <Text style={styles.metaPillText}>
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.metaPill}>
          <Ionicons
            name="pricetag-outline"
            size={14}
            color={theme.colors.primary}
          />
          <Text style={styles.metaPillText}>{group.category}</Text>
        </View>

        <View style={styles.metaPill}>
          <Ionicons
            name={
              group.joinPolicy === "open"
                ? "checkmark-circle-outline"
                : group.joinPolicy === "request"
                ? "mail-outline"
                : "lock-closed-outline"
            }
            size={14}
            color={theme.colors.primary}
          />
          <Text style={styles.metaPillText}>
            {group.joinPolicy === "open"
              ? "Open join"
              : group.joinPolicy === "request"
              ? "Request to join"
              : "Invite only"}
          </Text>
        </View>
      </View>

      {group.tags.length > 0 ? (
        <View style={styles.tagsRow}>
          {group.tags.map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagText}>#{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}
      
    </View>

    <View style={styles.card}>
  <Text style={styles.cardTitle}>Join this group</Text>

  {!isSignedIn ? (
  <View style={styles.signedOutNotice}>
    <Ionicons
      name="person-circle-outline"
      size={18}
      color={theme.colors.primary}
    />

    <Text style={styles.signedOutNoticeText}>
      Sign in to join or request access to groups.
    </Text>
  </View>
) : (
 <>
  <Text style={styles.helperText}>
  {group.joinPolicy === "open"
    ? "Anyone with access to discovery can join instantly. Group admins can moderate, remove, or block unsafe members."
    : group.joinPolicy === "request"
    ? "Send a request and group admins or moderators can review it before you join."
    : "This group is visible for discovery, but joining is invite-only."}
</Text>

{isCurrentMember ? (
  <View style={styles.joinActionStack}>
    <View style={styles.memberBadge}>
      <Text style={styles.memberBadgeText}>
        Already a member
      </Text>
    </View>

    <Pressable
      style={styles.primaryButton}
      onPress={() =>
        router.replace({
          pathname: "/group/[id]",
          params: { id: group.id },
        })
      }
    >
      <Text style={styles.primaryButtonText}>
        Open group
      </Text>
    </Pressable>
  </View>
) : group.joinPolicy === "open" ? (
  <Pressable
    style={[
      styles.primaryButton,
      joinActionPending && styles.buttonDisabled,
    ]}
    onPress={handleJoinOpenGroup}
    disabled={joinActionPending}
  >
    <Text style={styles.primaryButtonText}>
      {joinActionPending ? "Joining..." : "Join group"}
    </Text>
  </Pressable>
) : group.joinPolicy === "request" ? (
  hasPendingRequest ? (
    <View style={styles.joinActionStack}>
      <View style={styles.pendingBadge}>
        <Text style={styles.pendingBadgeText}>
          Request pending
        </Text>
      </View>

      <Pressable
        style={[
          styles.secondaryButton,
          joinActionPending && styles.buttonDisabled,
        ]}
        onPress={handleCancelJoinRequest}
        disabled={joinActionPending}
      >
        <Text style={styles.secondaryButtonText}>
          {joinActionPending
            ? "Cancelling..."
            : "Cancel request"}
        </Text>
      </Pressable>
    </View>
  ) : (
    <Pressable
      style={[
        styles.primaryButton,
        joinActionPending && styles.buttonDisabled,
      ]}
      onPress={handleRequestToJoin}
      disabled={joinActionPending}
    >
      <Text style={styles.primaryButtonText}>
        {joinActionPending
          ? "Sending..."
          : "Request to join"}
      </Text>
    </Pressable>
  )
) : (
  <Pressable style={styles.disabledButton} disabled>
    <Text style={styles.disabledButtonText}>
      Invite only
    </Text>
  </Pressable>
)}

<Text style={styles.previewSafetyText}>
  Public groups are moderated by their owners and admins. You can report unsafe content or leave groups at any time.
</Text>
</>
)}
</View>
  </>
) : null}
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

    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
      marginBottom: 14,
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
      marginBottom: 14,
    },

    cardTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "900",
      marginBottom: 8,
    },

    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
      fontSize: 14,
    },

    metaText: {
      color: theme.colors.primary,
      marginTop: 14,
      fontSize: 12,
      fontWeight: "900",
    },

    disabledButton: {
  marginTop: 14,
  borderRadius: 999,
  paddingVertical: 10,
  alignItems: "center",
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
  borderWidth: 1,
  opacity: 0.85,
},

    disabledButtonText: {
      color: theme.colors.secondaryText,
      fontSize: 13,
      fontWeight: "900",
    },
    loadingText: {
  color: theme.colors.textMuted,
  marginTop: 10,
  textAlign: "center",
},

metaGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 14,
},

metaPill: {
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 6,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

metaPillText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  textTransform: "capitalize",
},

tagsRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 14,
},

tagChip: {
  backgroundColor: theme.colors.badge,
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 5,
},

tagText: {
  color: theme.colors.badgeText,
  fontSize: 12,
  fontWeight: "800",
},
centerCard: {
  alignItems: "center",
},
previewHint: {
  color: theme.colors.primary,
  marginTop: 12,
  fontSize: 13,
  fontWeight: "900",
},
joinActionStack: {
  marginTop: 14,
  gap: 10,
},

primaryButton: {
  marginTop: 14,
  borderRadius: 999,
  paddingVertical: 10,
  alignItems: "center",
  backgroundColor: theme.colors.primary,
},

primaryButtonText: {
  color: theme.colors.primaryText,
  fontSize: 13,
  fontWeight: "900",
},

secondaryButton: {
  borderRadius: 999,
  paddingVertical: 10,
  alignItems: "center",
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
  borderWidth: 1,
},

secondaryButtonText: {
  color: theme.colors.secondaryText,
  fontSize: 13,
  fontWeight: "900",
},

buttonDisabled: {
  opacity: 0.55,
},

pendingBadge: {
  alignSelf: "flex-start",
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 6,
  backgroundColor: theme.colors.warningBackground,
  borderColor: theme.colors.warningBorder,
  borderWidth: 1,
},

pendingBadgeText: {
  color: theme.colors.warningText,
  fontSize: 12,
  fontWeight: "900",
},
previewSafetyText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 12,
},
memberBadge: {
  alignSelf: "flex-start",
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 6,
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
  borderWidth: 1,
},

memberBadgeText: {
  color: theme.colors.successText,
  fontSize: 12,
  fontWeight: "900",
},
signedOutNotice: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  marginTop: 14,
  padding: 12,
  borderRadius: 14,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

signedOutNoticeText: {
  flex: 1,
  color: theme.colors.textMuted,
  fontSize: 13,
  lineHeight: 18,
},
  });