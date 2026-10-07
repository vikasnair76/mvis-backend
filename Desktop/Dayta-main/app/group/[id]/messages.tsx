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

import { auth } from "../../../services/firebase";
import {
  getGroupThreadUnreadState,
  subscribeGroupMembers,
  subscribeMyArchivedGroupConversations,
  subscribeMyGroupConversations,
  subscribeMyGroupDms,
  type GroupConversationDoc,
  type GroupDmDoc,
  type GroupMemberDoc
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

function getThreadSortMs(thread: {
  lastMessageAtMs?: number | null;
  updatedAtMs?: number | null;
  createdAtMs?: number | null;
}): number {
  return (
    thread.lastMessageAtMs ??
    thread.updatedAtMs ??
    thread.createdAtMs ??
    0
  );
}

type MessageHubFilter = "all" | "unread" | "group" | "dms";

function getMessageHubFilterLabel(filter: MessageHubFilter): string {
  switch (filter) {
    case "unread":
      return "Unread";
    case "group":
      return "Group";
    case "dms":
      return "DMs";
    default:
      return "All";
  }
}

function normalizeThreadSearchText(value?: string | null): string {
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

export default function GroupMessagesScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

const [dms, setDms] = useState<GroupDmDoc[]>([]);
const [membershipLoaded, setMembershipLoaded] = useState(false);
const [currentMember, setCurrentMember] = useState<GroupMemberDoc | null>(null);

const [conversations, setConversations] = useState<GroupConversationDoc[]>([]);
const [archivedConversations, setArchivedConversations] = useState<
  GroupConversationDoc[]
>([]);

const [searchText, setSearchText] = useState("");

const [activeFilter, setActiveFilter] = useState<MessageHubFilter>("all");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const currentUid = auth.currentUser?.uid ?? "";
  const hasActiveMembership = currentMember?.status === "active";

 const groupDms = useMemo(
  () =>
    dms
      .filter((dm) => dm.groupId === groupId)
      .sort((a, b) => getThreadSortMs(b) - getThreadSortMs(a)),
  [dms, groupId]
);

const groupConversations = useMemo(
  () =>
    conversations
      .filter((conversation) => conversation.groupId === groupId)
      .sort((a, b) => getThreadSortMs(b) - getThreadSortMs(a)),
  [conversations, groupId]
);

const groupArchivedConversations = useMemo(
  () =>
    archivedConversations
      .filter((conversation) => conversation.groupId === groupId)
      .sort((a, b) => getThreadSortMs(b) - getThreadSortMs(a)),
  [archivedConversations, groupId]
);

const getConversationParticipantLabel = (conversation: GroupConversationDoc) => {
  const count = conversation.memberUids.length;

  if (count <= 0) return "No members";
  if (count === 1) return "1 member";

  return `${count} members`;
};



const getConversationPreview = (conversation: GroupConversationDoc) => {
  return (
    conversation.lastMessagePreview ??
    conversation.subject ??
    "No messages yet — start the conversation."
  );
};



const getDmPreview = (dm: GroupDmDoc) => {
  return dm.lastMessagePreview ?? dm.subject ?? "No messages yet — start the conversation.";
};

const getDmMetaLabel = (dm: GroupDmDoc) => {
  return dm.subject?.trim() || "Private conversation";
};


  const getOtherParticipantLabel = (dm: GroupDmDoc) => {

    const otherUid =

      dm.participantUids.find((uid) => uid !== currentUid) ?? "";



    return (

      dm.participantNames?.[otherUid] ??

      dm.participantEmails?.[otherUid] ??

      "Group member"

    );

  };

const totalActiveThreads =
  groupConversations.length + groupDms.length;

  

const hasArchivedThreads = groupArchivedConversations.length > 0;

const normalizedSearchText = normalizeThreadSearchText(searchText);

const searchedGroupConversations = useMemo(() => {
  if (!normalizedSearchText) return groupConversations;

  return groupConversations.filter((conversation) => {
    const searchable = normalizeThreadSearchText(
      [
        conversation.title,
        conversation.subject,
        conversation.lastMessagePreview,
        getConversationParticipantLabel(conversation),
      ]
        .filter(Boolean)
        .join(" ")
    );

    return searchable.includes(normalizedSearchText);
  });
}, [groupConversations, normalizedSearchText]);

const searchedGroupDms = useMemo(() => {
  if (!normalizedSearchText) return groupDms;

  return groupDms.filter((dm) => {
    const otherLabel = getOtherParticipantLabel(dm);

    const searchable = normalizeThreadSearchText(
      [
        otherLabel,
        dm.subject,
        dm.lastMessagePreview,
        dm.groupName,
      ]
        .filter(Boolean)
        .join(" ")
    );

    return searchable.includes(normalizedSearchText);
  });
}, [groupDms, normalizedSearchText, currentUid]);

const filteredGroupConversations = useMemo(() => {
  if (activeFilter === "dms") return [];

  if (activeFilter === "unread") {
    return searchedGroupConversations.filter(
      (conversation) => getConversationUnreadState(conversation).isUnread
    );
  }

  return searchedGroupConversations;
}, [activeFilter, searchedGroupConversations, currentUid]);

const filteredGroupDms = useMemo(() => {
  if (activeFilter === "group") return [];

  if (activeFilter === "unread") {
    return searchedGroupDms.filter((dm) => getDmUnreadState(dm).isUnread);
  }

  return searchedGroupDms;
}, [activeFilter, searchedGroupDms, currentUid]);

const totalFilteredThreads =
  filteredGroupConversations.length + filteredGroupDms.length;

  const getEmptyStateCopy = () => {
  if (normalizedSearchText) {
    return {
      title: "No matching threads",
      body: "Try a different search or switch filters.",
    };
  }

  if (activeFilter === "unread") {
    return {
      title: "No unread messages",
      body: "You’re all caught up for this group.",
    };
  }

  if (activeFilter === "group") {
    return {
      title: "No group conversations",
      body: "Create a shared conversation from the group dashboard.",
    };
  }

  if (activeFilter === "dms") {
    return {
      title: "No direct messages",
      body: "Start a private message from a group member card.",
    };
  }

  return {
    title: "No active messages yet",
    body: "Start a direct message from a member card, or create a group conversation from the group dashboard.",
  };
};

const emptyStateCopy = getEmptyStateCopy();

const totalSearchedThreads =
  searchedGroupConversations.length + searchedGroupDms.length;

const getConversationUnreadState = (conversation: GroupConversationDoc) =>
  getGroupThreadUnreadState(conversation, currentUid);

const getDmUnreadState = (dm: GroupDmDoc) =>
  getGroupThreadUnreadState(dm, currentUid);

const unreadGroupConversationCount = groupConversations.filter(
  (conversation) => getConversationUnreadState(conversation).isUnread
).length;

const unreadDmCount = groupDms.filter(
  (dm) => getDmUnreadState(dm).isUnread
).length;

const unreadTotalCount = unreadGroupConversationCount + unreadDmCount;

const groupConversationSectionLabel =
  searchedGroupConversations.length === 1
    ? `1 active group thread · ${unreadGroupConversationCount} unread`
    : `${searchedGroupConversations.length} active group threads · ${unreadGroupConversationCount} unread`;

const directMessageSectionLabel =
  searchedGroupDms.length === 1
    ? `1 direct thread · ${unreadDmCount} unread`
    : `${searchedGroupDms.length} direct threads · ${unreadDmCount} unread`;

useEffect(() => {
  if (!groupId || !currentUid) {
    setCurrentMember(null);
    setMembershipLoaded(true);
    return;
  }

  setMembershipLoaded(false);

  const unsub = subscribeGroupMembers(
    groupId,
    (members) => {
      setCurrentMember(
        members.find((member) => member.uid === currentUid) ?? null
      );
      setMembershipLoaded(true);
    },
    (err) => {
      console.log("[GroupMessages] membership subscription failed", err);
      setCurrentMember(null);
      setMembershipLoaded(true);
    }
  );

  return unsub;
}, [groupId, currentUid]);

useEffect(() => {
  if (!currentUid || !membershipLoaded || !hasActiveMembership) {
    setDms([]);
    setLoading(false);
    return;
  }

  setLoading(true);
    setErrorText(null);

    const unsub = subscribeMyGroupDms(
      currentUid,
      (items) => {
        setDms(items);
        setLoading(false);
      },
      (err) => {
        console.log("[GroupMessages] DM subscription failed", err);
        setErrorText("Could not load messages.");
        setLoading(false);
      }
    );

    return unsub;
}, [currentUid, membershipLoaded, hasActiveMembership]);

useEffect(() => {
  if (!currentUid || !membershipLoaded || !hasActiveMembership) {
    setConversations([]);
    return;
  }

  const unsub = subscribeMyGroupConversations(
    currentUid,
    setConversations,
    (err) => {
      console.log("[GroupMessages] conversations subscription failed", err);
    }
  );

  return unsub;
}, [currentUid, membershipLoaded, hasActiveMembership]);

useEffect(() => {
  if (!currentUid || !membershipLoaded || !hasActiveMembership) {
    setArchivedConversations([]);
    return;
  }

  const unsub = subscribeMyArchivedGroupConversations(
    currentUid,
    setArchivedConversations,
    (err) => {
      console.log("[GroupMessages] archived conversations subscription failed", err);
    }
  );

  return unsub;
}, [currentUid, membershipLoaded, hasActiveMembership]);



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
        <Text style={styles.title}>Messages</Text>
<Text style={styles.subtitle}>
  {totalActiveThreads === 0
    ? "No active message threads yet."
: `${totalActiveThreads} active thread${
    totalActiveThreads === 1 ? "" : "s"
  } · ${unreadTotalCount} unread`}
</Text>
      </View>
      {hasActiveMembership ? (
  <View style={styles.searchCard}>
    <Ionicons
      name="search-outline"
      size={17}
      color={theme.colors.textMuted}
    />

    <TextInput
      value={searchText}
      onChangeText={setSearchText}
      placeholder="Search conversations or DMs..."
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
{hasActiveMembership ? (
  <View style={styles.filterRow}>
    {(["all", "unread", "group", "dms"] as MessageHubFilter[]).map(
      (filter) => {
        const active = activeFilter === filter;

        return (
          <Pressable
            key={filter}
            style={[styles.filterChip, active && styles.filterChipActive]}
            onPress={() => setActiveFilter(filter)}
          >
            <Text
              style={[
                styles.filterChipText,
                active && styles.filterChipTextActive,
              ]}
            >
              {getMessageHubFilterLabel(filter)}
            </Text>
          </Pressable>
        );
      }
    )}
  </View>
) : null}

{!membershipLoaded ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Checking group access...</Text>
  </View>
) : !hasActiveMembership ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>Messages unavailable</Text>
    <Text style={styles.helperText}>
      You no longer have access to this group’s messages.
    </Text>
  </View>
) : loading ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading messages...</Text>
  </View>
) : errorText ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
) : totalFilteredThreads === 0 && totalActiveThreads > 0 ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>{emptyStateCopy.title}</Text>
    <Text style={styles.helperText}>{emptyStateCopy.body}</Text>
  </View>
) : totalActiveThreads === 0 ? (
  <>
    <View style={styles.card}>
<Text style={styles.emptyTitle}>{emptyStateCopy.title}</Text>
<Text style={styles.helperText}>{emptyStateCopy.body}</Text>
    </View>

    {hasArchivedThreads ? (
      <Pressable
        style={styles.archivedCard}
        onPress={() =>
          router.push(`/group/${groupId}/messages/archived` as any)
        }
      >
        <View>
          <Text style={styles.archivedTitle}>Archived conversations</Text>
          <Text style={styles.archivedText}>
            {groupArchivedConversations.length} archived thread
            {groupArchivedConversations.length === 1 ? "" : "s"}
          </Text>
        </View>

        <Text style={styles.archivedAction}>View →</Text>
      </Pressable>
    ) : null}
  </>
) : (
  <>
<View style={styles.sectionHeaderRow}>
  <View>
    <Text style={styles.sectionTitle}>Group conversations</Text>
    <Text style={styles.sectionSubtitle}>
      {groupConversationSectionLabel}
    </Text>
  </View>

  {hasArchivedThreads ? (
        <Pressable
          onPress={() =>
            router.push(`/group/${groupId}/messages/archived` as any)
          }
        >
<Text style={styles.sectionAction}>
  Archived · {groupArchivedConversations.length}
</Text>
        </Pressable>
      ) : null}
    </View>

    {filteredGroupConversations.length === 0 ? (
      <View style={styles.card}>
<Text style={styles.emptyTitle}>
  {normalizedSearchText ? "No matching group conversations" : "No group conversations yet"}
</Text>
<Text style={styles.helperText}>
  {normalizedSearchText
    ? "Try another title, subject, participant count, or message preview."
    : "Create a shared conversation from the group dashboard."}
</Text>
      </View>
    ) : (
      <View style={styles.dmList}>
        {filteredGroupConversations.map((conversation) => (
 <Pressable
  key={conversation.id}
  style={[
    styles.dmRow,
    getConversationUnreadState(conversation).isUnread && styles.dmRowUnread,
  ]}
            onPress={() =>
              router.push(
                `/group/${groupId}/conversation/${conversation.id}` as any
              )
            }
          >
            {getConversationUnreadState(conversation).isUnread ? (
  <View style={styles.unreadAccent} />
) : null}
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>🗣️</Text>
            </View>

            <View style={styles.dmBody}>
              <Text style={styles.dmTitle} numberOfLines={1}>
                {conversation.title}
              </Text>

<Text
  style={[
    styles.dmPreview,
    !conversation.lastMessagePreview && styles.dmPreviewEmpty,
  ]}
  numberOfLines={2}
>
  {getConversationPreview(conversation)}
</Text>

<Text style={styles.threadMeta} numberOfLines={1}>
  {getConversationParticipantLabel(conversation)}
</Text>
            </View>

<View style={styles.threadRightMeta}>
  {getConversationUnreadState(conversation).isUnread ? (
    <View style={styles.unreadPill}>
      <Text style={styles.unreadPillText}>● New</Text>
    </View>
  ) : null}

  <Text style={styles.dmTime}>
    {formatRelativeTime(
      conversation.lastMessageAtMs ?? conversation.updatedAtMs
    )}
  </Text>
</View>
          </Pressable>
        ))}
      </View>
    )}

<View style={styles.directSectionHeader}>
  <Text style={styles.sectionTitle}>Direct messages</Text>
  <Text style={styles.sectionSubtitle}>
    {directMessageSectionLabel}
  </Text>
</View>

    {filteredGroupDms.length === 0 ? (
      <View style={styles.card}>
<Text style={styles.emptyTitle}>
  {normalizedSearchText ? "No matching direct messages" : "No direct messages yet"}
</Text>
<Text style={styles.helperText}>
  {normalizedSearchText
    ? "Try another member name, subject, or message preview."
    : "Start a private message from a group member card."}
</Text>
      </View>
    ) : (
      <View style={styles.dmList}>
        {filteredGroupDms.map((dm) => (
          <Pressable
            key={dm.id}
            style={[
  styles.dmRow,
getDmUnreadState(dm).isUnread && styles.dmRowUnread,
]}
            onPress={() =>
              router.push({
                pathname: "/group/[id]/dm/[dmId]",
                params: {
                  id: groupId,
                  dmId: dm.id,
                },
              })
            }
          >
            {getDmUnreadState(dm).isUnread ? (
  <View style={styles.unreadAccent} />
) : null}
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {getOtherParticipantLabel(dm).slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View style={styles.dmBody}>
              <Text style={styles.dmTitle} numberOfLines={1}>
                {getOtherParticipantLabel(dm)}
              </Text>

<Text
  style={[
    styles.dmPreview,
    !dm.lastMessagePreview && styles.dmPreviewEmpty,
  ]}
  numberOfLines={2}
>
  {getDmPreview(dm)}
</Text>

<Text style={styles.threadMeta} numberOfLines={1}>
  {getDmMetaLabel(dm)}
</Text>
            </View>

<View style={styles.threadRightMeta}>
  {getDmUnreadState(dm).isUnread? (
    <View style={styles.unreadPill}>
      <Text style={styles.unreadPillText}>● New</Text>
    </View>
  ) : null}

  <Text style={styles.dmTime}>
    {formatRelativeTime(dm.lastMessageAtMs)}
  </Text>
</View>
          </Pressable>
        ))}
      </View>
    )}
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

    dmList: {
      gap: 10,
    },

dmRow: {
  position: "relative",
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  padding: 14,
  paddingLeft: 16,
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
      color: theme.colors.text,
      fontWeight: "900",
    },

    dmBody: {
      flex: 1,
      minWidth: 0,
    },

    dmTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },

    dmPreview: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 3,
    },

    dmTime: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
    },
    sectionHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
},

