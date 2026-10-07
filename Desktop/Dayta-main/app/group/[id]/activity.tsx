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
  fetchGroupActivityPage,
  type GroupActivityDoc,
} from "../../../services/groups";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

function getActivityIcon(type: string): string {
  switch (type) {
    case "goal_shared":
      return "🎯";
    case "invite_created":
      return "✉️";
    case "invite_accepted":
      return "🤝";
    case "invite_declined":
      return "↩️";
    case "member_removed":
      return "🚪";
    case "member_role_changed":
      return "🛡️";
    case "subtask_completed":
      return "✅";
    case "note_created":
      return "🧩";
    case "comment_created":
      return "💬";
    case "task_assigned":
      return "📌";
    case "task_unassigned":
      return "📍";
    case "planning_board_card_assigned":
    case "planning_board_card_reassigned":
    case "planning_board_card_unassigned":
      return "📋";
    default:
      return "•";
  }
}

function getActivityTitle(item: GroupActivityDoc): string {
  switch (item.type) {
    case "goal_shared":
      return "Goal shared";
    case "invite_created":
      return "Invite sent";
    case "invite_accepted":
      return "Invite accepted";
    case "invite_declined":
      return "Invite declined";
    case "member_removed":
      return "Member removed";
    case "member_role_changed":
      return "Role updated";
    case "subtask_completed":
      return "Task completed";
    case "note_created":
  return item.taskId ? "Task pool update" : "Progress update";
    case "comment_created":
      return "Comment added";
    case "task_assigned":
      return "Task assigned";
    case "task_unassigned":
      return "Task unassigned";
    case "planning_board_card_assigned":
      return "Board card assigned";
    case "planning_board_card_reassigned":
      return "Board card reassigned";
    case "planning_board_card_unassigned":
      return "Board card unassigned";
    default:
      return "Group update";
  }
}

function getActivityDetail(item: GroupActivityDoc): string | null {
  if (item.cardTitle) {
    return item.boardTitle
      ? `${item.cardTitle} • ${item.boardTitle}`
      : item.cardTitle;
  }

  if (item.taskTitle) {
    return item.taskTitle;
  }

  if (item.goalTitle) {
    return item.goalTitle;
  }

  if (item.targetEmail) {
    return item.targetEmail;
  }

  return null;
}

function getActivityMessage(item: GroupActivityDoc): string {
  const currentUid = auth.currentUser?.uid;

  if (item.type === "task_assigned" && item.targetUid === currentUid) {
    return item.message.replace("assigned", "assigned you");
  }

  return item.message;
}

function isGoalActivity(type: string): boolean {
  return [
    "goal_shared",
    "subtask_completed",
    "comment_created",
    "note_created",
    "task_assigned",
    "task_unassigned",
    "planning_board_card_assigned",
    "planning_board_card_reassigned",
    "planning_board_card_unassigned",
  ].includes(type);
}

function formatRelativeTime(ms?: number | null): string {
  if (!ms) return "Recently";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
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

export default function GroupActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = String(id ?? "");

  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [items, setItems] = useState<GroupActivityDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

const PAGE_SIZE = 25;

const [nextCursorCreatedAtMs, setNextCursorCreatedAtMs] = useState<number | null>(null);
const [hasMoreActivity, setHasMoreActivity] = useState(true);
const [loadingMore, setLoadingMore] = useState(false);

  type ActivityFilter =
  | "all"
  | "goals"
  | "members"
  | "invites"
  | "progress"
  | "completions"
  | "tasks"
  | "assignments";



const [selectedFilter, setSelectedFilter] =
  useState<ActivityFilter>("all");

  const ACTIVITY_FILTERS: {
  key: ActivityFilter;
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "goals", label: "Goals" },
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
  { key: "progress", label: "Progress" },
  { key: "completions", label: "Completions" },
  { key: "assignments", label: "Assignments" },
  { key: "tasks", label: "Tasks" },
];

