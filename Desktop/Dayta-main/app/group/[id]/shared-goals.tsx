import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { auth, db } from "../../../services/firebase";
import {
  assignSharedGoalSubtaskToMember,
  clearGroupGoalTyping,
  createGroupGoalComment,
  createGroupReport,
  createOrOpenGroupDm,
  removeGroupGoalCommentReaction,
  subscribeGroupGoalCommentReactions,
  subscribeGroupGoalComments,
  subscribeGroupGoalTyping,
  subscribeGroupMembers,
  unassignSharedGoalSubtask,
  upsertGroupGoalCommentReaction,
  upsertGroupGoalTyping,
  type GroupActivityDoc,
  type GroupGoalCommentDoc,
  type GroupGoalCommentReactionDoc,
  type GroupGoalTypingDoc,
  type GroupMemberDoc,
  type GroupReportReason,
  type GroupReportTargetType,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

type SharedGoalListItem = {
  id: string;
  title: string;
  description?: string | null;
  ownerUserId: string;
  status?: string | null;
  sharedAtMs?: number | null;
  goalStatus?: string | null;
  metricType?: string | null;
  metricUnit?: string | null;
  metricTargetValue?: number | null;
  currentMetricValue?: number | null;
  progressPercentage?: number | null;
};

type SharedGoalSubtaskPreview = {
  id: string;
  title: string;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  assignedAtMs?: number | null;
  dueAtMs?: number | null;
  scheduledDayKey?: string | null;
  firstCompletedAtMs?: number | null;
  lastCompletedAtMs?: number | null;
  lastActivityAtMs?: number | null;
};


type SharedGoalAssignmentFilter = "all" | "assigned" | "open" | "attention";

type AssignmentAttentionReason =
  | "overdue"
  | "due_today"
  | "assigned_7d"
  | "no_activity_today";

  type AssignmentHealthSignal =
  | "healthy"
  | "needs_attention"
  | "high_load"
  | "no_work";

  type AssignmentMemberBreakdownItem = {
  uid: string;
  displayName: string;
  email?: string | null;
  role?: string | null;
  assignedCount: number;
  attentionCount: number;
  tasks: Array<{
    goalId: string;
    goalTitle: string;
    subtask: SharedGoalSubtaskPreview;
  }>;
};

type ReportTarget = {
  targetType: GroupReportTargetType;
  targetId: string;

  goalId?: string | null;
  taskId?: string | null;
  commentId?: string | null;
  activityId?: string | null;

  previewTitle: string;
  previewBody?: string | null;
  targetAuthorUid?: string | null;
  targetAuthorName?: string | null;
};

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

function formatSharedGoalProgress(goal: SharedGoalListItem): string {
  const progress =
    typeof goal.progressPercentage === "number"
      ? `${goal.progressPercentage}%`
      : "0%";

  if (
    goal.metricType &&
    goal.metricType !== "none" &&
    typeof goal.metricTargetValue === "number"
  ) {
    const current = goal.currentMetricValue ?? 0;
    const unit = goal.metricUnit ? ` ${goal.metricUnit}` : "";
    return `${current}/${goal.metricTargetValue}${unit} · ${progress}`;
  }

  return progress;
}

function getLocalDayKey(ms: number = Date.now()): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getStartOfTodayMs(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function getStartOfTomorrowMs(): number {
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow.getTime();
}

function getActivityIcon(type: string): string {
  switch (type) {
    case "goal_shared":
      return "🎯";
    case "comment_created":
      return "💬";
    case "task_assigned":
      return "📌";
    case "task_unassigned":
      return "📍";
    case "subtask_completed":
      return "✅";
    default:
      return "•";
  }
}

const COMMENT_MAX_LENGTH = 1000;
const QUICK_COMMENT_REACTIONS = ["👍", "❤️", "🎉"] as const;

const MEMBER_BREAKDOWN_VISIBLE_TASK_LIMIT = 5;
const SHARED_GOAL_VISIBLE_TASK_LIMIT = 10;

export default function GroupSharedGoalsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [sharedGoals, setSharedGoals] = useState<SharedGoalListItem[]>([]);
  const [loadingSharedGoals, setLoadingSharedGoals] = useState(true);
  const [subtasksByGoalId, setSubtasksByGoalId] = useState<
    Record<string, SharedGoalSubtaskPreview[]>
  >({});
  const [activityItems, setActivityItems] = useState<GroupActivityDoc[]>([]);
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(
    new Set()
  );

  const [expandedGoalSectionIds, setExpandedGoalSectionIds] = useState<
  Set<string>
>(new Set());

  const [commentsByGoalId, setCommentsByGoalId] = useState<
  Record<string, GroupGoalCommentDoc[]>
>({});

const [typingByGoalId, setTypingByGoalId] = useState<
  Record<string, GroupGoalTypingDoc[]>
>({});

const [commentInputsByGoalId, setCommentInputsByGoalId] = useState<
  Record<string, string>
>({});

const [commentBusyGoalIds, setCommentBusyGoalIds] = useState<Set<string>>(
  new Set()
);

const [commentReactionsByCommentId, setCommentReactionsByCommentId] =
  useState<Record<string, GroupGoalCommentReactionDoc[]>>({});

  const [members, setMembers] = useState<GroupMemberDoc[]>([]);

const [assignmentPickerTarget, setAssignmentPickerTarget] = useState<{
  goalId: string;
  goalTitle: string;
  subtaskId: string;
  subtaskTitle: string;
} | null>(null);

const [assigningTask, setAssigningTask] = useState(false);

const [assignmentFilter, setAssignmentFilter] =
  useState<SharedGoalAssignmentFilter>("all");

  const [expandedAssignmentMemberUids, setExpandedAssignmentMemberUids] =
  useState<Set<string>>(new Set());

  const [messagingMemberUids, setMessagingMemberUids] = useState<Set<string>>(
  new Set()
);

const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
const [reportReason, setReportReason] = useState<GroupReportReason>("other");
const [reportNote, setReportNote] = useState("");
const [reportBusy, setReportBusy] = useState(false);

  const toggleGoalExpanded = (goalId: string) => {
    setExpandedGoalIds((current) => {
      const next = new Set(current);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  };

  const makeGoalSectionKey = (
  goalId: string,
  section: "assignments" | "activity" | "discussion"
) => `${goalId}:${section}`;

const isGoalSectionExpanded = (
  goalId: string,
  section: "assignments" | "activity" | "discussion"
) => expandedGoalSectionIds.has(makeGoalSectionKey(goalId, section));

const toggleGoalSection = (
  goalId: string,
  section: "assignments" | "activity" | "discussion"
) => {
  const key = makeGoalSectionKey(goalId, section);

  setExpandedGoalSectionIds((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
};

const toggleAssignmentMemberExpanded = (uid: string) => {
  setExpandedAssignmentMemberUids((current) => {
    const next = new Set(current);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    return next;
  });
};

  const getAssignmentCountForGoal = (goalId: string) => {
    return (subtasksByGoalId[goalId] ?? []).filter(
      (subtask) => !!subtask.assignedToUid
    ).length;
  };

  const getOpenAssignmentCountForGoal = (goalId: string) => {
  return (subtasksByGoalId[goalId] ?? []).filter(
    (subtask) => !subtask.assignedToUid
  ).length;
};

const getTotalAssignedTaskCount = () => {
  return sharedGoals.reduce(
    (sum, goal) => sum + getAssignmentCountForGoal(goal.id),
    0
  );
};

const getTotalOpenTaskCount = () => {
  return sharedGoals.reduce(
    (sum, goal) => sum + getOpenAssignmentCountForGoal(goal.id),
    0
  );
};

const getTotalAttentionTaskCount = () => {
  return sharedGoals.reduce((sum, goal) => {
    const subtasks = subtasksByGoalId[goal.id] ?? [];

    return (
      sum +
      subtasks.filter((subtask) => !!getAttentionReasonForSubtask(subtask)).length
    );
  }, 0);
};

const getAttentionReasonForSubtask = (
  subtask: SharedGoalSubtaskPreview
): AssignmentAttentionReason | null => {
  if (!subtask.assignedToUid) return null;

  const now = Date.now();
  const todayKey = getLocalDayKey(now);
  const startOfTodayMs = getStartOfTodayMs();
  const startOfTomorrowMs = getStartOfTomorrowMs();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const completed =
    !!subtask.firstCompletedAtMs || !!subtask.lastCompletedAtMs;

  const dueAtMs =
    typeof subtask.dueAtMs === "number" ? subtask.dueAtMs : null;

  if (!completed && dueAtMs !== null && dueAtMs < startOfTodayMs) {
    return "overdue";
  }

  if (
    !completed &&
    ((dueAtMs !== null &&
      dueAtMs >= startOfTodayMs &&
      dueAtMs < startOfTomorrowMs) ||
      subtask.scheduledDayKey === todayKey)
  ) {
    return "due_today";
  }

  if (
    !completed &&
    typeof subtask.assignedAtMs === "number" &&
    now - subtask.assignedAtMs >= sevenDaysMs
  ) {
    return "assigned_7d";
  }

  if (
    !completed &&
    (!subtask.lastActivityAtMs || subtask.lastActivityAtMs < startOfTodayMs)
  ) {
    return "no_activity_today";
  }

  return null;
};

const getAttentionReasonLabel = (
  reason: AssignmentAttentionReason | null
): string => {
  switch (reason) {
    case "overdue":
      return "Overdue";
    case "due_today":
      return "Due Today";
    case "assigned_7d":
      return "Stale 7d";
    case "no_activity_today":
      return "No Activity";
    default:
      return "Attention";
  }
};

const getAttentionPriority = (
  reason: AssignmentAttentionReason | null
): number => {
  switch (reason) {
    case "overdue":
      return 1;
    case "due_today":
      return 2;
    case "assigned_7d":
      return 3;
    case "no_activity_today":
      return 4;
    default:
      return 99;
  }
};

const getGoalAttentionPriority = (goalId: string): number => {
  const subtasks = subtasksByGoalId[goalId] ?? [];

  return subtasks.reduce((bestPriority, subtask) => {
    const reason = getAttentionReasonForSubtask(subtask);
    return Math.min(bestPriority, getAttentionPriority(reason));
  }, 99);
};

const goalHasAttention = (goalId: string): boolean => {
  return getGoalAttentionPriority(goalId) < 99;
};

const getSortedSubtasksForGoal = (goalId: string) => {
  return [...(subtasksByGoalId[goalId] ?? [])].sort((a, b) => {
    const aPriority = getAttentionPriority(getAttentionReasonForSubtask(a));
    const bPriority = getAttentionPriority(getAttentionReasonForSubtask(b));

    if (aPriority !== bPriority) return aPriority - bPriority;

    return (a.assignedAtMs ?? 0) - (b.assignedAtMs ?? 0);
  });
};

const getAssignmentHealthSignal = (
  memberItem: AssignmentMemberBreakdownItem
): AssignmentHealthSignal => {
  if (memberItem.assignedCount === 0) {
    return "no_work";
  }

  if (memberItem.attentionCount > 0) {
    return "needs_attention";
  }

  if (memberItem.assignedCount >= 5) {
    return "high_load";
  }

  return "healthy";
};

const getAssignmentHealthLabel = (signal: AssignmentHealthSignal): string => {
  switch (signal) {
    case "needs_attention":
      return "Needs attention";
    case "high_load":
      return "High load";
    case "no_work":
      return "No assigned work";
    case "healthy":
    default:
      return "Healthy";
  }
};

const getAssignmentHealthPriority = (signal: AssignmentHealthSignal): number => {
  switch (signal) {
    case "needs_attention":
      return 1;
    case "high_load":
      return 2;
    case "healthy":
      return 3;
    case "no_work":
    default:
      return 4;
  }
};

const getAssignmentMemberBreakdown = (): AssignmentMemberBreakdownItem[] => {
  const byUid: Record<string, AssignmentMemberBreakdownItem> = {};

  sharedGoals.forEach((goal) => {
    const subtasks = subtasksByGoalId[goal.id] ?? [];

    subtasks.forEach((subtask) => {
      if (!subtask.assignedToUid) return;

      const member = members.find((item) => item.uid === subtask.assignedToUid);
      const uid = subtask.assignedToUid;
      const attentionReason = getAttentionReasonForSubtask(subtask);

      if (!byUid[uid]) {
        byUid[uid] = {
          uid,
          displayName:
            subtask.assignedToName ??
            subtask.assignedToEmail ??
            member?.displayName ??
            member?.email ??
            "Unknown member",
          email: subtask.assignedToEmail ?? member?.email ?? null,
          role: member?.role ?? null,
          assignedCount: 0,
          attentionCount: 0,
          tasks: [],
        };
      }

      byUid[uid].assignedCount += 1;

      if (attentionReason) {
        byUid[uid].attentionCount += 1;
      }

      byUid[uid].tasks.push({
        goalId: goal.id,
        goalTitle: goal.title,
        subtask,
      });
    });
  });

  return Object.values(byUid).sort((a, b) => {
    const aHealthPriority = getAssignmentHealthPriority(
      getAssignmentHealthSignal(a)
    );
    const bHealthPriority = getAssignmentHealthPriority(
      getAssignmentHealthSignal(b)
    );

    if (aHealthPriority !== bHealthPriority) {
      return aHealthPriority - bHealthPriority;
    }

    if (b.attentionCount !== a.attentionCount) {
      return b.attentionCount - a.attentionCount;
    }

    return b.assignedCount - a.assignedCount;
  });
};

const getFilteredSharedGoals = () => {
  const filteredGoals =
    assignmentFilter === "assigned"
      ? sharedGoals.filter((goal) => getAssignmentCountForGoal(goal.id) > 0)
      : assignmentFilter === "open"
        ? sharedGoals.filter((goal) => getOpenAssignmentCountForGoal(goal.id) > 0)
        : assignmentFilter === "attention"
          ? sharedGoals.filter((goal) => goalHasAttention(goal.id))
          : sharedGoals;

  return [...filteredGoals].sort((a, b) => {
    const aPriority = getGoalAttentionPriority(a.id);
    const bPriority = getGoalAttentionPriority(b.id);

    if (aPriority !== bPriority) return aPriority - bPriority;

    return (b.sharedAtMs ?? 0) - (a.sharedAtMs ?? 0);
  });
};

  const getRecentActivityForGoal = (goalId: string) => {
    return activityItems.filter((item) => item.goalId === goalId).slice(0, 3);
  };

  const getCommentsForGoal = (goalId: string) => {
  return commentsByGoalId[goalId] ?? [];
};

const getReactionSummaryForComment = (commentId: string) => {
  const reactions = commentReactionsByCommentId[commentId] ?? [];
  const summary: Record<string, number> = {};

  reactions.forEach((reaction) => {
    summary[reaction.emoji] = (summary[reaction.emoji] ?? 0) + 1;
  });

  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
};

const getMyReactionForComment = (commentId: string) => {
  const currentUid = auth.currentUser?.uid;

  if (!currentUid) return null;

  return (
    (commentReactionsByCommentId[commentId] ?? []).find(
      (reaction) => reaction.uid === currentUid
    ) ?? null
  );
};

const handleToggleCommentReaction = async (
  sharedGoal: SharedGoalListItem,
  comment: GroupGoalCommentDoc,
  emoji: string
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!groupId) {
    Alert.alert("Not ready", "Shared goals are not available yet.");
    return;
  }

  const existingReaction = getMyReactionForComment(comment.id);

  try {
    if (existingReaction?.emoji === emoji) {
      await removeGroupGoalCommentReaction({
        groupId,
        goalId: sharedGoal.id,
        commentId: comment.id,
        uid: currentUser.uid,
      });
      return;
    }

    await upsertGroupGoalCommentReaction({
      groupId,
      goalId: sharedGoal.id,
      commentId: comment.id,
      uid: currentUser.uid,
      emoji,
      displayName: currentUser.displayName ?? currentUser.email ?? null,
      email: currentUser.email ?? null,
    });
  } catch (err: any) {
    console.log("[GroupSharedGoals] toggle comment reaction failed", err);
    Alert.alert("Reaction failed", err?.message ?? "Please try again.");
  }
};

const handleGoalCommentInputChange = async (
  sharedGoal: SharedGoalListItem,
  text: string
) => {
  setCommentInputsByGoalId((current) => ({
    ...current,
    [sharedGoal.id]: text,
  }));

  const currentUser = auth.currentUser;
  if (!groupId || !currentUser?.uid) return;

  try {
    if (text.trim()) {
      await upsertGroupGoalTyping({
        groupId,
        goalId: sharedGoal.id,
        uid: currentUser.uid,
        displayName: currentUser.displayName ?? currentUser.email ?? null,
        email: currentUser.email ?? null,
      });
    } else {
      await clearGroupGoalTyping({
        groupId,
        goalId: sharedGoal.id,
        uid: currentUser.uid,
      });
    }
  } catch (err) {
    console.log("[GroupSharedGoals] update typing failed", err);
  }
};

const handleCreateGoalComment = async (sharedGoal: SharedGoalListItem) => {
  const currentUser = auth.currentUser;
  const body = commentInputsByGoalId[sharedGoal.id]?.trim() ?? "";

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!body) {
    Alert.alert("Comment required", "Write a comment first.");
    return;
  }

  if (body.length > COMMENT_MAX_LENGTH) {
    Alert.alert(
      "Comment too long",
      `Comments must be ${COMMENT_MAX_LENGTH} characters or fewer.`
    );
    return;
  }

  try {
    setCommentBusyGoalIds((current) => new Set(current).add(sharedGoal.id));

    await createGroupGoalComment({
      groupId,
      goalId: sharedGoal.id,
      goalTitle: sharedGoal.title,
      body,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName ?? currentUser.email ?? null,
    });

    await clearGroupGoalTyping({
      groupId,
      goalId: sharedGoal.id,
      uid: currentUser.uid,
    }).catch((err) => {
      console.log("[GroupSharedGoals] clear typing failed", err);
    });

    setCommentInputsByGoalId((current) => ({
      ...current,
      [sharedGoal.id]: "",
    }));
  } catch (err: any) {
    console.log("[GroupSharedGoals] create comment failed", err);
    Alert.alert("Comment failed", err?.message ?? "Please try again.");
  } finally {
    setCommentBusyGoalIds((current) => {
      const next = new Set(current);
      next.delete(sharedGoal.id);
      return next;
    });
  }
};

const handleAssignTaskToMember = async (member: GroupMemberDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!assignmentPickerTarget) {
    Alert.alert("No task selected", "Choose a task first.");
    return;
  }

  try {
    setAssigningTask(true);

    await assignSharedGoalSubtaskToMember({
      groupId,
      goalId: assignmentPickerTarget.goalId,
      goalTitle: assignmentPickerTarget.goalTitle,
      subtaskId: assignmentPickerTarget.subtaskId,
      subtaskTitle: assignmentPickerTarget.subtaskTitle,
      assignedToUid: member.uid,
      assignedToName: member.displayName ?? member.email ?? null,
      assignedToEmail: member.email ?? null,
      assignedByUid: currentUser.uid,
      assignedByName: currentUser.displayName ?? currentUser.email ?? null,
    });

    setAssignmentPickerTarget(null);
  } catch (err: any) {
    console.log("[GroupSharedGoals] assign task failed", err);
    Alert.alert("Assign failed", err?.message ?? "Please try again.");
  } finally {
    setAssigningTask(false);
  }
};

const handleUnassignTask = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!assignmentPickerTarget) {
    Alert.alert("No task selected", "Choose a task first.");
    return;
  }

  try {
    setAssigningTask(true);

    await unassignSharedGoalSubtask({
      groupId,
      goalId: assignmentPickerTarget.goalId,
      goalTitle: assignmentPickerTarget.goalTitle,
      subtaskId: assignmentPickerTarget.subtaskId,
      subtaskTitle: assignmentPickerTarget.subtaskTitle,
      unassignedByUid: currentUser.uid,
      unassignedByName: currentUser.displayName ?? currentUser.email ?? null,
    });

    setAssignmentPickerTarget(null);
  } catch (err: any) {
    console.log("[GroupSharedGoals] unassign task failed", err);
    Alert.alert("Unassign failed", err?.message ?? "Please try again.");
  } finally {
    setAssigningTask(false);
  }
};

const handleOpenReportTarget = (target: ReportTarget) => {
  setReportTarget(target);
  setReportReason("other");
  setReportNote("");
};

const handleCloseReportTarget = () => {
  if (reportBusy) return;

  setReportTarget(null);
  setReportReason("other");
  setReportNote("");
};

const handleMessageAssignmentMember = async (
  memberItem: AssignmentMemberBreakdownItem
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!groupId) {
    Alert.alert("Not ready", "Group messaging is not available yet.");
    return;
  }

  if (memberItem.uid === currentUser.uid) {
    Alert.alert("Not available", "You cannot message yourself.");
    return;
  }

  try {
    setMessagingMemberUids((current) => new Set(current).add(memberItem.uid));

    const dmId = await createOrOpenGroupDm({
      groupId,
      actorUid: currentUser.uid,
      actorName: currentUser.displayName ?? currentUser.email ?? null,
      actorEmail: currentUser.email ?? null,
      targetUid: memberItem.uid,
      targetName: memberItem.displayName,
      targetEmail: memberItem.email ?? null,
      subject: `Assignment follow-up with ${memberItem.displayName}`,
    });

    router.push({
      pathname: "/group/[id]/dm/[dmId]",
      params: {
        id: groupId,
        dmId,
      },
    });
  } catch (err: any) {
    console.log("[GroupSharedGoals] open member DM failed", err);
    Alert.alert("Message failed", err?.message ?? "Please try again.");
  } finally {
    setMessagingMemberUids((current) => {
      const next = new Set(current);
      next.delete(memberItem.uid);
      return next;
    });
  }
};