sectionTitle: {
  color: theme.colors.text,
  fontSize: 18,
  fontWeight: "900",
},

directSectionHeader: {
  marginTop: 22,
  marginBottom: 10,
},

sectionSubtitle: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 3,
},

sectionAction: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
archivedCard: {
  marginTop: 12,
  padding: 16,
  borderRadius: 18,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
},

archivedTitle: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "900",
},

archivedText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  fontWeight: "700",
  marginTop: 4,
},

archivedAction: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
},
dmRowUnread: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},
threadRightMeta: {
  alignItems: "flex-end",
  gap: 6,
},

unreadPill: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

unreadPillText: {
  color: theme.colors.primaryText,
  fontSize: 10,
  fontWeight: "900",
},
threadMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 4,
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
filterRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 14,
},

filterChip: {
  paddingHorizontal: 11,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

filterChipActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

filterChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

filterChipTextActive: {
  color: theme.colors.primary,
},
dmPreviewEmpty: {
  fontStyle: "italic",
  opacity: 0.85,
},
unreadAccent: {
  position: "absolute",
  left: 0,
  top: 12,
  bottom: 12,
  width: 4,
  borderTopRightRadius: 999,
  borderBottomRightRadius: 999,
  backgroundColor: theme.colors.primary,
},
  });