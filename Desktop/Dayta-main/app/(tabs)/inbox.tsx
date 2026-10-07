import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { auth } from "../../services/firebase";
import {
  fetchMyGroupInboxPage,
  getGroupThreadUnreadState,
  markGroupConversationRead,
  markGroupDmRead,
  markGroupInboxItemRead,
  subscribeMyGroupConversations,
  subscribeMyGroupDms,
  subscribeMyGroupInbox,
  type GroupConversationDoc,
  type GroupDmDoc,
  type GroupInboxItemDoc
} from "../../services/groups";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

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

function getInboxIcon(item: GroupInboxItemDoc) {
  if (item.moderation || item.reportId) return "🛡️";

  if (
    item.title.toLowerCase().includes("bulletin") ||
    item.groupKey?.includes("bulletin")
  ) {
    return "📣";
  }

  switch (item.type) {
    case "assignment":
      return "📌";
    case "comment":
      return "💬";
    case "dm":
      return "💬";
    case "conversation":
      return "🗣️";
    case "planner":
      return "🗓️";
    case "activity":
      return "🔔";
    default:
      return "•";
  }
}

function getInboxTypeLabel(item: GroupInboxItemDoc): string {
  if (item.moderation || item.reportId) return "Moderation";
  if (item.title === "You were mentioned") return "Mention";

  switch (item.type) {
    case "assignment":
      return "Assignment";
    case "comment":
      return "Comment";
    case "dm":
      return "Direct message";
    case "conversation":
      return "Conversation";
    case "planner":
      return "Planner";
    case "activity":
      return "Activity";
    default:
      return "Update";
  }
}

function getInboxThreadLabel(item: GroupInboxItemDoc): string | null {
  if (item.type === "planner") return "Opens Planner";
  if (item.type === "dm") return "Opens direct message";
  if (item.type === "conversation") return "Opens conversation";

  if (item.moderation || item.reportId) return "Opens moderation";

  if (
    item.title.toLowerCase().includes("bulletin") ||
    item.groupKey?.includes("bulletin")
  ) {
    return "Opens bulletin";
  }

  if (item.joinRequest || item.title === "New join request") {
    return "Opens join requests";
  }

  if (item.relatedEntityType === "task") return "Opens task";
  if (item.relatedEntityType === "goal") return "Opens goal";
  if (item.relatedEntityType === "planning_board") return "Opens board";
  if (item.relatedEntityType === "routine_occurrence") return "Opens routine";
  if (item.relatedEntityType === "group") return "Opens group";

  if (item.subtaskId && !item.goalId) return "Opens task";
  if (item.goalId) return "Opens goal";
  if (item.groupId) return "Opens group";

  return null;
}

type InboxFilter =
  | "all"
  | "unread"
  | "mentions"
  | "assignments"
  | "comments"
  | "direct_messages"
  | "conversations"
  | "moderation"
| "bulletins";

function getInboxFilterLabel(filter: InboxFilter): string {
  switch (filter) {
    case "unread":
      return "Unread";
    case "mentions":
      return "Mentions";
    case "assignments":
      return "Assignments";
    case "comments":
      return "Comments";
    case "direct_messages":
      return "Direct messages";
    case "conversations":
      return "Conversations";
      case "moderation":
  return "Moderation";
  case "bulletins":
  return "Bulletins";
    default:
      return "All";
  }
}

