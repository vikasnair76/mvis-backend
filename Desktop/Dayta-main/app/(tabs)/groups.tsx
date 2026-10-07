import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged, type User } from "firebase/auth";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { router } from "expo-router";
import { auth } from "../../services/firebase";
import {
  acceptGroupInvite,
  cancelJoinRequest,
  createGroup,
  declineGroupInvite,
  subscribeMyGroupMemberships,
  subscribeMyPendingGroupInvites,
  subscribeMyPendingJoinRequests,
  type GroupDiscoveryCategory,
  type GroupInviteDoc,
  type GroupJoinRequestDoc,
  type GroupMemberDoc,
} from "../../services/groups";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

type MyGroupMembership = GroupMemberDoc & {
  groupId: string;
};

type NewGroupJoinMode = "invite_only" | "request" | "open";

function formatJoinRequestTime(ms?: number | null): string {
  if (!ms) return "recently";

  return new Date(ms).toLocaleString();
}

const GROUP_CATEGORY_OPTIONS: Array<{
  key: GroupDiscoveryCategory;
  label: string;
}> = [
  { key: "general", label: "General" },
  { key: "fitness", label: "Fitness" },
  { key: "productivity", label: "Productivity" },
  { key: "learning", label: "Learning" },
  { key: "wellness", label: "Wellness" },
  { key: "work", label: "Work" },
  { key: "other", label: "Other" },
];

export default function GroupsScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);

  const [showInvites, setShowInvites] = useState(false);
const [showJoinRequests, setShowJoinRequests] = useState(false);
const [showMyGroups, setShowMyGroups] = useState(true);
const [groupName, setGroupName] = useState("");
const [groupDescription, setGroupDescription] = useState("");

const [newGroupJoinMode, setNewGroupJoinMode] =
  useState<NewGroupJoinMode>("invite_only");

  const [newGroupCategory, setNewGroupCategory] =
  useState<GroupDiscoveryCategory>("general");

const [newGroupSummary, setNewGroupSummary] = useState("");

const [newGroupTagsText, setNewGroupTagsText] = useState("");

  const [memberships, setMemberships] = useState<MyGroupMembership[]>([]);

  const [pendingInvites, setPendingInvites] = useState<GroupInviteDoc[]>([]);
const [loadingInvites, setLoadingInvites] = useState(true);

const [pendingJoinRequests, setPendingJoinRequests] = useState<
  GroupJoinRequestDoc[]
>([]);
const [loadingJoinRequests, setLoadingJoinRequests] = useState(true);
const [cancellingJoinRequestIds, setCancellingJoinRequestIds] = useState<
  Set<string>
>(new Set());

const [acceptingInviteIds, setAcceptingInviteIds] = useState<Set<string>>(
  new Set()
);

const [decliningInviteIds, setDecliningInviteIds] = useState<Set<string>>(
  new Set()
);

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
    });

    return unsub;
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);

const unsub = subscribeMyGroupMemberships(
  user.uid,
  (next) => {
    const activeMemberships = next.filter(
      (membership) => membership.status === "active"
    );

    setMemberships(activeMemberships);
    setLoading(false);
  },
  (err) => {
        console.log("[Groups] membership subscription failed", err);
        setLoading(false);
      }
    );

    return unsub;
  }, [user?.uid]);

  useEffect(() => {
  if (!user?.email) {
    setPendingInvites([]);
    setLoadingInvites(false);
    return;
  }

  setLoadingInvites(true);

  const unsub = subscribeMyPendingGroupInvites(
    user.email,
    (next) => {
      setPendingInvites(next);
      setLoadingInvites(false);
    },
    (err) => {
      console.log("[Groups] pending invite subscription failed", err);
      setLoadingInvites(false);
    }
  );

  return unsub;
}, [user?.email]);