const handleSubmitReport = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || !reportTarget || reportBusy) {
    return;
  }

  try {
    setReportBusy(true);

    await createGroupReport({
      groupId,
      targetType: reportTarget.targetType,
      targetId: reportTarget.targetId,
      goalId: reportTarget.goalId ?? null,
      taskId: reportTarget.taskId ?? null,
      commentId: reportTarget.commentId ?? null,
      activityId: reportTarget.activityId ?? null,
      reason: reportReason,
      note: reportNote,
      targetAuthorUid: reportTarget.targetAuthorUid ?? null,
      targetAuthorName: reportTarget.targetAuthorName ?? null,
      reporterUid: currentUser.uid,
      reporterName: currentUser.displayName ?? currentUser.email ?? null,
      reporterEmail: currentUser.email ?? null,
    });

    Alert.alert(
      "Report submitted",
      "Thanks — moderators can now review this report."
    );

    handleCloseReportTarget();
  } catch (err: any) {
    console.log("[GroupSharedGoals] submit report failed", err);
    Alert.alert("Report failed", err?.message ?? "Please try again.");
  } finally {
    setReportBusy(false);
  }
};

  useEffect(() => {
    if (!groupId) {
      setSharedGoals([]);
      setLoadingSharedGoals(false);
      return;
    }

    setLoadingSharedGoals(true);

    const q = query(
      collection(db, "groups", groupId, "sharedGoals"),
      where("status", "==", "active")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: SharedGoalListItem[] = snap.docs.map((sharedDoc) => {
          const sharedData = sharedDoc.data();

          return {
            id: sharedDoc.id,
            title: sharedData.goalTitle ?? sharedDoc.id,
            description: sharedData.goalDescription ?? null,
            ownerUserId: sharedData.ownerUserId ?? "",
            status: sharedData.status ?? "active",
            sharedAtMs: sharedData.sharedAtMs ?? null,
            goalStatus: sharedData.goalStatus ?? null,
            metricType: sharedData.metricType ?? null,
            metricUnit: sharedData.metricUnit ?? null,
            metricTargetValue:
              typeof sharedData.metricTargetValue === "number"
                ? sharedData.metricTargetValue
                : null,
            currentMetricValue:
              typeof sharedData.currentMetricValue === "number"
                ? sharedData.currentMetricValue
                : null,
            progressPercentage:
              typeof sharedData.progressPercentage === "number"
                ? sharedData.progressPercentage
                : null,
          };
        });

        setSharedGoals(items);
        setLoadingSharedGoals(false);
      },
      (err) => {
        console.log("[GroupSharedGoals] failed loading shared goals", err);
        setLoadingSharedGoals(false);
      }
    );

    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId || sharedGoals.length === 0) {
      setSubtasksByGoalId({});
      return;
    }

    const unsubs = sharedGoals.map((sharedGoal) => {
      const q = query(
        collection(db, "goals", sharedGoal.id, "subtasks"),
        orderBy("createdAtMs", "desc"),
        limit(10)
      );

      return onSnapshot(q, (snap) => {
        const next: SharedGoalSubtaskPreview[] = snap.docs.map((docSnap) => {
          const data = docSnap.data();

          return {
            id: docSnap.id,
            title: data.title ?? "Untitled task",
            assignedToUid:
              typeof data.assignedToUid === "string"
                ? data.assignedToUid
                : null,
            assignedToName:
              typeof data.assignedToName === "string"
                ? data.assignedToName
                : null,
            assignedToEmail:
              typeof data.assignedToEmail === "string"
                ? data.assignedToEmail
                : null,
            assignedAtMs:
              typeof data.assignedAtMs === "number" ? data.assignedAtMs : null,
            dueAtMs: typeof data.dueAtMs === "number" ? data.dueAtMs : null,
            scheduledDayKey:
              typeof data.scheduledDayKey === "string"
                ? data.scheduledDayKey
                : null,
            firstCompletedAtMs:
              typeof data.firstCompletedAtMs === "number"
                ? data.firstCompletedAtMs
                : null,
            lastCompletedAtMs:
              typeof data.lastCompletedAtMs === "number"
                ? data.lastCompletedAtMs
                : null,
            lastActivityAtMs:
              typeof data.lastActivityAtMs === "number"
                ? data.lastActivityAtMs
                : null,
          };
        });

        setSubtasksByGoalId((current) => ({
          ...current,
          [sharedGoal.id]: next,
        }));
      });
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [groupId, sharedGoals]);

  useEffect(() => {
    if (!groupId) {
      setActivityItems([]);
      return;
    }

    const q = query(
      collection(db, "groups", groupId, "activity"),
      orderBy("createdAtMs", "desc"),
      limit(25)
    );

    const unsub = onSnapshot(q, (snap) => {
      const next: GroupActivityDoc[] = snap.docs.map((docSnap) => {
        const data = docSnap.data();

        return {
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          type: data.type ?? "goal_shared",
          actorUid: data.actorUid ?? "",
          actorName: data.actorName ?? null,
          message: data.message ?? "",
          goalId: data.goalId ?? null,
          goalTitle: data.goalTitle ?? null,
          targetUid: data.targetUid ?? null,
          targetEmail: data.targetEmail ?? null,
          createdAtMs:
            typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
          taskId: data.taskId ?? null,
          taskTitle: data.taskTitle ?? null,
        };
      });

      setActivityItems(next);
    });

    return unsub;
  }, [groupId]);

  useEffect(() => {
  if (!groupId || sharedGoals.length === 0) {
    setCommentsByGoalId({});
    return;
  }

  const unsubs = sharedGoals.map((sharedGoal) =>
    subscribeGroupGoalComments(
      groupId,
      sharedGoal.id,
      (comments) => {
        setCommentsByGoalId((current) => ({
          ...current,
          [sharedGoal.id]: comments,
        }));
      },
      (err) => {
        console.log("[GroupSharedGoals] failed loading comments", {
          goalId: sharedGoal.id,
          err,
        });
      }
    )
  );

  return () => unsubs.forEach((unsub) => unsub());
}, [groupId, sharedGoals]);

useEffect(() => {
  if (!groupId || sharedGoals.length === 0) {
    setTypingByGoalId({});
    return;
  }

  const unsubs = sharedGoals.map((sharedGoal) =>
    subscribeGroupGoalTyping(
      groupId,
      sharedGoal.id,
      (typing) => {
        const currentUid = auth.currentUser?.uid;

        setTypingByGoalId((current) => ({
          ...current,
          [sharedGoal.id]: typing.filter((item) => item.uid !== currentUid),
        }));
      },
      (err) => {
        console.log("[GroupSharedGoals] failed loading typing", {
          goalId: sharedGoal.id,
          err,
        });
      }
    )
  );

  return () => unsubs.forEach((unsub) => unsub());
}, [groupId, sharedGoals]);

useEffect(() => {
  if (!groupId || Object.keys(commentsByGoalId).length === 0) {
    setCommentReactionsByCommentId({});
    return;
  }

  const commentTargets = Object.entries(commentsByGoalId).flatMap(
    ([goalId, comments]) =>
      comments.map((comment) => ({
        goalId,
        commentId: comment.id,
      }))
  );

  if (commentTargets.length === 0) {
    setCommentReactionsByCommentId({});
    return;
  }

  const unsubs = commentTargets.map(({ goalId, commentId }) =>
    subscribeGroupGoalCommentReactions(
      groupId,
      goalId,
      commentId,
      (reactions) => {
        setCommentReactionsByCommentId((current) => ({
          ...current,
          [commentId]: reactions,
        }));
      },
      (err) => {
        console.log("[GroupSharedGoals] failed loading comment reactions", {
          goalId,
          commentId,
          err,
        });
      }
    )
  );

  return () => unsubs.forEach((unsub) => unsub());
}, [groupId, commentsByGoalId]);

useEffect(() => {
  if (!groupId) {
    setMembers([]);
    return;
  }

  const unsub = subscribeGroupMembers(
    groupId,
    (items) => {
      setMembers(items.filter((member) => member.status === "active"));
    },
    (err) => {
      console.log("[GroupSharedGoals] failed loading members", err);
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
        <Text style={styles.title}>Shared goals</Text>
        <Text style={styles.subtitle}>
          Collaborate on assignments, progress, discussion, and shared planning.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>
          {sharedGoals.length} shared goal{sharedGoals.length === 1 ? "" : "s"}
        </Text>

        <Text style={styles.summaryText}>
          {getTotalAssignedTaskCount()} assigned task
          {getTotalAssignedTaskCount() === 1 ? "" : "s"} ·{" "}
          {getTotalOpenTaskCount()} open · {getTotalAttentionTaskCount()} attention
        </Text>

        <View style={styles.assignmentFilterRow}>
          <Pressable
            style={[
              styles.assignmentFilterChip,
              assignmentFilter === "all" && styles.assignmentFilterChipActive,
            ]}
            onPress={() => setAssignmentFilter("all")}
          >
            <Text
              style={[
                styles.assignmentFilterChipText,
                assignmentFilter === "all" && styles.assignmentFilterChipTextActive,
              ]}
            >
              All
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.assignmentFilterChip,
              assignmentFilter === "assigned" && styles.assignmentFilterChipActive,
            ]}
            onPress={() => setAssignmentFilter("assigned")}
          >
            <Text
              style={[
                styles.assignmentFilterChipText,
                assignmentFilter === "assigned" &&
                  styles.assignmentFilterChipTextActive,
              ]}
            >
              Assigned
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.assignmentFilterChip,
              assignmentFilter === "open" && styles.assignmentFilterChipActive,
            ]}
            onPress={() => setAssignmentFilter("open")}
          >
            <Text
              style={[
                styles.assignmentFilterChipText,
                assignmentFilter === "open" && styles.assignmentFilterChipTextActive,
              ]}
            >
              Open
            </Text>
          </Pressable>
                    <Pressable
            style={[
              styles.assignmentFilterChip,
              assignmentFilter === "attention" &&
                styles.assignmentFilterChipActive,
            ]}
            onPress={() => setAssignmentFilter("attention")}
          >
            <Text
              style={[
                styles.assignmentFilterChipText,
                assignmentFilter === "attention" &&
                  styles.assignmentFilterChipTextActive,
              ]}
            >
              Attention
            </Text>
          </Pressable>
        </View>
      </View>

            <View style={styles.memberBreakdownCard}>
        <Text style={styles.memberBreakdownTitle}>Member breakdown</Text>
        <Text style={styles.memberBreakdownSubtitle}>
          Health signals sort members by attention, workload, and assignment balance.
        </Text>

        {getAssignmentMemberBreakdown().length === 0 ? (
          <Text style={styles.helperText}>
            No assigned member work yet. Assign tasks from a shared goal to start seeing member health signals here.
          </Text>
        ) : (
          getAssignmentMemberBreakdown().map((memberItem) => {
            const expanded = expandedAssignmentMemberUids.has(memberItem.uid);
            const healthSignal = getAssignmentHealthSignal(memberItem);

            return (
              <View key={memberItem.uid} style={styles.memberBreakdownRow}>
                <Pressable
                  style={styles.memberBreakdownHeader}
                  onPress={() => toggleAssignmentMemberExpanded(memberItem.uid)}
                >
                  <View style={styles.memberBreakdownAvatar}>
                    <Text style={styles.memberBreakdownAvatarText}>
                      {memberItem.displayName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.memberBreakdownMain}>
                    <Text style={styles.memberBreakdownName} numberOfLines={1}>
                      {memberItem.displayName}
                    </Text>

                    <Text
                      style={[
                        styles.memberHealthPill,
                        healthSignal === "needs_attention" &&
                          styles.memberHealthPillWarning,
                        healthSignal === "high_load" &&
                          styles.memberHealthPillMuted,
                      ]}
                    >
                      {getAssignmentHealthLabel(healthSignal)}
                    </Text>
                  </View>

                  <Text style={styles.memberBreakdownToggle}>
                    {expanded ? "Hide" : "Show"}
                  </Text>
                </Pressable>

                {expanded ? (
                  <View style={styles.memberBreakdownTasks}>
                    <Pressable
                      style={[
                        styles.memberBreakdownMessageButton,
                        messagingMemberUids.has(memberItem.uid) &&
                          styles.buttonDisabled,
                      ]}
                      onPress={() => handleMessageAssignmentMember(memberItem)}
                      disabled={messagingMemberUids.has(memberItem.uid)}
                    >
                      <Text style={styles.memberBreakdownMessageButtonText}>
                        {messagingMemberUids.has(memberItem.uid)
                          ? "Opening..."
                          : "Message"}
                      </Text>
                    </Pressable>

                                        {memberItem.tasks
                      .slice(0, MEMBER_BREAKDOWN_VISIBLE_TASK_LIMIT)
                      .map(({ goalId, goalTitle, subtask }) => {
                      const attentionReason = getAttentionReasonForSubtask(subtask);

                      return (
                        <View
                          key={`${goalId}:${subtask.id}`}
                          style={styles.memberBreakdownTaskRow}
                        >
                          <View style={styles.memberBreakdownTaskMain}>
                            <Text
                              style={styles.memberBreakdownTaskTitle}
                              numberOfLines={1}
                            >
                              {subtask.title}
                            </Text>

                            <Text
                              style={styles.memberBreakdownTaskMeta}
                              numberOfLines={1}
                            >
                              {goalTitle}
                            </Text>

                            {attentionReason ? (
                              <Text style={styles.memberBreakdownAttentionPill}>
                                {getAttentionReasonLabel(attentionReason)}
                              </Text>
                            ) : null}
                          </View>

                          <View style={styles.memberBreakdownTaskActions}>
                            <Pressable
                              style={styles.memberBreakdownTaskActionButton}
                              onPress={() =>
                                router.push({
                                  pathname: "/goal/[id]",
                                  params: {
                                    id: goalId,
                                    highlightSubtaskId: subtask.id,
                                  },
                                })
                              }
                            >
                              <Text style={styles.memberBreakdownTaskActionText}>
                                View
                              </Text>
                            </Pressable>

                            <Pressable
                              style={styles.memberBreakdownTaskActionButton}
                              onPress={() =>
                                setAssignmentPickerTarget({
                                  goalId,
                                  goalTitle,
                                  subtaskId: subtask.id,
                                  subtaskTitle: subtask.title,
                                })
                              }
                            >
                              <Text style={styles.memberBreakdownTaskActionText}>
                                Reassign
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                                        {memberItem.tasks.length > MEMBER_BREAKDOWN_VISIBLE_TASK_LIMIT ? (
                      <Text style={styles.memberBreakdownMoreText}>
                        +{memberItem.tasks.length - MEMBER_BREAKDOWN_VISIBLE_TASK_LIMIT} more assigned task
                        {memberItem.tasks.length - MEMBER_BREAKDOWN_VISIBLE_TASK_LIMIT === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {loadingSharedGoals ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading shared goals...</Text>
        </View>
      ) : sharedGoals.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No shared goals yet</Text>
          <Text style={styles.helperText}>
            Goals shared with this group will appear here.
          </Text>
        </View>
      ) : (
        getFilteredSharedGoals().length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.helperText}>
              No shared goals match this oversight filter.
            </Text>
          </View>
        ) : (
          getFilteredSharedGoals().map((sharedGoal) => {
          const expanded = expandedGoalIds.has(sharedGoal.id);
          const subtasks = subtasksByGoalId[sharedGoal.id] ?? [];
          const activity = getRecentActivityForGoal(sharedGoal.id);

          const assignmentsExpanded = isGoalSectionExpanded(
  sharedGoal.id,
  "assignments"
);
const activityExpanded = isGoalSectionExpanded(sharedGoal.id, "activity");
const discussionExpanded = isGoalSectionExpanded(
  sharedGoal.id,
  "discussion"
);
const comments = getCommentsForGoal(sharedGoal.id);

          return (
            <View key={sharedGoal.id} style={styles.goalCard}>
              <Pressable
                style={styles.goalHeader}
                onPress={() => toggleGoalExpanded(sharedGoal.id)}
              >
                <View style={styles.goalHeaderText}>
                  <Text style={styles.goalTitle}>{sharedGoal.title}</Text>

                  {!!sharedGoal.description ? (
                    <Text style={styles.goalDescription} numberOfLines={2}>
                      {sharedGoal.description}
                    </Text>
                  ) : null}

                  <View style={styles.goalMetaRow}>
                    <Text style={styles.statusPill}>
                      {sharedGoal.goalStatus ?? "active"}
                    </Text>

                    <Text style={styles.goalMetaText}>
                      {formatSharedGoalProgress(sharedGoal)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.toggleText}>
                  {expanded ? "Hide" : "Show"}
                </Text>
              </Pressable>

              {expanded ? (
                <View style={styles.goalBody}>
                  <Pressable
                    style={styles.openGoalButton}
                    onPress={() =>
                      router.push({
                        pathname: "/goal/[id]",
                        params: { id: sharedGoal.id },
                      })
                    }
                  >
                    <Text style={styles.openGoalButtonText}>
                      Open goal →
                    </Text>
                  </Pressable>

<View style={styles.sectionBox}>
  <Pressable
    style={styles.innerSectionHeader}
    onPress={() => toggleGoalSection(sharedGoal.id, "assignments")}
  >
    <View style={styles.innerSectionTextWrap}>
      <Text style={styles.sectionTitle}>Task assignments</Text>
      <Text style={styles.innerSectionSubtitle}>
        {getAssignmentCountForGoal(sharedGoal.id)}/{subtasks.length} assigned
      </Text>
    </View>

    <Text style={styles.innerSectionToggle}>
      {assignmentsExpanded ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {assignmentsExpanded ? (
    <View style={styles.innerSectionBody}>

                    {subtasks.length === 0 ? (
                      <Text style={styles.helperText}>
                        No tasks found for this shared goal yet.
                      </Text>
                    ) : (
                                           getSortedSubtasksForGoal(sharedGoal.id)
                        .slice(0, SHARED_GOAL_VISIBLE_TASK_LIMIT)
                        .map((subtask) => {
                        const assignedLabel =
                          subtask.assignedToName ??
                          subtask.assignedToEmail ??
                          "Unassigned";

                        return (
<View key={subtask.id} style={styles.subtaskRow}>
  <View style={styles.subtaskMain}>
    <Text style={styles.subtaskTitle} numberOfLines={1}>
      {subtask.title}
    </Text>

    <Text style={styles.subtaskMeta} numberOfLines={1}>
      {subtask.assignedToUid
        ? `Assigned to ${assignedLabel}`
        : "Unassigned"}
    </Text>

    {getAttentionReasonForSubtask(subtask) ? (
      <Text style={styles.subtaskAttentionPill}>
        {getAttentionReasonLabel(getAttentionReasonForSubtask(subtask))}
      </Text>
    ) : null}
  </View>

  <Pressable
    style={styles.assignmentButton}
    onPress={() =>
      setAssignmentPickerTarget({
        goalId: sharedGoal.id,
        goalTitle: sharedGoal.title,
        subtaskId: subtask.id,
        subtaskTitle: subtask.title,
      })
    }
  >
    <Text style={styles.assignmentButtonText}>
      {subtask.assignedToUid ? "Reassign" : "Assign"}
    </Text>
  </Pressable>
</View>
                        );
                       })

                    )}
                    {subtasks.length > SHARED_GOAL_VISIBLE_TASK_LIMIT ? (
                      <Text style={styles.assignmentMoreText}>
                        Showing {SHARED_GOAL_VISIBLE_TASK_LIMIT} of {subtasks.length} tasks.
                      </Text>
                    ) : null}
                      </View>
  ) : null}
</View>

                  <View style={styles.sectionBox}>
  <Pressable
    style={styles.innerSectionHeader}
    onPress={() => toggleGoalSection(sharedGoal.id, "activity")}
  >
    <View style={styles.innerSectionTextWrap}>
      <Text style={styles.sectionTitle}>Recent activity</Text>
      <Text style={styles.innerSectionSubtitle}>
        {activity.length === 0
          ? "No recent activity"
          : `${activity.length} recent update${activity.length === 1 ? "" : "s"}`}
      </Text>
    </View>

    <Text style={styles.innerSectionToggle}>
      {activityExpanded ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {activityExpanded ? (
    <View style={styles.innerSectionBody}>
      <Pressable
        onPress={() => router.push(`/group/${groupId}/activity`)}
        style={styles.innerSectionLinkButton}
      >
        <Text style={styles.sectionLink}>View all activity →</Text>
      </Pressable>

                    {activity.length === 0 ? (
                      <Text style={styles.helperText}>
                        No recent activity for this goal yet.
                      </Text>
                    ) : (
                      activity.map((item) => (
                        <View key={item.id} style={styles.activityRow}>
                          <Text style={styles.activityIcon}>
                            {getActivityIcon(item.type)}
                          </Text>

                          <View style={styles.activityBody}>
                            <Text style={styles.activityText} numberOfLines={2}>
                              <Text style={styles.activityActor}>
                                {item.actorName ?? "Someone"}
                              </Text>{" "}
                              {item.message}
                            </Text>

                            <Text style={styles.activityMeta}>
                              {formatRelativeTime(item.createdAtMs)}
                            </Text>
                            <Pressable
  style={styles.reportInlineButton}
  onPress={() =>
    handleOpenReportTarget({
      targetType: "activity",
      targetId: item.id,
      activityId: item.id,
      goalId: item.goalId ?? null,
      taskId: item.taskId ?? null,
      previewTitle: "Group activity",
      previewBody: item.message,
      targetAuthorUid: item.actorUid ?? null,
      targetAuthorName: item.actorName ?? null,
    })
  }
>
  <Text style={styles.reportInlineButtonText}>Report</Text>
</Pressable>
                          </View>
                        </View>
                      ))
                    )}
                      </View>
  ) : null}
</View>
<View style={styles.sectionBox}>
  <Pressable
    style={styles.innerSectionHeader}
    onPress={() => toggleGoalSection(sharedGoal.id, "discussion")}
  >
    <View style={styles.innerSectionTextWrap}>
      <Text style={styles.sectionTitle}>Discussion</Text>
      <Text style={styles.innerSectionSubtitle}>
        {comments.length} comment{comments.length === 1 ? "" : "s"}
      </Text>
    </View>

    <Text style={styles.innerSectionToggle}>
      {discussionExpanded ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {discussionExpanded ? (
    <View style={styles.innerSectionBody}>

  {comments.length === 0 ? (
    <Text style={styles.helperText}>
      No comments yet. Start the discussion below.
    </Text>
  ) : (
   comments.map((comment) => (
      <View key={comment.id} style={styles.commentRow}>
        <Text style={styles.commentAuthor}>
          {comment.authorName ?? "Someone"}
        </Text>

        <Text style={styles.commentBody}>{comment.body}</Text>

        <Text style={styles.commentMeta}>
          {formatRelativeTime(comment.createdAtMs)}
        </Text>
        <Pressable
  style={styles.reportInlineButton}
  onPress={() =>
    handleOpenReportTarget({
      targetType: "goal_comment",
      targetId: comment.id,
      goalId: sharedGoal.id,
      commentId: comment.id,
      previewTitle: `Comment on ${sharedGoal.title}`,
      previewBody: comment.body,
      targetAuthorUid: comment.authorUid ?? null,
      targetAuthorName: comment.authorName ?? null,
    })
  }
>
  <Text style={styles.reportInlineButtonText}>Report</Text>
</Pressable>
        <View style={styles.commentQuickReactionRow}>
  {QUICK_COMMENT_REACTIONS.map((emoji) => {
    const active = getMyReactionForComment(comment.id)?.emoji === emoji;

    return (
      <Pressable
        key={emoji}
        style={[
          styles.commentQuickReactionButton,
          active && styles.commentQuickReactionButtonActive,
        ]}
        onPress={() =>
          handleToggleCommentReaction(sharedGoal, comment, emoji)
        }
      >
        <Text style={styles.commentQuickReactionText}>{emoji}</Text>
      </Pressable>
    );
  })}
</View>

{getReactionSummaryForComment(comment.id).length > 0 ? (
  <View style={styles.commentReactionRow}>
    {getReactionSummaryForComment(comment.id).map(([emoji, count]) => (
      <View key={emoji} style={styles.commentReactionChip}>
        <Text style={styles.commentReactionText}>
          {emoji} {count}
        </Text>
      </View>
    ))}
  </View>
) : null}
      </View>
    ))
  )}

  {(typingByGoalId[sharedGoal.id] ?? []).length > 0 ? (
    <Text style={styles.typingText}>
      {(typingByGoalId[sharedGoal.id] ?? [])[0].displayName ??
        (typingByGoalId[sharedGoal.id] ?? [])[0].email ??
        "Someone"}{" "}
      is typing…
    </Text>
  ) : null}

  <View style={styles.commentComposer}>
    <TextInput
      value={commentInputsByGoalId[sharedGoal.id] ?? ""}
      onChangeText={(text) =>
        handleGoalCommentInputChange(sharedGoal, text)
      }
      maxLength={COMMENT_MAX_LENGTH}
      placeholder="Add a comment..."
      placeholderTextColor={theme.colors.textMuted}
      style={styles.commentInput}
      multiline
    />

    <Text style={styles.commentLengthText}>
      {(commentInputsByGoalId[sharedGoal.id] ?? "").length}/
      {COMMENT_MAX_LENGTH}
    </Text>

    <Pressable
      style={[
        styles.commentButton,
        commentBusyGoalIds.has(sharedGoal.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleCreateGoalComment(sharedGoal)}
      disabled={commentBusyGoalIds.has(sharedGoal.id)}
    >
      <Text style={styles.commentButtonText}>
        {commentBusyGoalIds.has(sharedGoal.id) ? "Posting..." : "Post"}
      </Text>
    </Pressable>
  </View>
      </View>
  ) : null}
</View>
                </View>
              ) : null}
            </View>
                   );
        })
        )
      )}
      <Modal
  visible={!!reportTarget}
  transparent
  animationType="fade"
  onRequestClose={handleCloseReportTarget}
>
  <Pressable style={styles.assignmentModalBackdrop} onPress={handleCloseReportTarget}>
    <Pressable style={styles.assignmentModalCard} onPress={() => {}}>
      <Text style={styles.assignmentModalTitle}>Report content</Text>

      <Text style={styles.helperText}>
        Reports help moderators review content that may need attention.
      </Text>

      {reportTarget ? (
        <View style={styles.reportPreviewBox}>
          <Text style={styles.reportPreviewTitle}>{reportTarget.previewTitle}</Text>
          {!!reportTarget.previewBody ? (
            <Text style={styles.reportPreviewBody} numberOfLines={3}>
              {reportTarget.previewBody}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.inputLabel}>Reason</Text>

      <View style={styles.reportReasonGrid}>
        {([
          ["spam", "Spam"],
          ["harassment", "Harassment"],
          ["inappropriate", "Inappropriate"],
          ["misleading", "Misleading"],
          ["other", "Other"],
        ] as Array<[GroupReportReason, string]>).map(([reason, label]) => {
          const active = reportReason === reason;

          return (
            <Pressable
              key={reason}
              style={[styles.reportReasonChip, active && styles.reportReasonChipActive]}
              onPress={() => setReportReason(reason)}
              disabled={reportBusy}
            >
              <Text
                style={[
                  styles.reportReasonChipText,
                  active && styles.reportReasonChipTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.inputLabel}>Optional note</Text>

      <TextInput
        value={reportNote}
        onChangeText={setReportNote}
        placeholder="Add context for moderators..."
        placeholderTextColor={theme.colors.textMuted}
        style={styles.reportNoteInput}
        multiline
        maxLength={500}
        editable={!reportBusy}
      />

      <Text style={styles.commentLengthText}>{reportNote.length}/500</Text>

      <Pressable
        style={[styles.commentButton, reportBusy && styles.buttonDisabled]}
        disabled={reportBusy}
        onPress={handleSubmitReport}
      >
        <Text style={styles.commentButtonText}>
          {reportBusy ? "Submitting..." : "Submit report"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.assignmentModalCancelButton}
        onPress={handleCloseReportTarget}
        disabled={reportBusy}
      >
        <Text style={styles.assignmentModalCancelText}>Cancel</Text>
      </Pressable>
    </Pressable>
  </Pressable>
</Modal>

<Modal
  visible={!!assignmentPickerTarget}
  transparent
  animationType="fade"
  onRequestClose={() => setAssignmentPickerTarget(null)}
>
  <Pressable
    style={styles.assignmentModalBackdrop}
    onPress={() => setAssignmentPickerTarget(null)}
  >
    <Pressable style={styles.assignmentModalCard} onPress={() => {}}>
      <Text style={styles.assignmentModalTitle}>Assign task</Text>

      {assignmentPickerTarget ? (
        <>
          <Text style={styles.assignmentModalTaskTitle}>
            {assignmentPickerTarget.subtaskTitle}
          </Text>
          <Text style={styles.assignmentModalMeta}>
            From {assignmentPickerTarget.goalTitle}
          </Text>
        </>
      ) : null}

      <Text style={styles.assignmentModalSectionTitle}>Choose a member</Text>

      <ScrollView
        style={styles.assignmentModalList}
        contentContainerStyle={styles.assignmentModalListContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {members.length === 0 ? (
          <Text style={styles.assignmentEmptyText}>
            No members available for assignment.
          </Text>
        ) : (
          members.map((member) => {
            const alreadyAssigned =
              member.uid ===
              (subtasksByGoalId[assignmentPickerTarget?.goalId ?? ""] ?? []).find(
                (s) => s.id === assignmentPickerTarget?.subtaskId
              )?.assignedToUid;

            return (
              <Pressable
                key={member.uid}
                style={[
                  styles.assignmentMemberOption,
                  assigningTask && styles.buttonDisabled,
                  alreadyAssigned && styles.assignmentMemberOptionAssigned,
                ]}
                onPress={() => handleAssignTaskToMember(member)}
                disabled={assigningTask || alreadyAssigned}
              >
                <View style={styles.assignmentMemberAvatar}>
                  <Text style={styles.assignmentMemberAvatarText}>
                    {(member.displayName ?? member.email ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.assignmentMemberInfo}>
                  <Text style={styles.assignmentMemberName}>
                    {member.displayName ?? member.email ?? member.uid}
                  </Text>
                  <Text style={styles.assignmentMemberMeta}>
                    {member.email ? `${member.email} · ${member.role}` : member.role}
                  </Text>
                </View>

                <Text style={styles.assignmentMemberAction}>
                  {alreadyAssigned ? "Assigned" : assigningTask ? "Assigning..." : "Select"}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Pressable
        style={[styles.assignmentModalUnassignButton, assigningTask && styles.buttonDisabled]}
        onPress={handleUnassignTask}
        disabled={assigningTask}
      >
        <Text style={styles.assignmentModalUnassignText}>Unassign task</Text>
      </Pressable>

      <Pressable
        style={styles.assignmentModalCancelButton}
        onPress={() => setAssignmentPickerTarget(null)}
        disabled={assigningTask}
      >
        <Text style={styles.assignmentModalCancelText}>Cancel</Text>
      </Pressable>
    </Pressable>
  </Pressable>
</Modal>
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
      borderRadius: 20,
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
      borderRadius: 20,
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
      fontSize: 13,
    },
    goalCard: {
      padding: 16,
      borderRadius: 22,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: 12,
    },
    goalHeader: {
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      justifyContent: "space-between",
    },
    goalHeaderText: {
      flex: 1,
      minWidth: 0,
    },
    goalTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "900",
    },
    goalDescription: {
      color: theme.colors.textMuted,
      marginTop: 5,
      lineHeight: 19,
      fontSize: 13,
    },
    goalMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    statusPill: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 9,
      paddingVertical: 4,
      fontSize: 11,
      fontWeight: "900",
    },
    goalMetaText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
    },
    toggleText: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 12,
      paddingVertical: 7,
      fontSize: 12,
      fontWeight: "900",
    },
    goalBody: {
  marginTop: 12,
  gap: 10,
},
    openGoalButton: {
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: "center",
      backgroundColor: theme.colors.primary,
    },
    openGoalButtonText: {
      color: theme.colors.primaryText,
      fontSize: 13,
      fontWeight: "900",
    },
   sectionBox: {
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 8,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "900",
      marginBottom: 8,
    },
    sectionLink: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    subtaskRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},
    subtaskTitle: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "900",
    },
    subtaskMeta: {
      color: theme.colors.textMuted,
      marginTop: 3,
      fontSize: 12,
      fontWeight: "700",
    },
    activityRow: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 9,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    activityIcon: {
      width: 24,
      fontSize: 16,
    },
    activityBody: {
      flex: 1,
      minWidth: 0,
    },
    activityText: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 18,
    },
    activityActor: {
      fontWeight: "900",
    },
    activityMeta: {
      color: theme.colors.textMuted,
      marginTop: 3,
      fontSize: 11,
      fontWeight: "800",
    },
    commentRow: {
  paddingVertical: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

commentAuthor: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

commentBody: {
  color: theme.colors.text,
  marginTop: 4,
  fontSize: 13,
  lineHeight: 19,
},

commentMeta: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 11,
  fontWeight: "800",
},

typingText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 8,
},

commentComposer: {
  marginTop: 12,
  gap: 8,
},

commentInput: {
  minHeight: 64,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  backgroundColor: theme.colors.surface,
  color: theme.colors.text,
  paddingHorizontal: 12,
  paddingVertical: 9,
  textAlignVertical: "top",
},

commentLengthText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  textAlign: "right",
},

commentButton: {
  paddingVertical: 11,
  borderRadius: 14,
  alignItems: "center",
  backgroundColor: theme.colors.primary,
},

commentButtonText: {
  color: theme.colors.primaryText,
  fontSize: 13,
  fontWeight: "900",
},

buttonDisabled: {
  opacity: 0.5,
},
commentQuickReactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
},

commentQuickReactionButton: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

commentQuickReactionButtonActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

commentQuickReactionText: {
  fontSize: 16,
},

commentReactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
},

commentReactionChip: {
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

commentReactionText: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "800",
},
subtaskMain: {
  flex: 1,
  minWidth: 0,
},

assignmentButton: {
  flexShrink: 0,
  paddingHorizontal: 11,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

assignmentButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

assignmentModalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  justifyContent: "center",
  padding: 18,
},

assignmentModalCard: {
  maxHeight: "82%",
  borderRadius: 22,
  padding: 18,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

assignmentModalTitle: {
  color: theme.colors.text,
  fontSize: 20,
  fontWeight: "900",
},

assignmentModalTaskTitle: {
  color: theme.colors.text,
  marginTop: 10,
  fontSize: 15,
  fontWeight: "900",
},

assignmentModalMeta: {
  color: theme.colors.textMuted,
  marginTop: 3,
  fontSize: 12,
  fontWeight: "700",
},

assignmentModalSectionTitle: {
  color: theme.colors.text,
  marginTop: 16,
  marginBottom: 8,
  fontSize: 13,
  fontWeight: "900",
},

assignmentModalList: {
  maxHeight: 320,
},

assignmentModalListContent: {
  gap: 8,
  paddingBottom: 8,
},

assignmentEmptyText: {
  color: theme.colors.textMuted,
  lineHeight: 20,
},

assignmentMemberOption: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

assignmentMemberOptionAssigned: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

assignmentMemberAvatar: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.badge,
},

assignmentMemberAvatarText: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
},

assignmentMemberInfo: {
  flex: 1,
  minWidth: 0,
},

assignmentMemberName: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

assignmentMemberMeta: {
  color: theme.colors.textMuted,
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
},

assignmentMemberAction: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

assignmentModalUnassignButton: {
  marginTop: 12,
  paddingVertical: 11,
  borderRadius: 14,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.danger,
  borderWidth: 1,
},

assignmentModalUnassignText: {
  color: theme.colors.danger,
  fontSize: 13,
  fontWeight: "900",
},

assignmentModalCancelButton: {
  marginTop: 10,
  paddingVertical: 11,
  borderRadius: 14,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

assignmentModalCancelText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  fontWeight: "900",
},
reportInlineButton: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

reportInlineButtonText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
},

reportPreviewBox: {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

reportPreviewTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

reportPreviewBody: {
  color: theme.colors.textMuted,
  marginTop: 5,
  fontSize: 12,
  lineHeight: 18,
},

inputLabel: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
  marginTop: 12,
  marginBottom: 6,
},

reportReasonGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

reportReasonChip: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

reportReasonChipActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

reportReasonChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

reportReasonChipTextActive: {
  color: theme.colors.primary,
},

reportNoteInput: {
  minHeight: 86,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  color: theme.colors.text,
  paddingHorizontal: 12,
  paddingVertical: 10,
  textAlignVertical: "top",
},
innerSectionHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},

innerSectionTextWrap: {
  flex: 1,
  minWidth: 0,
},

innerSectionSubtitle: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 2,
},

innerSectionToggle: {
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  borderRadius: 999,
  overflow: "hidden",
  paddingHorizontal: 10,
  paddingVertical: 6,
  fontSize: 11,
  fontWeight: "900",
},

innerSectionBody: {
  marginTop: 10,
},

innerSectionLinkButton: {
  alignSelf: "flex-start",
  marginBottom: 8,
},
    assignmentFilterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    assignmentFilterChip: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    assignmentFilterChipActive: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    assignmentFilterChipText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
    },
    assignmentFilterChipTextActive: {
      color: theme.colors.primary,
    },
        memberBreakdownCard: {
      padding: 16,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
    },
    memberBreakdownTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "900",
    },
    memberBreakdownSubtitle: {
      color: theme.colors.textMuted,
      marginTop: 4,
      marginBottom: 10,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    memberBreakdownRow: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingVertical: 10,
    },
    memberBreakdownHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    memberBreakdownAvatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
    },
    memberBreakdownAvatarText: {
      color: theme.colors.primary,
      fontSize: 13,
      fontWeight: "900",
    },
    memberBreakdownMain: {
      flex: 1,
      minWidth: 0,
    },
    memberBreakdownName: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "900",
    },
    memberBreakdownMeta: {
      color: theme.colors.textMuted,
      marginTop: 2,
      fontSize: 11,
      fontWeight: "800",
    },
    memberBreakdownToggle: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 11,
      fontWeight: "900",
    },
    memberBreakdownTasks: {
      marginTop: 10,
      gap: 8,
    },
    memberBreakdownTaskRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 10,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    memberBreakdownTaskMain: {
      flex: 1,
      minWidth: 0,
    },
    memberBreakdownTaskTitle: {
      color: theme.colors.text,
      fontSize: 12,
      fontWeight: "900",
    },
    memberBreakdownTaskMeta: {
      color: theme.colors.textMuted,
      marginTop: 2,
      fontSize: 11,
      fontWeight: "700",
    },
    memberBreakdownAttentionPill: {
      color: theme.colors.danger,
      borderColor: theme.colors.danger,
      borderWidth: 1,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "900",
    },
        subtaskAttentionPill: {
      alignSelf: "flex-start",
      color: theme.colors.danger,
      borderColor: theme.colors.danger,
      borderWidth: 1,
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginTop: 6,
      fontSize: 10,
      fontWeight: "900",
    },
        memberBreakdownMessageButton: {
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.primary,
    },
    memberBreakdownMessageButtonText: {
      color: theme.colors.primaryText,
      fontSize: 12,
      fontWeight: "900",
    },
        memberBreakdownTaskActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      gap: 6,
    },
    memberBreakdownTaskActionButton: {
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },
    memberBreakdownTaskActionText: {
      color: theme.colors.primary,
      fontSize: 11,
      fontWeight: "900",
    },
        memberHealthPill: {
      alignSelf: "flex-start",
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: "hidden",
      color: theme.colors.success,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.success,
      borderWidth: 1,
      fontSize: 10,
      fontWeight: "900",
    },
    memberHealthPillWarning: {
      color: theme.colors.danger,
      borderColor: theme.colors.danger,
    },
    memberHealthPillMuted: {
      color: theme.colors.textMuted,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
        memberBreakdownMoreText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 2,
    },
        assignmentMoreText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 8,
    },
  });