export default function InboxTabScreen() {
  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const currentUid = auth.currentUser?.uid ?? null;

  const [items, setItems] = useState<GroupInboxItemDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [markingAllRead, setMarkingAllRead] = useState(false);

  const [activeFilter, setActiveFilter] = useState<InboxFilter>("all");

  const [hideDuplicateReadItems, setHideDuplicateReadItems] = useState(true);

  const [olderItems, setOlderItems] = useState<GroupInboxItemDoc[]>([]);
const [nextCursorCreatedAtMs, setNextCursorCreatedAtMs] = useState<number | null>(null);
const [hasMoreInboxItems, setHasMoreInboxItems] = useState(true);
const [loadingOlderItems, setLoadingOlderItems] = useState(false);

const [dmThreads, setDmThreads] = useState<GroupDmDoc[]>([]);

const [conversationThreads, setConversationThreads] = useState<
  GroupConversationDoc[]
>([]);

const inboxItems = useMemo(() => {
  const mergedById = new Map<string, GroupInboxItemDoc>();

items.forEach((item) => mergedById.set(item.id, item));
olderItems.forEach((item) => {
  if (!mergedById.has(item.id)) mergedById.set(item.id, item);
});

const sorted = Array.from(mergedById.values()).sort(
  (a, b) => b.createdAtMs - a.createdAtMs
);

  let filtered = sorted;

  if (activeFilter === "unread") {
    filtered = sorted.filter((item) => !item.readAtMs);
  } else if (activeFilter === "mentions") {
    filtered = sorted.filter((item) => item.title === "You were mentioned");
  } else if (activeFilter === "assignments") {
    filtered = sorted.filter((item) => item.type === "assignment");
  } else if (activeFilter === "comments") {
    filtered = sorted.filter((item) => item.type === "comment");
 } else if (activeFilter === "direct_messages") {
  filtered = sorted.filter((item) => item.type === "dm");
} else if (activeFilter === "conversations") {
  filtered = sorted.filter((item) => item.type === "conversation");
}
else if (activeFilter === "moderation") {
  filtered = sorted.filter(
    (item) => item.moderation === true || !!item.reportId
  );
}
else if (activeFilter === "bulletins") {
  filtered = sorted.filter(
    (item) =>
      item.relatedEntityType === "group" &&
      (item.title.toLowerCase().includes("bulletin") ||
        item.groupKey?.includes("bulletin"))
  );
}

if (activeFilter === "all" || activeFilter === "unread") {
  const dmIds = new Set(dmThreads.map((dm) => dm.id));
  const conversationIds = new Set(
    conversationThreads.map((conversation) => conversation.id)
  );

  filtered = filtered.filter((item) => {
    if (item.type === "dm" && item.dmId) {
      return !dmIds.has(item.dmId);
    }

    if (item.type === "conversation" && item.relatedEntityId) {
      return !conversationIds.has(item.relatedEntityId);
    }

    return true;
  });
}

  if (!hideDuplicateReadItems) {
    return filtered;
  }

  const seenReadGroupKeys = new Set<string>();

  return filtered.filter((item) => {
    if (!item.groupKey) return true;
    if (!item.readAtMs) return true;

    if (seenReadGroupKeys.has(item.groupKey)) {
      return false;
    }

    seenReadGroupKeys.add(item.groupKey);
    return true;
  });
}, [
  items,
  olderItems,
  activeFilter,
  hideDuplicateReadItems,
  dmThreads,
  conversationThreads,
]);



const inboxGroupCounts = useMemo(() => {
  const counts: Record<string, number> = {};

  [...items, ...olderItems].forEach((item) => {
    if (!item.groupKey) return;

    counts[item.groupKey] = (counts[item.groupKey] ?? 0) + 1;
  });

  return counts;
}, [items, olderItems]);




const activeFilterLabel = getInboxFilterLabel(activeFilter);


  const getEmptyInboxMessage = () => {
  switch (activeFilter) {
    case "unread":
      return {
        title: "All caught up",
        body: "You have no unread inbox items right now.",
      };
    case "mentions":
      return {
        title: "No mentions yet",
        body: "When someone mentions you with @name, it will appear here.",
      };
    case "assignments":
      return {
        title: "No assignments yet",
        body: "Tasks assigned to you across groups will appear here.",
      };
    case "comments":
      return {
        title: "No comment activity yet",
        body: "Comment notifications and discussion updates will appear here.",
      };
    case "direct_messages":
      return {
        title: "No direct messages yet",
        body: "Private group messages will appear here.",
      };
    case "conversations":
      return {
        title: "No conversations yet",
        body: "Group conversations will appear here when someone starts a shared thread.",
      };
      case "moderation":
  return {
    title: "No moderation alerts",
    body: "Reports and review requests will appear here.",
  };
  case "bulletins":
  return {
    title: "No bulletin updates",
    body: "Bulletin posts, comments, and related updates will appear here.",
  };
    default:
      return {
        title: "Nothing here yet",
        body: "New assignments, comments, mentions, and group activity will appear here.",
      };
  }
};

const emptyInboxMessage = getEmptyInboxMessage();

 useEffect(() => {
  if (!currentUid) {
    setItems([]);
    setOlderItems([]);
    setNextCursorCreatedAtMs(null);
    setHasMoreInboxItems(true);
    setLoading(false);
    return;
  }

  setLoading(true);
  setItems([]);
  setOlderItems([]);
  setNextCursorCreatedAtMs(null);
  setHasMoreInboxItems(true);

  const unsub = subscribeMyGroupInbox(
    currentUid,
    (next) => {
      setItems(next);
      setNextCursorCreatedAtMs(
        next.length > 0 ? next[next.length - 1].createdAtMs : null
      );
      setHasMoreInboxItems(next.length >= 20);
      setLoading(false);
    },
    (err) => {
      console.log("[InboxTab] failed loading inbox", err);
      setLoading(false);
    }
  );

  return unsub;
}, [currentUid]);

useEffect(() => {
  if (!currentUid) {
    setDmThreads([]);
    return;
  }

  const unsub = subscribeMyGroupDms(
    currentUid,
    setDmThreads,
    (err) => console.log("[InboxTab] failed loading DMs", err)
  );

  return unsub;
}, [currentUid]);

useEffect(() => {
  if (!currentUid) {
    setConversationThreads([]);
    return;
  }

  const unsub = subscribeMyGroupConversations(
    currentUid,
    setConversationThreads,
    (err) => console.log("[InboxTab] failed loading conversations", err)
  );

  return unsub;
}, [currentUid]);

const getDmLabel = (dm: GroupDmDoc) => {
  const otherUid = dm.participantUids.find((uid) => uid !== currentUid) ?? "";

  return (
    dm.subject ??
    dm.participantNames?.[otherUid] ??
    dm.participantEmails?.[otherUid] ??
    "Private message"
  );
};

const getConversationLabel = (conversation: GroupConversationDoc) => {
  return conversation.title || "Group conversation";
};

const getThreadPreviewText = (thread: {
  lastMessagePreview?: string | null;
  lastMessageSenderUid?: string | null;
}) => {
  if (!thread.lastMessagePreview) return "No messages yet.";

  if (thread.lastMessageSenderUid === currentUid) {
    return `You: ${thread.lastMessagePreview}`;
  }

  return thread.lastMessagePreview;
};

const markMatchingThreadInboxItemsRead = async (params: {
  type: "dm" | "conversation";
  threadId: string;
}) => {
  if (!currentUid) return;

  const allInboxItems = [...items, ...olderItems];

  await Promise.all(
    allInboxItems
      .filter((item) => {
        if (item.readAtMs) return false;

        if (params.type === "dm") {
          return item.type === "dm" && item.dmId === params.threadId;
        }

        return (
          item.type === "conversation" &&
          item.relatedEntityId === params.threadId
        );
      })
      .map((item) =>
        markGroupInboxItemRead({
          uid: currentUid,
          itemId: item.id,
        }).catch((err) => {
          console.log("[InboxTab] mark matching thread inbox item read failed", err);
        })
      )
  );
};

const handleOpenConversation = (conversation: GroupConversationDoc) => {
  if (currentUid && isConversationUnread(conversation)) {
    markGroupConversationRead({
      conversationId: conversation.id,
      uid: currentUid,
    }).catch((err) => {
      console.log("[InboxTab] mark conversation read failed", err);
    });
  }

  markMatchingThreadInboxItemsRead({
  type: "conversation",
  threadId: conversation.id,
});

  router.push(
    `/group/${conversation.groupId}/conversation/${conversation.id}` as any
  );
};

const handleOpenDm = (dm: GroupDmDoc) => {
  if (currentUid && isDirectMessageUnread(dm)) {
    markGroupDmRead({
      dmId: dm.id,
      uid: currentUid,
    }).catch((err) => {
      console.log("[InboxTab] mark DM read failed", err);
    });
  }

  markMatchingThreadInboxItemsRead({
  type: "dm",
  threadId: dm.id,
});

  router.push(`/group/${dm.groupId}/dm/${dm.id}` as any);
};

const isConversationUnread = (conversation: GroupConversationDoc) => {
  return getGroupThreadUnreadState(conversation, currentUid ?? "").isUnread;
};

const isDirectMessageUnread = (dm: GroupDmDoc) => {
  return getGroupThreadUnreadState(dm, currentUid ?? "").isUnread;
};



const visibleDmIds = new Set(dmThreads.map((dm) => dm.id));

const visibleDmThreads = dmThreads.filter((dm) => {
  if (activeFilter === "unread") {
    return isDirectMessageUnread(dm);
  }

  return true;
});

const shouldShowDirectMessages =
  activeFilter === "all" ||
  activeFilter === "unread" ||
  activeFilter === "direct_messages";

const shouldShowConversations =
  activeFilter === "all" ||
  activeFilter === "unread" ||
  activeFilter === "conversations";

const shouldShowInboxItems =
  activeFilter !== "direct_messages" && activeFilter !== "conversations";

  

const unreadItems = inboxItems.filter((item) => {
  if (item.readAtMs) return false;
  if (item.type === "dm") return false;
  if (item.type === "conversation") return false;

  return true;
});

const unreadDmThreads = dmThreads.filter((dm) =>
  isDirectMessageUnread(dm)
);

const unreadDmThreadsById = Array.from(
  new Map(unreadDmThreads.map((dm) => [dm.id, dm])).values()
);

const unreadDmCount = unreadDmThreadsById.length;

const unreadConversationThreads = conversationThreads.filter((conversation) =>
  isConversationUnread(conversation)
);

const unreadConversationThreadsById = Array.from(
  new Map(
    unreadConversationThreads.map((conversation) => [
      conversation.id,
      conversation,
    ])
  ).values()
);

const unreadConversationCount = unreadConversationThreadsById.length;

const unreadCount = unreadItems.length + unreadDmCount + unreadConversationCount;

const unreadMentionCount = [...items, ...olderItems].filter(
  (item) => !item.readAtMs && item.title === "You were mentioned"
).length;

const unreadAssignmentCount = [...items, ...olderItems].filter(
  (item) => !item.readAtMs && item.type === "assignment"
).length;

const unreadCommentCount = [...items, ...olderItems].filter(
  (item) => !item.readAtMs && item.type === "comment"
).length;

const unreadModerationCount = [...items, ...olderItems].filter(
  (item) => !item.readAtMs && (item.moderation || !!item.reportId)
).length;

const totalInboxCount =
  inboxItems.length + dmThreads.length + conversationThreads.length;

  const visibleConversationThreads = conversationThreads.filter((conversation) => {
  if (activeFilter === "unread") {
    return isConversationUnread(conversation);
  }

  return true;
});



const filteredCount =
  (shouldShowInboxItems ? inboxItems.length : 0) +
  (shouldShowDirectMessages ? visibleDmThreads.length : 0) +
  (shouldShowConversations ? visibleConversationThreads.length : 0);

  const handleOpenItem = (item: GroupInboxItemDoc) => {
  const currentUser = auth.currentUser;

  if (currentUser?.uid && !item.readAtMs) {
    markGroupInboxItemRead({
      uid: currentUser.uid,
      itemId: item.id,
    }).catch((err) => {
      console.log("[InboxTab] mark item read failed", err);
    });
  }

if (item.type === "planner" || item.relatedEntityType === "planner") {
  router.push("/planner" as any);
  return;
}

if (item.type === "dm" && item.dmId) {
  const matchingDm = dmThreads.find((dm) => dm.id === item.dmId);

  if (matchingDm) {
    handleOpenDm(matchingDm);
    return;
  }

  router.push(`/group/${item.groupId}/dm/${item.dmId}` as any);
  return;
}

if (item.type === "conversation" && item.relatedEntityId) {
  const matchingConversation = conversationThreads.find(
    (conversation) => conversation.id === item.relatedEntityId
  );

  if (matchingConversation) {
    handleOpenConversation(matchingConversation);
    return;
  }

if (currentUid) {
  markGroupConversationRead({
    conversationId: item.relatedEntityId,
    uid: currentUid,
  }).catch((err) => {
    console.log("[InboxTab] fallback mark conversation read failed", err);
  });
}

router.push(
  `/group/${item.groupId}/conversation/${item.relatedEntityId}` as any
);
return;
}

if (item.moderation || item.reportId) {
  router.push(`/group/${item.groupId}/moderation` as any);
  return;
}

if (
  item.relatedEntityType === "routine_occurrence" &&
  item.relatedEntityId &&
  item.groupId
) {
  router.push(
    `/group/${item.groupId}/routine-occurrence/${item.relatedEntityId}` as any
  );
  return;
}

if (item.boardId) {
  router.push({
    pathname: "/board/[id]",
    params: { id: item.boardId },
  });
  return;
}

if (
  item.groupKey?.startsWith("bulletin:") &&
  item.relatedEntityId &&
  item.groupId
) {
  router.push(
    `/group/${item.groupId}/bulletin/${item.relatedEntityId}` as any
  );
  return;
}

  if (item.joinRequest || item.title === "New join request") {
  router.push({
    pathname: "/group/[id]",
    params: {
      id: item.groupId,
      focus: "joinRequests",
    },
  });
  return;
}

  if (item.subtaskId && !item.goalId) {
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
    return;
  }

  if (item.groupId) {
    router.push(`/group/${item.groupId}`);
  }
};

 const handleMarkAllRead = async () => {
 if (!currentUid) return;
  if (markingAllRead) return;
  if (unreadCount <= 0) return;

  try {
    setMarkingAllRead(true);

    await Promise.all([
      ...unreadItems.map((item) =>
        markGroupInboxItemRead({
          uid: currentUid,
          itemId: item.id,
        })
      ),
...unreadDmThreadsById.map((dm) =>
  markGroupDmRead({
    dmId: dm.id,
    uid: currentUid,
  })
),
...unreadConversationThreadsById.map((conversation) =>
  markGroupConversationRead({
    conversationId: conversation.id,
    uid: currentUid,
  })
),
    ]);
  } catch (err) {
    console.log("[InboxTab] mark all read failed", err);
  } finally {
    setMarkingAllRead(false);
  }
};

const handleLoadOlderInboxItems = async () => {
  if (!currentUid) return;
  if (loadingOlderItems) return;
  if (!hasMoreInboxItems) return;

  try {
    setLoadingOlderItems(true);

    const page = await fetchMyGroupInboxPage({
      uid: currentUid,
      pageSize: 20,
      cursorCreatedAtMs: nextCursorCreatedAtMs,
    });

    setOlderItems((current) => {
      const merged = new Map<string, GroupInboxItemDoc>();

      current.forEach((item) => merged.set(item.id, item));
      page.items.forEach((item) => merged.set(item.id, item));

      return Array.from(merged.values()).sort(
        (a, b) => b.createdAtMs - a.createdAtMs
      );
    });

    setNextCursorCreatedAtMs(page.nextCursorCreatedAtMs);
    setHasMoreInboxItems(page.hasMore);
  } catch (err) {
    console.log("[InboxTab] load older inbox failed", err);
  } finally {
    setLoadingOlderItems(false);
  }
};

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons
            name="notifications-outline"
            size={26}
            color={theme.colors.primary}
          />
        </View>

        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          Assignments, comments, mentions, and group updates across all groups.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryTitle}>
{unreadCount} unread
{unreadDmCount > 0
  ? ` · ${unreadDmCount} DM${unreadDmCount === 1 ? "" : "s"}`
  : ""}
{unreadConversationCount > 0
  ? ` · ${unreadConversationCount} conversation${
      unreadConversationCount === 1 ? "" : "s"
    }`
  : ""}