const filteredActivity = useMemo(() => {
  if (selectedFilter === "all") {
    return items;
  }

  return items.filter((item) => {
    switch (selectedFilter) {
     case "goals":
  return [
    "goal_shared",
    "subtask_completed",
    "comment_created",
    "task_assigned",
    "note_created",
  ].includes(item.type);

      case "members":
        return [
          "member_removed",
          "member_role_changed",
        ].includes(item.type);

      case "invites":
        return [
          "invite_created",
          "invite_accepted",
          "invite_declined",
        ].includes(item.type);

      case "progress":
        return [
          "note_created",
        ].includes(item.type);

      case "completions":
        return [
          "subtask_completed",
        ].includes(item.type);
        case "assignments":
  return [
    "task_assigned",
    "task_unassigned",
    "planning_board_card_assigned",
    "planning_board_card_reassigned",
    "planning_board_card_unassigned",
  ].includes(item.type);
  case "tasks":
  return !!item.taskId;

      default:
        return true;
    }
  });
}, [items, selectedFilter]);

useEffect(() => {
  if (!groupId) {
    setItems([]);
    setLoading(false);
    return;
  }

  let cancelled = false;

  const loadInitial = async () => {
    try {
      setLoading(true);
      setError(null);

      const page = await fetchGroupActivityPage({
        groupId,
        pageSize: PAGE_SIZE,
        cursorCreatedAtMs: null,
      });

      if (cancelled) return;

      setItems(page.items);
      setNextCursorCreatedAtMs(page.nextCursorCreatedAtMs);
      setHasMoreActivity(page.hasMore);
    } catch (err) {
      console.log("[GroupActivity] failed loading activity", err);
      if (!cancelled) setError("Could not load activity.");
    } finally {
      if (!cancelled) setLoading(false);
    }
  };

  loadInitial();

  return () => {
    cancelled = true;
  };
}, [groupId]);

const handleLoadMore = async () => {
  if (loadingMore || loading || !hasMoreActivity) return;

  try {
    setLoadingMore(true);

    const page = await fetchGroupActivityPage({
      groupId,
      pageSize: PAGE_SIZE,
      cursorCreatedAtMs: nextCursorCreatedAtMs,
    });

    setItems((current) => {
      const merged = new Map<string, GroupActivityDoc>();

      current.forEach((item) => merged.set(item.id, item));
      page.items.forEach((item) => merged.set(item.id, item));

      return Array.from(merged.values()).sort(
        (a, b) => b.createdAtMs - a.createdAtMs
      );
    });

    setNextCursorCreatedAtMs(page.nextCursorCreatedAtMs);
    setHasMoreActivity(page.hasMore);
  } catch (err) {
    console.log("[GroupActivity] load older activity failed", err);
  } finally {
    setLoadingMore(false);
  }
};

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Group activity</Text>
      <Text style={styles.subtitle}>Recent group updates and shared progress.</Text>

      <ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.activityFiltersRow}
>
  {ACTIVITY_FILTERS.map((filter) => {
    const active = selectedFilter === filter.key;

    return (
      <Pressable
        key={filter.key}
        onPress={() => setSelectedFilter(filter.key)}
        style={[
          styles.activityFilterChip,
          active && styles.activityFilterChipActive,
        ]}
      >
        <Text
          style={[
            styles.activityFilterChipText,
            active && styles.activityFilterChipTextActive,
          ]}
        >
          {filter.label}
        </Text>
      </Pressable>
    );
  })}
