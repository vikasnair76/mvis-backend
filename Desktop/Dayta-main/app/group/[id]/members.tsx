import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
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

import { auth, db } from "../../../services/firebase";
import {
  blockUserFromGroup,
  canChangeGroupMemberRole,
  canManageGroupMembers,
  canRemoveGroupMember,
  createOrOpenGroupDm,
  GROUP_ASSIGNABLE_ROLES,
  removeGroupMember,
  subscribeGroupMembers,
  updateGroupMemberRole,
  type AssignableGroupRole,
  type GroupDoc,
  type GroupMemberDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

export default function GroupMembersScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [removingMemberIds, setRemovingMemberIds] = useState<Set<string>>(
    new Set()
  );
  const [blockingMemberIds, setBlockingMemberIds] = useState<Set<string>>(
    new Set()
  );

  const [openingDmMemberIds, setOpeningDmMemberIds] = useState<Set<string>>(
  new Set()
);


  const [updatingRoleMemberIds, setUpdatingRoleMemberIds] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    if (!groupId) {
      setGroup(null);
      setLoadingGroup(false);
      return;
    }

    setLoadingGroup(true);

    const unsub = onSnapshot(
      doc(db, "groups", groupId),
      (snap) => {
        if (!snap.exists()) {
          setGroup(null);
          setLoadingGroup(false);
          return;
        }

        const data = snap.data();

        setGroup({
          id: snap.id,
          name: data.name ?? "Untitled group",
          description: data.description ?? null,
          ownerUserId: data.ownerUserId,
          visibility: data.visibility ?? "invite_only",
          memberCount: data.memberCount ?? 0,
          createdAtMs: data.createdAtMs ?? 0,
          updatedAtMs: data.updatedAtMs ?? 0,
        });

        setLoadingGroup(false);
      },
      (err) => {
        console.log("[GroupMembers] failed loading group", err);
        setLoadingGroup(false);
      }
    );

    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      setLoadingMembers(false);
      return;
    }

    setLoadingMembers(true);

    const unsub = subscribeGroupMembers(
      groupId,
      (next) => {
        setMembers(next);
        setLoadingMembers(false);
      },
      (err) => {
        console.log("[GroupMembers] failed loading members", err);
        setLoadingMembers(false);
      }
    );

    return unsub;
  }, [groupId]);

  const currentUserMember = useMemo(() => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return null;

    return members.find((member) => member.uid === currentUid) ?? null;
  }, [members]);

  const currentUserRole = currentUserMember?.role ?? null;
  const canManageGroup = canManageGroupMembers(currentUserRole);
  const loading = loadingGroup || loadingMembers;

  const handleOpenDmWithMember = async (member: GroupMemberDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || openingDmMemberIds.has(member.uid)) {
    return;
  }

  if (member.uid === currentUser.uid) {
    Alert.alert("Not available", "You cannot message yourself.");
    return;
  }

  try {
    setOpeningDmMemberIds((current) => new Set(current).add(member.uid));

    const dmId = await createOrOpenGroupDm({
      groupId,
      actorUid: currentUser.uid,
      actorName: currentUser.displayName ?? currentUser.email ?? null,
      actorEmail: currentUser.email ?? null,
      targetUid: member.uid,
      targetName: member.displayName ?? member.email ?? null,
      targetEmail: member.email ?? null,
      groupName: group?.name ?? null,
subject: `DM with ${member.displayName ?? member.email ?? "group member"}`,
    });

    router.push(`/group/${groupId}/dm/${dmId}` as any);
  } catch (err: any) {
    console.log("[GroupMembers] open DM failed", err);
    Alert.alert("Message failed", err?.message ?? "Please try again.");
  } finally {
    setOpeningDmMemberIds((current) => {
      const next = new Set(current);
      next.delete(member.uid);
      return next;
    });
  }
};

  const handleRemoveMember = async (member: GroupMemberDoc) => {
    const memberLabel = member.displayName ?? member.email ?? "this member";

    if (
      !canRemoveGroupMember({
        actorRole: currentUserRole,
        targetRole: member.role,
      })
    ) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to remove this member."
      );
      return;
    }

    Alert.alert(
      "Remove member?",
      `${memberLabel} will lose access to this group.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              setRemovingMemberIds((current) =>
                new Set(current).add(member.uid)
              );

              await removeGroupMember({
                groupId,
                memberUid: member.uid,
              });
            } catch (err: any) {
              console.log("[GroupMembers] remove member failed", err);
              Alert.alert("Remove failed", err?.message ?? "Please try again.");
            } finally {
              setRemovingMemberIds((current) => {
                const next = new Set(current);
                next.delete(member.uid);
                return next;
              });
            }
          },
        },
      ]
    );
  };

  const handleBlockMember = async (member: GroupMemberDoc) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid) {
      Alert.alert("Sign in required", "Please sign in first.");
      return;
    }

    if (!groupId || !member.uid) return;

    Alert.alert(
      "Block member?",
      `${
        member.displayName ?? member.email ?? "This member"
      } will be removed and prevented from rejoining this group.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              setBlockingMemberIds((current) =>
                new Set(current).add(member.uid)
              );

              await blockUserFromGroup({
                groupId,
                uid: member.uid,
                blockedByUid: currentUser.uid,
                blockedByEmail: currentUser.email ?? null,
                blockedByDisplayName:
                  currentUser.displayName ?? currentUser.email ?? null,
                blockedUserEmail: member.email ?? null,
                blockedUserDisplayName:
                  member.displayName ?? member.email ?? null,
                reason: "Blocked by group admin",
              });

              await removeGroupMember({
                groupId,
                memberUid: member.uid,
              });
            } catch (err: any) {
              console.log("[GroupMembers] block member failed", err);
              Alert.alert("Block failed", err?.message ?? "Please try again.");
            } finally {
              setBlockingMemberIds((current) => {
                const next = new Set(current);
                next.delete(member.uid);
                return next;
              });
            }
          },
        },
      ]
    );
  };

  const handleChangeMemberRole = async (
    member: GroupMemberDoc,
    role: AssignableGroupRole
  ) => {
    const memberLabel = member.displayName ?? member.email ?? "this member";

    if (
      !canChangeGroupMemberRole({
        actorRole: currentUserRole,
        targetRole: member.role,
        nextRole: role,
      })
    ) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to make this role change."
      );
      return;
    }

    Alert.alert(
      "Change member role?",
      `Change ${memberLabel} from ${member.role} to ${role}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Change to ${role}`,
          style: role === "admin" ? "destructive" : "default",
          onPress: async () => {
            try {
              setUpdatingRoleMemberIds((current) =>
                new Set(current).add(member.uid)
              );

              await updateGroupMemberRole({
                groupId,
                memberUid: member.uid,
                role,
              });
            } catch (err: any) {
              console.log("[GroupMembers] update role failed", err);
              Alert.alert(
                "Role update failed",
                err?.message ?? "Please try again."
              );
            } finally {
              setUpdatingRoleMemberIds((current) => {
                const next = new Set(current);
                next.delete(member.uid);
                return next;
              });
            }
          },
        },
      ]
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

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading members...</Text>
        </View>
      ) : !group ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Group not found</Text>
          <Text style={styles.helperText}>
            This group may have been deleted or you may not have access.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>Members</Text>
            <Text style={styles.subtitle}>
              Manage roles, removals, and blocked access for {group.name}.
            </Text>

            <Text style={styles.meta}>
              {members.length} {members.length === 1 ? "member" : "members"}
              {currentUserRole ? ` · Your role: ${currentUserRole}` : ""}
            </Text>
          </View>

          <View style={styles.card}>
            {members.length === 0 ? (
              <Text style={styles.helperText}>No active members yet.</Text>
            ) : (
              members.map((member) => {
                const canActOnMember =
                  canManageGroup &&
                  member.uid !== auth.currentUser?.uid &&
                  member.role !== "owner";

                return (
                  <View key={member.uid} style={styles.memberRow}>
                    <View style={styles.memberTopRow}>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {(member.displayName ?? member.email ?? "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.memberInfo}>
                        <Text style={styles.memberName}>
                          {member.displayName ?? member.email ?? member.uid}
                        </Text>

                        {!!member.email ? (
                          <Text style={styles.memberEmail}>{member.email}</Text>
                        ) : null}

                        <Text style={styles.memberEmail}>
                          Joined{" "}
                          {member.joinedAtMs
                            ? new Date(member.joinedAtMs).toLocaleDateString()
                            : "recently"}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.roleBadge,
                          member.role === "owner" && styles.roleBadgeOwner,
                          member.role === "admin" && styles.roleBadgeAdmin,
                          member.role === "moderator" &&
                            styles.roleBadgeModerator,
                          member.role === "viewer" && styles.roleBadgeViewer,
                        ]}
                      >
                        <Text style={styles.roleBadgeText}>{member.role}</Text>
                      </View>
                    </View>

                                        {member.uid !== auth.currentUser?.uid ? (
                      <Pressable
                        style={[
                          styles.memberMessageButton,
                          openingDmMemberIds.has(member.uid) &&
                            styles.buttonDisabled,
                        ]}
                        onPress={() => handleOpenDmWithMember(member)}
                        disabled={openingDmMemberIds.has(member.uid)}
                      >
                        <Text style={styles.memberMessageButtonText}>
                          {openingDmMemberIds.has(member.uid)
                            ? "Opening..."
                            : "Message"}
                        </Text>
                      </Pressable>
                    ) : null}

                    {canActOnMember ? (
                      <View style={styles.memberAdminActions}>
                        <View style={styles.roleActionRow}>
                          {GROUP_ASSIGNABLE_ROLES.filter((roleOption) =>
                            canChangeGroupMemberRole({
                              actorRole: currentUserRole,
                              targetRole: member.role,
                              nextRole: roleOption,
                            })
                          ).map((roleOption) => {
                            const active = member.role === roleOption;
                            const busy = updatingRoleMemberIds.has(member.uid);

                            return (
                              <Pressable
                                key={roleOption}
                                style={[
                                  styles.roleActionChip,
                                  active && styles.roleActionChipActive,
                                  busy && styles.buttonDisabled,
                                ]}
                                onPress={() =>
                                  handleChangeMemberRole(member, roleOption)
                                }
                                disabled={active || busy}
                              >
                                <Text
                                  style={[
                                    styles.roleActionChipText,
                                    active && styles.roleActionChipTextActive,
                                  ]}
                                >
                                  {roleOption}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <View style={styles.memberDangerActionRow}>
                          <Pressable
                            style={[
                              styles.removeMemberButton,
                              removingMemberIds.has(member.uid) &&
                                styles.buttonDisabled,
                            ]}
                            onPress={() => handleRemoveMember(member)}
                            disabled={removingMemberIds.has(member.uid)}
                          >
                            <Text style={styles.removeMemberButtonText}>
                              {removingMemberIds.has(member.uid)
                                ? "Removing..."
                                : "Remove"}
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.blockMemberButton,
                              blockingMemberIds.has(member.uid) &&
                                styles.buttonDisabled,
                            ]}
                            onPress={() => handleBlockMember(member)}
                            disabled={
                              blockingMemberIds.has(member.uid) ||
                              removingMemberIds.has(member.uid)
                            }
                          >
                            <Text style={styles.blockMemberButtonText}>
                              {blockingMemberIds.has(member.uid)
                                ? "Blocking..."
                                : "Block"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </>
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
    meta: {
      color: theme.colors.textMuted,
      marginTop: 10,
      fontSize: 13,
      fontWeight: "700",
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    memberRow: {
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      gap: 12,
    },
    memberTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    memberAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted,
    },
    memberAvatarText: {
      color: theme.colors.text,
      fontWeight: "900",
    },
    memberInfo: {
      flex: 1,
      minWidth: 0,
    },
    memberName: {
      color: theme.colors.text,
      fontWeight: "900",
    },
    memberEmail: {
      color: theme.colors.textMuted,
      marginTop: 3,
      fontSize: 12,
    },
    roleBadge: {
      borderColor: theme.colors.primary,
      borderWidth: 1,
      backgroundColor: theme.colors.badge,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    roleBadgeOwner: {
      borderColor: theme.colors.warning,
    },
    roleBadgeAdmin: {
      borderColor: theme.colors.primary,
    },
    roleBadgeModerator: {
      borderColor: theme.colors.success,
    },
    roleBadgeViewer: {
      borderColor: theme.colors.border,
    },
    roleBadgeText: {
      color: theme.colors.text,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "capitalize",
    },
    memberAdminActions: {
      gap: 10,
      paddingTop: 4,
    },
    roleActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    roleActionChip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    roleActionChipActive: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    roleActionChipText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
      textTransform: "capitalize",
    },
    roleActionChipTextActive: {
      color: theme.colors.primary,
    },
    memberDangerActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    removeMemberButton: {
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.danger,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    removeMemberButtonText: {
      color: theme.colors.danger,
      fontWeight: "900",
      fontSize: 12,
    },
    blockMemberButton: {
      backgroundColor: theme.colors.danger,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    blockMemberButtonText: {
      color: theme.colors.primaryText,
      fontWeight: "900",
      fontSize: 12,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    memberMessageButton: {
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

memberMessageButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
  });