</Text>
         <Text style={styles.summaryText}>
  {activeFilter === "all"
    ? unreadCount > 0
? `${totalInboxCount} total inbox item${
    totalInboxCount === 1 ? "" : "s"
  }`
      : "You're all caught up"
    : `${filteredCount} ${activeFilterLabel.toLowerCase()} item${
        filteredCount === 1 ? "" : "s"
      }`}
</Text>
        </View>

        {unreadCount > 0 ? (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={markingAllRead ? "Marking all inbox items as read" : "Mark all inbox items as read"}
    accessibilityState={{
      disabled: markingAllRead || unreadCount <= 0,
      busy: markingAllRead,
    }}
    style={({ pressed }) => [
      styles.markAllButton,
      markingAllRead && styles.markAllButtonDisabled,
      pressed && styles.controlPressed,
    ]}
    onPress={handleMarkAllRead}
    disabled={markingAllRead}
  >
    <Text style={styles.markAllButtonText}>
      {markingAllRead ? "Marking..." : "Mark all read"}
    </Text>
  </Pressable>
) : null}
      </View>

      <View style={styles.filterRow}>
{([
  ["all", "All", null],
  ["unread", "Unread", unreadCount],
  ["mentions", "Mentions", unreadMentionCount],
  ["assignments", "Assignments", unreadAssignmentCount],
  ["comments", "Comments", unreadCommentCount],
  ["direct_messages", "DMs", unreadDmCount],
  ["conversations", "Conversations", unreadConversationCount],
  ["moderation", "Moderation", unreadModerationCount],
  ["bulletins", "Bulletins", null],
] as Array<[InboxFilter, string, number | null]>).map(
  ([filter, label, badgeCount]) => {
    const active = activeFilter === filter;

    return (
      <Pressable
        key={filter}
        accessibilityRole="tab"
        accessibilityLabel={`Show ${label} inbox items`}
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.filterChip,
          active && styles.filterChipActive,
          pressed && styles.controlPressed,
        ]}
        onPress={() => setActiveFilter(filter)}
      >
<Text
  style={[
    styles.filterChipText,
    active && styles.filterChipTextActive,
  ]}
>
  {label}
  {badgeCount && badgeCount > 0 ? ` (${badgeCount})` : ""}
</Text>
      </Pressable>
    );
  })}