useEffect(() => {
  if (!user?.uid) {
    setPendingJoinRequests([]);
    setLoadingJoinRequests(false);
    return;
  }

  setLoadingJoinRequests(true);

  const unsub = subscribeMyPendingJoinRequests(
    user.uid,
    (next) => {
      setPendingJoinRequests(next);
      setLoadingJoinRequests(false);
    },
    (err) => {
      console.log("[Groups] pending join requests subscription failed", err);
      setLoadingJoinRequests(false);
    }
  );

  return unsub;
}, [user?.uid]);

 const handleCreateGroup = async () => {
  if (!user?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

const parsedTags = newGroupTagsText
  .split(",")
  .map((tag) => tag.trim().toLowerCase())
  .filter(Boolean)
  .slice(0, 8);

  const trimmedName = groupName.trim();

  if (!trimmedName) {
    Alert.alert("Name required", "Please enter a group name.");
    return;
  }

  try {
    setCreating(true);

    const groupId = await createGroup({
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      name: trimmedName,
      description: groupDescription.trim() || null,
      visibility: newGroupJoinMode === "invite_only" ? "invite_only" : "searchable",
discoverable: newGroupJoinMode !== "invite_only",
joinPolicy: newGroupJoinMode,
category: newGroupCategory,
tags: parsedTags,
summary: newGroupSummary.trim() || groupDescription.trim() || null,
    });

    setGroupName("");
    setGroupDescription("");
setNewGroupJoinMode("invite_only");
setNewGroupCategory("general");
setNewGroupSummary("");
setNewGroupTagsText("");
    setShowCreateForm(false);

    Alert.alert(
  "Group created",
  newGroupJoinMode === "invite_only"
    ? "Your private group is ready. Invite people from the group dashboard."
    : "Your group is ready and can appear in Explore based on its discovery settings."
);
  } catch (e: any) {
    console.log("[Groups] create group failed", e);
    Alert.alert("Create group failed", e?.message ?? "Unknown error");
  } finally {
    setCreating(false);
  }
};

  const handleAcceptInvite = async (invite: GroupInviteDoc) => {
  if (!user?.uid || !user.email) {
    Alert.alert("Sign in required", "Please sign in with an email account.");
    return;
  }

  try {
    setAcceptingInviteIds((current) => new Set(current).add(invite.id));

    await acceptGroupInvite({
      invite,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? null,
    });

    Alert.alert("Invite accepted", `You joined ${invite.groupName}.`);
  } catch (e: any) {
    console.log("[Groups] accept invite failed", e);
    Alert.alert("Accept failed", e?.message ?? "Unknown error");
  } finally {
    setAcceptingInviteIds((current) => {
      const next = new Set(current);
      next.delete(invite.id);
      return next;
    });
  }
};

const handleDeclineInvite = async (invite: GroupInviteDoc) => {
  if (!user?.email) {
    Alert.alert("Sign in required", "Please sign in with an email account.");
    return;
  }

  try {
    setDecliningInviteIds((current) => new Set(current).add(invite.id));

    await declineGroupInvite({
  invite,
  email: user.email,
  displayName: user.displayName ?? user.email ?? null,
});

    Alert.alert("Invite declined", `Declined invite to ${invite.groupName}.`);
  } catch (e: any) {
    console.log("[Groups] decline invite failed", e);
    Alert.alert("Decline failed", e?.message ?? "Unknown error");
  } finally {
    setDecliningInviteIds((current) => {
      const next = new Set(current);
      next.delete(invite.id);
      return next;
    });
  }
};

const handleCancelJoinRequest = async (request: GroupJoinRequestDoc) => {
  if (!user?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setCancellingJoinRequestIds((current) => new Set(current).add(request.id));

    await cancelJoinRequest({
      groupId: request.groupId,
      uid: user.uid,
    });
  } catch (e: any) {
    console.log("[Groups] cancel join request failed", e);
    Alert.alert("Cancel failed", e?.message ?? "Unknown error");
  } finally {
    setCancellingJoinRequestIds((current) => {
      const next = new Set(current);
      next.delete(request.id);
      return next;
    });
  }
};

const handleOpenJoinRequestGroup = (request: GroupJoinRequestDoc) => {
  if (!request.groupId) return;

  router.push({
    pathname: "/group/[id]/preview",
    params: { id: request.groupId },
  });
};

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <Text style={styles.subtitle}>
  Create private accountability spaces, join public communities, and coordinate shared goals safely.
</Text>
      </View>

      <Pressable
  style={styles.exploreCard}
  onPress={() => router.push("/group/explore")}
>
  <View style={styles.exploreIconWrap}>
    <Ionicons name="compass-outline" size={22} color={theme.colors.primary} />
  </View>

  <View style={styles.exploreBody}>
    <Text style={styles.exploreTitle}>Explore public groups</Text>
    <Text style={styles.exploreText}>
  Discover public accountability communities, review group details, and request access safely.
</Text>
  </View>

  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
</Pressable>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="people-outline" size={22} color={theme.colors.primary} />
          <Text style={styles.cardTitle}>Group system foundation</Text>
        </View>

        <Text style={styles.helperText}>
  Create private invite-only groups, request-based communities, or public open groups.
  Public groups can appear in Explore and should use clear summaries, categories, and moderation.
</Text>

       <Pressable
  style={styles.button}
  onPress={() => setShowCreateForm((current) => !current)}
>
  <Text style={styles.buttonText}>
    {showCreateForm ? "Cancel" : "Create group"}
  </Text>
</Pressable>

{showCreateForm ? (
  <View style={styles.createForm}>
    <Text style={styles.inputLabel}>Group name</Text>

    <TextInput
      value={groupName}
      onChangeText={setGroupName}
      placeholder="Family planning, Study group, Team Alpha..."
      placeholderTextColor={theme.colors.textMuted}
      style={styles.input}
    />

    <Text style={styles.inputLabel}>Description</Text>

    <TextInput
      value={groupDescription}
      onChangeText={setGroupDescription}
      placeholder="What is this group for?"
      placeholderTextColor={theme.colors.textMuted}
      style={[styles.input, styles.textArea]}
      multiline
    />
    <Text style={styles.inputLabel}>Group access</Text>

    <Text style={styles.publicSafetyText}>
  Choose how people can join. You can change discovery settings later.
</Text>

<View style={styles.visibilityOptionList}>
  {[
    {
      key: "invite_only",
      title: "Invite only",
      body: "Only people you invite can join.",
    },
    {
      key: "request",
      title: "Request to join",
       body: "People can find the group, but admins or moderators must approve access.",
    },
    {
  key: "open",
  title: "Public open join",
  body: "People can find and join instantly. Use this only for groups meant to be broadly accessible.",
},
  ].map((option) => {
    const selected = newGroupJoinMode === option.key;

    return (
      <Pressable
        key={option.key}
        style={[
          styles.visibilityOption,
          selected && styles.visibilityOptionSelected,
        ]}
        onPress={() => setNewGroupJoinMode(option.key as NewGroupJoinMode)}
      >
        <Text
          style={[
            styles.visibilityOptionTitle,
            selected && styles.visibilityOptionTitleSelected,
          ]}
        >
          {option.title}
        </Text>

        <Text style={styles.visibilityOptionBody}>
          {option.body}
        </Text>
      </Pressable>
    );
  })}
</View>
<Text style={styles.publicSafetyText}>
  Invite-only groups stay out of public discovery. Request and open groups may appear in Explore, and admins can remove or block unsafe members later.
</Text>
<Text style={styles.inputLabel}>Discovery category</Text>

<Text style={styles.publicSafetyText}>
  Pick the closest category so people can find the group in Explore.
</Text>

<View style={styles.categoryOptionRow}>
  {GROUP_CATEGORY_OPTIONS.map((option) => {
    const selected = newGroupCategory === option.key;

    return (
      <Pressable
        key={option.key}
        style={[
          styles.categoryOptionChip,
          selected && styles.categoryOptionChipSelected,
        ]}
        onPress={() => setNewGroupCategory(option.key)}
      >
        <Text
          style={[
            styles.categoryOptionChipText,
            selected && styles.categoryOptionChipTextSelected,
          ]}
        >
          {option.label}
        </Text>
      </Pressable>
    );
  })}
</View>

<Text style={styles.inputLabel}>Discovery tags</Text>

<TextInput
  value={newGroupTagsText}
  onChangeText={setNewGroupTagsText}
  placeholder="fitness, morning routine, study"
  placeholderTextColor={theme.colors.textMuted}
  style={styles.input}
/>

<Text style={styles.publicSafetyText}>
  Add up to 8 comma-separated tags. Tags help people understand what the group is for before joining.
</Text>

<Text style={styles.inputLabel}>Public summary</Text>

<Text style={styles.publicSafetyText}>
  Write a short, welcoming preview for people deciding whether to join.
</Text>

<TextInput
  value={newGroupSummary}
  onChangeText={setNewGroupSummary}
  placeholder="Short preview shown in Explore"
  placeholderTextColor={theme.colors.textMuted}
  style={[styles.input, styles.textArea]}
  multiline
/>
<Text style={styles.publicSafetyText}>
  This summary is visible before someone joins. Avoid private details, invite codes, or sensitive personal information.
</Text>

    <Pressable
      style={[
        styles.button,
        styles.createSubmitButton,
        creating && styles.buttonDisabled,
      ]}
      onPress={handleCreateGroup}
      disabled={creating}
    >
      <Text style={styles.buttonText}>
        {creating ? "Creating..." : "Save group"}
      </Text>
    </Pressable>
  </View>
) : null}
      </View>

<Pressable
  style={styles.collapsibleSectionHeader}
  onPress={() => setShowInvites((prev) => !prev)}
>
  <View>
    <Text style={styles.sectionTitle}>Invites</Text>
    <Text style={styles.sectionSubtitle}>
      {pendingInvites.length === 0
        ? "No pending invites"
        : `${pendingInvites.length} pending invite${pendingInvites.length === 1 ? "" : "s"}`}
    </Text>
  </View>

  <Text style={styles.collapsibleSectionToggle}>
    {showInvites ? "Hide" : "Show"}
  </Text>
</Pressable>

{showInvites ? (
<>
{loadingInvites ? (
  <View style={styles.loadingCard}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading invites...</Text>
  </View>
) : pendingInvites.length === 0 ? (
  <View style={styles.emptyInviteCard}>
    <Text style={styles.emptyInviteTitle}>No pending invites</Text>
    <Text style={styles.emptyInviteText}>
      Group invitations sent to your account email will appear here.
    </Text>
  </View>
) : (
  pendingInvites.map((invite) => (
    <View key={invite.id} style={styles.inviteCard}>
      <Text style={styles.inviteGroupName}>{invite.groupName}</Text>

      <Text style={styles.inviteMeta}>
        Invited by {invite.invitedByName ?? "Someone"}
      </Text>

      <Text style={styles.inviteMeta}>
        Sent{" "}
        {invite.createdAtMs
          ? new Date(invite.createdAtMs).toLocaleString()
          : "recently"}
      </Text>

     <View style={styles.inviteActions}>
  <Text style={styles.inviteStatus}>Pending</Text>

  <View style={styles.inviteButtonRow}>
    <Pressable
      style={[
        styles.declineInviteButton,
        decliningInviteIds.has(invite.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleDeclineInvite(invite)}
      disabled={
        acceptingInviteIds.has(invite.id) ||
        decliningInviteIds.has(invite.id)
      }
    >
      <Text style={styles.declineInviteButtonText}>
        {decliningInviteIds.has(invite.id) ? "Declining..." : "Decline"}
      </Text>
    </Pressable>

    <Pressable
      style={[
        styles.acceptInviteButton,
        acceptingInviteIds.has(invite.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleAcceptInvite(invite)}
      disabled={
        acceptingInviteIds.has(invite.id) ||
        decliningInviteIds.has(invite.id)
      }
    >
      <Text style={styles.acceptInviteButtonText}>
        {acceptingInviteIds.has(invite.id) ? "Accepting..." : "Accept"}
      </Text>
    </Pressable>
  </View>
</View>
    </View>
  ))
)}
</>
) : null}
<Pressable
  style={styles.collapsibleSectionHeader}
  onPress={() => setShowJoinRequests((prev) => !prev)}
>
  <View>
    <Text style={styles.sectionTitle}>My join requests</Text>
    <Text style={styles.sectionSubtitle}>
      {pendingJoinRequests.length === 0
        ? "No pending requests"
        : `${pendingJoinRequests.length} pending request${pendingJoinRequests.length === 1 ? "" : "s"}`}
    </Text>
  </View>

  <Text style={styles.collapsibleSectionToggle}>
    {showJoinRequests ? "Hide" : "Show"}
  </Text>
</Pressable>

{showJoinRequests ? (
<>
{loadingJoinRequests ? (
  <View style={styles.loadingCard}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading join requests...</Text>
  </View>
) : pendingJoinRequests.length === 0 ? (
  <View style={styles.emptyInviteCard}>
    <Text style={styles.emptyInviteTitle}>No pending join requests</Text>
    <Text style={styles.emptyInviteText}>
  Groups you request to join will appear here until an admin or moderator reviews them.
</Text>
  </View>
) : (
  pendingJoinRequests.map((request) => {
    const busy = cancellingJoinRequestIds.has(request.id);

    return (
      <View
  key={`${request.groupId}_${request.id}`}
  style={styles.joinRequestCard}
>
        <Text style={styles.inviteGroupName}>
  {request.groupName ?? request.groupId}
</Text>

        <Text style={styles.inviteMeta}>
          Requested {formatJoinRequestTime(request.createdAtMs)}
        </Text>

        {!!request.message ? (
          <Text style={styles.joinRequestMessage}>
            “{request.message}”
          </Text>
        ) : null}

        <View style={styles.inviteActions}>
          <Text style={styles.inviteStatus}>Pending review</Text>

          <View style={styles.inviteButtonRow}>
            <Pressable
  style={styles.declineInviteButton}
  onPress={() => handleOpenJoinRequestGroup(request)}
>
  <Text style={styles.declineInviteButtonText}>
    View
  </Text>
</Pressable>

            <Pressable
              style={[
                styles.cancelJoinRequestButton,
                busy && styles.buttonDisabled,
              ]}
              onPress={() => handleCancelJoinRequest(request)}
              disabled={busy}
            >
              <Text style={styles.cancelJoinRequestButtonText}>
                {busy ? "Cancelling..." : "Cancel request"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  })
)}
</>
) : null}
      <Pressable
  style={styles.collapsibleSectionHeader}
  onPress={() => setShowMyGroups((prev) => !prev)}
>
  <View>
    <Text style={styles.sectionTitle}>My groups</Text>
    <Text style={styles.sectionSubtitle}>
      {memberships.length === 0
        ? "No groups yet"
        : `${memberships.length} group${memberships.length === 1 ? "" : "s"}`}
    </Text>
  </View>

  <Text style={styles.collapsibleSectionToggle}>
    {showMyGroups ? "Hide" : "Show"}
  </Text>
</Pressable>

{showMyGroups ? (
<>
{loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading groups...</Text>
        </View>
      ) : memberships.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="people-circle-outline" size={28} color={theme.colors.primary} />
          </View>

          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptyText}>
  Create a private group for people you know, or explore public groups to find an accountability community.
</Text>
        </View>
      ) : (
        memberships.map((membership) => (
          <Pressable
  key={membership.groupId}
  style={styles.groupCard}
  onPress={() =>
    router.push({
      pathname: "/group/[id]",
      params: { id: membership.groupId },
    })
  }
>
           <Text style={styles.groupTitle}>
  {membership.groupName ?? membership.groupId}
</Text>

            <Text style={styles.groupMeta}>
              Role: {membership.role} · Status: {membership.status}
            </Text>

            <Text style={styles.groupMeta}>
              Joined:{" "}
              {membership.joinedAtMs
                ? new Date(membership.joinedAtMs).toLocaleString()
                : "Unknown"}
            </Text>
            <Text style={styles.groupOpenHint}>Open dashboard →</Text>
          </Pressable>
        ))
      )}
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

    header: {
      marginBottom: 20,
    },

    title: {
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: "800",
    },

    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 6,
      fontSize: 15,
      lineHeight: 21,
    },

    card: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 22,
    },

    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 8,
    },

    cardTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "800",
      flex: 1,
    },

    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
      marginBottom: 14,
    },

    button: {
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },

    buttonDisabled: {
      opacity: 0.5,
    },

    buttonText: {
      color: theme.colors.primaryText,
      fontSize: 15,
      fontWeight: "800",
    },

    sectionTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginBottom: 10,
    },

    loadingCard: {
      padding: 18,
      borderRadius: 16,
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },

    loadingText: {
      color: theme.colors.textMuted,
      marginTop: 10,
    },

    emptyCard: {
      padding: 20,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },

    emptyIconWrap: {
      width: 50,
      height: 50,
      borderRadius: 25,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
      marginBottom: 14,
    },

    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "800",
    },

    emptyText: {
      color: theme.colors.textMuted,
      marginTop: 8,
      lineHeight: 20,
    },

    groupCard: {
      padding: 16,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 12,
    },

    groupTitle: {
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "800",
    },

    groupMeta: {
      color: theme.colors.textMuted,
      marginTop: 6,
      fontSize: 13,
    },
    createForm: {
  marginTop: 16,
  paddingTop: 14,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

inputLabel: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "800",
  marginBottom: 6,
  marginTop: 10,
},