</ScrollView>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading activity...</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
     ) : filteredActivity.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No activity yet.</Text>
        </View>
          ) : (
        <>
          <View style={styles.card}>
          {filteredActivity.map((item) => (
            <Pressable
              key={item.id}
              style={styles.activityRow}
              disabled={!item.goalId && !item.taskId && !item.boardId}
onPress={() => {
  if (item.boardId) {
    router.push({
      pathname: "/board/[id]",
      params: { id: item.boardId },
    });
    return;
  }

  if (item.taskId) {
    router.push(`/group/${groupId}/task/${item.taskId}`);
    return;
  }

  if (item.goalId) {
    router.push({
      pathname: "/goal/[id]",
      params: { id: item.goalId },
    });
  }
}}
            >
              <View style={styles.activityIconWrap}>
                <Text style={styles.activityIcon}>{getActivityIcon(item.type)}</Text>
              </View>

              <View style={styles.activityBody}>
  <View style={styles.activityHeaderRow}>
    <Text style={styles.activityTitle}>{getActivityTitle(item)}</Text>

    {item.taskId ? (
  <View style={styles.activityTypeBadge}>
    <Text style={styles.activityTypeBadgeText}>Task</Text>
  </View>
) : item.boardId ? (
  <View style={styles.activityTypeBadge}>
    <Text style={styles.activityTypeBadgeText}>Board</Text>
  </View>
) : isGoalActivity(item.type) ? (
  <View style={styles.activityTypeBadge}>
    <Text style={styles.activityTypeBadgeText}>Goal</Text>
  </View>
) : null}
  </View>

  <Text style={styles.activityMessage}>
    <Text style={styles.activityActor}>
      {item.actorName ?? "Someone"}
    </Text>{" "}
    {getActivityMessage(item)}
  </Text>

  {getActivityDetail(item) ? (
    <View style={styles.activityDetailBox}>
      <Text style={styles.activityDetailText}>
        {getActivityDetail(item)}
      </Text>
    </View>
  ) : null}

  <Text style={styles.activityMeta}>
    {formatRelativeTime(item.createdAtMs)}
    {item.taskId
  ? " · Tap to open task"
  : item.boardId
  ? " · Tap to open board"
  : item.goalId
  ? " · Tap to open goal"
  : ""}
  </Text>
</View>
            </Pressable>
          ))}
        </View>
        {!loading && filteredActivity.length > 0 && hasMoreActivity ? (
  <Pressable
    style={[
      styles.loadMoreButton,
      loadingMore && styles.loadMoreButtonDisabled,
    ]}
    onPress={handleLoadMore}
    disabled={loadingMore}
  >
    <Text style={styles.loadMoreButtonText}>
      {loadingMore
  ? "Loading more..."
  : `Load more ${selectedFilter !== "all" ? selectedFilter : "activity"}`}
    </Text>
  </Pressable>
) : null}
      </>
      )}
    </ScrollView>
  );
}

function makeStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      padding: 16,
      paddingBottom: 40,
    },
    backButton: {
      alignSelf: "flex-start",
      marginBottom: 12,
    },
    backButtonText: {
      color: theme.colors.primary,
      fontWeight: "900",
    },
    title: {
      color: theme.colors.text,
      fontSize: 26,
      fontWeight: "900",
    },
    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 6,
      marginBottom: 16,
      lineHeight: 20,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: 14,
      gap: 8,
    },
    loadingText: {
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: 8,
    },
    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
    },
    emptyText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    activityRow: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    activityIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginTop: 2,
    },
    activityIcon: {
      fontSize: 15,
    },
    activityBody: {
      flex: 1,
    },
    activityMessage: {
      color: theme.colors.text,
      lineHeight: 19,
    },
    activityActor: {
      color: theme.colors.text,
      fontWeight: "900",
    },
    activityMeta: {
      color: theme.colors.textMuted,
      marginTop: 4,
      fontSize: 12,
      fontWeight: "700",
    },
    activityFiltersRow: {
  paddingBottom: 14,
  paddingTop: 2,
  gap: 8,
},

activityFilterChip: {
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
  marginRight: 8,
},

activityFilterChipActive: {
  backgroundColor: theme.colors.primary,
  borderColor: theme.colors.primary,
},

activityFilterChipText: {
  color: theme.colors.textMuted,
  fontWeight: "700",
},

activityFilterChipTextActive: {
  color: theme.colors.primaryText,
},
activityHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 3,
},

activityTitle: {
  color: theme.colors.text,
  fontWeight: "900",
  fontSize: 14,
  flex: 1,
},

activityTypeBadge: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

activityTypeBadgeText: {
  color: theme.colors.badgeText,
  fontSize: 11,
  fontWeight: "900",
},

activityDetailBox: {
  marginTop: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

activityDetailText: {
  color: theme.colors.text,
  fontWeight: "800",
  lineHeight: 18,
},
loadMoreButton: {
  marginTop: 12,
  paddingVertical: 12,
  borderRadius: 999,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

loadMoreButtonDisabled: {
  opacity: 0.5,
},

loadMoreButtonText: {
  color: theme.colors.primary,
  fontWeight: "900",
},
  });
}