</View>

<Pressable
  accessibilityRole="switch"
  accessibilityLabel="Hide duplicate read thread updates"
  accessibilityState={{ checked: hideDuplicateReadItems }}
  style={({ pressed }) => [
    styles.compactToggle,
    pressed && styles.controlPressed,
  ]}
  onPress={() => setHideDuplicateReadItems((current) => !current)}
>
  <Text style={styles.compactToggleText}>
    {hideDuplicateReadItems
  ? "Compact read threads on"
  : "Compact read threads off"}
  </Text>
</Pressable>

{shouldShowDirectMessages && visibleDmThreads.length > 0 ? (
  <View style={styles.dmSection}>
<View style={styles.sectionHeaderRow}>
  <Text style={styles.dmSectionTitle}>
    Direct messages
    {unreadDmCount > 0 ? ` · ${unreadDmCount} unread` : ""}
  </Text>

  {activeFilter === "all" && dmThreads.length > 5 ? (
    <Pressable onPress={() => setActiveFilter("direct_messages")}>
      <Text style={styles.sectionHeaderAction}>View all</Text>
    </Pressable>
  ) : null}
</View>

{visibleDmThreads
  .slice(0, activeFilter === "direct_messages" ? 50 : 5)
  .map((dm) => {
    const unread = isDirectMessageUnread(dm);

    return (
      <Pressable
  key={dm.id}
  accessibilityRole="button"
  accessibilityLabel={`Open conversation with ${getDmLabel(dm)}${unread ? ", unread" : ""}`}
  style={({ pressed }) => [
    styles.inboxRow,
    unread && styles.inboxRowUnread,
    pressed && styles.inboxRowPressed,
  ]}
  onPress={() => handleOpenDm(dm)}
>
        <View style={styles.inboxIcon}>
          <Text style={styles.inboxIconText}>💬</Text>
        </View>

        <View style={styles.inboxBody}>
          <View style={styles.inboxTitleRow}>
  <Text style={styles.inboxTitle} numberOfLines={1}>
    {getDmLabel(dm)}
  </Text>

  {unread ? <View style={styles.unreadDot} /> : null}
</View>

          <Text style={styles.inboxBodyText} numberOfLines={2}>
            {getThreadPreviewText(dm)}
          </Text>

          <Text style={styles.inboxMeta}>
            {dm.groupName ?? "Group"} · {formatRelativeTime(dm.lastMessageAtMs)}
          </Text>
        </View>
      </Pressable>
        );
  })}
  </View>
) : null}