input: {
  width: "100%",
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
  color: theme.colors.text,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 15,
},

textArea: {
  minHeight: 84,
  textAlignVertical: "top",
},

createSubmitButton: {
  marginTop: 14,
},
groupOpenHint: {
  color: theme.colors.primary,
  marginTop: 10,
  fontSize: 13,
  fontWeight: "800",
},
emptyInviteCard: {
  padding: 16,
  borderRadius: 16,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 18,
},

emptyInviteTitle: {
  color: theme.colors.text,
  fontSize: 16,
  fontWeight: "800",
},

emptyInviteText: {
  color: theme.colors.textMuted,
  marginTop: 6,
  lineHeight: 20,
},

inviteCard: {
  padding: 16,
  borderRadius: 16,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 12,
},

inviteGroupName: {
  color: theme.colors.text,
  fontSize: 16,
  fontWeight: "900",
},

inviteMeta: {
  color: theme.colors.textMuted,
  marginTop: 6,
  fontSize: 13,
},

inviteStatus: {
  alignSelf: "flex-start",
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  borderRadius: 999,
  overflow: "hidden",
  paddingHorizontal: 8,
  paddingVertical: 4,
  marginTop: 10,
  fontSize: 12,
  fontWeight: "900",
},
inviteActions: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 10,
},