{activeFilter === "direct_messages" && visibleDmThreads.length === 0 ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>No direct messages yet</Text>
    <Text style={styles.helperText}>
      Private group messages will appear here.
    </Text>
  </View>
) : null}



{shouldShowConversations && visibleConversationThreads.length > 0 ? (
  <View style={styles.dmSection}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.dmSectionTitle}>
  Group conversations
  {unreadConversationCount > 0
    ? ` · ${unreadConversationCount} unread`
    : ""}
</Text>

      {activeFilter === "all" && conversationThreads.length > 5 ? (
        <Pressable onPress={() => setActiveFilter("conversations")}>
          <Text style={styles.sectionHeaderAction}>View all</Text>
        </Pressable>
      ) : null}
    </View>

{visibleConversationThreads
  .slice(0, activeFilter === "conversations" ? 50 : 5)
      .map((conversation) => {
        const unread = isConversationUnread(conversation);

        return (
        <Pressable
          key={conversation.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${getConversationLabel(conversation)} conversation${unread ? ", unread" : ""}`}
          style={({ pressed }) => [
            styles.inboxRow,
            unread && styles.inboxRowUnread,
            pressed && styles.inboxRowPressed,
          ]}
          onPress={() => handleOpenConversation(conversation)}
        >
          <View style={styles.inboxIcon}>
            <Text style={styles.inboxIconText}>🗣️</Text>
          </View>

          <View style={styles.inboxBody}>
            <View style={styles.inboxTitleRow}>
              <Text style={styles.inboxTitle} numberOfLines={1}>
                {getConversationLabel(conversation)}
              </Text>
                            {unread ? <View style={styles.unreadDot} /> : null}
            </View>

            <Text style={styles.inboxBodyText} numberOfLines={2}>
              {getThreadPreviewText(conversation)}
            </Text>

            <Text style={styles.inboxMeta}>
              {conversation.memberUids.length} members ·{" "}
              {formatRelativeTime(
                conversation.lastMessageAtMs ?? conversation.updatedAtMs
              )}
            </Text>
          </View>
        </Pressable>
          );
})}
  </View>
) : null}

{activeFilter === "conversations" && conversationThreads.length === 0 ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>No conversations yet</Text>
    <Text style={styles.helperText}>
      Group conversations will appear here.
    </Text>
  </View>
) : null}

     {!shouldShowInboxItems ? null : loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading inbox...</Text>
        </View>
      ) : inboxItems.length === 0 && activeFilter !== "unread" ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>{emptyInboxMessage.title}</Text>
<Text style={styles.helperText}>{emptyInboxMessage.body}</Text>
        </View>
) : inboxItems.length === 0 ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>{emptyInboxMessage.title}</Text>
    <Text style={styles.helperText}>{emptyInboxMessage.body}</Text>
  </View>
) : (
  inboxItems.map((item) => {
          const unread = !item.readAtMs;
const threadLabel = getInboxThreadLabel(item);

const relatedCount = item.groupKey
  ? inboxGroupCounts[item.groupKey] ?? 0
  : 0;

          return (
            <Pressable
              key={item.id}
              style={[styles.inboxRow, unread && styles.inboxRowUnread]}
              onPress={() => handleOpenItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.body ?? ""}. ${threadLabel ?? "Open update"}`}
            >
              <View style={styles.inboxIcon}>
                <Text style={styles.inboxIconText}>
                  {getInboxIcon(item)}
                </Text>
              </View>

              <View style={styles.inboxBody}>
                <View style={styles.inboxTitleRow}>
                  <Text style={styles.inboxTitle} numberOfLines={1}>
                    {item.title}
                  </Text>

                  {unread ? <View style={styles.unreadDot} /> : null}
                </View>

                {!!item.body ? (
                  <Text style={styles.inboxBodyText} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}

                <View style={styles.inboxMetaRow}>
  <View style={styles.inboxTypePill}>
    <Text style={styles.inboxTypePillText}>
      {getInboxTypeLabel(item)}
    </Text>
  </View>

  {threadLabel ? (
    <View style={styles.inboxThreadPill}>
      <Text style={styles.inboxThreadPillText}>
        {threadLabel}
      </Text>
    </View>
  ) : null}

  {relatedCount > 1 ? (
  <View style={styles.inboxRelatedPill}>
    <Text style={styles.inboxRelatedPillText}>
      +{relatedCount - 1} related
    </Text>
  </View>
) : null}

  <Text style={styles.inboxMeta}>
    {formatRelativeTime(item.createdAtMs)}
    {item.actorName ? ` · ${item.actorName}` : ""}
  </Text>
</View>
              </View>
            </Pressable>
          );
        })
      )}
      {!loading && inboxItems.length > 0 && hasMoreInboxItems ? (
  <Pressable
    style={[
      styles.loadOlderButton,
      loadingOlderItems && styles.loadOlderButtonDisabled,
    ]}
    onPress={handleLoadOlderInboxItems}
    disabled={loadingOlderItems}
  >
    <Text style={styles.loadOlderButtonText}>
      {loadingOlderItems ? "Loading..." : "Load older"}
    </Text>
  </Pressable>
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
      marginBottom: 18,
    },

    iconWrap: {
      width: 54,
      height: 54,
      borderRadius: 27,
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
    filterRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 14,
},

filterChip: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

controlPressed: {
  opacity: 0.8,
},

inboxRowPressed: {
  opacity: 0.82,
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
inboxMetaRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginTop: 6,
},

inboxTypePill: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

inboxTypePillText: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
},
markAllButtonDisabled: {
  opacity: 0.6,
},
inboxThreadPill: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

inboxThreadPillText: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
},
inboxRelatedPill: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

inboxRelatedPillText: {
  color: theme.colors.primary,
  fontSize: 10,
  fontWeight: "900",
},
compactToggle: {
  alignSelf: "flex-start",
  marginBottom: 14,
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

compactToggleText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},
loadOlderButton: {
  marginTop: 6,
  paddingVertical: 11,
  borderRadius: 999,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

loadOlderButtonDisabled: {
  opacity: 0.6,
},

loadOlderButtonText: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
},
dmSection: {
  marginBottom: 16,
},

sectionHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
},

dmSectionTitle: {
  color: theme.colors.text,
  fontSize: 18,
  fontWeight: "900",
  flex: 1,
},

sectionHeaderAction: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
  });