acceptInviteButton: {
  backgroundColor: theme.colors.primary,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

acceptInviteButtonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 12,
},
inviteButtonRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

declineInviteButton: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

declineInviteButtonText: {
  color: theme.colors.text,
  fontWeight: "900",
  fontSize: 12,
},
exploreCard: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  padding: 16,
  borderRadius: 18,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 14,
},

exploreIconWrap: {
  width: 44,
  height: 44,
  borderRadius: 22,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.badge,
},

exploreBody: {
  flex: 1,
  minWidth: 0,
},

exploreTitle: {
  color: theme.colors.text,
  fontSize: 16,
  fontWeight: "900",
},

exploreText: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 13,
  lineHeight: 18,
},
visibilityOptionList: {
  gap: 10,
  marginTop: 4,
},

visibilityOption: {
  padding: 12,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

visibilityOptionSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

visibilityOptionTitle: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

visibilityOptionTitleSelected: {
  color: theme.colors.primary,
},

visibilityOptionBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 4,
},
categoryOptionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 4,
},

categoryOptionChip: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

categoryOptionChipSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

categoryOptionChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},

categoryOptionChipTextSelected: {
  color: theme.colors.primary,
},
joinRequestCard: {
  padding: 16,
  borderRadius: 16,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 12,
},
cancelJoinRequestButton: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.danger,
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

cancelJoinRequestButtonText: {
  color: theme.colors.danger,
  fontWeight: "900",
  fontSize: 12,
},

joinRequestMessage: {
  color: theme.colors.textMuted,
  marginTop: 8,
  fontSize: 13,
  lineHeight: 18,
},
publicSafetyText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 8,
  marginBottom: 6,
},
sectionSubtitle: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 2,
},

collapsibleSectionHeader: {
  marginTop: 6,
  marginBottom: 10,
  padding: 14,
  borderRadius: 18,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
},

collapsibleSectionToggle: {
  minHeight: 34,
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: 18,
  overflow: "hidden",
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
  });