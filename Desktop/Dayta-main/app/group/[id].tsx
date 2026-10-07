import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,

  where,
} from "firebase/firestore";
import { DateTime } from "luxon";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  findNodeHandle,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { MediaAttachmentGrid } from "../../components/MediaAttachmentGrid";
import { GroupCalendarEventCard } from "../../components/groupCalendar/GroupCalendarEventCard";
import { MediaAttachmentViewer } from "../../components/media/MediaAttachmentViewer";
import {
  archivePlanningBoard,
  createPlanningBoard,
  subscribeGroupPlanningBoards,
  type PlanningBoardDoc,
} from "../../services/boards";
import { auth, db } from "../../services/firebase";
import {
  canCreateGroupCalendarEvent,
  subscribeUpcomingGroupCalendarEvents,
  type GroupCalendarEventDoc,
} from "../../services/groupCalendar";
import {
  subscribeGroupRoutineOccurrencesForRange,
  type GroupRoutineOccurrenceDoc,
} from "../../services/groupRoutineOccurrences";
import {
  formatGroupRoutineNextOccurrence,
  formatGroupRoutineRecurrenceSummary,
} from "../../services/groupRoutineUi";
import {
  subscribeActiveGroupRoutines,
  type GroupRoutineDoc,
} from "../../services/groupRoutines";
import {
  approveJoinRequest,
  assignSharedGoalSubtaskToMember,
  blockUserFromGroup,
  canChangeGroupMemberRole,
  canManageGroupInvites,
  canManageGroupMembers,
  canPostGroupBulletins,
  canRemoveGroupMember,
  canUseGroupHereMention,
  claimGroupTask,
  clearGroupGoalTyping,
  completeGroupTask,
  createGroupBulletin,
  createGroupConversation,
  createGroupGoalComment,
  createGroupInvite,
  createGroupReport,
  createGroupTask,
  createOrOpenGroupDm,
  declineJoinRequest,
  DEFAULT_GROUP_NOTIFICATION_PREFERENCES,
  getGroupDiscoveryStatusLabel,
  GROUP_ACTIVITY_REACTION_EMOJIS,
  GROUP_ASSIGNABLE_ROLES,
  GROUP_PRESENCE_HEARTBEAT_THROTTLE_MS,
  hideModerationTarget,
  leaveGroup,
  markAllGroupInboxItemsRead,
  markGroupInboxItemRead,
  markGroupPresenceRecent,
  markGroupReadState,
  releaseGroupTask,
  removeGroupActivityReaction,
  removeGroupMember,
  reopenGroupTask,
  setGroupNotificationCategoryEnabled,
  setGroupNotificationsMuted,
  subscribeGroupActivityReactions,
  subscribeGroupAdminLogs,
  subscribeGroupBulletins,
  subscribeGroupGoalCommentReactions,
  subscribeGroupGoalComments,
  subscribeGroupGoalTyping,
  subscribeGroupInvites,
  subscribeGroupMembers,
  subscribeGroupNotificationPreferences,
  subscribeGroupPresence,
  subscribeGroupReports,
  subscribeGroupTasks,
  subscribeMyGroupConversations,
  subscribeMyGroupInbox,
  subscribeMyGroupReadState,
  subscribePendingJoinRequests,
  unassignSharedGoalSubtask,
  updateGroupDiscoverySettings,
  updateGroupMemberRole,
  updateGroupReportStatus,
  upsertGroupActivityReaction,
  upsertGroupGoalTyping,
  upsertGroupPresence,
  type AssignableGroupRole,
  type GroupActivityDoc,
  type GroupActivityReactionDoc,
  type GroupActivityReactionEmoji,
  type GroupAdminLogDoc,
  type GroupBulletinDoc,
  type GroupConversationDoc,
  type GroupDiscoveryCategory,
  type GroupDoc,
  type GroupGoalCommentDoc,
  type GroupGoalCommentReactionDoc,
  type GroupGoalTypingDoc,
  type GroupInboxItemDoc,
  type GroupInviteDoc,
  type GroupJoinPolicy,
  type GroupJoinRequestDoc,
  type GroupMemberDoc,
  type GroupMemberReadStateDoc,
  type GroupNotificationCategory,
  type GroupNotificationPreferences,
  type GroupPresenceDoc,
  type GroupReportDoc,
  type GroupReportReason,
  type GroupReportTargetType,
  type GroupRole,
  type GroupTaskDoc
} from "../../services/groups";
import {
  createMediaAttachmentId,
  createVideoLinkAttachment,
  deleteMediaAttachmentObjects,
  getMediaAttachmentPolicy,
  normalizeLocalMediaCandidate,
  uploadContextMediaAttachmentBatch,
  validateLocalMediaCandidate,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentDoc,
  type MediaUploadBatchHandle,
} from "../../services/mediaAttachments";
import {
  cancelMediaUploadSession,
  createMediaUploadSession,
  finalizeMediaUploadSession,
} from "../../services/mediaUploadSessions";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

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
};

type ReportTarget = {
  targetType: GroupReportTargetType;
  targetId: string;

  goalId?: string | null;
  taskId?: string | null;
  commentId?: string | null;
  activityId?: string | null;

  bulletinId?: string | null;

  previewTitle: string;
  previewBody?: string | null;
  targetAuthorUid?: string | null;
targetAuthorName?: string | null;
};

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

function getActiveMentionQuery(text: string): string | null {
  const match = text.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);

  return match ? match[2].toLowerCase() : null;
}

function getMentionTokenForMember(member: GroupMemberDoc): string {
  const source =
    member.displayName ??
    member.email?.split("@")[0] ??
    member.uid;

  return source
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

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

function formatModerationTargetTypeLabel(report: GroupReportDoc): string {
  switch (report.targetType) {
    case "bulletin":
      return "Bulletin";
    case "bulletin_comment":
      return "Bulletin comment";
    case "goal_comment":
      return "Goal comment";
    case "task_comment":
      return "Task comment";
    case "task":
      return "Shared task";
    case "activity":
      return "Activity";
    default:
      return "Content";
  }
}

function formatModeratorActionLabel(report: GroupReportDoc): string | null {
  if (!report.lastActionType) return null;

  const actor =
    report.reviewedByName?.trim() || "A moderator";

const action =
  report.lastActionType === "reviewing"
    ? "marked this as reviewing"
    : report.lastActionType === "resolved"
    ? "resolved this report"
    : report.lastActionType === "dismissed"
    ? "dismissed this report"
    : report.lastActionType === "hidden"
    ? "hid the reported content"
    : report.lastActionType === "restored"
    ? "restored the reported content"
    : null;

  if (!action) return null;

  const time = report.reviewedAtMs
    ? formatRelativeTime(report.reviewedAtMs)
    : null;

  return time
    ? `${actor} ${action} · ${time}`
    : `${actor} ${action}`;
}

function isFreshCompletionActivity(item: GroupActivityDoc): boolean {
  return (
    item.type === "subtask_completed" &&
    typeof item.createdAtMs === "number" &&
    Date.now() - item.createdAtMs <= 2 * 60 * 1000
  );
}

function formatBulletinAttachmentLabel(bulletin: GroupBulletinDoc): string | null {
  const imageCount = bulletin.attachments.filter((item) => item.type === "image" || item.type === "gif").length;
  const videoCount = bulletin.attachments.filter((item) => item.type === "video" || item.type === "video_link").length;

  const parts: string[] = [];

  if (imageCount > 0) {
    parts.push(`📷 ${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }

  if (videoCount > 0) {
    parts.push(`🎬 ${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(" • ") : null;
}

function formatGroupTaskDueLabel(ms?: number | null): string | null {
  if (!ms) return null;

  const due = new Date(ms);
  const now = new Date();

  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (dueDay.getTime() === today.getTime()) {
    return "Due today";
  }

  if (dueDay.getTime() === tomorrow.getTime()) {
    return "Due tomorrow";
  }

  return `Due ${due.toLocaleDateString()}`;
}


const COMMENT_MAX_LENGTH = 1000;

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

const GROUP_JOIN_POLICY_OPTIONS: Array<{
  key: GroupJoinPolicy;
  title: string;
  body: string;
}> = [
  {
    key: "invite_only",
    title: "Invite only",
    body: "Only invited members can join.",
  },
  {
    key: "request",
    title: "Request to join",
    body: "People can discover the group and request access.",
  },
  {
    key: "open",
    title: "Open join",
    body: "People can discover and join instantly.",
  },
];

function getActivityCollapseKey(item: GroupActivityDoc): string {
  if (
    item.type === "note_created" &&
    typeof item.message === "string" &&
    item.message.includes("updated progress on") &&
    item.goalId
  ) {
    return `progress:${item.goalId}`;
  }

  return item.id;
}

function getGroupNotificationCategoryLabel(
  category: GroupNotificationCategory
): string {
  switch (category) {
    case "assignments":
      return "Assignments";
    case "comments":
      return "Comments";
    case "reactions":
      return "Reactions";
    case "activity":
      return "Activity";
    case "celebrations":
      return "Celebrations";
    case "mentions":
      return "Mentions";
    default:
      return category;
  }
}

function openReportTarget(
  setReportTarget: React.Dispatch<React.SetStateAction<ReportTarget | null>>,
  setReportReason: React.Dispatch<React.SetStateAction<GroupReportReason>>,
  setReportNote: React.Dispatch<React.SetStateAction<string>>,
  target: ReportTarget
) {
  setReportTarget(target);
  setReportReason("other");
  setReportNote("");
}

function closeReportTarget(
  reportBusy: boolean,
  setReportTarget: React.Dispatch<React.SetStateAction<ReportTarget | null>>,
  setReportReason: React.Dispatch<React.SetStateAction<GroupReportReason>>,
  setReportNote: React.Dispatch<React.SetStateAction<string>>
) {
  if (reportBusy) return;

  setReportTarget(null);
  setReportReason("other");
  setReportNote("");
}


export default function GroupDashboardScreen() {
  const params = useLocalSearchParams<{
  id?: string;
  focus?: string;
  reportId?: string;
}>();
  const groupId = typeof params.id === "string" ? params.id : "";

  

const focusTarget = typeof params.focus === "string" ? params.focus : null;
const focusReportId =
  typeof params.reportId === "string" ? params.reportId : null;
  
  const currentUid = auth.currentUser?.uid ?? null;
  const presencePulseAnim = useRef(new Animated.Value(0)).current;
  const lastPresenceHeartbeatRef = useRef(0);

  const scrollViewRef = useRef<ScrollView | null>(null);
const moderationQueueRef = useRef<View | null>(null);

const [highlightedReportId, setHighlightedReportId] = useState<string | null>(
  null
);

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);

  const [presenceItems, setPresenceItems] = useState<GroupPresenceDoc[]>([]);

  const [sharedGoals, setSharedGoals] = useState<SharedGoalListItem[]>([]);
const [loadingSharedGoals, setLoadingSharedGoals] = useState(true);

const [subtasksByGoalId, setSubtasksByGoalId] = useState<
  Record<string, SharedGoalSubtaskPreview[]>
>({});

const [assignmentPickerTarget, setAssignmentPickerTarget] = useState<{
  goalId: string;
  goalTitle: string;
  subtaskId: string;
  subtaskTitle: string;
} | null>(null);

const [assigningTask, setAssigningTask] = useState(false);

const [activityItems, setActivityItems] = useState<GroupActivityDoc[]>([]);

const [groupCelebrationText, setGroupCelebrationText] = useState<string | null>(
  null
);

const [activityReactionsByActivityId, setActivityReactionsByActivityId] =
  useState<Record<string, GroupActivityReactionDoc[]>>({});

const [groupTasks, setGroupTasks] = useState<GroupTaskDoc[]>([]);

const [loadingGroupTasks, setLoadingGroupTasks] = useState(true);

const [groupTasksError, setGroupTasksError] = useState<string | null>(null);

const [groupPlanningBoards, setGroupPlanningBoards] =
  useState<PlanningBoardDoc[]>([]);

const [loadingGroupPlanningBoards, setLoadingGroupPlanningBoards] =
  useState(true);

const [groupPlanningBoardsError, setGroupPlanningBoardsError] =
  useState<string | null>(null);

const [groupCalendarPreview, setGroupCalendarPreview] = useState<
  GroupCalendarEventDoc[]
>([]);
const [loadingGroupCalendarPreview, setLoadingGroupCalendarPreview] =
  useState(true);
const [groupCalendarPreviewError, setGroupCalendarPreviewError] =
  useState(false);
const [groupRoutinePreview, setGroupRoutinePreview] =
  useState<GroupRoutineDoc[]>([]);
const [loadingGroupRoutinePreview, setLoadingGroupRoutinePreview] =
  useState(true);
const [groupRoutinePreviewError, setGroupRoutinePreviewError] =
  useState(false);
const [todayRoutineOccurrences, setTodayRoutineOccurrences] = useState<
  GroupRoutineOccurrenceDoc[]
>([]);

const [showCreateGroupBoardForm, setShowCreateGroupBoardForm] =
  useState(false);

const [newGroupBoardTitle, setNewGroupBoardTitle] =
  useState("");

const [savingGroupBoard, setSavingGroupBoard] =
  useState(false);

const [archivingGroupBoardId, setArchivingGroupBoardId] =
  useState<string | null>(null);

const [showDiscoverySettings, setShowDiscoverySettings] = useState(false);
const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
const [showSharedTaskPool, setShowSharedTaskPool] = useState(true);
const [showLiveCollaboration, setShowLiveCollaboration] = useState(false);
const [showTeamWins, setShowTeamWins] = useState(false);
const [showAdminTools, setShowAdminTools] = useState(false);
const [showPlanningBoardsPanel, setShowPlanningBoardsPanel] =
  useState(false);

const [showCreateGroupTaskModal, setShowCreateGroupTaskModal] =
  useState(false);

const [newGroupTaskTitle, setNewGroupTaskTitle] = useState("");
const [newGroupTaskDescription, setNewGroupTaskDescription] = useState("");
const [newGroupTaskPriority, setNewGroupTaskPriority] =
  useState<"low" | "medium" | "high" | null>(null);


  const [newGroupTaskDuePreset, setNewGroupTaskDuePreset] =
  useState<"today" | "tomorrow" | "week" | null>(null);

const [creatingGroupTask, setCreatingGroupTask] = useState(false);


const [claimingGroupTaskIds, setClaimingGroupTaskIds] = useState<Set<string>>(
  new Set()
);

const [releasingGroupTaskIds, setReleasingGroupTaskIds] = useState<Set<string>>(
  new Set()
);

const [completingGroupTaskIds, setCompletingGroupTaskIds] = useState<Set<string>>(
  new Set()
);

const [reopeningGroupTaskIds, setReopeningGroupTaskIds] = useState<Set<string>>(
  new Set()
);

const [myReadState, setMyReadState] =
  useState<GroupMemberReadStateDoc | null>(null);

const [loadingActivity, setLoadingActivity] = useState(true);
const [activityError, setActivityError] = useState<string | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [invites, setInvites] = useState<GroupInviteDoc[]>([]);
const [inviteEmail, setInviteEmail] = useState("");
const [inviteBusy, setInviteBusy] = useState(false);

const [pendingJoinRequests, setPendingJoinRequests] = useState<GroupJoinRequestDoc[]>([]);

const [highlightJoinRequests, setHighlightJoinRequests] = useState(false);

const [loadingJoinRequests, setLoadingJoinRequests] = useState(false);
const [joinRequestsError, setJoinRequestsError] = useState<string | null>(null);
const [reviewingJoinRequestIds, setReviewingJoinRequestIds] = useState<Set<string>>(
  new Set()
);
const [commentInputsByGoalId, setCommentInputsByGoalId] = useState<
  Record<string, string>
>({});

const [commentBusyGoalIds, setCommentBusyGoalIds] = useState<Set<string>>(
  new Set()
);

const [removingMemberIds, setRemovingMemberIds] = useState<Set<string>>(
  new Set()
);

const [leavingGroup, setLeavingGroup] = useState(false);

const [blockingMemberIds, setBlockingMemberIds] = useState<Set<string>>(
  new Set()
);

const [openingDmMemberIds, setOpeningDmMemberIds] = useState<Set<string>>(
  new Set()
);

const [groupConversations, setGroupConversations] = useState<
  GroupConversationDoc[]
>([]);

const [loadingGroupConversations, setLoadingGroupConversations] =
  useState(true);

const [groupConversationsError, setGroupConversationsError] =
  useState<string | null>(null);

const [showCreateConversationModal, setShowCreateConversationModal] =
  useState(false);

const [newConversationTitle, setNewConversationTitle] = useState("");
const [newConversationSubject, setNewConversationSubject] = useState("");
const [creatingConversation, setCreatingConversation] = useState(false);

const [selectedConversationMemberUids, setSelectedConversationMemberUids] =
  useState<Set<string>>(new Set());

const [updatingRoleMemberIds, setUpdatingRoleMemberIds] = useState<Set<string>>(
  new Set()
);

const [showSharedGoalsPanel, setShowSharedGoalsPanel] = useState(false);

const [inviteRole, setInviteRole] =
  useState<AssignableGroupRole>("member");

  const [commentsByGoalId, setCommentsByGoalId] = useState<
  Record<string, GroupGoalCommentDoc[]>
>({});

const [commentReactionsByCommentId, setCommentReactionsByCommentId] =
  useState<Record<string, GroupGoalCommentReactionDoc[]>>({});

const [typingByGoalId, setTypingByGoalId] = useState<
  Record<string, GroupGoalTypingDoc[]>
>({});

const [optimisticCommentsByGoalId, setOptimisticCommentsByGoalId] = useState<
  Record<string, GroupGoalCommentDoc[]>
>({});

const [groupInboxItems, setGroupInboxItems] = useState<GroupInboxItemDoc[]>([]);

const [groupNotificationPreferences, setGroupNotificationPreferences] =
  useState<GroupNotificationPreferences>(
    DEFAULT_GROUP_NOTIFICATION_PREFERENCES
  );

  const [updatingNotificationPreferences, setUpdatingNotificationPreferences] =
  useState(false);

  const [adminLogs, setAdminLogs] = useState<GroupAdminLogDoc[]>([]);
const [loadingAdminLogs, setLoadingAdminLogs] = useState(true);
const [adminLogsError, setAdminLogsError] = useState<string | null>(null);

const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
const [reportReason, setReportReason] = useState<GroupReportReason>("other");
const [reportNote, setReportNote] = useState("");
const [reportBusy, setReportBusy] = useState(false);

const [editingDiscoverySettings, setEditingDiscoverySettings] = useState(false);
const [savingDiscoverySettings, setSavingDiscoverySettings] = useState(false);

const [discoveryJoinPolicy, setDiscoveryJoinPolicy] =
  useState<GroupJoinPolicy>("invite_only");

const [discoveryCategory, setDiscoveryCategory] =
  useState<GroupDiscoveryCategory>("general");

const [discoverySummary, setDiscoverySummary] = useState("");

const [groupReports, setGroupReports] = useState<GroupReportDoc[]>([]);
const [loadingGroupReports, setLoadingGroupReports] = useState(false);
const [groupReportsError, setGroupReportsError] = useState<string | null>(null);

const [updatingReportIds, setUpdatingReportIds] = useState<Set<string>>(
  new Set()
);

const [hidingReportIds, setHidingReportIds] = useState<Set<string>>(
  new Set()
);

const [bulletins, setBulletins] = useState<GroupBulletinDoc[]>([]);
const [loadingBulletins, setLoadingBulletins] = useState(true);
const [bulletinsError, setBulletinsError] = useState<string | null>(null);
const [showBulletinBoardPanel, setShowBulletinBoardPanel] = useState(true);

const [newBulletinTitle, setNewBulletinTitle] = useState("");
const [newBulletinBody, setNewBulletinBody] = useState("");

const [selectedBulletinMedia, setSelectedBulletinMedia] = useState<{
  id: string;
  candidate: LocalMediaAttachmentCandidate;
}[]>([]);
const [bulletinUploadProgress, setBulletinUploadProgress] = useState(0);
const activeBulletinUploadRef = useRef<MediaUploadBatchHandle | null>(null);
const [bulletinViewer, setBulletinViewer] = useState<{
  attachments: MediaAttachmentDoc[];
  index: number;
  title: string;
} | null>(null);

const [newBulletinVideoUrl, setNewBulletinVideoUrl] = useState("");

const [creatingBulletin, setCreatingBulletin] = useState(false);

const [showMembersPanel, setShowMembersPanel] = useState(false);
const [showJoinRequestsPanel, setShowJoinRequestsPanel] = useState(false);
const [showAdminHistoryPanel, setShowAdminHistoryPanel] = useState(false);

const [showSafetyToolsPanel, setShowSafetyToolsPanel] = useState(false);
const [showModerationQueuePanel, setShowModerationQueuePanel] = useState(false);
const [showNotificationPrefsPanel, setShowNotificationPrefsPanel] = useState(false);
const [showAssignedToMePanel, setShowAssignedToMePanel] = useState(false);
const [showRecentActivityPanel, setShowRecentActivityPanel] = useState(false);
const [showInviteMemberPanel, setShowInviteMemberPanel] = useState(false);

const isHiddenByModeration = (item?: { hiddenByModeration?: boolean } | null) =>
  item?.hiddenByModeration === true;

const handleOpenReportTarget = (target: ReportTarget) => {
  openReportTarget(
    setReportTarget,
    setReportReason,
    setReportNote,
    target
  );
};

const handleCloseReportTarget = () => {
  closeReportTarget(
    reportBusy,
    setReportTarget,
    setReportReason,
    setReportNote
  );
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
      bulletinId: reportTarget.bulletinId ?? null,
targetPreviewTitle: reportTarget.previewTitle,
targetPreviewBody: reportTarget.previewBody ?? null,
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
    console.log("[GroupDashboard] submit report failed", err);
    Alert.alert("Report failed", err?.message ?? "Please try again.");
  } finally {
    setReportBusy(false);
  }
};

const handleCreateBulletin = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || creatingBulletin) return;

  if (!canPostBulletins) {
    Alert.alert(
      "Not allowed",
      "Only owners, admins, and moderators can post bulletins."
    );
    return;
  }

  const title = newBulletinTitle.trim();
  const body = newBulletinBody.trim();

  const videoUrl = newBulletinVideoUrl.trim();
  let videoLinkAttachment: MediaAttachmentDoc | null = null;
  if (videoUrl) {
    try {
      videoLinkAttachment = createVideoLinkAttachment({
        rawUrl: videoUrl,
        createdByUid: currentUser.uid,
      });
    } catch {
      Alert.alert("Invalid YouTube link", "Paste a full YouTube video URL.");
      return;
    }
  }
  const policy = getMediaAttachmentPolicy("bulletin");
  if (selectedBulletinMedia.length + (videoLinkAttachment ? 1 : 0) > policy.maxAttachments) {
    Alert.alert("Too many attachments", `You can attach up to ${policy.maxAttachments} files.`);
    return;
  }

  if (!title) {
    Alert.alert("Title required", "Add a short bulletin title.");
    return;
  }

  if (!body) {
    Alert.alert("Message required", "Add a bulletin message.");
    return;
  }

let sessionId: string | null = null;
let uploadedAttachments: MediaAttachmentDoc[] = [];
let bulletinCreated = false;
const bulletinRef = doc(collection(db, "groups", groupId, "bulletins"));
const mediaContext = { type: "bulletin" as const, groupId, bulletinId: bulletinRef.id };
try {
  setCreatingBulletin(true);
  setBulletinUploadProgress(0);
  if (selectedBulletinMedia.length > 0) {
    const session = await createMediaUploadSession({
      uploaderUid: currentUser.uid,
      context: mediaContext,
    });
    sessionId = session.id;
    const itemProgress = new Map<string, number>();
    activeBulletinUploadRef.current = uploadContextMediaAttachmentBatch({
      items: selectedBulletinMedia.map((item) => ({
        attachmentId: item.id,
        candidate: item.candidate,
      })),
      uploaderUid: currentUser.uid,
      context: mediaContext,
      uploadSessionId: session.id,
      onItemProgress: (attachmentId, progress) => {
        itemProgress.set(attachmentId, progress);
        const total = [...itemProgress.values()].reduce((sum, value) => sum + value, 0);
        setBulletinUploadProgress(total / selectedBulletinMedia.length);
      },
    });
    uploadedAttachments = (await activeBulletinUploadRef.current.promise).attachments;
  }

  await createGroupBulletin({
    groupId,
    bulletinId: bulletinRef.id,
    title,
    body,
    attachments: [
      ...uploadedAttachments,
      ...(videoLinkAttachment ? [videoLinkAttachment] : []),
    ],
    authorUid: currentUser.uid,
    authorName: currentUser.displayName ?? currentUser.email ?? null,
    authorEmail: currentUser.email ?? null,
  });
  bulletinCreated = true;

setNewBulletinTitle("");
setNewBulletinBody("");
setNewBulletinVideoUrl("");
setSelectedBulletinMedia([]);
if (sessionId) await finalizeMediaUploadSession(sessionId, currentUser.uid);

  Alert.alert("Posted", "Bulletin added to the group board.");
} catch (err: any) {
  if (!bulletinCreated) {
    bulletinCreated = await getDoc(bulletinRef)
      .then((snapshot) => snapshot.exists())
      .catch(() => false);
  }
  if (bulletinCreated && sessionId) {
    await finalizeMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
  }
  activeBulletinUploadRef.current?.cancel();
  if (!bulletinCreated && uploadedAttachments.length > 0) {
    await deleteMediaAttachmentObjects(uploadedAttachments, mediaContext);
  }
  if (!bulletinCreated && sessionId) {
    await cancelMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
  }
  console.log("[GroupDashboard] create bulletin failed", {
    code: err?.code,
    message: err?.message,
    serverResponse: err?.serverResponse,
    customData: err?.customData,
    name: err?.name,
  });

  Alert.alert("Post failed", err?.message ?? "Please try again.");
} finally {
    activeBulletinUploadRef.current = null;
    setBulletinUploadProgress(0);
    setCreatingBulletin(false);
  }
};

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const groupNotificationCategories: GroupNotificationCategory[] = [
  "assignments",
  "comments",
  "reactions",
  "activity",
  "celebrations",
  "mentions",
];

  useEffect(() => {
  const loop = Animated.loop(
    Animated.sequence([
      Animated.timing(presencePulseAnim, {
        toValue: 1,
        duration: 1300,
        useNativeDriver: true,
      }),
      Animated.timing(presencePulseAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ])
  );

  loop.start();

  return () => {
    loop.stop();
  };
}, [presencePulseAnim]);

const presencePulseAnimatedStyle = {
  opacity: presencePulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  }),
  transform: [
    {
      scale: presencePulseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.7],
      }),
    },
  ],
};

const memberPresencePulseAnimatedStyle = {
  opacity: presencePulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  }),
  transform: [
    {
      scale: presencePulseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.8],
      }),
    },
  ],
};

  const visibleActivityItems = useMemo(() => {
  const seen = new Set<string>();

  return activityItems.filter((item) => {
  if (isHiddenByModeration(item)) return false;
    const key = getActivityCollapseKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}, [activityItems]);

const hasUnreadActivity = useMemo(() => {
  const lastViewed = myReadState?.lastViewedActivityAtMs ?? 0;

  return visibleActivityItems.some(
    (item) =>
      item.actorUid !== auth.currentUser?.uid &&
      item.createdAtMs > lastViewed
  );
}, [visibleActivityItems, myReadState]);


const getRecentActivityForGoal = (goalId: string) => {
  return visibleActivityItems
    .filter((item) => item.goalId === goalId)
    .slice(0, 3);
};

const getCommentsForGoal = (goalId: string) => {
  return [
  ...(optimisticCommentsByGoalId[goalId] ?? []),
  ...(commentsByGoalId[goalId] ?? []),
].filter((comment) => !isHiddenByModeration(comment));
};

const getCommentCountForGoal = (goalId: string) => {
  return getCommentsForGoal(goalId).length;
};

const getReactionSummaryForComment = (commentId: string) => {
  const reactions = commentReactionsByCommentId[commentId] ?? [];
  const summary: Record<string, number> = {};

  reactions.forEach((reaction: GroupGoalCommentReactionDoc) => {
    summary[reaction.emoji] = (summary[reaction.emoji] ?? 0) + 1;
  });

  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
};

const getActivityReactionSummary = (activityId: string) => {
  const reactions = activityReactionsByActivityId[activityId] ?? [];
  const summary: Record<string, number> = {};

  reactions.forEach((reaction) => {
    summary[reaction.emoji] = (summary[reaction.emoji] ?? 0) + 1;
  });

  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
};

const getMyActivityReaction = (activityId: string) => {
  const currentUid = auth.currentUser?.uid;

  if (!currentUid) return null;

  return (
    (activityReactionsByActivityId[activityId] ?? []).find(
      (reaction) => reaction.uid === currentUid
    ) ?? null
  );
};

const getAssignmentCountForGoal = (goalId: string) => {
  return (subtasksByGoalId[goalId] ?? []).filter(
    (subtask) => !!subtask.assignedToUid
  ).length;
};

const hasUnreadCommentsForGoal = (goalId: string) => {
  const lastViewed = myReadState?.lastViewedCommentsAtMs ?? 0;

  return (commentsByGoalId[goalId] ?? []).some(
    (comment) =>
      comment.authorUid !== auth.currentUser?.uid &&
      comment.createdAtMs > lastViewed
  );
};

const visibleGroupTasks = useMemo(() => {
  return groupTasks.filter((task) => !isHiddenByModeration(task));
}, [groupTasks]);

const unclaimedGroupTasks = useMemo(() => {
  return visibleGroupTasks.filter((task) => task.status === "unclaimed");
}, [visibleGroupTasks]);

const myClaimedGroupTasks = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  if (!currentUid) return [];

  return  visibleGroupTasks.filter(
    (task) =>
      (task.status === "claimed" || task.status === "in_progress") &&
      task.claimedByUid === currentUid
  );
}, [visibleGroupTasks]);

const claimedByOthersGroupTasks = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  return visibleGroupTasks.filter(
    (task) =>
      (task.status === "claimed" || task.status === "in_progress") &&
      task.claimedByUid !== currentUid
  );
}, [visibleGroupTasks]);

const completedGroupTasks = useMemo(() => {
  return visibleGroupTasks.filter((task) => task.status === "completed");
}, [visibleGroupTasks]);

const recentSharedWins = useMemo(() => {
  return completedGroupTasks
    .filter((task) => typeof task.completedAtMs === "number")
    .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
    .slice(0, 3);
}, [completedGroupTasks]);



const activeGroupTaskCount =
  unclaimedGroupTasks.length +
  myClaimedGroupTasks.length +
  claimedByOthersGroupTasks.length;

  const getClaimedTaskCountForMember = (uid: string) => {
  return groupTasks.filter(
    (task) =>
      (task.status === "claimed" || task.status === "in_progress") &&
      task.claimedByUid === uid
  ).length;
};

const getCompletedTaskCountForMember = (uid: string) => {
  return groupTasks.filter(
    (task) =>
      task.status === "completed" &&
      task.completedByUid === uid
  ).length;
};

const mostLoadedMember = useMemo(() => {
  const membersWithCounts = members
    .map((member) => ({
      member,
      claimedCount: getClaimedTaskCountForMember(member.uid),
    }))
    .filter((item) => item.claimedCount > 0)
    .sort((a, b) => b.claimedCount - a.claimedCount);

  return membersWithCounts[0] ?? null;
}, [members, groupTasks]);

const getPresenceForMember = (uid: string) => {
  return presenceItems.find((item) => item.uid === uid) ?? null;
};

type PresenceDisplayTone = "online" | "recent" | "away";

type PresenceDisplay = {
  tone: PresenceDisplayTone;
  label: string;
  detail: string;
  rank: number;
  isLive: boolean;
};

const getPresenceDisplayForMember = (uid: string): PresenceDisplay => {
  const presence = getPresenceForMember(uid);

  if (!presence) {
    return {
      tone: "away",
      label: "Away",
      detail: "Not active in this group right now",
      rank: 2,
      isLive: false,
    };
  }

  if (presence.status === "online") {
    if (presence.activeGoalTitle) {
      return {
        tone: "online",
        label: "Active now",
        detail: `Viewing ${presence.activeGoalTitle}`,
        rank: 0,
        isLive: true,
      };
    }

    if (presence.activeRoute === "group") {
      return {
        tone: "online",
        label: "Active now",
        detail: "Viewing this group",
        rank: 0,
        isLive: true,
      };
    }

    return {
      tone: "online",
      label: "Active now",
      detail: "Online in Dayta",
      rank: 0,
      isLive: true,
    };
  }

  if (presence.status === "recent") {
    return {
      tone: "recent",
      label: "Recently here",
      detail: `Seen ${formatRelativeTime(presence.lastSeenAtMs)}`,
      rank: 1,
      isLive: false,
    };
  }

  return {
    tone: "away",
    label: "Away",
    detail: "Not active in this group right now",
    rank: 2,
    isLive: false,
  };
};

const getPresenceRankForMember = (uid: string) => {
  return getPresenceDisplayForMember(uid).rank;
};

const memberWorkloadSummary = useMemo(() => {
  return members
    .filter((member) => member.status === "active")
    .map((member) => {
      const claimedCount = getClaimedTaskCountForMember(member.uid);
      const completedCount = getCompletedTaskCountForMember(member.uid);
      const presence = getPresenceForMember(member.uid);

      return {
        member,
        claimedCount,
        completedCount,
        presence,
        totalSignal: claimedCount * 2 + completedCount,
      };
    })
    .sort((a, b) => {
      if (b.claimedCount !== a.claimedCount) {
        return b.claimedCount - a.claimedCount;
      }

      return b.completedCount - a.completedCount;
    });
}, [members, groupTasks, presenceItems]);

const lowLoadMemberCount = useMemo(() => {
  return memberWorkloadSummary.filter((item) => item.claimedCount === 0).length;
}, [memberWorkloadSummary]);

const workloadVisibilitySummary = useMemo(() => {
  if (memberWorkloadSummary.length === 0) {
    return "No active members available for workload visibility.";
  }

  if (mostLoadedMember) {
    return `${
      mostLoadedMember.member.displayName ??
      mostLoadedMember.member.email ??
      "Someone"
    } currently has the heaviest shared-task load.`;
  }

  if (lowLoadMemberCount > 0) {
    return `${lowLoadMemberCount} member${
      lowLoadMemberCount === 1 ? "" : "s"
    } currently have no claimed shared tasks.`;
  }

  return "Shared task load is currently balanced.";
}, [memberWorkloadSummary, mostLoadedMember, lowLoadMemberCount]);


const leastLoadedAvailableMember = useMemo(() => {
  const candidates = members
    .filter((member) => member.status === "active")
    .map((member) => ({
      member,
      claimedCount: getClaimedTaskCountForMember(member.uid),
      presence: getPresenceForMember(member.uid),
    }))
    .sort((a, b) => {
      const aOnlineRank = a.presence?.status === "online" ? 0 : 1;
      const bOnlineRank = b.presence?.status === "online" ? 0 : 1;

      if (aOnlineRank !== bOnlineRank) {
        return aOnlineRank - bOnlineRank;
      }

      return a.claimedCount - b.claimedCount;
    });

  return candidates[0] ?? null;
}, [members, groupTasks, presenceItems]);

const getSuggestedHelperReason = (member: GroupMemberDoc | null) => {
  if (!member) return null;

  const presence = getPresenceForMember(member.uid);
  const claimedCount = getClaimedTaskCountForMember(member.uid);

  if (presence?.status === "online" && claimedCount === 0) {
    return "Online with no claimed shared tasks";
  }

  if (presence?.status === "online") {
    return `Online with ${claimedCount} claimed`;
  }

  if (presence?.status === "recent" && claimedCount === 0) {
    return "Recently active with no claimed shared tasks";
  }

  if (claimedCount === 0) {
    return "Lightest current shared-task load";
  }

  return `Light shared-task load: ${claimedCount} claimed`;
};

const getSuggestedHelperForTask = (task: GroupTaskDoc) => {
  if (task.status !== "unclaimed") return null;

  if (leastLoadedAvailableMember?.member) {
    return leastLoadedAvailableMember.member;
  }

  return members.find((member) => member.status === "active") ?? null;
};

const groupTaskCoordinationHint = useMemo(() => {
  if (unclaimedGroupTasks.length > 0 && leastLoadedAvailableMember) {
    return `${
      leastLoadedAvailableMember.member.displayName ??
      leastLoadedAvailableMember.member.email ??
      "Someone"
    } may be available to help — currently ${
      leastLoadedAvailableMember.claimedCount
    } claimed.`;
  }

  if (unclaimedGroupTasks.length > 0) {
    return "There is open work available for the group to pick up.";
  }

  if (myClaimedGroupTasks.length > 0) {
    return "You have shared tasks in progress.";
  }

  if (claimedByOthersGroupTasks.length > 0) {
    return "All active shared work is currently claimed.";
  }

  return "No active shared task load right now.";
}, [
  unclaimedGroupTasks,
  myClaimedGroupTasks,
  claimedByOthersGroupTasks,
  leastLoadedAvailableMember,
]);

const getGroupTaskSignalLabel = (task: GroupTaskDoc) => {
  const nowMs = Date.now();

  if (
    typeof task.dueAtMs === "number" &&
    task.dueAtMs > 0 &&
    task.dueAtMs <= nowMs + 24 * 60 * 60 * 1000 &&
    task.status !== "completed"
  ) {
    return "Urgent";
  }

  if (
    task.status === "unclaimed" &&
    nowMs - task.createdAtMs > 48 * 60 * 60 * 1000
  ) {
    return "Unowned";
  }

  if (
    (task.status === "claimed" || task.status === "in_progress") &&
    typeof task.claimedAtMs === "number" &&
    nowMs - task.claimedAtMs > 72 * 60 * 60 * 1000
  ) {
    return "Stale";
  }

  if (task.priority === "high" && task.status !== "completed") {
    return "High priority";
  }

  return null;
};

const attentionGroupTasks = useMemo(() => {
  return visibleGroupTasks.filter((task) => !!getGroupTaskSignalLabel(task));
}, [visibleGroupTasks]);

const overdueGroupTasks = useMemo(() => {
  const nowMs = Date.now();

  return visibleGroupTasks.filter(
    (task) =>
      task.status !== "completed" &&
      typeof task.dueAtMs === "number" &&
      task.dueAtMs > 0 &&
      task.dueAtMs < nowMs
  );
}, [visibleGroupTasks]);

const dueSoonGroupTasks = useMemo(() => {
  const nowMs = Date.now();

  return visibleGroupTasks.filter(
    (task) =>
      task.status !== "completed" &&
      typeof task.dueAtMs === "number" &&
      task.dueAtMs > 0 &&
      task.dueAtMs <= nowMs + 24 * 60 * 60 * 1000
  );
}, [visibleGroupTasks]);

const highPriorityOpenGroupTasks = useMemo(() => {
  return visibleGroupTasks.filter(
    (task) =>
      task.status !== "completed" &&
      task.priority === "high"
  );
}, [visibleGroupTasks]);

const smartGroupTaskSummary = useMemo(() => {
  if (overdueGroupTasks.length > 0) {
    return {
      tone: "danger" as const,
      title: `${overdueGroupTasks.length} overdue shared task${
        overdueGroupTasks.length === 1 ? "" : "s"
      }`,
      body: "These need attention first.",
    };
  }

  if (dueSoonGroupTasks.length > 0) {
    return {
      tone: "warning" as const,
      title: `${dueSoonGroupTasks.length} due soon`,
      body: "Shared work is coming up in the next 24 hours.",
    };
  }

  if (highPriorityOpenGroupTasks.length > 0) {
    return {
      tone: "warning" as const,
      title: `${highPriorityOpenGroupTasks.length} high-priority task${
        highPriorityOpenGroupTasks.length === 1 ? "" : "s"
      }`,
      body: "The group has important work waiting.",
    };
  }

  if (unclaimedGroupTasks.length > 0) {
    return {
      tone: "primary" as const,
      title: `${unclaimedGroupTasks.length} open shared task${
        unclaimedGroupTasks.length === 1 ? "" : "s"
      }`,
      body: "There is work available for someone to pick up.",
    };
  }

  if (myClaimedGroupTasks.length > 0) {
    return {
      tone: "primary" as const,
      title: `${myClaimedGroupTasks.length} yours in progress`,
      body: "You have shared work currently claimed.",
    };
  }

  if (claimedByOthersGroupTasks.length > 0) {
    return {
      tone: "muted" as const,
      title: "All active work is claimed",
      body: "No unclaimed shared tasks right now.",
    };
  }

  return {
    tone: "muted" as const,
    title: "Shared task pool is clear",
    body: "No active shared work needs attention.",
  };
}, [
  overdueGroupTasks,
  dueSoonGroupTasks,
  highPriorityOpenGroupTasks,
  unclaimedGroupTasks,
  myClaimedGroupTasks,
  claimedByOthersGroupTasks,
]);

const assignedToMeItems = useMemo(() => {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return [];

  return sharedGoals.flatMap((goal) =>
    (subtasksByGoalId[goal.id] ?? [])
      .filter((subtask) => subtask.assignedToUid === currentUid)
      .map((subtask) => ({
  goalId: goal.id,
  goalTitle: goal.title,
  subtaskId: subtask.id,
  subtaskTitle: subtask.title,
  assignedAtMs: subtask.assignedAtMs ?? null,
}))
  );
}, [sharedGoals, subtasksByGoalId]);

const hasUnreadAssignments = useMemo(() => {
  const lastViewed = myReadState?.lastViewedAssignmentsAtMs ?? 0;

  return assignedToMeItems.some(
    (item) =>
      typeof item.assignedAtMs === "number" &&
      item.assignedAtMs > lastViewed
  );
}, [assignedToMeItems, myReadState]);

const onlinePresenceItems = useMemo(
  () => presenceItems.filter((item) => item.status === "online"),
  [presenceItems]
);

const recentPresenceItems = useMemo(
  () => presenceItems.filter((item) => item.status === "recent"),
  [presenceItems]
);

const groupSocialPulse = useMemo(() => {
  if (onlinePresenceItems.length > 0) {
    return {
      tone: "live" as const,
      title: `${onlinePresenceItems.length} active now`,
      body:
        onlinePresenceItems.length === 1
          ? `${
              onlinePresenceItems[0].displayName ??
              onlinePresenceItems[0].email ??
              "Someone"
            } is around right now.`
          : "The group has live activity right now.",
    };
  }

  if (recentPresenceItems.length > 0) {
    return {
      tone: "recent" as const,
      title: `${recentPresenceItems.length} recently around`,
      body: "The group has had activity recently.",
    };
  }

  return {
    tone: "quiet" as const,
    title: "Quiet right now",
    body: "No one is active in this group at the moment.",
  };
}, [onlinePresenceItems, recentPresenceItems]);

const groupMoraleSignal = useMemo(() => {
  if (recentSharedWins.length >= 3) {
    return {
      tone: "celebrating" as const,
      title: "Momentum is strong",
      body: "The group has been stacking shared wins recently.",
      emoji: "🔥",
    };
  }

  if (recentSharedWins.length > 0) {
    return {
      tone: "positive" as const,
      title: "Shared progress is moving",
      body: "Recent completed tasks are keeping the group moving.",
      emoji: "🎉",
    };
  }

  if (onlinePresenceItems.length > 0 && unclaimedGroupTasks.length > 0) {
    return {
      tone: "active" as const,
      title: "Good time to coordinate",
      body: "People are around and there is open shared work available.",
      emoji: "✨",
    };
  }

  if (attentionGroupTasks.length > 0) {
    return {
      tone: "needs_attention" as const,
      title: "A little attention would help",
      body: "Some shared work could use a nudge from the group.",
      emoji: "👀",
    };
  }

  return {
    tone: "quiet" as const,
    title: "Calm right now",
    body: "No urgent group morale signal at the moment.",
    emoji: "🌙",
  };
}, [
  recentSharedWins,
  onlinePresenceItems,
  unclaimedGroupTasks,
  attentionGroupTasks,
]);

const sortedMembers = useMemo(() => {
  return [...members].sort((a, b) => {
    const presenceDiff =
      getPresenceRankForMember(a.uid) - getPresenceRankForMember(b.uid);

    if (presenceDiff !== 0) return presenceDiff;

    const roleRank = (role: GroupRole) => {
      if (role === "owner") return 0;
      if (role === "admin") return 1;
      if (role === "member") return 2;
      return 3;
    };

    const roleDiff = roleRank(a.role) - roleRank(b.role);

    if (roleDiff !== 0) return roleDiff;

    return (a.displayName ?? a.email ?? a.uid).localeCompare(
      b.displayName ?? b.email ?? b.uid
    );
  });
}, [members, presenceItems]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid) {
    return;
  }

  let cancelled = false;


 const writePresence = async () => {
  const nowMs = Date.now();

  if (
    nowMs - lastPresenceHeartbeatRef.current <
    GROUP_PRESENCE_HEARTBEAT_THROTTLE_MS
  ) {
    return;
  }

  lastPresenceHeartbeatRef.current = nowMs;

  try {
    await upsertGroupPresence({
      groupId,
      uid: currentUser.uid,
      displayName: currentUser.displayName ?? currentUser.email ?? null,
      email: currentUser.email ?? null,
      photoURL: currentUser.photoURL ?? null,
      activeRoute: "group",
    });
  } catch (e) {
    if (!cancelled) {
      console.log("[GroupDashboard] presence heartbeat failed", e);
    }
  }
};

  writePresence();

  const interval = setInterval(() => {
    writePresence();
  }, GROUP_PRESENCE_HEARTBEAT_THROTTLE_MS);

  return () => {
    cancelled = true;
    clearInterval(interval);

    markGroupPresenceRecent({
      groupId,
      uid: currentUser.uid,
    }).catch((e) => {
      console.log("[GroupDashboard] mark presence recent failed", e);
    });
  };
}, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setLoadingGroup(false);
      return;
    }

    const ref = doc(db, "groups", groupId);

    const unsub = onSnapshot(
      ref,
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
        console.log("[GroupDashboard] failed loading group", err);
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
        console.log("[GroupDashboard] failed loading members", err);
        setLoadingMembers(false);
      }
    );

    return unsub;
  }, [groupId]);

useEffect(() => {
  if (!currentUid) {
    setGroupInboxItems([]);
    return;
  }

  setGroupInboxItems([]);

  const unsub = subscribeMyGroupInbox(
    currentUid,
    setGroupInboxItems,
    (err) => {
      console.log("[GroupDashboard] failed loading group inbox", err);
    }
  );

  return unsub;
}, [currentUid]);

useEffect(() => {
  if (!groupId || !currentUid) {
    setGroupNotificationPreferences(
      DEFAULT_GROUP_NOTIFICATION_PREFERENCES
    );

    return;
  }

  const unsub = subscribeGroupNotificationPreferences(
    currentUid,
    groupId,
    setGroupNotificationPreferences,
    (err) => {
      console.log(
        "[GroupDashboard] failed loading notification preferences",
        err
      );
    }
  );

  return unsub;
}, [groupId, currentUid]);



  useEffect(() => {
  if (!groupId) {
    setPresenceItems([]);
    return;
  }

  const unsub = subscribeGroupPresence(
    groupId,
    setPresenceItems,
    (err) => {
      console.log("[GroupDashboard] failed loading presence", err);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId) {
    setGroupTasks([]);
    setLoadingGroupTasks(false);
    return;
  }

  setLoadingGroupTasks(true);
  setGroupTasksError(null);

  const unsub = subscribeGroupTasks(
    groupId,
    (tasks) => {
      setGroupTasks(tasks);
      setLoadingGroupTasks(false);
    },
    (err) => {
      console.log(
        "[GroupDashboard] failed loading group tasks",
        err
      );

      setGroupTasksError("Could not load shared tasks.");
      setLoadingGroupTasks(false);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId) {
    setGroupPlanningBoards([]);
    setLoadingGroupPlanningBoards(false);
    setGroupPlanningBoardsError(null);
    return;
  }

  setLoadingGroupPlanningBoards(true);
  setGroupPlanningBoardsError(null);

  const unsub = subscribeGroupPlanningBoards(
    groupId,
    (items) => {
      setGroupPlanningBoards(items);
      setLoadingGroupPlanningBoards(false);
    },
    (err) => {
      console.log(
        "[GroupDashboard] planning boards subscription failed",
        err
      );

      setGroupPlanningBoards([]);
      setGroupPlanningBoardsError("Could not load planning boards.");
      setLoadingGroupPlanningBoards(false);
    }
  );

  return unsub;
}, [groupId]);

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
        console.log("[GroupDashboard] failed loading preview reactions", {
          goalId,
          commentId,
          err,
        });
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [groupId, commentsByGoalId]);



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
    async (snap) => {
      const items = await Promise.all(
        snap.docs.map(async (sharedDoc) => {
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
        })
      );

      setSharedGoals(items);
      setLoadingSharedGoals(false);
    },
    (err) => {
      console.log("[GroupDashboard] failed loading shared goals", err);
      setLoadingSharedGoals(false);
    }
  );

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
          [sharedGoal.id]: comments.slice(0, 3),
        }));
      },
      (err) => {
        console.log("[GroupDashboard] failed loading comments", {
          goalId: sharedGoal.id,
          err,
        });
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [groupId, sharedGoals]);

useEffect(() => {
  if (!groupId) {
    setActivityItems([]);
    setLoadingActivity(false);
    return;
  }

 
  setLoadingActivity(true);
  setActivityError(null);

  const q = query(
    collection(db, "groups", groupId, "activity"),
    orderBy("createdAtMs", "desc"),
    limit(10)
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const next: GroupActivityDoc[] = snap.docs.map((docSnap) => {
        const data = docSnap.data();

        return {
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          type: data.type ?? "goal_shared",
          actorUid: data.actorUid ?? "",
          actorName: data.actorName ?? null,
          actorEmail: data.actorEmail ?? null,
          message: data.message ?? "",
          goalId: data.goalId ?? null,
          goalTitle: data.goalTitle ?? null,
          targetUid: data.targetUid ?? null,
          targetEmail: data.targetEmail ?? null,
          createdAtMs:
            typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
           taskId: data.taskId ?? null,
taskTitle: data.taskTitle ?? null,
          boardId: data.boardId ?? null,
          boardTitle: data.boardTitle ?? null,
          cardId: data.cardId ?? null,
          cardTitle: data.cardTitle ?? null,
          previousAssignedToUid: data.previousAssignedToUid ?? null,
          previousAssignedToName: data.previousAssignedToName ?? null,
          previousAssignedToEmail: data.previousAssignedToEmail ?? null,
          assignedToUid: data.assignedToUid ?? null,
          assignedToName: data.assignedToName ?? null,
          assignedToEmail: data.assignedToEmail ?? null,
        };
      });

      setActivityItems(next);
      setLoadingActivity(false);
    },
    (err) => {
  console.log("[GroupDashboard] failed loading activity", err);

  setActivityError("Could not load recent activity.");
  setLoadingActivity(false);
}
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid) {
    setMyReadState(null);
    return;
  }

  const unsub = subscribeMyGroupReadState(
    groupId,
    currentUser.uid,
    setMyReadState,
    (err) => {
      console.log("[GroupDashboard] failed loading read state", err);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid || visibleActivityItems.length === 0) {
    return;
  }

  const newestActivityAtMs = visibleActivityItems.reduce(
  (max, item) => Math.max(max, item.createdAtMs ?? 0),
  0
);
  const lastViewed = myReadState?.lastViewedActivityAtMs ?? 0;

  if (newestActivityAtMs <= lastViewed) {
    return;
  }

  const timeout = setTimeout(() => {
    markGroupReadState({
      groupId,
      uid: currentUser.uid,
      activity: true,
    }).catch((err) => {
      console.log("[GroupDashboard] mark activity read failed", err);
    });
  }, 1500);

  return () => clearTimeout(timeout);
}, [groupId, visibleActivityItems, myReadState?.lastViewedActivityAtMs]);



useEffect(() => {
  if (!groupId || sharedGoals.length === 0) {
    setSubtasksByGoalId({});
    return;
  }

  const unsubs = sharedGoals.map((sharedGoal) => {
    const q = query(
      collection(db, "goals", sharedGoal.id, "subtasks"),
      orderBy("createdAtMs", "desc"),
      limit(5)
    );

    return onSnapshot(
      q,
      (snap) => {
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
    typeof data.assignedAtMs === "number"
      ? data.assignedAtMs
      : null,
                
          };
        });

        setSubtasksByGoalId((current) => ({
          ...current,
          [sharedGoal.id]: next,
        }));
      },
      (err) => {
        console.log("[GroupDashboard] failed loading shared goal subtasks", {
          goalId: sharedGoal.id,
          err,
        });
      }
    );
  });

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [groupId, sharedGoals]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid || Object.keys(commentsByGoalId).length === 0) {
    return;
  }

  const newestCommentAtMs = Object.values(commentsByGoalId)
    .flat()
    .reduce((max, comment) => Math.max(max, comment.createdAtMs ?? 0), 0);

  const lastViewed = myReadState?.lastViewedCommentsAtMs ?? 0;

  if (newestCommentAtMs <= lastViewed) {
    return;
  }

  const timeout = setTimeout(() => {
    markGroupReadState({
      groupId,
      uid: currentUser.uid,
      comments: true,
    }).catch((err) => {
      console.log("[GroupDashboard] mark comments read failed", err);
    });
  }, 2000);

  return () => clearTimeout(timeout);
}, [groupId, commentsByGoalId, myReadState?.lastViewedCommentsAtMs]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (
    !groupId ||
    !currentUser?.uid ||
    assignedToMeItems.length === 0
  ) {
    return;
  }

  const newestAssignmentAtMs = assignedToMeItems.reduce(
    (max, item) =>
      Math.max(
        max,
        typeof item.assignedAtMs === "number"
          ? item.assignedAtMs
          : 0
      ),
    0
  );

  const lastViewed =
    myReadState?.lastViewedAssignmentsAtMs ?? 0;

  if (newestAssignmentAtMs <= lastViewed) {
    return;
  }

  const timeout = setTimeout(() => {
    markGroupReadState({
      groupId,
      uid: currentUser.uid,
      assignments: true,
    }).catch((err) => {
      console.log(
        "[GroupDashboard] mark assignments read failed",
        err
      );
    });
  }, 2000);

  return () => clearTimeout(timeout);
}, [groupId, assignedToMeItems, myReadState?.lastViewedAssignmentsAtMs]);

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
        console.log("[GroupDashboard] failed loading typing", {
          goalId: sharedGoal.id,
          err,
        });
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [groupId, sharedGoals]);

useEffect(() => {
  if (!groupId || visibleActivityItems.length === 0) {
    setActivityReactionsByActivityId({});
    return;
  }

  const unsubs = visibleActivityItems.map((item) =>
    subscribeGroupActivityReactions(
      groupId,
      item.id,
      (reactions) => {
        setActivityReactionsByActivityId((current) => ({
          ...current,
          [item.id]: reactions,
        }));
      },
      (err) => {
        console.log("[GroupDashboard] failed loading activity reactions", {
          activityId: item.id,
          err,
        });
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [groupId, visibleActivityItems]);




const showGroupCelebration = (text: string) => {
  setGroupCelebrationText(text);

  setTimeout(() => {
    setGroupCelebrationText(null);
  }, 2600);
};

const getNewGroupTaskDueAtMs = () => {
  if (!newGroupTaskDuePreset) return null;

  const now = new Date();

  if (newGroupTaskDuePreset === "today") {
    const due = new Date(now);
    due.setHours(20, 0, 0, 0);
    return due.getTime();
  }

  if (newGroupTaskDuePreset === "tomorrow") {
    const due = new Date(now);
    due.setDate(due.getDate() + 1);
    due.setHours(20, 0, 0, 0);
    return due.getTime();
  }

  const due = new Date(now);
  due.setDate(due.getDate() + 7);
  due.setHours(20, 0, 0, 0);
  return due.getTime();
};

const toggleSelectedConversationMember = (uid: string) => {
  setSelectedConversationMemberUids((current) => {
    const next = new Set(current);

    if (next.has(uid)) next.delete(uid);
    else next.add(uid);

    return next;
  });
};

const handleCreateGroupConversation = async () => {
  const currentUser = auth.currentUser;
  const title = newConversationTitle.trim();

  if (!currentUser?.uid || !groupId || creatingConversation) {
    return;
  }

  if (!title) {
    Alert.alert("Title required", "Add a conversation title first.");
    return;
  }

  const memberUids = Array.from(selectedConversationMemberUids).filter(
    (uid) => uid !== currentUser.uid
  );

  if (memberUids.length === 0) {
    Alert.alert(
      "No members yet",
      "Add at least one other active group member before creating a group conversation."
    );
    return;
  }

  try {
    setCreatingConversation(true);

    const conversationId = await createGroupConversation({
      groupId,
      title,
      subject: newConversationSubject.trim() || null,
      creatorUid: currentUser.uid,
      creatorName: currentUser.displayName ?? currentUser.email ?? null,
      creatorEmail: currentUser.email ?? null,
      memberUids,
    });

    setNewConversationTitle("");
    setNewConversationSubject("");
    setSelectedConversationMemberUids(new Set());
    setShowCreateConversationModal(false);

    router.push(`/group/${groupId}/conversation/${conversationId}`);
  } catch (err: any) {
    console.log("[GroupDashboard] create conversation failed", err);
    Alert.alert("Conversation failed", err?.message ?? "Please try again.");
  } finally {
    setCreatingConversation(false);
  }
};

const handleCreateGroupTask = async () => {
  const currentUser = auth.currentUser;
  const title = newGroupTaskTitle.trim();

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!title) {
    Alert.alert("Task title required", "Add a task title first.");
    return;
  }

  try {
    setCreatingGroupTask(true);

    await createGroupTask({
      groupId,
      title,
      description: newGroupTaskDescription,
      priority: newGroupTaskPriority,
      createdByUid: currentUser.uid,
      createdByName: currentUser.displayName ?? currentUser.email ?? null,
      createdByEmail: currentUser.email ?? null,
      dueAtMs: getNewGroupTaskDueAtMs(),
    });

    setNewGroupTaskTitle("");
setNewGroupTaskDescription("");
setNewGroupTaskPriority(null);
setNewGroupTaskDuePreset(null);
setShowCreateGroupTaskModal(false);
  } catch (e: any) {
    console.log("[GroupDashboard] create group task failed", e);
    Alert.alert("Task failed", e?.message ?? "Unknown error");
  } finally {
    setCreatingGroupTask(false);
  }
};

const handleClaimGroupTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (task.status !== "unclaimed") {
    Alert.alert("Already claimed", "This shared task is no longer open.");
    return;
  }

  try {
    setClaimingGroupTaskIds((current) => new Set(current).add(task.id));

    await claimGroupTask({
      groupId,
      taskId: task.id,
      claimedByUid: currentUser.uid,
      claimedByName: currentUser.displayName ?? currentUser.email ?? null,
      claimedByEmail: currentUser.email ?? null,
    });
  } catch (e: any) {
    console.log("[GroupDashboard] claim group task failed", e);
    Alert.alert("Claim failed", e?.message ?? "Unknown error");
  } finally {
    setClaimingGroupTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};



const handleReleaseGroupTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setReleasingGroupTaskIds((current) => new Set(current).add(task.id));

    await releaseGroupTask({
      groupId,
      taskId: task.id,
      releasedByUid: currentUser.uid,
      releasedByName: currentUser.displayName ?? currentUser.email ?? null,
      releasedByEmail: currentUser.email ?? null,
    });
  } catch (e: any) {
    console.log("[GroupDashboard] release group task failed", e);
    Alert.alert("Release failed", e?.message ?? "Unknown error");
  } finally {
    setReleasingGroupTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleCompleteGroupTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setCompletingGroupTaskIds((current) => new Set(current).add(task.id));

    await completeGroupTask({
      groupId,
      taskId: task.id,
      completedByUid: currentUser.uid,
      completedByName: currentUser.displayName ?? currentUser.email ?? null,
      completedByEmail: currentUser.email ?? null,
    });
    showGroupCelebration(`🎉 Nice work completing "${task.title}"!`);
  } catch (e: any) {
    console.log("[GroupDashboard] complete group task failed", e);
    Alert.alert("Complete failed", e?.message ?? "Unknown error");
  } finally {
    setCompletingGroupTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleReopenGroupTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setReopeningGroupTaskIds((current) => new Set(current).add(task.id));

    await reopenGroupTask({
      groupId,
      taskId: task.id,
      reopenedByUid: currentUser.uid,
      reopenedByName: currentUser.displayName ?? currentUser.email ?? null,
      reopenedByEmail: currentUser.email ?? null,
    });
  } catch (e: any) {
    console.log("[GroupDashboard] reopen group task failed", e);
    Alert.alert("Reopen failed", e?.message ?? "Unknown error");
  } finally {
    setReopeningGroupTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleToggleActivityReaction = async (
  activity: GroupActivityDoc,
  emoji: GroupActivityReactionEmoji
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!groupId) {
    Alert.alert("Not ready", "Group is not loaded yet.");
    return;
  }

  const existingReaction = getMyActivityReaction(activity.id);

  try {
    if (existingReaction?.emoji === emoji) {
      await removeGroupActivityReaction({
        groupId,
        activityId: activity.id,
        uid: currentUser.uid,
      });
      return;
    }

    await upsertGroupActivityReaction({
      groupId,
      activityId: activity.id,
      uid: currentUser.uid,
      emoji,
      displayName: currentUser.displayName ?? currentUser.email ?? null,
      email: currentUser.email ?? null,
    });
  } catch (err: any) {
    console.log("[GroupDashboard] toggle activity reaction failed", err);
    Alert.alert("Reaction failed", err?.message ?? "Unknown error");
  }
};

const handleInviteMember = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setInviteBusy(true);

    await createGroupInvite({
  groupId,
  invitedEmail: inviteEmail,
  invitedByUid: currentUser.uid,
  invitedByName: currentUser.displayName ?? currentUser.email ?? null,
  role: inviteRole,
});

    setInviteEmail("");
    Alert.alert("Invite sent", "The invite was created in the app.");
  } catch (e: any) {
    Alert.alert("Invite failed", e?.message ?? "Unknown error");
  } finally {
    setInviteBusy(false);
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
  Alert.alert("Comment too long", `Comments must be ${COMMENT_MAX_LENGTH} characters or fewer.`);
  return;
}

const optimisticId = `optimistic-${Date.now()}`;

const optimisticComment: GroupGoalCommentDoc = {
  id: optimisticId,
  groupId,
  goalId: sharedGoal.id,
  body,
  authorUid: currentUser.uid,
  authorName: currentUser.displayName ?? currentUser.email ?? null,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  attachments: [],
  attachmentCount: 0,
};

setOptimisticCommentsByGoalId((current) => ({
  ...current,
  [sharedGoal.id]: [
    optimisticComment,
    ...(current[sharedGoal.id] ?? []),
  ],
}));

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
  console.log("[GroupDashboard] clear typing after comment failed", err);
});

setOptimisticCommentsByGoalId((current) => ({
  ...current,
  [sharedGoal.id]: (current[sharedGoal.id] ?? []).filter(
    (comment) => comment.id !== optimisticId
  ),
}));

    setCommentInputsByGoalId((current) => ({
      ...current,
      [sharedGoal.id]: "",
    }));
  } catch (e: any) {
    console.log("[GroupDashboard] create comment failed", e);
    setOptimisticCommentsByGoalId((current) => ({
  ...current,
  [sharedGoal.id]: (current[sharedGoal.id] ?? []).filter(
    (comment) => comment.id !== optimisticId
  ),
}));
    Alert.alert("Comment failed", e?.message ?? "Unknown error");
  } finally {
    setCommentBusyGoalIds((current) => {
      const next = new Set(current);
      next.delete(sharedGoal.id);
      return next;
    });
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
    console.log("[GroupDashboard] update typing failed", err);
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

    Alert.alert(
      "Task assigned",
      `"${assignmentPickerTarget.subtaskTitle}" was assigned to ${
        member.displayName ?? member.email ?? "this member"
      }.`
    );
  } catch (e: any) {
    console.log("[GroupDashboard] assign task failed", e);
    Alert.alert("Assign failed", e?.message ?? "Unknown error");
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
      unassignedByName:
        currentUser.displayName ?? currentUser.email ?? null,
    });

    setAssignmentPickerTarget(null);
  } catch (e: any) {
    console.log("[GroupDashboard] unassign task failed", e);
    Alert.alert("Unassign failed", e?.message ?? "Unknown error");
  } finally {
    setAssigningTask(false);
  }
};

const handleRemoveMember = async (member: GroupMemberDoc) => {
  const memberLabel = member.displayName ?? member.email ?? "this member";

  if (member.role === "owner") {
    Alert.alert(
      "Cannot remove owner",
      "Transfer ownership first before removing the owner."
    );
    return;
  }

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
    `Remove ${memberLabel} from this group?\n\nThey will lose access to shared goals, group tasks, comments, and group activity.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove member",
        style: "destructive",
        onPress: async () => {
          try {
            setRemovingMemberIds((current) => new Set(current).add(member.uid));

            await removeGroupMember({
              groupId,
              memberUid: member.uid,
            });
          } catch (e: any) {
            console.log("[GroupDashboard] remove member failed", e);
            Alert.alert("Remove failed", e?.message ?? "Unknown error");
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

const handleLeaveGroup = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || leavingGroup) {
    return;
  }

  if (currentUserRole === "owner") {
    Alert.alert(
      "Owner cannot leave yet",
      "Transfer ownership will be added later. For now, group owners cannot leave their own group."
    );
    return;
  }

  Alert.alert(
    "Leave group?",
    "You will lose access to shared goals, shared tasks, bulletins, direct messages, group conversations, and group activity.\n\nYou can be invited again later.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave group",
        style: "destructive",
        onPress: async () => {
          try {
            setLeavingGroup(true);

            await leaveGroup({
              groupId,
              uid: currentUser.uid,
            });

            router.replace("/(tabs)/groups");
          } catch (err: any) {
            console.log("[GroupDashboard] leave group failed", err);
            Alert.alert("Leave failed", err?.message ?? "Please try again.");
          } finally {
            setLeavingGroup(false);
          }
        },
      },
    ]
  );
};

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
    });

    router.push(`/group/${groupId}/dm/${dmId}` as any);
  } catch (err: any) {
    console.log("[GroupDashboard] open DM failed", err);
    Alert.alert("Message failed", err?.message ?? "Please try again.");
  } finally {
    setOpeningDmMemberIds((current) => {
      const next = new Set(current);
      next.delete(member.uid);
      return next;
    });
  }
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
    `${member.displayName ?? member.email ?? "This member"} will be removed and prevented from rejoining this group.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            setBlockingMemberIds((current) => new Set(current).add(member.uid));

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
            console.log("[GroupDashboard] block member failed", err);
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

  if (member.role === "owner") {
    Alert.alert(
      "Owner role is locked",
      "Ownership transfer will be handled separately."
    );
    return;
  }

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
    `Change ${memberLabel} from ${member.role} to ${role}?\n\nThis will update what they can do in this group.`,
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
          } catch (e: any) {
            console.log("[GroupDashboard] update role failed", e);
            Alert.alert("Role update failed", e?.message ?? "Unknown error");
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

const handleSaveDiscoverySettings = async () => {
  if (!groupId || !canEditDiscoverySettings || savingDiscoverySettings) {
    return;
  }

  try {
    setSavingDiscoverySettings(true);

    const isPublic = discoveryJoinPolicy !== "invite_only";

    await updateGroupDiscoverySettings({
      groupId,
      visibility: isPublic ? "searchable" : "invite_only",
      discoverable: isPublic,
      joinPolicy: discoveryJoinPolicy,
      category: discoveryCategory,
      summary: discoverySummary.trim() || group?.description || null,
    });

    setEditingDiscoverySettings(false);
  } catch (err: any) {
    console.log("[GroupDashboard] save discovery settings failed", err);
    Alert.alert(
      "Could not save discovery settings",
      err?.message ?? "Please try again."
    );
  } finally {
    setSavingDiscoverySettings(false);
  }
};

const handleToggleGroupNotificationsMuted = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || updatingNotificationPreferences) {
    return;
  }

  try {
    setUpdatingNotificationPreferences(true);

    await setGroupNotificationsMuted({
      uid: currentUser.uid,
      groupId,
      muted: !groupNotificationPreferences.muted,
    });
  } catch (err) {
    console.log("[GroupDashboard] toggle group notifications failed", err);
    Alert.alert(
      "Could not update notifications",
      "Please try again in a moment."
    );
  } finally {
    setUpdatingNotificationPreferences(false);
  }
};

const handleToggleGroupNotificationCategory = async (
  category: GroupNotificationCategory
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || updatingNotificationPreferences) {
    return;
  }

  try {
    setUpdatingNotificationPreferences(true);

    await setGroupNotificationCategoryEnabled({
      uid: currentUser.uid,
      groupId,
      category,
      enabled: !groupNotificationPreferences.categories[category],
    });
  } catch (err) {
    console.log("[GroupDashboard] toggle notification category failed", err);
    Alert.alert(
      "Could not update notifications",
      "Please try again in a moment."
    );
  } finally {
    setUpdatingNotificationPreferences(false);
  }
};

const openReportedTarget = (report: GroupReportDoc) => {
  if (
    (report.targetType === "bulletin" ||
      report.targetType === "bulletin_comment") &&
    report.bulletinId
  ) {
    router.push({
      pathname: "/group/[id]/bulletin/[bulletinId]",
      params: {
        id: groupId,
        bulletinId: report.bulletinId,
      },
    });
    return;
  }

  if (report.taskId) {
    router.push(`/group/${groupId}/task/${report.taskId}`);
    return;
  }

  if (report.goalId) {
    router.push({
      pathname: "/goal/[id]",
      params: { id: report.goalId },
    });
  }
};

const handleUpdateReportStatus = async (
  report: GroupReportDoc,
  status: GroupReportDoc["status"]
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || updatingReportIds.has(report.id)) {
    return;
  }

  try {
    setUpdatingReportIds((current) => new Set(current).add(report.id));

    await updateGroupReportStatus({
      groupId,
      reportId: report.id,
      status,
      reviewedByUid: currentUser.uid,
      reviewedByName: currentUser.displayName ?? currentUser.email ?? null,
      resolutionNote:
        status === "resolved"
          ? "Marked resolved from moderation queue."
          : status === "dismissed"
          ? "Dismissed from moderation queue."
          : null,
    });
  } catch (err: any) {
    console.log("[GroupDashboard] update report status failed", err);
    Alert.alert("Could not update report", err?.message ?? "Please try again.");
  } finally {
    setUpdatingReportIds((current) => {
      const next = new Set(current);
      next.delete(report.id);
      return next;
    });
  }
};

const handleHideReportedContent = async (report: GroupReportDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || hidingReportIds.has(report.id)) {
    return;
  }

  Alert.alert(
    "Hide reported content?",
    "This will hide the content from the group without deleting the audit trail.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Hide content",
        style: "destructive",
        onPress: async () => {
          try {
            setHidingReportIds((current) => new Set(current).add(report.id));

            await hideModerationTarget({
              groupId,
              targetType: report.targetType,
              targetId: report.targetId,
              reportId: report.id,
              hiddenByUid: currentUser.uid,
              hiddenByName:
                currentUser.displayName ?? currentUser.email ?? null,
              reason: `Report reason: ${formatReportReasonLabel(report.reason)}`,
              goalId: report.goalId ?? null,
              taskId: report.taskId ?? null,
               bulletinId: report.bulletinId ?? null,
               targetPreviewTitle: report.targetPreviewTitle ?? null,
targetPreviewBody: report.targetPreviewBody ?? null,

            });

          
          } catch (err: any) {
            console.log("[GroupDashboard] hide reported content failed", err);
            Alert.alert(
              "Could not hide content",
              err?.message ?? "Please try again."
            );
          } finally {
            setHidingReportIds((current) => {
              const next = new Set(current);
              next.delete(report.id);
              return next;
            });
          }
        },
      },
    ]
  );
};

const handleApproveJoinRequest = async (
  request: GroupJoinRequestDoc
) => {
  const currentUser = auth.currentUser;

  if (
    !currentUser?.uid ||
    !groupId ||
    reviewingJoinRequestIds.has(request.id)
  ) {
    return;
  }

  try {
    setReviewingJoinRequestIds(
      (current) => new Set(current).add(request.id)
    );

    await approveJoinRequest({
      groupId,
      requestUid: request.uid,
      reviewedByUid: currentUser.uid,
      reviewedByName:
        currentUser.displayName ?? currentUser.email ?? null,
    });

    Alert.alert(
      "Request approved",
      "The member has been added to the group."
    );
  } catch (err: any) {
    console.log(
      "[GroupDashboard] approve join request failed",
      err
    );

    Alert.alert(
      "Approve failed",
      err?.message ?? "Please try again."
    );
  } finally {
    setReviewingJoinRequestIds((current) => {
      const next = new Set(current);
      next.delete(request.id);
      return next;
    });
  }
};

const handleDeclineJoinRequest = async (
  request: GroupJoinRequestDoc
) => {
  const currentUser = auth.currentUser;

  if (
    !currentUser?.uid ||
    !groupId ||
    reviewingJoinRequestIds.has(request.id)
  ) {
    return;
  }

  try {
    setReviewingJoinRequestIds(
      (current) => new Set(current).add(request.id)
    );

    await declineJoinRequest({
      groupId,
      requestUid: request.uid,
      reviewedByUid: currentUser.uid,
      reviewedByName:
        currentUser.displayName ?? currentUser.email ?? null,
    });
  } catch (err: any) {
    console.log(
      "[GroupDashboard] decline join request failed",
      err
    );

    Alert.alert(
      "Decline failed",
      err?.message ?? "Please try again."
    );
  } finally {
    setReviewingJoinRequestIds((current) => {
      const next = new Set(current);
      next.delete(request.id);
      return next;
    });
  }
};

  const currentUserMember = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  if (!currentUid) return null;

  return members.find((member) => member.uid === currentUid) ?? null;
}, [members]);

const groupInboxPreviewItems = useMemo(() => {
  return groupInboxItems
    .filter((item) => item.groupId === groupId)
    .slice(0, 5);
}, [groupInboxItems, groupId]);

const unreadGroupInboxCount = useMemo(() => {
  return groupInboxPreviewItems.filter((item) => !item.readAtMs).length;
}, [groupInboxPreviewItems]);

const currentUserRole = currentUserMember?.role ?? null;

const canManageGroup = canManageGroupMembers(currentUserRole);
const canInviteMembers = canManageGroupInvites(currentUserRole);
const canCreateGroupCalendar = canCreateGroupCalendarEvent(
  currentUserRole,
  currentUserMember?.status ?? "removed"
);

useEffect(() => {
  if (!groupId || !currentUserMember) {
    setGroupCalendarPreview([]);
    setLoadingGroupCalendarPreview(false);
    setGroupCalendarPreviewError(false);
    return;
  }

  setLoadingGroupCalendarPreview(true);
  setGroupCalendarPreviewError(false);

  return subscribeUpcomingGroupCalendarEvents(
    groupId,
    { lowerBoundMs: Date.now(), limit: 3 },
    (events) => {
      setGroupCalendarPreview(events);
      setLoadingGroupCalendarPreview(false);
    },
    () => {
      console.log("[GroupDashboard] calendar preview subscription failed", {
        groupId,
      });
      setGroupCalendarPreview([]);
      setGroupCalendarPreviewError(true);
      setLoadingGroupCalendarPreview(false);
    }
  );
}, [currentUserMember, groupId]);

useEffect(() => {
  if (!groupId || currentUserMember?.status !== "active") {
    setGroupRoutinePreview([]);
    setLoadingGroupRoutinePreview(false);
    setGroupRoutinePreviewError(false);
    return;
  }
  setLoadingGroupRoutinePreview(true);
  setGroupRoutinePreviewError(false);
  return subscribeActiveGroupRoutines(
    groupId,
    { limit: 4 },
    (routines) => {
      setGroupRoutinePreview(routines);
      setLoadingGroupRoutinePreview(false);
      setGroupRoutinePreviewError(false);
    },
    () => {
      console.log("[GroupDashboard] routine preview subscription failed", {
        groupId,
      });
      setGroupRoutinePreview([]);
      setGroupRoutinePreviewError(true);
      setLoadingGroupRoutinePreview(false);
    }
  );
}, [currentUserMember?.status, groupId]);

useEffect(() => {
  if (!groupId || currentUserMember?.status !== "active") {
    setTodayRoutineOccurrences([]);
    return;
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return subscribeGroupRoutineOccurrencesForRange(
    groupId,
    start.getTime(),
    end.getTime(),
    setTodayRoutineOccurrences,
    () => setTodayRoutineOccurrences([]),
    { limit: 100 }
  );
}, [currentUserMember?.status, groupId]);

const handleCreateGroupPlanningBoard = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!groupId) {
    Alert.alert("Group not found", "This group is not available.");
    return;
  }

  if (!canManageGroup) {
    Alert.alert(
      "Not allowed",
      "Only group owners and admins can create planning boards."
    );
    return;
  }

  const title = newGroupBoardTitle.trim();

  if (!title) {
    Alert.alert("Board title required", "Add a board title first.");
    return;
  }

  setSavingGroupBoard(true);

  try {
    await createPlanningBoard({
      title,
      scope: "group",
      createdByUid: currentUser.uid,
      ownerUid: null,
      groupId,
    });

    setNewGroupBoardTitle("");
    setShowCreateGroupBoardForm(false);
  } catch (err: any) {
    console.log(
      "[GroupDashboard] create planning board failed",
      err
    );
    Alert.alert("Could not create board", err?.message ?? "Please try again.");
  } finally {
    setSavingGroupBoard(false);
  }
};

const handleArchiveGroupPlanningBoard = (board: PlanningBoardDoc) => {
  if (!groupId || !canManageGroup || archivingGroupBoardId) return;

  Alert.alert(
    "Archive board?",
    `Archive "${board.title}"? It will no longer appear on the group dashboard.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: async () => {
          setArchivingGroupBoardId(board.id);

          try {
            await archivePlanningBoard({ boardId: board.id });
          } catch (err: any) {
            console.log(
              "[GroupDashboard] archive planning board failed",
              err
            );
            Alert.alert(
              "Could not archive board",
              err?.message ?? "Please try again."
            );
          } finally {
            setArchivingGroupBoardId(null);
          }
        },
      },
    ]
  );
};

const canPostBulletins = canPostGroupBulletins(currentUserRole);

const activeBulletinMentionQuery = useMemo(
  () => getActiveMentionQuery(newBulletinBody),
  [newBulletinBody]
);

const canUseBulletinHereMention =
  canUseGroupHereMention(currentUserRole);

const filteredBulletinMentionMembers = useMemo(() => {
  if (activeBulletinMentionQuery == null) {
    return [];
  }

  return members
    .filter((member) => member.uid !== auth.currentUser?.uid)
    .filter((member) => {
      const token = getMentionTokenForMember(member);
      const label = `${member.displayName ?? ""} ${member.email ?? ""}`
        .trim()
        .toLowerCase();

      if (!activeBulletinMentionQuery) return true;

      return (
        token.includes(activeBulletinMentionQuery) ||
        label.includes(activeBulletinMentionQuery)
      );
    })
    .slice(0, 6);
}, [members, activeBulletinMentionQuery]);

const showBulletinMentionSuggestions =
  activeBulletinMentionQuery != null;

const handleInsertBulletinMention = (member: GroupMemberDoc) => {
  const token = getMentionTokenForMember(member);

  if (!token) return;

  setNewBulletinBody((current) => {
    const activeMatch = current.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);

    if (activeMatch?.index != null) {
      const prefixEnd = activeMatch.index + activeMatch[1].length;
      const prefix = current.slice(0, prefixEnd);
      return `${prefix}@${token} `;
    }

    const needsSpace =
      current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n");

    return `${current}${needsSpace ? " " : ""}@${token} `;
  });
};

const handleInsertBulletinHereMention = () => {
  setNewBulletinBody((current) =>
    current.replace(/(^|\s)@([a-zA-Z0-9._-]*)$/, "$1@here ")
  );
};

const handlePickBulletinImages = async () => {
  const permission =
    await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert(
      "Permission needed",
      "Please allow media access to attach files."
    );
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsMultipleSelection: true,
    quality: 0.85,
    selectionLimit: Math.max(0, 4 - selectedBulletinMedia.length),
  });

  if (result.canceled) return;

  const next: typeof selectedBulletinMedia = [];
  for (const asset of result.assets) {
    const source = (asset.fileName || asset.uri).split("?")[0].toLowerCase();
    const mimeType = asset.mimeType?.toLowerCase() ||
      (source.endsWith(".mp4") ? "video/mp4" :
        source.endsWith(".gif") ? "image/gif" :
          source.endsWith(".png") ? "image/png" :
            source.endsWith(".webp") ? "image/webp" :
              source.endsWith(".jpg") || source.endsWith(".jpeg") ? "image/jpeg" : "");
    const type = mimeType === "video/mp4" ? "video" : mimeType === "image/gif" ? "gif" : "image";
    const candidate = normalizeLocalMediaCandidate({
      localUri: asset.uri,
      type,
      mimeType,
      fileName: asset.fileName,
      sizeBytes: asset.fileSize,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration,
    });
    if (!candidate) continue;
    try {
      validateLocalMediaCandidate(candidate, getMediaAttachmentPolicy("bulletin"));
      next.push({ id: createMediaAttachmentId(), candidate });
    } catch (error: any) {
      Alert.alert("Media not added", error?.message ?? "This file is not supported.");
    }
  }
  setSelectedBulletinMedia((current) => [...current, ...next].slice(0, 4));
};

const handleRemoveSelectedBulletinImage = (attachmentId: string) => {
  setSelectedBulletinMedia((current) =>
    current.filter((item) => item.id !== attachmentId)
  );
};

useEffect(() => {
  if (!groupId || !canInviteMembers) {
    setInvites([]);
    return;
  }

  const unsub = subscribeGroupInvites(
    groupId,
    setInvites,
    (err) => {
      console.log("[GroupDashboard] failed loading invites", err);
    }
  );

  return unsub;
}, [groupId, canInviteMembers]);

const canViewAdminHistory =
  currentUserRole === "owner" || currentUserRole === "admin";

  const canEditDiscoverySettings =
  currentUserRole === "owner" || currentUserRole === "admin";

  useEffect(() => {
  if (!group) return;

  setDiscoveryJoinPolicy(group.joinPolicy ?? "invite_only");
  setDiscoveryCategory(group.category ?? "general");
  setDiscoverySummary(group.summary ?? group.description ?? "");
}, [
  group?.id,
  group?.joinPolicy,
  group?.category,
  group?.summary,
  group?.description,
]);

  const canReviewJoinRequests =
  currentUserRole === "owner" || currentUserRole === "admin";

  const canViewModerationQueue =
  currentUserRole === "owner" ||
  currentUserRole === "admin" ||
  currentUserRole === "moderator";

const openGroupReports = groupReports.filter(
  (report) => report.status === "open" || report.status === "reviewing"
);

const formatReportReasonLabel = (reason: GroupReportReason) => {
  switch (reason) {
    case "spam":
      return "Spam";
    case "harassment":
      return "Harassment";
    case "inappropriate":
      return "Inappropriate";
    case "misleading":
      return "Misleading";
    default:
      return "Other";
  }
};

const formatReportTargetLabel = (report: GroupReportDoc) =>
  formatModerationTargetTypeLabel(report);

 const canModerateContent =
  currentUserRole === "owner" ||
  currentUserRole === "admin" ||
  currentUserRole === "moderator"; 

const loading = loadingGroup || loadingMembers;

useEffect(() => {
  if (focusTarget !== "moderation") return;
  if (!canViewModerationQueue) return;
  if (!moderationQueueRef.current) return;
  if (!scrollViewRef.current) return;

  const timeout = setTimeout(() => {
    const queueNode = findNodeHandle(moderationQueueRef.current);

    if (!queueNode) return;

    moderationQueueRef.current?.measureLayout(
      queueNode,
      (_x, y) => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, y - 24),
          animated: true,
        });
      },
      () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }
    );

    if (focusReportId) {
      setHighlightedReportId(focusReportId);

      setTimeout(() => {
        setHighlightedReportId(null);
      }, 2500);
    }
  }, 450);

  return () => clearTimeout(timeout);
}, [focusTarget, focusReportId, canViewModerationQueue]);

useEffect(() => {
  if (focusTarget !== "joinRequests") return;
  if (!canReviewJoinRequests) return;

  setHighlightJoinRequests(true);

  const timeout = setTimeout(() => {
    setHighlightJoinRequests(false);
  }, 3500);

  return () => clearTimeout(timeout);
}, [focusTarget, canReviewJoinRequests]);

useEffect(() => {
  if (!groupId) {
    setBulletins([]);
    setLoadingBulletins(false);
    setBulletinsError(null);
    return;
  }

  setLoadingBulletins(true);
  setBulletinsError(null);

  const unsub = subscribeGroupBulletins(
    groupId,
    (items) => {
      setBulletins(items.filter((item) => !isHiddenByModeration(item) && !item.deletedByAuthor));
      setLoadingBulletins(false);
    },
    (err) => {
      console.log("[GroupDashboard] bulletin subscription failed", err);
      setBulletinsError("Could not load bulletins.");
      setLoadingBulletins(false);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId || !canReviewJoinRequests) {
    setPendingJoinRequests([]);
    setLoadingJoinRequests(false);
    setJoinRequestsError(null);
    return;
  }

  setLoadingJoinRequests(true);
  setJoinRequestsError(null);

  const unsub = subscribePendingJoinRequests(
    groupId,
    (items) => {
      setPendingJoinRequests(items);
      setLoadingJoinRequests(false);
    },
    (err) => {
      console.log(
        "[GroupDashboard] join requests subscription failed",
        err
      );

      setJoinRequestsError("Could not load join requests.");
      setLoadingJoinRequests(false);
    }
  );

  return unsub;
}, [groupId, canReviewJoinRequests]);



useEffect(() => {
  if (!groupId || !canViewAdminHistory) {
    setAdminLogs([]);
    setLoadingAdminLogs(false);
    return;
  }

  setLoadingAdminLogs(true);
  setAdminLogsError(null);

  const unsub = subscribeGroupAdminLogs(
    groupId,
    (items) => {
      setAdminLogs(items);
      setLoadingAdminLogs(false);
    },
    (err) => {
      console.log("[GroupDashboard] admin logs subscription failed", err);
      setAdminLogsError("Could not load admin history.");
      setLoadingAdminLogs(false);
    }
  );

  return unsub;
}, [groupId, canViewAdminHistory]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    setGroupConversations([]);
    setLoadingGroupConversations(false);
    setGroupConversationsError(null);
    return;
  }

  setLoadingGroupConversations(true);
  setGroupConversationsError(null);

  const unsub = subscribeMyGroupConversations(
    currentUser.uid,
    (items) => {
      setGroupConversations(items.filter((item) => item.groupId === groupId));
      setLoadingGroupConversations(false);
    },
    (err) => {
      console.log("[GroupDashboard] conversations subscription failed", err);
      setGroupConversationsError("Could not load conversations.");
      setLoadingGroupConversations(false);
    },
    groupId
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId || !canModerateContent) {
    setGroupReports([]);
    setLoadingGroupReports(false);
    setGroupReportsError(null);
    return;
  }

  setLoadingGroupReports(true);
  setGroupReportsError(null);

  const unsub = subscribeGroupReports(
    groupId,
    (items) => {
      setGroupReports(items);
      setLoadingGroupReports(false);
    },
    (err) => {
      console.log("[GroupDashboard] reports subscription failed", err);
      setGroupReportsError("Could not load moderation reports.");
      setLoadingGroupReports(false);
    }
  );

  return unsub;
}, [groupId, canModerateContent]);

  return (
    <ScrollView
     ref={scrollViewRef}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Groups</Text>
      </Pressable>

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading group...</Text>
        </View>
      ) : !group ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Group not found</Text>
          <Text style={styles.emptyText}>
            This group may have been deleted or you may not have access.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons
                name="people-outline"
                size={28}
                color={theme.colors.primary}
              />
            </View>

            <Text style={styles.title}>{group.name}</Text>

            {!!group.description && (
              <Text style={styles.subtitle}>{group.description}</Text>
            )}

            <Text style={styles.meta}>
  {members.length} {members.length === 1 ? "member" : "members"} ·{" "}
  {group.visibility}
</Text>

{currentUserRole ? (
  <View style={styles.currentRolePill}>
    <Ionicons
      name="shield-checkmark-outline"
      size={14}
      color={theme.colors.primary}
    />
    <Text style={styles.currentRoleText}>
      Your role: {currentUserRole}
    </Text>
  </View>
) : null}
                    </View>

                    {groupCelebrationText ? (
  <View style={styles.groupCelebrationBanner}>
    <Text style={styles.groupCelebrationText}>
      {groupCelebrationText}
    </Text>
  </View>
) : null}

<View style={styles.card}>
  <Text style={styles.cardTitle}>Messages</Text>

  <Text style={styles.helperText}>
    Direct messages and group conversations for coordinating inside this group.
  </Text>

  {loadingGroupConversations ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading conversations...</Text>
    </View>
  ) : groupConversationsError ? (
    <Text style={styles.errorText}>{groupConversationsError}</Text>
  ) : groupConversations.length === 0 ? (
    <Text style={styles.helperText}>
      No group conversations yet. Create one to start a shared planning thread.
    </Text>
  ) : (
    <View style={styles.groupConversationPreviewList}>
      {groupConversations.slice(0, 3).map((conversation) => (
        <Pressable
          key={conversation.id}
          style={styles.groupConversationPreviewRow}
          onPress={() =>
            router.push(`/group/${groupId}/conversation/${conversation.id}`)
          }
        >
          <Text style={styles.groupConversationPreviewTitle} numberOfLines={1}>
            {conversation.title}
          </Text>

          <Text style={styles.groupConversationPreviewMeta} numberOfLines={1}>
            {conversation.lastMessagePreview
              ? conversation.lastMessagePreview
              : `${conversation.memberUids.length} members`}
          </Text>
        </Pressable>
      ))}

      {groupConversations.length > 3 ? (
        <Text style={styles.groupConversationMoreText}>
          +{groupConversations.length - 3} more conversation
          {groupConversations.length - 3 === 1 ? "" : "s"}
        </Text>
      ) : null}
    </View>
  )}

  <View style={styles.messageCardActionRow}>
    <Pressable
      style={styles.messageCardSecondaryButton}
      onPress={() =>
        Alert.alert(
          "Start a direct message",
          "Choose a group member first, then tap Message on their member card.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Choose member",
              onPress: () => router.push(`/group/${groupId}/members`),
            },
          ]
        )
      }
    >
      <Text style={styles.messageCardSecondaryText}>DM member</Text>
    </Pressable>

    <Pressable
      style={styles.messageCardSecondaryButton}
      onPress={() => setShowCreateConversationModal(true)}
    >
      <Text style={styles.messageCardSecondaryText}>New conversation</Text>
    </Pressable>

    <Pressable
      style={styles.messageCardPrimaryButton}
      onPress={() => router.push(`/group/${groupId}/messages`)}
    >
      <Text style={styles.messageCardPrimaryText}>Inbox →</Text>
    </Pressable>
  </View>
</View>

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => {
  setShowBulletinBoardPanel((prev) => {
    const next = !prev;

    if (!next) {
      setNewBulletinTitle("");
      setNewBulletinBody("");
      setNewBulletinVideoUrl("");
      setSelectedBulletinMedia([]);
    }

    return next;
  });
}}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardTitle}>Bulletin board</Text>

        {bulletins.length > 0 ? (
          <View style={styles.unreadActivityBadge}>
            <Text style={styles.unreadActivityBadgeText}>
              {bulletins.length}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.collapsibleSectionSubtitle}>
        Group-wide announcements and updates
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showBulletinBoardPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showBulletinBoardPanel ? (
    <View style={styles.collapsibleBody}>
      {canPostBulletins ? (
        <View style={styles.bulletinComposer}>
          <Text style={styles.inputLabel}>New bulletin</Text>

          <TextInput
            value={newBulletinTitle}
            onChangeText={setNewBulletinTitle}
            placeholder="Title"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            maxLength={120}
          />

          <TextInput
            value={newBulletinBody}
            onChangeText={setNewBulletinBody}
            placeholder="Share an update with the group"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, styles.textArea]}
            multiline
            maxLength={4000}
          />
<Text style={styles.mentionHelperText}>
  Type @ to mention a member, or @here to notify the group.
</Text>

{showBulletinMentionSuggestions ? (
  <View style={styles.mentionChipRow}>
    {canUseBulletinHereMention &&
    "here".startsWith(activeBulletinMentionQuery) ? (
      <Pressable
        style={styles.mentionChip}
        onPress={handleInsertBulletinHereMention}
      >
        <Text style={styles.mentionChipText}>@here</Text>
      </Pressable>
    ) : null}

    {filteredBulletinMentionMembers.map((member) => {
      const token = getMentionTokenForMember(member);

      return (
        <Pressable
          key={member.uid}
          style={styles.mentionChip}
          onPress={() => handleInsertBulletinMention(member)}
        >
          <Text style={styles.mentionChipText}>@{token}</Text>
        </Pressable>
      );
    })}
  </View>
) : null}
<View style={styles.bulletinImagePickerRow}>
  <Pressable
    style={[
      styles.bulletinImagePickerButton,
      selectedBulletinMedia.length >= 4 && styles.buttonDisabled,
    ]}
    onPress={handlePickBulletinImages}
    disabled={selectedBulletinMedia.length >= 4}
  >
    <Text style={styles.bulletinImagePickerButtonText}>
      {selectedBulletinMedia.length > 0
        ? `Add media (${selectedBulletinMedia.length}/4)`
        : "Add media"}
    </Text>
  </Pressable>
</View>

{selectedBulletinMedia.length > 0 ? (
  <View style={styles.bulletinImagePreviewGrid}>
    {selectedBulletinMedia.map((item) => (
      <View key={item.id} style={styles.bulletinImagePreviewWrap}>
        {item.candidate.type === "video" ? (
          <View style={styles.bulletinImageFallback}>
            <Text style={styles.bulletinImageFallbackText}>MP4 video</Text>
          </View>
        ) : (
          <Image source={{ uri: item.candidate.localUri }} style={styles.bulletinImagePreview} />
        )}

        <Pressable
          style={styles.bulletinImageRemoveButton}
          onPress={() => handleRemoveSelectedBulletinImage(item.id)}
        >
          <Text style={styles.bulletinImageRemoveText}>×</Text>
        </Pressable>
      </View>
    ))}
  </View>
) : null}

<Text style={styles.inputLabel}>Video link optional</Text>

<TextInput
  value={newBulletinVideoUrl}
  onChangeText={setNewBulletinVideoUrl}
  placeholder="Paste a YouTube, Vimeo, or video link"
  placeholderTextColor={theme.colors.textMuted}
  style={styles.input}
  autoCapitalize="none"
  keyboardType="url"
/>
          <Text style={styles.commentLengthText}>
            {newBulletinBody.length}/4000
          </Text>

          <Pressable
            style={[
              styles.button,
              creatingBulletin && styles.buttonDisabled,
            ]}
            onPress={handleCreateBulletin}
            disabled={creatingBulletin}
          >
<Text style={styles.buttonText}>
  {creatingBulletin
    ? selectedBulletinMedia.length > 0
      ? `Uploading ${Math.round(bulletinUploadProgress * 100)}%...`
      : "Posting..."
    : "Post bulletin"}
</Text>

          </Pressable>
          {creatingBulletin && selectedBulletinMedia.length > 0 ? (
  <>
    <Text style={styles.helperText}>
      Preparing and uploading {selectedBulletinMedia.length} attachment
      {selectedBulletinMedia.length === 1 ? "" : "s"} before posting.
    </Text>
    <Pressable onPress={() => activeBulletinUploadRef.current?.cancel()}>
      <Text style={styles.bulletinImagePickerButtonText}>Cancel upload</Text>
    </Pressable>
  </>
) : null}
        </View>
      ) : (
        <Text style={styles.helperText}>
          Owners, admins, and moderators can post bulletins.
        </Text>
      )}

      {loadingBulletins ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading bulletins...</Text>
        </View>
      ) : bulletinsError ? (
        <Text style={styles.errorText}>{bulletinsError}</Text>
      ) : bulletins.length === 0 ? (
        <Text style={styles.groupTaskSectionEmpty}>
          No bulletins yet. Important group updates will appear here.
        </Text>
      ) : (
        <>
          <View style={styles.bulletinList}>
            {bulletins.slice(0, 5).map((bulletin) => (
              <Pressable
                key={bulletin.id}
                style={styles.bulletinRow}
                onPress={() =>
                  router.push({
                    pathname: "/group/[id]/bulletin/[bulletinId]",
                    params: {
                      id: groupId,
                      bulletinId: bulletin.id,
                    },
                  })
                }
              >
                <Text style={styles.bulletinTitle}>
                  {bulletin.title}
                </Text>

<Text style={styles.bulletinBody} numberOfLines={4}>
  {bulletin.body}
</Text>

<MediaAttachmentGrid
  attachments={bulletin.attachments}
  theme={theme}
  onAttachmentPress={(_, index) =>
    setBulletinViewer({
      attachments: bulletin.attachments,
      index,
      title: bulletin.title,
    })
  }
/>

{formatBulletinAttachmentLabel(bulletin) ? (
  <Text style={styles.bulletinAttachmentMeta}>
    {formatBulletinAttachmentLabel(bulletin)}
  </Text>
) : null}

<Text style={styles.bulletinMeta}>
                  {bulletin.authorName ?? bulletin.authorEmail ?? "Someone"} ·{" "}
                  {formatRelativeTime(bulletin.createdAtMs)}
                </Text>
              </Pressable>
            ))}
          </View>

{bulletins.length > 3 ? (
  <Pressable
    style={styles.viewAllActivityButton}
    onPress={() =>
      router.push({
        pathname: "/group/[id]/bulletins",
        params: { id: groupId },
      })
    }
  >
    <Text style={styles.viewAllActivityText}>
      View all bulletins →
    </Text>
  </Pressable>
) : null}
        </>
      )}
    </View>
  ) : null}
</View>

{canEditDiscoverySettings ? (
  <View style={styles.card}>
    <Pressable
      style={styles.collapsibleSectionHeader}
      onPress={() => setShowDiscoverySettings((prev) => !prev)}
    >
      <View style={styles.collapsibleSectionTextWrap}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>Discovery settings</Text>

          <View style={styles.unreadActivityBadge}>
            <Text style={styles.unreadActivityBadgeText}>
              {getGroupDiscoveryStatusLabel(group)}
            </Text>
          </View>
        </View>

        <Text style={styles.collapsibleSectionSubtitle}>
          Explore visibility and join policy
        </Text>
      </View>

      <Text style={styles.collapsibleSectionToggle}>
        {showDiscoverySettings ? "Hide" : "Show"}
      </Text>
    </Pressable>

    {showDiscoverySettings ? (
      <>

      

    <Text style={styles.helperText}>
      Control whether this group appears in Explore and how people can join.
    </Text>

    {editingDiscoverySettings ? (
      <>
        <Text style={styles.discoverySettingsLabel}>Access</Text>

        <View style={styles.discoveryOptionList}>
          {GROUP_JOIN_POLICY_OPTIONS.map((option) => {
            const selected = discoveryJoinPolicy === option.key;

            return (
              <Pressable
                key={option.key}
                style={[
                  styles.discoveryOption,
                  selected && styles.discoveryOptionSelected,
                ]}
                onPress={() => setDiscoveryJoinPolicy(option.key)}
              >
                <Text
                  style={[
                    styles.discoveryOptionTitle,
                    selected && styles.discoveryOptionTitleSelected,
                  ]}
                >
                  {option.title}
                </Text>

                <Text style={styles.discoveryOptionBody}>
                  {option.body}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.discoverySettingsLabel}>Category</Text>

        <View style={styles.discoveryCategoryRow}>
          {GROUP_CATEGORY_OPTIONS.map((option) => {
            const selected = discoveryCategory === option.key;

            return (
              <Pressable
                key={option.key}
                style={[
                  styles.discoveryCategoryChip,
                  selected && styles.discoveryCategoryChipSelected,
                ]}
                onPress={() => setDiscoveryCategory(option.key)}
              >
                <Text
                  style={[
                    styles.discoveryCategoryChipText,
                    selected && styles.discoveryCategoryChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.discoverySettingsLabel}>Public summary</Text>

        <TextInput
          value={discoverySummary}
          onChangeText={setDiscoverySummary}
          placeholder="Short public preview"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, styles.textArea]}
          multiline
        />

        <View style={styles.discoverySettingsActions}>
          <Pressable
            style={styles.discoveryCancelButton}
            onPress={() => setEditingDiscoverySettings(false)}
            disabled={savingDiscoverySettings}
          >
            <Text style={styles.discoveryCancelButtonText}>Cancel</Text>
          </Pressable>

          <Pressable
            style={[
              styles.discoverySaveButton,
              savingDiscoverySettings && styles.buttonDisabled,
            ]}
            onPress={handleSaveDiscoverySettings}
            disabled={savingDiscoverySettings}
          >
            <Text style={styles.discoverySaveButtonText}>
              {savingDiscoverySettings ? "Saving..." : "Save settings"}
            </Text>
          </Pressable>
        </View>
      </>
    ) : (
      <>
        <Text style={styles.discoveryStatusText}>
          {group.summary || group.description || "No public summary yet."}
        </Text>

        <Pressable
  style={styles.discoveryPreviewButton}
  onPress={() =>
    router.push({
      pathname: "/group/[id]/preview",
      params: { id: groupId },
    })
  }
>
  <Text style={styles.discoveryPreviewButtonText}>
    View public preview
  </Text>
</Pressable>

        <Pressable
          style={styles.discoveryEditButton}
          onPress={() => setEditingDiscoverySettings(true)}
        >
          <Text style={styles.discoveryEditButtonText}>
            Edit discovery settings
          </Text>
        </Pressable>
      </>
    )}
        </>
    ) : null}
  </View>
) : null}

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowNotificationsPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Notifications</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {unreadGroupInboxCount > 0
          ? `${unreadGroupInboxCount} unread update${unreadGroupInboxCount === 1 ? "" : "s"}`
          : "Inbox preview and collaboration updates"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showNotificationsPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

 {showNotificationsPanel ? (
  <View style={styles.collapsibleBody}>

  <Pressable
  style={styles.viewInboxButton}
  onPress={() => router.push("/inbox")}
>
  <Text style={styles.viewInboxButtonText}>Open inbox →</Text>
</Pressable>

  <View style={styles.groupInboxHeaderActions}>
    {unreadGroupInboxCount > 0 ? (
      <View style={styles.unreadActivityBadge}>
        <Text style={styles.unreadActivityBadgeText}>
          {unreadGroupInboxCount} new
        </Text>
      </View>
    ) : null}

    {unreadGroupInboxCount > 0 ? (
      <Pressable
        style={styles.groupInboxMarkReadButton}
        onPress={() => {
          const currentUser = auth.currentUser;
          if (!currentUser?.uid) return;

          markAllGroupInboxItemsRead({
            uid: currentUser.uid,
            items: groupInboxPreviewItems,
          }).catch((err) => {
            console.log(
              "[GroupDashboard] mark all inbox read failed",
              err
            );
          });
        }}
      >
        <Text style={styles.groupInboxMarkReadText}>
          Mark read
        </Text>
      </Pressable>
    ) : null}
  </View>


  {groupInboxPreviewItems.length === 0 ? (
    <Text style={styles.helperText}>
  Assignments, comments, and collaboration updates appear here automatically.
</Text>
  ) : (
    <View style={styles.groupInboxList}>
      {groupInboxPreviewItems.map((item) => (
        <Pressable
          key={item.id}
          style={[
            styles.groupInboxRow,
            !item.readAtMs && styles.groupInboxRowUnread,
          ]}
          onPress={() => {
  const currentUser = auth.currentUser;

  if (currentUser?.uid && !item.readAtMs) {
    markGroupInboxItemRead({
      uid: currentUser.uid,
      itemId: item.id,
    }).catch((err) => {
      console.log("[GroupDashboard] mark inbox item read failed", err);
    });
  }

  if (currentUser?.uid) {
    if (item.type === "comment") {
      markGroupReadState({
        groupId: item.groupId,
        uid: currentUser.uid,
        comments: true,
      }).catch((err) => {
        console.log("[GroupDashboard] mark comments read failed", err);
      });
    }

    if (item.type === "assignment") {
      markGroupReadState({
        groupId: item.groupId,
        uid: currentUser.uid,
        assignments: true,
      }).catch((err) => {
        console.log("[GroupDashboard] mark assignments read failed", err);
      });
    }

    if (item.type === "activity") {
      markGroupReadState({
        groupId: item.groupId,
        uid: currentUser.uid,
        activity: true,
      }).catch((err) => {
        console.log("[GroupDashboard] mark activity read failed", err);
      });
    }
  }

  if (item.type === "comment" && item.subtaskId && !item.goalId) {
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
  }
}}
        >
          <Text style={styles.groupInboxTitle} numberOfLines={1}>
            {item.title}
          </Text>

          {!!item.body ? (
            <Text style={styles.groupInboxBody} numberOfLines={2}>
              {item.body}
            </Text>
          ) : null}

          <Text style={styles.groupInboxMeta}>
            {formatRelativeTime(item.createdAtMs)}
          </Text>
        </Pressable>
      ))}
    </View>
  )}
    </View>
  ) : null}
</View>   

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowSharedTaskPool((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardTitle}>Shared task pool</Text>

        {unclaimedGroupTasks.length > 0 ? (
          <View style={styles.unreadActivityBadge}>
            <Text style={styles.unreadActivityBadgeText}>
              {unclaimedGroupTasks.length} open
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.collapsibleSectionSubtitle}>
        {activeGroupTaskCount} active · {attentionGroupTasks.length} needs attention
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showSharedTaskPool ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showSharedTaskPool ? (
      <View style={styles.collapsibleBody}>

<Pressable
  style={styles.groupTaskAddButton}
  onPress={() => setShowCreateGroupTaskModal(true)}
>
  <Text style={styles.groupTaskAddButtonText}>Add</Text>
</Pressable>





  <Text style={styles.helperText}>
  Shared work the group can claim, plan, and complete together.
</Text>

  <View
  style={[
    styles.smartTaskSummaryCard,
    smartGroupTaskSummary.tone === "danger" &&
      styles.smartTaskSummaryCardDanger,
    smartGroupTaskSummary.tone === "warning" &&
      styles.smartTaskSummaryCardWarning,
    smartGroupTaskSummary.tone === "muted" &&
      styles.smartTaskSummaryCardMuted,
  ]}
>
  <Text style={styles.smartTaskSummaryEyebrow}>
  Planning snapshot
</Text>

<Text style={styles.smartTaskSummaryTitle}>
  {smartGroupTaskSummary.title}
</Text>

  <Text style={styles.smartTaskSummaryBody}>
    {smartGroupTaskSummary.body}
  </Text>

  <Text style={styles.smartTaskSummaryMeta}>
    {activeGroupTaskCount} active · {attentionGroupTasks.length} needs attention
  </Text>
</View>
<View style={styles.workloadVisibilityBox}>
 <Text style={styles.workloadVisibilityTitle}>
  Team workload
</Text>

  <Text style={styles.workloadVisibilitySummary}>
    {workloadVisibilitySummary}
  </Text>

  {memberWorkloadSummary.length === 0 ? (
    <Text style={styles.groupTaskSectionEmpty}>
      No members to show yet.
    </Text>
  ) : (
    <View style={styles.workloadVisibilityList}>
      {memberWorkloadSummary.slice(0, 4).map((item) => (
        <View key={item.member.uid} style={styles.workloadVisibilityRow}>
          <View style={styles.workloadVisibilityMain}>
            <Text style={styles.workloadVisibilityName} numberOfLines={1}>
              {item.member.displayName ??
                item.member.email ??
                "Someone"}
            </Text>

            <Text style={styles.workloadVisibilityMeta} numberOfLines={1}>
              {item.presence?.status === "online"
                ? "Online"
                : item.presence?.status === "recent"
                ? "Recently active"
                : "Offline"}{" "}
              · {item.completedCount} completed
            </Text>
          </View>

          <View
            style={[
              styles.workloadVisibilityPill,
              item.claimedCount === 0 &&
                styles.workloadVisibilityPillLow,
            ]}
          >
            <Text
              style={[
                styles.workloadVisibilityPillText,
                item.claimedCount === 0 &&
                  styles.workloadVisibilityPillTextLow,
              ]}
            >
              {item.claimedCount} claimed
            </Text>
          </View>
        </View>
      ))}

      {memberWorkloadSummary.length > 4 ? (
        <Text style={styles.workloadVisibilityMore}>
          +{memberWorkloadSummary.length - 4} more member
          {memberWorkloadSummary.length - 4 === 1 ? "" : "s"}
        </Text>
      ) : null}
    </View>
  )}
</View>

  {loadingGroupTasks ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading shared tasks...</Text>
    </View>
  ) : groupTasksError ? (
    <Text style={styles.errorText}>{groupTasksError}</Text>
  ) : groupTasks.length === 0 ? (
    <Text style={styles.groupTaskEmptyText}>
      No shared tasks yet. Soon you’ll be able to add unclaimed group work here.
    </Text>
  ) : (
    <View style={styles.groupTaskPoolList}>
 <View style={styles.groupTaskSummaryRow}>
  <Text style={styles.groupTaskSummaryText}>
    {activeGroupTaskCount} active · {unclaimedGroupTasks.length} open ·{" "}
{attentionGroupTasks.length} needs attention · {completedGroupTasks.length} completed
  </Text>

  {mostLoadedMember ? (
    <Text style={styles.groupTaskSummarySubtext}>
      Heaviest current load:{" "}
      {mostLoadedMember.member.displayName ??
        mostLoadedMember.member.email ??
        "Someone"}{" "}
      with {mostLoadedMember.claimedCount} claimed
    </Text>
  ) : (
    <Text style={styles.groupTaskSummarySubtext}>
      No one is carrying shared task load right now.
    </Text>
  )}
  <Text style={styles.groupTaskSuggestionText}>
  {groupTaskCoordinationHint}
</Text>
</View>

  <View style={styles.groupTaskSection}>
    <Text style={styles.groupTaskSectionTitle}>
      Open tasks · {unclaimedGroupTasks.length}
    </Text>

    {unclaimedGroupTasks.length === 0 ? (
      <Text style={styles.groupTaskSectionEmpty}>
        Nothing open right now. Add a shared task when the group needs help.
      </Text>
    ) : (
      unclaimedGroupTasks.slice(0, 4).map((task) => (
        <View key={task.id} style={styles.groupTaskPoolRow}>
          <View style={styles.groupTaskPoolMain}>
            <Text style={styles.groupTaskPoolTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.groupTaskPoolMeta} numberOfLines={1}>
  Unclaimed
  {task.priority ? ` · ${task.priority} priority` : ""}
</Text>

{formatGroupTaskDueLabel(task.dueAtMs) ? (
  <Text style={styles.groupTaskDueText}>
    {formatGroupTaskDueLabel(task.dueAtMs)}
  </Text>
) : null}

{getSuggestedHelperForTask(task) ? (
  <View style={styles.suggestedHelperBox}>
    <Text style={styles.groupTaskSuggestionInline} numberOfLines={1}>
      {getSuggestedHelperForTask(task)?.displayName ??
        getSuggestedHelperForTask(task)?.email ??
        "Someone"}{" "}
      may be a good fit
    </Text>

    <Text style={styles.suggestedHelperReason} numberOfLines={1}>
      {getSuggestedHelperReason(getSuggestedHelperForTask(task))}
    </Text>
  </View>
) : null}
          </View>
{getGroupTaskSignalLabel(task) ? (
  <View style={styles.groupTaskSignalPill}>
    <Text style={styles.groupTaskSignalPillText}>
      {getGroupTaskSignalLabel(task)}
    </Text>
  </View>
) : null}
{getSuggestedHelperForTask(task)?.uid === auth.currentUser?.uid ? (
  <View style={styles.suggestedAssigneeChip}>
    <Text style={styles.suggestedAssigneeChipText}>Suggested for you</Text>
  </View>
) : getSuggestedHelperForTask(task) ? (
  <View style={styles.suggestedAssigneeChipMuted}>
    <Text style={styles.suggestedAssigneeChipMutedText}>
      Suggested:{" "}
{getSuggestedHelperForTask(task)?.displayName ??
  getSuggestedHelperForTask(task)?.email ??
  "someone"}
    </Text>
  </View>
) : null}
          <Pressable
            style={[
              styles.groupTaskClaimButton,
              claimingGroupTaskIds.has(task.id) && styles.buttonDisabled,
            ]}
            onPress={() => handleClaimGroupTask(task)}
            disabled={claimingGroupTaskIds.has(task.id)}
          >
            <Text style={styles.groupTaskClaimButtonText}>
              {claimingGroupTaskIds.has(task.id) ? "..." : "Claim"}
            </Text>
          </Pressable>
        </View>
      ))
    )}
  </View>

  <View style={styles.groupTaskSection}>
    <Text style={styles.groupTaskSectionTitle}>
      My claimed tasks · {myClaimedGroupTasks.length}
    </Text>

    {myClaimedGroupTasks.length === 0 ? (
      <Text style={styles.groupTaskSectionEmpty}>
        You have not claimed any shared tasks yet.
      </Text>
    ) : (
      myClaimedGroupTasks.slice(0, 4).map((task) => (
        <View key={task.id} style={styles.groupTaskPoolRow}>
          <View style={styles.groupTaskPoolMain}>
            <Text style={styles.groupTaskPoolTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.groupTaskPoolMeta} numberOfLines={1}>
              Claimed by you
              {task.priority ? ` · ${task.priority} priority` : ""}
            </Text>
          </View>
{getGroupTaskSignalLabel(task) ? (
  <View style={styles.groupTaskSignalPill}>
    <Text style={styles.groupTaskSignalPillText}>
      {getGroupTaskSignalLabel(task)}
    </Text>
  </View>
) : null}
          <View style={styles.groupTaskActionRow}>
            <Pressable
              style={[
                styles.groupTaskCompleteButton,
                completingGroupTaskIds.has(task.id) && styles.buttonDisabled,
              ]}
              onPress={() => handleCompleteGroupTask(task)}
              disabled={completingGroupTaskIds.has(task.id)}
            >
              <Text style={styles.groupTaskCompleteButtonText}>
                {completingGroupTaskIds.has(task.id) ? "..." : "Done"}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.groupTaskReleaseButton,
                releasingGroupTaskIds.has(task.id) && styles.buttonDisabled,
              ]}
              onPress={() => handleReleaseGroupTask(task)}
              disabled={releasingGroupTaskIds.has(task.id)}
            >
              <Text style={styles.groupTaskReleaseButtonText}>
                {releasingGroupTaskIds.has(task.id) ? "..." : "Release"}
              </Text>
            </Pressable>
          </View>
        </View>
      ))
    )}
  </View>

  <View style={styles.groupTaskSection}>
    <Text style={styles.groupTaskSectionTitle}>
      Claimed by others · {claimedByOthersGroupTasks.length}
    </Text>

    {claimedByOthersGroupTasks.length === 0 ? (
      <Text style={styles.groupTaskSectionEmpty}>
        No one else is holding shared tasks right now.
      </Text>
    ) : (
      claimedByOthersGroupTasks.slice(0, 4).map((task) => (
        <View key={task.id} style={styles.groupTaskPoolRow}>
          <View style={styles.groupTaskPoolMain}>
            <Text style={styles.groupTaskPoolTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.groupTaskPoolMeta} numberOfLines={1}>
              Claimed by{" "}
              {task.claimedByName ??
                task.claimedByEmail ??
                task.claimedByUid ??
                "someone"}
            </Text>
          </View>
{getGroupTaskSignalLabel(task) ? (
  <View style={styles.groupTaskSignalPill}>
    <Text style={styles.groupTaskSignalPillText}>
      {getGroupTaskSignalLabel(task)}
    </Text>
  </View>
) : null}
          <View style={styles.groupTaskStatusPillMuted}>
            <Text style={styles.groupTaskStatusPillTextMuted}>
              Claimed
            </Text>
          </View>
        </View>
      ))
    )}
  </View>

  <View style={styles.groupTaskSection}>
    <Text style={styles.groupTaskSectionTitle}>
      Recently completed · {completedGroupTasks.length}
    </Text>

    {completedGroupTasks.length === 0 ? (
      <Text style={styles.groupTaskSectionEmpty}>
        Completed shared tasks will show here.
      </Text>
    ) : (
      completedGroupTasks.slice(0, 3).map((task) => (
        <View key={task.id} style={styles.groupTaskCompletedRow}>
          <View style={styles.groupTaskPoolMain}>
            <Text style={styles.groupTaskCompletedTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.groupTaskPoolMeta} numberOfLines={1}>
              Completed by{" "}
              {task.completedByName ??
                task.completedByUid ??
                "someone"}
            </Text>
          </View>

          <Pressable
            style={[
              styles.groupTaskReleaseButton,
              reopeningGroupTaskIds.has(task.id) && styles.buttonDisabled,
            ]}
            onPress={() => handleReopenGroupTask(task)}
            disabled={reopeningGroupTaskIds.has(task.id)}
          >
            <Text style={styles.groupTaskReleaseButtonText}>
              {reopeningGroupTaskIds.has(task.id) ? "..." : "Reopen"}
            </Text>
          </Pressable>
        </View>
      ))
    )}
  </View>
</View>
  )}
  <Pressable
    style={styles.viewAllActivityButton}
    onPress={() => router.push(`/group/${groupId}/tasks`)}
  >
    <Text style={styles.viewAllActivityText}>View all tasks →</Text>
  </Pressable>
    </View>
  ) : null}
</View>
<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowLiveCollaboration((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Live collaboration</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {onlinePresenceItems.length > 0
          ? `${onlinePresenceItems.length} live now`
          : "Presence and recent activity"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showLiveCollaboration ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showLiveCollaboration ? (
     <View style={styles.collapsibleBody}>

    

  <Text style={styles.helperText}>
    See who is around right now without turning the group into a chat.
  </Text>

  <View
  style={[
    styles.socialPulseBox,
    groupSocialPulse.tone === "live" && styles.socialPulseBoxLive,
    groupSocialPulse.tone === "recent" && styles.socialPulseBoxRecent,
  ]}
>
  <Text
    style={[
      styles.socialPulseTitle,
      groupSocialPulse.tone === "live" && styles.socialPulseTitleLive,
    ]}
  >
    {groupSocialPulse.title}
  </Text>

  <Text style={styles.socialPulseBody}>
    {groupSocialPulse.body}
  </Text>
</View>

  {presenceItems.length === 0 ? (
    <Text style={styles.presenceEmptyText}>
      When members open this group or shared goals, they’ll appear here in realtime.
    </Text>
  ) : (
    <View style={styles.presenceList}>
      {onlinePresenceItems.length > 0 ? (
        <View style={styles.presenceSection}>
          <Text style={styles.presenceSectionTitle}>Active now</Text>

          {onlinePresenceItems.slice(0, 5).map((item) => {
            const presenceDisplay = getPresenceDisplayForMember(item.uid);

            return (
              <View key={item.uid} style={styles.presenceRow}>
                <View style={styles.presenceAvatar}>
                  <Text style={styles.presenceAvatarText}>
                    {(item.displayName ?? item.email ?? "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                </View>

                <View style={styles.presenceInfo}>
                  <View style={styles.presenceNameRow}>
                    <Text style={styles.presenceName} numberOfLines={1}>
                      {item.displayName ?? item.email ?? "Someone"}
                    </Text>

                    {presenceDisplay.isLive ? (
                      <Text style={styles.presenceLivePill}>live</Text>
                    ) : null}
                  </View>

                  <Text style={styles.presenceMeta} numberOfLines={1}>
                    {presenceDisplay.detail}
                  </Text>
                </View>

                <View style={styles.presencePulseWrap}>
  <Animated.View
  style={[
    styles.presencePulseRing,
    presencePulseAnimatedStyle,
  ]}
/>
  <View style={styles.presenceOnlineDot} />
</View>
              </View>
            );
          })}

          {onlinePresenceItems.length > 5 ? (
            <Text style={styles.presenceMoreText}>
              +{onlinePresenceItems.length - 5} more active
            </Text>
          ) : null}
        </View>
      ) : null}

      {recentPresenceItems.length > 0 ? (
        <View style={styles.presenceSection}>
          <Text style={styles.presenceSectionTitle}>Recently around</Text>

          {recentPresenceItems.slice(0, 5).map((item) => {
            const presenceDisplay = getPresenceDisplayForMember(item.uid);

            return (
              <View key={item.uid} style={styles.presenceRow}>
                <View style={styles.presenceAvatar}>
                  <Text style={styles.presenceAvatarText}>
                    {(item.displayName ?? item.email ?? "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                </View>

                <View style={styles.presenceInfo}>
                  <Text style={styles.presenceName} numberOfLines={1}>
                    {item.displayName ?? item.email ?? "Someone"}
                  </Text>

                  <Text style={styles.presenceMeta} numberOfLines={1}>
                    {presenceDisplay.detail}
                  </Text>
                </View>

                <View style={styles.presenceRecentDot} />
              </View>
            );
          })}

          {recentPresenceItems.length > 5 ? (
            <Text style={styles.presenceMoreText}>
              +{recentPresenceItems.length - 5} more recent
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )}
    </View>
  ) : null}
</View>
<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowTeamWins((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Team wins</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {completedGroupTasks.length === 0
          ? "No recent wins yet"
          : `${completedGroupTasks.length} completed shared task${completedGroupTasks.length === 1 ? "" : "s"}`}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showTeamWins ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showTeamWins ? (
      <View style={styles.collapsibleBody}>

   

  {recentSharedWins.length === 0 ? (
    <Text style={styles.helperText}>
      Completed shared tasks will show up here as quiet team wins.
    </Text>
  ) : (
    <View style={styles.teamWinsList}>
      {recentSharedWins.map((task) => (
        <View key={task.id} style={styles.teamWinRow}>
          <Text style={styles.teamWinIcon}>🎉</Text>

          <View style={styles.teamWinBody}>
            <Text style={styles.teamWinTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.teamWinMeta} numberOfLines={1}>
              Completed by{" "}
              {task.completedByName ??
                task.completedByUid ??
                "someone"}
              {task.completedAtMs
                ? ` · ${formatRelativeTime(task.completedAtMs)}`
                : ""}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )}
    </View>
  ) : null}
</View>
<View
  style={[
    styles.card,
    groupMoraleSignal.tone === "celebrating" &&
      styles.groupMoraleCardCelebrating,
    groupMoraleSignal.tone === "needs_attention" &&
      styles.groupMoraleCardNeedsAttention,
  ]}
>
  <View style={styles.groupMoraleHeader}>
    <Text style={styles.groupMoraleEmoji}>
      {groupMoraleSignal.emoji}
    </Text>

    <View style={styles.groupMoraleBody}>
      <Text style={styles.groupMoraleTitle}>
        {groupMoraleSignal.title}
      </Text>

      <Text style={styles.groupMoraleText}>
        {groupMoraleSignal.body}
      </Text>
    </View>
  </View>
</View>

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowMembersPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Members</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {members.length} member{members.length === 1 ? "" : "s"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showMembersPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

 {showMembersPanel ? (
  <>
    <Text style={styles.helperText}>
      {members.length === 0
        ? "No active members found yet."
        : "View members, manage roles, remove members, or block access."}
    </Text>

    <Pressable
      style={styles.viewAllActivityButton}
      onPress={() => router.push(`/group/${groupId}/members`)}
    >
      <Text style={styles.viewAllActivityText}>
        Manage members →
      </Text>
    </Pressable>

    {currentUserRole && currentUserRole !== "owner" ? (
      <View style={styles.leaveGroupFooter}>
        <Text style={styles.leaveGroupFooterText}>
          Leaving removes your access to this group, including shared goals,
          tasks, bulletins, and DMs.
        </Text>

        <Pressable
          style={[
            styles.leaveGroupButton,
            leavingGroup && styles.buttonDisabled,
          ]}
          onPress={handleLeaveGroup}
          disabled={leavingGroup}
        >
          <Text style={styles.leaveGroupButtonText}>
            {leavingGroup ? "Leaving..." : "Leave group"}
          </Text>
        </Pressable>
      </View>
    ) : null}
  </>
) : null}
</View>

{canReviewJoinRequests ? (
  <View
    style={[
      styles.card,
      highlightJoinRequests && styles.joinRequestsCardHighlighted,
    ]}
  >
    <Pressable
      style={styles.collapsibleSectionHeader}
      onPress={() => setShowJoinRequestsPanel((prev) => !prev)}
    >
      <View style={styles.collapsibleSectionTextWrap}>
        <Text style={styles.cardTitle}>Join requests</Text>
        <Text style={styles.collapsibleSectionSubtitle}>
          {pendingJoinRequests.length === 0
            ? "No pending requests"
            : `${pendingJoinRequests.length} pending request${
                pendingJoinRequests.length === 1 ? "" : "s"
              }`}
        </Text>
      </View>

      {pendingJoinRequests.length > 0 ? (
        <View style={styles.unreadActivityBadge}>
          <Text style={styles.unreadActivityBadgeText}>
            {pendingJoinRequests.length} pending
          </Text>
        </View>
      ) : null}

      <Text style={styles.collapsibleSectionToggle}>
        {showJoinRequestsPanel ? "Hide" : "Show"}
      </Text>
    </Pressable>

    {showJoinRequestsPanel ? (
      <View style={styles.collapsibleBody}>
        <Text style={styles.helperText}>
          Review people asking to join this group. Approve trusted requests,
          decline ones that do not fit, or block users who should not be able to
          request again.
        </Text>

        {highlightJoinRequests ? (
          <Text style={styles.joinRequestsFocusHint}>
            Opened from inbox · review pending requests here.
          </Text>
        ) : null}

        {loadingJoinRequests ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading join requests...</Text>
          </View>
        ) : joinRequestsError ? (
          <Text style={styles.errorText}>{joinRequestsError}</Text>
        ) : pendingJoinRequests.length === 0 ? (
          <Text style={styles.helperText}>
            No pending join requests. New requests from Explore will appear here
            for admin review.
          </Text>
        ) : (
          <View style={styles.joinRequestList}>
            {pendingJoinRequests.slice(0, 3).map((request) => {
              const busy = reviewingJoinRequestIds.has(request.id);

              return (
                <View key={request.id} style={styles.joinRequestRow}>
                  <Text style={styles.joinRequestName}>
                    {request.displayName ?? request.email ?? request.uid}
                  </Text>

                  {!!request.email ? (
                    <Text style={styles.joinRequestMeta}>{request.email}</Text>
                  ) : null}

                  <Text style={styles.joinRequestMeta}>
                    Requested {formatRelativeTime(request.createdAtMs)}
                  </Text>

                  {!!request.message ? (
                    <Text style={styles.joinRequestMessage}>
                      {request.message}
                    </Text>
                  ) : null}

                  <View style={styles.joinRequestActions}>
                    <Pressable
                      style={[
                        styles.declineJoinRequestButton,
                        busy && styles.buttonDisabled,
                      ]}
                      onPress={() => handleDeclineJoinRequest(request)}
                      disabled={busy}
                    >
                      <Text style={styles.declineJoinRequestButtonText}>
                        Decline
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.approveJoinRequestButton,
                        busy && styles.buttonDisabled,
                      ]}
                      onPress={() => handleApproveJoinRequest(request)}
                      disabled={busy}
                    >
                      <Text style={styles.approveJoinRequestButtonText}>
                        {busy ? "Reviewing..." : "Approve"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {pendingJoinRequests.length > 3 ? (
          <Pressable
            style={styles.viewAllActivityButton}
            onPress={() => router.push(`/group/${groupId}/join-requests`)}
          >
            <Text style={styles.viewAllActivityText}>
              View all join requests →
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null}
  </View>
) : null}

{canViewAdminHistory ? (
  <View style={styles.card}>
    <Pressable
      style={styles.collapsibleSectionHeader}
      onPress={() => setShowAdminHistoryPanel((prev) => !prev)}
    >
      <View style={styles.collapsibleSectionTextWrap}>
        <Text style={styles.cardTitle}>Admin history</Text>
        <Text style={styles.collapsibleSectionSubtitle}>
          {adminLogs.length === 0
            ? "No admin actions yet"
            : `${Math.min(adminLogs.length, 3)} recent action${
                Math.min(adminLogs.length, 3) === 1 ? "" : "s"
              }`}
        </Text>
      </View>

      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>Safety</Text>
      </View>

      <Text style={styles.collapsibleSectionToggle}>
        {showAdminHistoryPanel ? "Hide" : "Show"}
      </Text>
    </Pressable>

    {showAdminHistoryPanel ? (
      <View style={styles.collapsibleBody}>
        <Text style={styles.helperText}>
          Recent member, invite, and role-management actions.
        </Text>

        {loadingAdminLogs ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading admin history...</Text>
          </View>
        ) : adminLogsError ? (
          <Text style={styles.errorText}>{adminLogsError}</Text>
        ) : adminLogs.length === 0 ? (
          <Text style={styles.helperText}>
            No admin actions have been recorded yet.
          </Text>
        ) : (
          <View style={styles.adminHistoryList}>
            {adminLogs.slice(0, 3).map((log) => (
              <View key={log.id} style={styles.adminHistoryRow}>
                <Text style={styles.adminHistoryMessage}>
                  {log.message}
                </Text>

                <Text style={styles.adminHistoryMeta}>
                  {log.actorName ?? log.actorEmail ?? "Someone"} ·{" "}
                  {formatRelativeTime(log.createdAtMs)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {adminLogs.length > 3 ? (
          <Pressable
            style={styles.viewAllActivityButton}
            onPress={() => router.push(`/group/${groupId}/admin-history`)}
          >
            <Text style={styles.viewAllActivityText}>
              View full admin history →
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null}
  </View>
) : null} 

      {canManageGroup ? (
  <View style={[styles.card, styles.utilityAdminCard]}>
    <View style={styles.cardTitleRow}>
      <Text style={styles.cardTitle}>
        Safety tools
      </Text>

      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>
          Admin
        </Text>
      </View>
    </View>

    <Text style={styles.helperText}>
      Manage blocked users and future moderation tools.
    </Text>

    <Pressable
      style={styles.viewAllActivityButton}
      onPress={() =>
        router.push(`/group/${groupId}/blocked`)
      }
    >
      <Text style={styles.viewAllActivityText}>
        Blocked users →
      </Text>
    </Pressable>
  </View>
) : null}

{canViewModerationQueue ? (
  <View ref={moderationQueueRef} style={styles.card}>
    <Pressable
      style={styles.collapsibleSectionHeader}
      onPress={() => setShowModerationQueuePanel((prev) => !prev)}
    >
      <View style={styles.collapsibleSectionTextWrap}>
        <Text style={styles.cardTitle}>Moderation queue</Text>
        <Text style={styles.collapsibleSectionSubtitle}>
          {openGroupReports.length === 0
            ? "No open reports"
            : `${openGroupReports.length} open report${
                openGroupReports.length === 1 ? "" : "s"
              }`}
        </Text>
      </View>

      {openGroupReports.length > 0 ? (
        <View style={styles.unreadActivityBadge}>
          <Text style={styles.unreadActivityBadgeText}>
            {openGroupReports.length} open
          </Text>
        </View>
      ) : null}

      <Text style={styles.collapsibleSectionToggle}>
        {showModerationQueuePanel ? "Hide" : "Show"}
      </Text>
    </Pressable>

    {showModerationQueuePanel ? (
      <View style={styles.collapsibleBody}>
        <Text style={styles.helperText}>
          Reports from group members that may need moderator review.
        </Text>

        {focusTarget === "moderation" ? (
          <Text style={styles.moderationFocusHint}>
            Opened from inbox
            {focusReportId ? ` · Report ${focusReportId.slice(0, 6)}` : ""}
          </Text>
        ) : null}

        {loadingGroupReports ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading reports...</Text>
          </View>
        ) : groupReportsError ? (
          <Text style={styles.errorText}>{groupReportsError}</Text>
        ) : groupReports.length === 0 ? (
          <Text style={styles.helperText}>
            No reports have been submitted yet.
          </Text>
        ) : (
          <View style={styles.moderationReportList}>
            {groupReports.slice(0, 3).map((report) => {
              const viewerUid = auth.currentUser?.uid ?? null;

              const isSelfModerationConflict =
                report.reporterUid === viewerUid ||
                report.targetAuthorUid === viewerUid;

              return (
                <View
                  key={report.id}
                  style={[
                    styles.moderationReportRow,
                    highlightedReportId === report.id &&
                      styles.moderationReportRowHighlighted,
                  ]}
                >
                  <View style={styles.moderationReportHeader}>
                    <Text style={styles.moderationReportTitle}>
                      {formatReportTargetLabel(report)}
                    </Text>

                    <View style={styles.moderationStatusPill}>
                      <Text style={styles.moderationStatusPillText}>
                        {report.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.moderationReportMeta}>
                    Reason: {formatReportReasonLabel(report.reason)}
                  </Text>

                  {report.targetPreviewTitle ? (
  <View style={styles.moderationReportPreviewBox}>
    <Text style={styles.moderationReportPreviewTitle}>
      {report.targetPreviewTitle}
    </Text>

    {report.targetPreviewBody ? (
      <Text style={styles.moderationReportPreviewBody} numberOfLines={3}>
        {report.targetPreviewBody}
      </Text>
    ) : null}
  </View>
) : null}

<Text style={styles.moderationReportMeta}>
  Target: {report.targetAuthorName ?? "Unknown author"}
</Text>

                  {!!report.note ? (
                    <Text style={styles.moderationReportNote} numberOfLines={2}>
                      “{report.note}”
                    </Text>
                  ) : null}

                  {!!report.moderatorNote ? (
                    <Text style={styles.moderationModeratorNote}>
                      Moderator note: {report.moderatorNote}
                    </Text>
                  ) : null}

                  {formatModeratorActionLabel(report) ? (
                    <Text style={styles.moderationActionHistoryText}>
                      {formatModeratorActionLabel(report)}
                    </Text>
                  ) : null}

                  <Text style={styles.moderationReportMeta}>
                    Reported by{" "}
                    {report.reporterName ?? report.reporterEmail ?? "Someone"} ·{" "}
                    {formatRelativeTime(report.createdAtMs)}
                  </Text>

                  {isSelfModerationConflict ? (
                    <Text style={styles.moderationConflictText}>
                      You cannot moderate a report involving your own content or report.
                    </Text>
) : (
  <View style={styles.moderationActionRow}>
    {report.goalId || report.taskId || report.bulletinId ? (
      <Pressable
        style={styles.moderationActionButton}
        onPress={() => openReportedTarget(report)}
      >
        <Text style={styles.moderationActionButtonText}>
          Open target
        </Text>
      </Pressable>
    ) : null}

    {report.status !== "resolved" &&
    report.status !== "dismissed" ? (
                        <Pressable
                          style={[
                            styles.moderationActionButtonDanger,
                            hidingReportIds.has(report.id) && styles.buttonDisabled,
                          ]}
                          onPress={() => handleHideReportedContent(report)}
                          disabled={hidingReportIds.has(report.id)}
                        >
                          <Text style={styles.moderationActionButtonDangerText}>
                            {hidingReportIds.has(report.id)
                              ? "Hiding..."
                              : "Hide content"}
                          </Text>
                        </Pressable>
                      ) : null}

                      {report.status !== "reviewing" &&
                      report.status !== "resolved" &&
                      report.status !== "dismissed" ? (
                        <Pressable
                          style={[
                            styles.moderationActionButton,
                            updatingReportIds.has(report.id) &&
                              styles.buttonDisabled,
                          ]}
                          onPress={() =>
                            handleUpdateReportStatus(report, "reviewing")
                          }
                          disabled={updatingReportIds.has(report.id)}
                        >
                          <Text style={styles.moderationActionButtonText}>
                            Reviewing
                          </Text>
                        </Pressable>
                      ) : null}

{report.status !== "resolved" &&
report.status !== "dismissed" ? (
  <>
    <Pressable
      style={[
        styles.moderationActionButton,
        updatingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleUpdateReportStatus(report, "resolved")}
      disabled={updatingReportIds.has(report.id)}
    >
      <Text style={styles.moderationActionButtonText}>Resolve</Text>
    </Pressable>

    <Pressable
      style={[
        styles.moderationActionButtonMuted,
        updatingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleUpdateReportStatus(report, "dismissed")}
      disabled={updatingReportIds.has(report.id)}
    >
      <Text style={styles.moderationActionButtonMutedText}>Dismiss</Text>
    </Pressable>
  </>
) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Pressable
          style={styles.viewAllActivityButton}
          onPress={() => router.push(`/group/${groupId}/moderation`)}
        >
          <Text style={styles.viewAllActivityText}>View all reports →</Text>
        </Pressable>
      </View>
    ) : null}
  </View>
) : null}


<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowNotificationPrefsPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Notification preferences</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {groupNotificationPreferences.muted ? "Muted" : "Active"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showNotificationPrefsPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showNotificationPrefsPanel ? (
    <View style={styles.collapsibleBody}>
      <Pressable
        style={[
          styles.notificationMuteButton,
          groupNotificationPreferences.muted &&
            styles.notificationMuteButtonActive,
          updatingNotificationPreferences && styles.buttonDisabled,
        ]}
        onPress={handleToggleGroupNotificationsMuted}
        disabled={updatingNotificationPreferences}
      >
        <Text
          style={[
            styles.notificationMuteButtonText,
            groupNotificationPreferences.muted &&
              styles.notificationMuteButtonTextActive,
          ]}
        >
          {groupNotificationPreferences.muted ? "Muted" : "Mute group"}
        </Text>
      </Pressable>

      <Text style={styles.helperText}>
        Choose what this group can notify you about. Muting the group overrides
        category settings.
      </Text>
      {todayRoutineOccurrences.length ? (
        <Text
          accessibilityLabel={`Today’s routines, ${
            todayRoutineOccurrences.filter(
              (item) =>
                auth.currentUser?.uid &&
                item.participantUids.includes(auth.currentUser.uid) &&
                ["scheduled", "in_progress"].includes(item.executionStatus)
            ).length
          } need your check-in`}
          style={styles.groupRoutineSummary}
        >
          Today:{" "}
          {
            todayRoutineOccurrences.filter(
              (item) =>
                auth.currentUser?.uid &&
                item.participantUids.includes(auth.currentUser.uid) &&
                ["scheduled", "in_progress"].includes(item.executionStatus)
            ).length
          }{" "}
          need your check-in ·{" "}
          {
            todayRoutineOccurrences.filter(
              (item) => item.executionStatus === "completed"
            ).length
          }{" "}
          completed
        </Text>
      ) : null}

      <View style={styles.notificationCategoryGrid}>
        {groupNotificationCategories.map((category) => {
          const enabled =
            groupNotificationPreferences.categories[category] === true;

          return (
            <Pressable
              key={category}
              style={[
                styles.notificationCategoryChip,
                enabled && styles.notificationCategoryChipActive,
                groupNotificationPreferences.muted &&
                  styles.notificationCategoryChipMuted,
                updatingNotificationPreferences && styles.buttonDisabled,
              ]}
              onPress={() => handleToggleGroupNotificationCategory(category)}
              disabled={
                updatingNotificationPreferences ||
                groupNotificationPreferences.muted
              }
            >
              <Text
                style={[
                  styles.notificationCategoryChipText,
                  enabled && styles.notificationCategoryChipTextActive,
                  groupNotificationPreferences.muted &&
                    styles.notificationCategoryChipTextMuted,
                ]}
              >
                {getGroupNotificationCategoryLabel(category)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null}
</View>



          {assignedToMeItems.length > 0 ? (
  <View style={styles.card}>
    <View style={styles.cardTitleRow}>
  <Text style={styles.cardTitle}>Assigned to me</Text>

  {hasUnreadAssignments ? (
    <View style={styles.unreadActivityBadge}>
      <Text style={styles.unreadActivityBadgeText}>New</Text>
    </View>
  ) : null}
</View>

    <Text style={styles.helperText}>
      Tasks assigned to you across this group.
    </Text>

    <View style={styles.assignedToMeDashboardList}>
      {assignedToMeItems.slice(0, 4).map((item) => (
        <Pressable
          key={`${item.goalId}:${item.subtaskId}`}
          style={styles.assignedToMeDashboardRow}
          onPress={() =>
            router.push({
              pathname: "/goal/[id]",
              params: { id: item.goalId },
            })
          }
        >
          <Text style={styles.assignedToMeDashboardTitle} numberOfLines={1}>
            {item.subtaskTitle}
          </Text>

          <Text style={styles.assignedToMeDashboardMeta} numberOfLines={1}>
            {item.goalTitle}
          </Text>
        </Pressable>
      ))}
    </View>

    {assignedToMeItems.length > 4 ? (
      <Text style={styles.assignedToMeDashboardMore}>
        +{assignedToMeItems.length - 4} more assigned task
        {assignedToMeItems.length - 4 === 1 ? "" : "s"}
      </Text>
    ) : null}
  </View>
) : null}

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowSharedGoalsPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Shared goals</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {loadingSharedGoals
          ? "Loading shared goals..."
          : sharedGoals.length === 0
          ? "No shared goals yet"
          : `${sharedGoals.length} shared goal${
              sharedGoals.length === 1 ? "" : "s"
            } · ${sharedGoals.reduce(
              (sum, sharedGoal) =>
                sum + getAssignmentCountForGoal(sharedGoal.id),
              0
            )} assigned task${
              sharedGoals.reduce(
                (sum, sharedGoal) =>
                  sum + getAssignmentCountForGoal(sharedGoal.id),
                0
              ) === 1
                ? ""
                : "s"
            }`}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showSharedGoalsPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showSharedGoalsPanel ? (
    <View style={styles.collapsibleBody}>
      {loadingSharedGoals ? (
  <View style={styles.inlineLoading}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading shared goals...</Text>
  </View>
) : sharedGoals.length === 0 ? (
  <Text style={styles.helperText}>
    No goals have been shared with this group yet.
  </Text>
) : (
  <>
    {sharedGoals.slice(0, 2).map((sharedGoal) => (
      <Pressable
        key={sharedGoal.id}
        style={styles.sharedGoalPreviewCard}
        onPress={() =>
          router.push({
            pathname: "/goal/[id]",
            params: { id: sharedGoal.id },
          })
        }
      >
        <Text style={styles.sharedGoalTitle}>{sharedGoal.title}</Text>

        {!!sharedGoal.description ? (
          <Text style={styles.sharedGoalDescription} numberOfLines={2}>
            {sharedGoal.description}
          </Text>
        ) : null}

        <View style={styles.sharedGoalPreviewRow}>
          <Text style={styles.sharedGoalPreviewPill}>
            {sharedGoal.goalStatus ?? "active"}
          </Text>

          <Text style={styles.sharedGoalPreviewText}>
            {formatSharedGoalProgress(sharedGoal)}
          </Text>
        </View>

        <Text style={styles.sharedGoalAssignmentSummary}>
          {getAssignmentCountForGoal(sharedGoal.id)}/
          {(subtasksByGoalId[sharedGoal.id] ?? []).length} tasks assigned
        </Text>
      </Pressable>
    ))}

    {sharedGoals.length > 2 ? (
      <Text style={styles.helperText}>
        +{sharedGoals.length - 2} more shared goal
        {sharedGoals.length - 2 === 1 ? "" : "s"}
      </Text>
    ) : null}

    <Pressable
      style={styles.openSharedGoalsButton}
      onPress={() => router.push(`/group/${groupId}/shared-goals`)}
    >
      <Text style={styles.openSharedGoalsButtonText}>
        Open shared goals →
      </Text>
    </Pressable>
  </>
)}
    </View>
  ) : null}
</View>

<View style={styles.card}>
  <View style={styles.groupRoutineHeader}>
    <View style={styles.groupRoutineHeaderText}>
      <Text style={styles.cardTitle}>History</Text>
      <Text style={styles.helperText}>
        Browse completed shared work by month and category.
      </Text>
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open group history"
      accessibilityHint="Shows the group’s recorded completion history."
      onPress={() =>
        router.push({
          pathname: "/group/[id]/history",
          params: {id: groupId},
        } as any)
      }
      style={styles.groupPlanningBoardOpenButton}
    >
      <Text style={styles.groupPlanningBoardOpenButtonText}>
        View History →
      </Text>
    </Pressable>
  </View>
</View>

<View style={styles.card}>
  <View style={styles.groupRoutineHeader}>
    <View style={styles.groupRoutineHeaderText}>
      <Text style={styles.cardTitle}>Routines</Text>
      <Text style={styles.helperText}>
        {loadingGroupRoutinePreview
          ? "Loading shared routines..."
          : groupRoutinePreviewError
          ? "Routine preview unavailable"
          : groupRoutinePreview.length === 0
          ? "No active routines"
          : `${groupRoutinePreview.length} active routine${
              groupRoutinePreview.length === 1 ? "" : "s"
            }`}
      </Text>
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open group routines"
      onPress={() =>
        router.push({
          pathname: "/group/[id]/routines",
          params: { id: groupId },
        } as any)
      }
      style={styles.groupPlanningBoardOpenButton}
    >
      <Text style={styles.groupPlanningBoardOpenButtonText}>
        Open Routines →
      </Text>
    </Pressable>
  </View>

  {loadingGroupRoutinePreview ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading routines...</Text>
    </View>
  ) : groupRoutinePreviewError ? (
    <Text style={styles.errorText}>Routines are unavailable right now.</Text>
  ) : groupRoutinePreview.length === 0 ? (
    <Text style={styles.helperText}>
      {currentUserRole === "viewer"
        ? "No active routines have been shared yet."
        : "Open Routines to create the group's first recurring rhythm."}
    </Text>
  ) : (
    <View style={styles.groupPlanningBoardList}>
      {groupRoutinePreview.slice(0, 3).map((routine) => (
        <Pressable
          key={routine.id}
          accessibilityRole={
            todayRoutineOccurrences.some(
              (item) => item.routineId === routine.id
            )
              ? "button"
              : undefined
          }
          onPress={() => {
            const occurrence = todayRoutineOccurrences.find(
              (item) => item.routineId === routine.id
            );
            if (occurrence) {
              router.push({
                pathname:
                  "/group/[id]/routine-occurrence/[occurrenceId]",
                params: { id: groupId, occurrenceId: occurrence.id },
              } as any);
            }
          }}
          style={styles.groupRoutinePreview}
        >
          <Text numberOfLines={1} style={styles.groupPlanningBoardTitle}>
            {routine.title}
          </Text>
          <Text numberOfLines={2} style={styles.groupRoutineSummary}>
            {formatGroupRoutineRecurrenceSummary(routine)}
          </Text>
          <Text style={styles.groupRoutineNext}>
            {todayRoutineOccurrences.find(
              (item) => item.routineId === routine.id
            )?.executionStatus === "completed"
              ? "Completed today"
              : todayRoutineOccurrences.some(
                    (item) =>
                      item.routineId === routine.id &&
                      auth.currentUser?.uid &&
                      item.participantUids.includes(auth.currentUser.uid)
                  )
                ? "Awaiting your check-in"
                : formatGroupRoutineNextOccurrence(routine)}
          </Text>
        </Pressable>
      ))}
      {groupRoutinePreview.length > 3 ? (
        <Text style={styles.groupPlanningBoardMoreText}>
          +{groupRoutinePreview.length - 3} more active routine
          {groupRoutinePreview.length - 3 === 1 ? "" : "s"}
        </Text>
      ) : null}
    </View>
  )}
</View>

<View style={styles.card}>
  <View style={styles.collapsibleSectionHeader}>
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Planning Calendar</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {loadingGroupCalendarPreview
          ? "Loading upcoming events..."
          : groupCalendarPreviewError
          ? "Calendar preview unavailable"
          : groupCalendarPreview.length === 0
          ? "No upcoming group events"
          : `${groupCalendarPreview.length} upcoming event${
              groupCalendarPreview.length === 1 ? "" : "s"
            }`}
      </Text>
    </View>
  </View>

  <Text style={styles.helperText}>
    Coordinate scheduled plans with everyone in this group.
  </Text>

  {loadingGroupCalendarPreview ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading calendar...</Text>
    </View>
  ) : groupCalendarPreviewError ? (
    <Text style={styles.errorText}>
      Couldn’t load the calendar preview. Open the calendar to try again.
    </Text>
  ) : groupCalendarPreview.length === 0 ? (
    <Text style={styles.helperText}>
      {canCreateGroupCalendar
        ? "No upcoming events. Add one from the group calendar."
        : "No upcoming group events."}
    </Text>
  ) : (
    <View style={styles.groupPlanningBoardList}>
      {groupCalendarPreview.map((event) => (
        <GroupCalendarEventCard
          key={event.id}
          event={event}
          displayTimezone={DateTime.local().zoneName}
          theme={theme}
          compact
          onPress={() =>
            router.push({
              pathname: "/group/[id]/calendar",
              params: { id: groupId },
            } as any)
          }
        />
      ))}
    </View>
  )}

  <Pressable
    accessibilityRole="button"
    accessibilityLabel="Open group calendar"
    style={styles.openSharedGoalsButton}
    onPress={() =>
      router.push({
        pathname: "/group/[id]/calendar",
        params: { id: groupId },
      } as any)
    }
  >
    <Text style={styles.openSharedGoalsButtonText}>
      Open Calendar →
    </Text>
  </Pressable>
</View>

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowPlanningBoardsPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Planning boards</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {loadingGroupPlanningBoards
          ? "Loading boards..."
          : groupPlanningBoardsError
          ? "Boards unavailable"
          : groupPlanningBoards.length === 0
          ? "No group boards yet"
          : groupPlanningBoards.length === 1
          ? "1 shared board"
          : `${groupPlanningBoards.length} shared boards`}
      </Text>
    </View>

    {groupPlanningBoards.length > 0 ? (
      <View style={styles.unreadActivityBadge}>
        <Text style={styles.unreadActivityBadgeText}>
          {groupPlanningBoards.length}
        </Text>
      </View>
    ) : null}

    <Text style={styles.collapsibleSectionToggle}>
      {showPlanningBoardsPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showPlanningBoardsPanel ? (
    <View style={styles.collapsibleBody}>
      <Text style={styles.helperText}>
        Coordinate group goals, milestones, tasks, and standalone work across
        shared planning columns.
      </Text>

      {canManageGroup ? (
        <>
          <Pressable
            style={styles.groupPlanningBoardCreateToggle}
            onPress={() =>
              setShowCreateGroupBoardForm((prev) => {
                if (prev) {
                  setNewGroupBoardTitle("");
                }

                return !prev;
              })
            }
            disabled={savingGroupBoard}
          >
            <Text style={styles.groupPlanningBoardCreateToggleText}>
              {showCreateGroupBoardForm ? "Hide" : "+ New board"}
            </Text>
          </Pressable>

          {showCreateGroupBoardForm ? (
            <View style={styles.groupPlanningBoardForm}>
              <Text style={styles.inputLabel}>Board title</Text>
              <TextInput
                value={newGroupBoardTitle}
                onChangeText={setNewGroupBoardTitle}
                placeholder="e.g., Group project board"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.input}
                editable={!savingGroupBoard}
              />

              <View style={styles.groupPlanningBoardFormActions}>
                <Pressable
                  style={[
                    styles.button,
                    savingGroupBoard && styles.buttonDisabled,
                  ]}
                  onPress={handleCreateGroupPlanningBoard}
                  disabled={savingGroupBoard}
                >
                  <Text style={styles.buttonText}>
                    {savingGroupBoard ? "Creating..." : "Create board"}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.groupPlanningBoardCreateToggle}
                  onPress={() => {
                    setNewGroupBoardTitle("");
                    setShowCreateGroupBoardForm(false);
                  }}
                  disabled={savingGroupBoard}
                >
                  <Text style={styles.groupPlanningBoardCreateToggleText}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {loadingGroupPlanningBoards ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading boards...</Text>
        </View>
      ) : groupPlanningBoardsError ? (
        <Text style={styles.errorText}>{groupPlanningBoardsError}</Text>
      ) : groupPlanningBoards.length === 0 ? (
        <Text style={styles.helperText}>
          {canManageGroup
            ? "No planning boards yet. Create one to coordinate shared work."
            : "No planning boards have been created for this group yet."}
        </Text>
      ) : (
        <View style={styles.groupPlanningBoardList}>
          {groupPlanningBoards.slice(0, 3).map((board) => {
            const sortedBoardColumns = [...board.columns].sort(
              (a, b) => a.sortOrder - b.sortOrder
            );

            return (
              <View key={board.id} style={styles.groupPlanningBoardPreview}>
                <Text style={styles.groupPlanningBoardTitle}>
                  {board.title}
                </Text>
                <Text style={styles.groupPlanningBoardMeta}>Group board</Text>

                <View style={styles.groupPlanningBoardColumnRow}>
                  {sortedBoardColumns.map((column) => (
                    <View
                      key={column.id}
                      style={styles.groupPlanningBoardColumnChip}
                    >
                      <Text style={styles.groupPlanningBoardColumnChipText}>
                        {column.title}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={styles.groupPlanningBoardFormActions}>
                  <Pressable
                    style={styles.groupPlanningBoardOpenButton}
                    onPress={() => router.push(`/board/${board.id}` as any)}
                  >
                    <Text style={styles.groupPlanningBoardOpenButtonText}>
                      Open board
                    </Text>
                  </Pressable>

                  {canManageGroup ? (
                    <Pressable
                      style={[
                        styles.groupPlanningBoardArchiveButton,
                        archivingGroupBoardId === board.id &&
                          styles.buttonDisabled,
                      ]}
                      onPress={() => handleArchiveGroupPlanningBoard(board)}
                      disabled={archivingGroupBoardId === board.id}
                    >
                      <Text style={styles.groupPlanningBoardArchiveButtonText}>
                        {archivingGroupBoardId === board.id
                          ? "Archiving..."
                          : "Archive"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}

          {groupPlanningBoards.length > 3 ? (
            <Text style={styles.groupPlanningBoardMoreText}>
              +{groupPlanningBoards.length - 3} more shared boards
            </Text>
          ) : null}
        </View>
      )}
    </View>
  ) : null}
</View>

<Modal
  visible={showCreateConversationModal}
  transparent
  animationType="fade"
  onRequestClose={() => setShowCreateConversationModal(false)}
>
  <Pressable
    style={styles.assignmentModalBackdrop}
    onPress={() => {
      if (!creatingConversation) {
        setShowCreateConversationModal(false);
      }
    }}
  >
    <Pressable style={styles.assignmentModalCard} onPress={() => {}}>
      <Text style={styles.assignmentModalTitle}>New group conversation</Text>

      <Text style={styles.helperText}>
        Creates a shared conversation with all active group members. Member
        selection can be added later.
      </Text>

      <Text style={styles.inputLabel}>Title</Text>

      <TextInput
        value={newConversationTitle}
        onChangeText={setNewConversationTitle}
        maxLength={120}
        placeholder="Example: Launch planning"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.input}
        editable={!creatingConversation}
      />

      <Text style={styles.commentLengthText}>
        {newConversationTitle.length}/120
      </Text>

            <Text style={styles.inputLabel}>Members</Text>

      <View style={styles.conversationMemberPickerList}>
        {members
          .filter((member) => member.status === "active")
          .filter((member) => member.uid !== auth.currentUser?.uid)
          .map((member) => {
            const selected = selectedConversationMemberUids.has(member.uid);

            return (
              <Pressable
                key={member.uid}
                style={[
                  styles.conversationMemberPickerRow,
                  selected && styles.conversationMemberPickerRowSelected,
                ]}
                onPress={() => toggleSelectedConversationMember(member.uid)}
                disabled={creatingConversation}
              >
                <View style={styles.conversationMemberAvatar}>
                  <Text style={styles.conversationMemberAvatarText}>
                    {(member.displayName ?? member.email ?? "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                </View>

                <View style={styles.conversationMemberInfo}>
                  <Text style={styles.conversationMemberName} numberOfLines={1}>
                    {member.displayName ?? member.email ?? member.uid}
                  </Text>

                  <Text style={styles.conversationMemberMeta} numberOfLines={1}>
                    {member.email ? `${member.email} · ${member.role}` : member.role}
                  </Text>
                </View>

                <Text style={styles.conversationMemberSelectedText}>
                  {selected ? "Selected" : "Add"}
                </Text>
              </Pressable>
            );
          })}
      </View>

      <Text style={styles.inputLabel}>Subject</Text>

      <TextInput
        value={newConversationSubject}
        onChangeText={setNewConversationSubject}
        maxLength={240}
        placeholder="Optional purpose or context."
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, styles.groupTaskDescriptionInput]}
        multiline
        editable={!creatingConversation}
      />

      <Text style={styles.commentLengthText}>
        {newConversationSubject.length}/240
      </Text>

      <Pressable
        style={[
          styles.button,
          (!newConversationTitle.trim() ||
            selectedConversationMemberUids.size === 0 ||
            creatingConversation) &&
            styles.buttonDisabled,
        ]}
        onPress={handleCreateGroupConversation}
        disabled={
          !newConversationTitle.trim() ||
          selectedConversationMemberUids.size === 0 ||
          creatingConversation
        }
      >
        <Text style={styles.buttonText}>
          {creatingConversation ? "Creating..." : "Create conversation"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.assignmentModalCancelButton}
        onPress={() => setShowCreateConversationModal(false)}
        disabled={creatingConversation}
      >
        <Text style={styles.assignmentModalCancelText}>Cancel</Text>
      </Pressable>
    </Pressable>
  </Pressable>
</Modal>

<Modal
  visible={showCreateGroupTaskModal}
  transparent
  animationType="fade"
  onRequestClose={() => setShowCreateGroupTaskModal(false)}
>
  <Pressable
    style={styles.assignmentModalBackdrop}
    onPress={() => {
      if (!creatingGroupTask) {
        setShowCreateGroupTaskModal(false);
      }
    }}
  >
    <Pressable
      style={styles.assignmentModalCard}
      onPress={() => {}}
    >
      <Text style={styles.assignmentModalTitle}>Create shared task</Text>

      <Text style={styles.helperText}>
        Add group-level work that someone can claim later.
      </Text>

      <Text style={styles.inputLabel}>Title</Text>

      <TextInput
        value={newGroupTaskTitle}
        onChangeText={setNewGroupTaskTitle}
        maxLength={160}
        placeholder="Example: Review launch checklist"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.input}
      />

      <Text style={styles.commentLengthText}>
  {newGroupTaskTitle.length}/160
</Text>

      <Text style={styles.inputLabel}>Description</Text>

      <TextInput
        value={newGroupTaskDescription}
        onChangeText={setNewGroupTaskDescription}
        placeholder="Optional details..."
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, styles.groupTaskDescriptionInput]}
        multiline
        maxLength={1000}
      />

<Text style={styles.commentLengthText}>
  {newGroupTaskDescription.length}/1000
</Text>
      <Text style={styles.inputLabel}>Priority</Text>

      <View style={styles.rolePickerRow}>
        {(["low", "medium", "high"] as const).map((priority) => {
          const active = newGroupTaskPriority === priority;

          return (
            <Pressable
              key={priority}
              style={[
                styles.rolePickerChip,
                active && styles.rolePickerChipActive,
              ]}
              onPress={() =>
                setNewGroupTaskPriority(active ? null : priority)
              }
            >
              <Text
                style={[
                  styles.rolePickerChipText,
                  active && styles.rolePickerChipTextActive,
                ]}
              >
                {priority}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.inputLabel}>Due</Text>

<View style={styles.rolePickerRow}>
  {([
    ["today", "Today 8pm"],
    ["tomorrow", "Tomorrow 8pm"],
    ["week", "In 1 week"],
  ] as Array<["today" | "tomorrow" | "week", string]>).map(
    ([preset, label]) => {
      const active = newGroupTaskDuePreset === preset;

      return (
        <Pressable
          key={preset}
          style={[
            styles.rolePickerChip,
            active && styles.rolePickerChipActive,
          ]}
          onPress={() =>
            setNewGroupTaskDuePreset(active ? null : preset)
          }
        >
          <Text
            style={[
              styles.rolePickerChipText,
              active && styles.rolePickerChipTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      );
    }
  )}
</View>

      <Pressable
        style={[
          styles.button,
          (!newGroupTaskTitle.trim() || creatingGroupTask) &&
            styles.buttonDisabled,
        ]}
        onPress={handleCreateGroupTask}
        disabled={!newGroupTaskTitle.trim() || creatingGroupTask}
      >
        <Text style={styles.buttonText}>
          {creatingGroupTask ? "Creating..." : "Create shared task"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.assignmentModalCancelButton}
        onPress={() => setShowCreateGroupTaskModal(false)}
        disabled={creatingGroupTask}
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
    <Pressable
      style={styles.assignmentModalCard}
      onPress={() => {}}
    >
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

      <Text style={styles.assignmentModalSectionTitle}>
        Choose a member
      </Text>

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
      (
        subtasksByGoalId[
          assignmentPickerTarget?.goalId ?? ""
        ] ?? []
      ).find(
        (s) =>
          s.id === assignmentPickerTarget?.subtaskId
      )?.assignedToUid;

    return (
      <Pressable
        key={member.uid}
        style={[
          styles.assignmentMemberOption,
          assigningTask && styles.buttonDisabled,
          alreadyAssigned &&
            styles.assignmentMemberOptionAssigned,
        ]}
        onPress={() => handleAssignTaskToMember(member)}
        disabled={assigningTask || alreadyAssigned}
      >
        <View style={styles.assignmentMemberAvatar}>
          <Text style={styles.assignmentMemberAvatarText}>
            {(member.displayName ?? member.email ?? "?")
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </View>

        <View style={styles.assignmentMemberInfo}>
          <Text style={styles.assignmentMemberName}>
            {member.displayName ?? member.email ?? member.uid}
          </Text>

          <Text style={styles.assignmentMemberMeta}>
            {member.email
              ? `${member.email} · ${member.role}`
              : member.role}
          </Text>
        </View>

        <Text style={styles.assignmentMemberAction}>
          {alreadyAssigned
            ? "Assigned"
            : assigningTask
            ? "Assigning..."
            : "Select"}
        </Text>
      </Pressable>
    );
  })
)}
      </ScrollView>

      <Pressable
  style={[
    styles.assignmentModalUnassignButton,
    assigningTask && styles.buttonDisabled,
  ]}
  onPress={handleUnassignTask}
  disabled={assigningTask}
>
  <Text style={styles.assignmentModalUnassignText}>
    Unassign task
  </Text>
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

<Modal
  visible={!!reportTarget}
  transparent
  animationType="fade"
  onRequestClose={handleCloseReportTarget}
>
  <Pressable
    style={styles.assignmentModalBackdrop}
    onPress={handleCloseReportTarget}
  >
    <Pressable
      style={styles.assignmentModalCard}
      onPress={() => {}}
    >
      <Text style={styles.assignmentModalTitle}>Report content</Text>

      <Text style={styles.helperText}>
        Reports help moderators review content that may need attention.
      </Text>

      {reportTarget ? (
        <View style={styles.reportPreviewBox}>
          <Text style={styles.reportPreviewTitle}>
            {reportTarget.previewTitle}
          </Text>

          {!!reportTarget.previewBody ? (
            <Text style={styles.reportPreviewBody} numberOfLines={3}>
              {reportTarget.previewBody}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.inputLabel}>Reason</Text>

      <View style={styles.reportReasonGrid}>
        {(
          [
            ["spam", "Spam"],
            ["harassment", "Harassment"],
            ["inappropriate", "Inappropriate"],
            ["misleading", "Misleading"],
            ["other", "Other"],
          ] as Array<[GroupReportReason, string]>
        ).map(([reason, label]) => {
          const active = reportReason === reason;

          return (
            <Pressable
              key={reason}
              style={[
                styles.rolePickerChip,
                active && styles.rolePickerChipActive,
              ]}
              onPress={() => setReportReason(reason)}
              disabled={reportBusy}
            >
              <Text
                style={[
                  styles.rolePickerChipText,
                  active && styles.rolePickerChipTextActive,
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
        style={[styles.input, styles.groupTaskDescriptionInput]}
        multiline
        maxLength={500}
        editable={!reportBusy}
      />

      <Text style={styles.commentLengthText}>{reportNote.length}/500</Text>

      <Pressable
        style={[
          styles.button,
          (!reportTarget || reportBusy) && styles.buttonDisabled,
        ]}
        disabled={!reportTarget || reportBusy}
        onPress={handleSubmitReport}
      >
        <Text style={styles.buttonText}>
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

<MediaAttachmentViewer
  attachments={bulletinViewer?.attachments ?? []}
  initialIndex={bulletinViewer?.index ?? 0}
  onRequestClose={() => setBulletinViewer(null)}
  presentationTitle={bulletinViewer?.title}
  visible={bulletinViewer !== null}
/>

<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowRecentActivityPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Recent activity</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {hasUnreadActivity ? "New activity available" : "Group updates and reactions"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showRecentActivityPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showRecentActivityPanel ? (
     <View style={styles.collapsibleBody}>

   {hasUnreadActivity ? (
  <View style={styles.unreadActivityBadge}>
    <Text style={styles.unreadActivityBadgeText}>New</Text>
  </View>
) : null}

  {loadingActivity ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading activity...</Text>
    </View>
 ) : activityError ? (
  <Text style={styles.errorText}>{activityError}</Text>
) : visibleActivityItems.length === 0 ? (
    <Text style={styles.helperText}>
      No group activity yet. Sharing goals, accepting invites, and completing
      tasks will appear here.
    </Text>
  ) : (
   visibleActivityItems.map((item) => {
  const myReaction = getMyActivityReaction(item.id);
  const reactionSummary = getActivityReactionSummary(item.id);

  return (
    <View key={item.id} style={styles.activityItemWrap}>
      <Pressable
  style={({ pressed }) => [
  styles.activityRow,
  item.type === "subtask_completed" && styles.activityRowCelebration,
  isFreshCompletionActivity(item) && styles.activityRowFreshCompletion,
  (!!item.goalId || !!item.taskId || !!item.boardId) &&
    styles.activityRowPressable,
  pressed &&
    (!!item.goalId || !!item.taskId || !!item.boardId) &&
    styles.pressedSoft,
]}
        disabled={!item.goalId && !item.taskId && !item.boardId}
        onPress={() => {
          if (item.boardId) {
            router.push({
              pathname: "/board/[id]",
              params: { id: item.boardId },
            });
            return;
          }

          if (item.goalId) {
            router.push({
              pathname: "/goal/[id]",
              params: { id: item.goalId },
            });
            return;
          }

          if (item.taskId) {
            router.push(`/group/${groupId}/task/${item.taskId}`);
          }
        }}
      >
        <View style={styles.activityIconWrap}>
          <Text style={styles.activityIcon}>
            {getActivityIcon(item.type)}
          </Text>
        </View>

        <View style={styles.activityBody}>
          <Text style={styles.activityMessage}>
            <Text style={styles.activityActor}>
              {item.actorName ?? "Someone"}
            </Text>{" "}
            {item.message}
          </Text>

          {item.type === "subtask_completed" ? (
            <Text style={styles.activityCelebrationText}>
              🎉 Nice work — shared progress updated.
            </Text>
          ) : null}

          <View style={styles.activityMetaRow}>
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
      targetAuthorUid: item.actorUid ?? null,
targetAuthorName: item.actorName ?? null,
      previewBody: item.message,
    })
  }
>
  <Text style={styles.reportInlineButtonText}>Report</Text>
</Pressable>

            {item.goalId || item.taskId || item.boardId ? (
              <Text style={styles.activityOpenHint}>Tap to open</Text>
            ) : item.type === "note_created" &&
              typeof item.message === "string" &&
              item.message.includes("shared task pool") ? (
              <Text style={styles.activityPoolHint}>Task pool update</Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      <View style={styles.activityReactionSection}>
        {item.type === "subtask_completed" ? (
  <Text style={styles.activityCelebrateHint}>
    Celebrate this win
  </Text>
) : null}

<View style={styles.activityReactionPickerRow}>
  {[...GROUP_ACTIVITY_REACTION_EMOJIS]
    .sort((a, b) => {
      if (item.type !== "subtask_completed") return 0;
      if (a === "🎉") return -1;
      if (b === "🎉") return 1;
      return 0;
    })
    .map((emoji) => {
      const isSelected = myReaction?.emoji === emoji;
      const isSuggestedCelebration =
        item.type === "subtask_completed" && emoji === "🎉";

      return (
        <Pressable
  key={emoji}
  style={({ pressed }) => [
    styles.activityReactionButton,
    isSuggestedCelebration &&
      styles.activityReactionButtonSuggested,
    isSelected && styles.activityReactionButtonSelected,
    pressed && styles.pressedSoft,
  ]}
          onPress={() => handleToggleActivityReaction(item, emoji)}
        >
          <Text
            style={[
              styles.activityReactionButtonText,
              isSuggestedCelebration &&
                styles.activityReactionButtonTextSuggested,
              isSelected &&
                styles.activityReactionButtonTextSelected,
            ]}
          >
            {emoji}
          </Text>
        </Pressable>
      );
    })}
</View>

        {reactionSummary.length > 0 ? (
          <View style={styles.activityReactionSummaryRow}>
            {reactionSummary.map(([emoji, count]) => (
              <View
                key={`${item.id}_${emoji}`}
                style={styles.activityReactionSummaryPill}
              >
                <Text style={styles.activityReactionSummaryText}>
                  {emoji} {count}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
})
  )}
<Pressable
  style={styles.viewAllActivityButton}
  onPress={() => router.push(`/group/${groupId}/activity`)}
>
  <Text style={styles.viewAllActivityText}>View all activity →</Text>
</Pressable>
    </View>
  ) : null}
</View>



<View style={styles.card}>
  <Pressable
    style={styles.collapsibleSectionHeader}
    onPress={() => setShowInviteMemberPanel((prev) => !prev)}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>
        {canInviteMembers ? "Invite member" : "Invites"}
      </Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {canInviteMembers
          ? invites.length > 0
            ? `${invites.length} pending invite${invites.length === 1 ? "" : "s"}`
            : "Invite by email"
          : "Owner/admin only"}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showInviteMemberPanel ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showInviteMemberPanel ? (
    <View style={styles.collapsibleBody}>
      {canInviteMembers ? (
        <>
          <Text style={styles.helperText}>
            Create an in-app invite by email. Accepting invites comes in the next patch.
          </Text>

          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="friend@example.com"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.inputLabel}>Role</Text>

          <View style={styles.rolePickerRow}>
            {GROUP_ASSIGNABLE_ROLES.map((role) => {
              const active = inviteRole === role;

              return (
                <Pressable
                  key={role}
                  onPress={() => setInviteRole(role)}
                  style={[
                    styles.rolePickerChip,
                    active && styles.rolePickerChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.rolePickerChipText,
                      active && styles.rolePickerChipTextActive,
                    ]}
                  >
                    {role}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[styles.button, inviteBusy && styles.buttonDisabled]}
            onPress={handleInviteMember}
            disabled={inviteBusy}
          >
            <Text style={styles.buttonText}>
              {inviteBusy ? "Sending..." : "Create invite"}
            </Text>
          </Pressable>

          {invites.length > 0 ? (
            <View style={styles.inviteList}>
              <Text style={styles.smallSectionTitle}>Pending invites</Text>

              {invites.map((invite) => (
                <View key={invite.id} style={styles.inviteRow}>
                  <Text style={styles.inviteEmail}>{invite.invitedEmail}</Text>
                  <Text style={styles.inviteStatus}>
                    {invite.status} · {invite.role}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.helperText}>
          Only group owners and admins can invite new members.
        </Text>
      )}
    </View>
  ) : null}
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

    loadingCard: {
      padding: 20,
      borderRadius: 18,
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

    header: {
      marginBottom: 18,
    },

    iconWrap: {
      width: 58,
      height: 58,
      borderRadius: 29,
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

    meta: {
      color: theme.colors.textMuted,
      marginTop: 10,
      fontSize: 13,
      fontWeight: "700",
    },

    card: {
  padding: 16,
  borderRadius: 22,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginBottom: 12,
},

    cardTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginBottom: 0,
    },

    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },

collapsibleBody: {
  marginTop: 12,
  gap: 10,
},

memberRow: {
  paddingVertical: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 10,
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
      fontWeight: "800",
    },

    memberEmail: {
      color: theme.colors.textMuted,
      marginTop: 2,
      fontSize: 12,
    },

    roleBadge: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: "hidden",
      fontSize: 12,
      fontWeight: "900",
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
  marginTop: 12,
},

button: {
  backgroundColor: theme.colors.primary,
  borderRadius: 12,
  paddingVertical: 12,
  alignItems: "center",
  marginTop: 12,
},

buttonDisabled: {
  opacity: 0.5,
},

buttonText: {
  color: theme.colors.primaryText,
  fontSize: 15,
  fontWeight: "800",
},

inviteList: {
  marginTop: 16,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

smallSectionTitle: {
  color: theme.colors.text,
  fontWeight: "800",
  marginBottom: 8,
},

inviteRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: 8,
},

inviteEmail: {
  color: theme.colors.text,
  fontWeight: "700",
  flex: 1,
  paddingRight: 10,
},

inviteStatus: {
  color: theme.colors.primary,
  fontWeight: "800",
  fontSize: 12,
},
inputLabel: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "800",
  marginTop: 12,
  marginBottom: 6,
},

rolePickerRow: {
  flexDirection: "row",
  gap: 8,
  marginTop: 4,
},

rolePickerChip: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

rolePickerChipActive: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

rolePickerChipText: {
  color: theme.colors.text,
  fontWeight: "800",
  fontSize: 12,
},

rolePickerChipTextActive: {
  color: theme.colors.primary,
},
currentRolePill: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  alignSelf: "flex-start",
  marginTop: 12,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

currentRoleText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

roleBadgeText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

roleBadgeOwner: {
  borderColor: theme.colors.primary,
},

roleBadgeAdmin: {
  borderColor: theme.colors.warning,
},

roleBadgeViewer: {
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},
removeMemberButton: {
  borderColor: theme.colors.danger,
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 5,
},

removeMemberButtonText: {
  color: theme.colors.danger,
  fontSize: 12,
  fontWeight: "900",
},
memberAdminActions: {
  width: "100%",
  marginTop: 8,
  gap: 8,
},

roleActionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

roleActionChip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

roleActionChipActive: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

roleActionChipText: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "800",
},

roleActionChipTextActive: {
  color: theme.colors.primary,
},
inlineLoading: {
  alignItems: "center",
  paddingVertical: 14,
},

sharedGoalRow: {
  paddingVertical: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

sharedGoalTitle: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "900",
},

sharedGoalDescription: {
  color: theme.colors.textMuted,
  marginTop: 4,
  lineHeight: 18,
},

sharedGoalMeta: {
  color: theme.colors.primary,
  marginTop: 8,
  fontSize: 12,
  fontWeight: "900",
},
sharedGoalPreviewRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
  alignItems: "center",
},

sharedGoalPreviewPill: {
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  borderRadius: 999,
  overflow: "hidden",
  paddingHorizontal: 8,
  paddingVertical: 4,
  fontSize: 12,
  fontWeight: "900",
},

sharedGoalPreviewText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},
activityRow: {
  flexDirection: "row",
  gap: 10,
},

activityDot: {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: theme.colors.primary,
  marginTop: 5,
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
},
memberTopRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
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
activityRowPressable: {
  borderRadius: 12,
},
activityMetaRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 4,
  alignItems: "center",
},

activityOpenHint: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
errorText: {
  color: theme.colors.danger,
  fontSize: 13,
  fontWeight: "800",
  lineHeight: 18,
},
viewAllActivityButton: {
  marginTop: 10,
  paddingVertical: 10,
  borderRadius: 999,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

viewAllActivityText: {
  color: theme.colors.primary,
  fontWeight: "900",
},
goalActivityPreview: {
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

goalActivityPreviewTitle: {
  color: theme.colors.text,
  fontWeight: "900",
  fontSize: 13,
},

goalActivityPreviewRow: {
  flexDirection: "row",
  gap: 8,
  alignItems: "flex-start",
},

goalActivityPreviewIcon: {
  fontSize: 14,
  marginTop: 1,
},

goalActivityPreviewBody: {
  flex: 1,
},

goalActivityPreviewText: {
  color: theme.colors.text,
  lineHeight: 18,
  fontSize: 13,
},

goalActivityPreviewActor: {
  color: theme.colors.text,
  fontWeight: "900",
},

goalActivityPreviewMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  marginTop: 2,
},
goalActivityPreviewHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},
goalActivityPreviewLink: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
},

goalActivityPreviewLinkText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

goalActivityPreviewEmpty: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
},
goalCommentComposer: {
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

goalCommentInput: {
  minHeight: 42,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
  color: theme.colors.text,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  lineHeight: 18,
},

goalCommentButton: {
  alignSelf: "flex-end",
  backgroundColor: theme.colors.primary,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

goalCommentButtonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 13,
},
goalCommentsPreview: {
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

goalCommentsPreviewTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

goalCommentRow: {
  padding: 10,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

goalCommentAuthor: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
  marginBottom: 4,
},

goalCommentBody: {
  color: theme.colors.text,
  fontSize: 13,
  lineHeight: 18,
},

goalCommentMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  marginTop: 6,
},
commentLengthText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  alignSelf: "flex-end",
},
goalCommentsPreviewHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},

goalCommentsPreviewLink: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
},

goalCommentsPreviewLinkText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

goalCommentsPreviewEmpty: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
},
sharedGoalSubtasksPreview: {
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

sharedGoalSubtasksTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

sharedGoalSubtasksEmpty: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
},

sharedGoalSubtaskRow: {
  gap: 6,
  paddingVertical: 8,
},

sharedGoalSubtaskTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "800",
},

assignmentPill: {
  alignSelf: "flex-start",
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

assignmentPillEmpty: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
},

assignmentPillText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

assignmentPillTextEmpty: {
  color: theme.colors.textMuted,
},
assignmentRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
},

assignmentButton: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

assignmentButtonText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},
assignmentPickerList: {
  marginTop: 12,
  gap: 8,
},

assignmentMemberOption: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
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
  color: theme.colors.text,
  fontWeight: "900",
},

assignmentMemberInfo: {
  flex: 1,
  minWidth: 0,
},

assignmentMemberName: {
  color: theme.colors.text,
  fontWeight: "900",
},

assignmentMemberMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  marginTop: 2,
},

assignmentMemberAction: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
sharedGoalAssignmentSummary: {
  color: theme.colors.textMuted,
  marginTop: 8,
  fontSize: 12,
  fontWeight: "800",
},
assignmentModalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
},

assignmentModalCard: {
  width: "100%",
  maxHeight: "80%",
  borderRadius: 20,
  padding: 16,
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
  fontSize: 15,
  fontWeight: "900",
  marginTop: 10,
},

assignmentModalMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 4,
},

assignmentModalSectionTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
  marginTop: 16,
  marginBottom: 8,
},

assignmentModalList: {
  maxHeight: 360,
},

assignmentModalCancelButton: {
  marginTop: 12,
  paddingVertical: 10,
  borderRadius: 999,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

assignmentModalCancelText: {
  color: theme.colors.primary,
  fontWeight: "900",
},
assignmentEmptyText: {
  color: theme.colors.textMuted,
  textAlign: "center",
  paddingVertical: 20,
  lineHeight: 20,
},

assignmentMemberOptionAssigned: {
  opacity: 0.6,
  borderColor: theme.colors.primary,
},

assignmentModalListContent: {
  paddingBottom: 8,
},
assignedToMeDashboardList: {
  marginTop: 10,
  gap: 8,
},

assignedToMeDashboardRow: {
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

assignedToMeDashboardTitle: {
  color: theme.colors.text,
  fontWeight: "900",
  fontSize: 13,
},

assignedToMeDashboardMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 3,
},

assignedToMeDashboardMore: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 10,
},
assignmentModalUnassignButton: {
  marginTop: 12,
  paddingVertical: 10,
  borderRadius: 999,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.danger,
  borderWidth: 1,
},

assignmentModalUnassignText: {
  color: theme.colors.danger,
  fontWeight: "900",
},
presenceList: {
  gap: 12,
},

presenceSection: {
  gap: 8,
},

presenceSectionTitle: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
  textTransform: "uppercase",
  letterSpacing: 0.4,
},

presenceRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 8,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

presenceAvatar: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.badge,
},

presenceAvatarText: {
  color: theme.colors.text,
  fontWeight: "900",
},

presenceInfo: {
  flex: 1,
  minWidth: 0,
},

presenceName: {
  color: theme.colors.text,
  fontWeight: "900",
},

presenceMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 2,
},

presenceOnlineDot: {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: theme.colors.success,
},
memberPresenceRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
},

memberPresenceDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: theme.colors.border,
},

memberPresenceDotOnline: {
  backgroundColor: theme.colors.success,
},

memberPresenceDotRecent: {
  backgroundColor: theme.colors.warning,
},

memberPresenceText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
},
cardTitleRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 10,
},

unreadActivityBadge: {
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

unreadActivityBadgeText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},
goalCommentsTitleRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  flex: 1,
},

unreadCommentsBadge: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

unreadCommentsBadgeText: {
  color: theme.colors.primaryText,
  fontSize: 10,
  fontWeight: "900",
},
typingIndicatorText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 8,
},
previewCommentReactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 6,
},

previewCommentReactionChip: {
  paddingHorizontal: 7,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

previewCommentReactionText: {
  color: theme.colors.text,
  fontSize: 11,
  fontWeight: "900",
},
activityRowCelebration: {
  backgroundColor: theme.colors.badge,
  borderRadius: 14,
  paddingHorizontal: 10,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

activityCelebrationText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 4,
},
groupInboxList: {
  gap: 8,
},

groupInboxRow: {
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupInboxRowUnread: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

groupInboxTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

groupInboxBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 3,
},

groupInboxMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 6,
},
groupInboxMarkReadButton: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupInboxMarkReadText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},
groupInboxHeaderActions: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},
groupTaskEmptyText: {
  color: theme.colors.textMuted,
  lineHeight: 20,
  marginTop: 12,
},

groupTaskPoolList: {
  marginTop: 12,
  gap: 10,
},

groupTaskPoolRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

groupTaskPoolMain: {
  flex: 1,
  minWidth: 0,
},

groupTaskPoolTitle: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

groupTaskPoolMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 3,
},

groupTaskStatusPill: {
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

groupTaskStatusPillText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

groupTaskStatusPillMuted: {
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupTaskStatusPillTextMuted: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},

groupTaskPoolFooter: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 4,
},
groupTaskAddButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

groupTaskAddButtonText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

groupTaskDescriptionInput: {
  minHeight: 86,
  textAlignVertical: "top",
},
groupTaskClaimButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

groupTaskClaimButtonText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},
groupTaskReleaseButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupTaskReleaseButtonText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},
groupTaskActionRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
},

groupTaskCompleteButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.success,
},

groupTaskCompleteButtonText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},

groupTaskCompletedSection: {
  marginTop: 8,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

groupTaskCompletedRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

groupTaskCompletedTitle: {
  color: theme.colors.textMuted,
  fontSize: 14,
  fontWeight: "900",
  textDecorationLine: "line-through",
},
groupTaskSummaryRow: {
  paddingVertical: 8,
  paddingHorizontal: 10,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
},

groupTaskSummaryText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

groupTaskSection: {
  marginTop: 10,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

groupTaskSectionTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
  marginBottom: 8,
},

groupTaskSectionEmpty: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
},
groupTaskSummarySubtext: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 4,
},

memberWorkloadRow: {
  marginTop: 4,
},

memberWorkloadText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
},
groupTaskSuggestionText: {
  color: theme.colors.primary,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 6,
  fontWeight: "800",
},

groupTaskSuggestionInline: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 3,
},
groupTaskSignalPill: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.warning,
  borderWidth: 1,
},

groupTaskSignalPillText: {
  color: theme.colors.warning,
  fontSize: 10,
  fontWeight: "900",
},
activityPoolHint: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},
groupTaskDueText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 3,
},
smartTaskSummaryCard: {
  marginTop: 12,
  marginBottom: 12,
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

smartTaskSummaryCardDanger: {
  borderColor: theme.colors.danger,
},

smartTaskSummaryCardWarning: {
  borderColor: theme.colors.warning,
},

smartTaskSummaryCardMuted: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
},

smartTaskSummaryTitle: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

smartTaskSummaryBody: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
},

smartTaskSummaryMeta: {
  color: theme.colors.primary,
  marginTop: 8,
  fontSize: 11,
  fontWeight: "900",
},
suggestedHelperBox: {
  marginTop: 4,
  gap: 2,
},

suggestedHelperReason: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "800",
},

suggestedAssigneeChip: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

suggestedAssigneeChipText: {
  color: theme.colors.primary,
  fontSize: 10,
  fontWeight: "900",
},

suggestedAssigneeChipMuted: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

suggestedAssigneeChipMutedText: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
},
workloadVisibilityBox: {
  marginBottom: 12,
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

workloadVisibilityTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

workloadVisibilitySummary: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
},

workloadVisibilityList: {
  marginTop: 10,
  gap: 8,
},

workloadVisibilityRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

workloadVisibilityMain: {
  flex: 1,
  minWidth: 0,
},

workloadVisibilityName: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},

workloadVisibilityMeta: {
  color: theme.colors.textMuted,
  marginTop: 2,
  fontSize: 10,
  fontWeight: "800",
},

workloadVisibilityPill: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

workloadVisibilityPillLow: {
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
},

workloadVisibilityPillText: {
  color: theme.colors.primary,
  fontSize: 10,
  fontWeight: "900",
},

workloadVisibilityPillTextLow: {
  color: theme.colors.textMuted,
},

workloadVisibilityMore: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 2,
},
smartTaskSummaryEyebrow: {
  color: theme.colors.primary,
  fontSize: 10,
  fontWeight: "900",
  textTransform: "uppercase",
  letterSpacing: 0.8,
  marginBottom: 4,
},
memberPresenceBlock: {
  marginTop: 6,
  gap: 3,
},

memberPresenceTextOnline: {
  color: theme.colors.success,
},

memberPresenceDotAway: {
  backgroundColor: theme.colors.border,
},

memberPresenceLiveText: {
  color: theme.colors.success,
  fontSize: 12,
  fontWeight: "900",
},

memberPresenceDetail: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "600",
},
liveNowBadge: {
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.success,
  borderWidth: 1,
},

liveNowBadgeText: {
  color: theme.colors.success,
  fontSize: 12,
  fontWeight: "900",
},

presenceEmptyText: {
  color: theme.colors.textMuted,
  lineHeight: 20,
  marginTop: 10,
},

presenceNameRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
},

presenceLivePill: {
  color: theme.colors.success,
  fontSize: 11,
  fontWeight: "900",
},

presenceRecentDot: {
  width: 9,
  height: 9,
  borderRadius: 999,
  backgroundColor: theme.colors.warning,
},

presenceMoreText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 6,
},
socialPulseBox: {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

socialPulseBoxLive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.success,
},

socialPulseBoxRecent: {
  borderColor: theme.colors.warning,
},

socialPulseTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

socialPulseTitleLive: {
  color: theme.colors.success,
},

socialPulseBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "600",
  marginTop: 3,
  lineHeight: 17,
},
activityReactionSection: {
  marginTop: 10,
  gap: 8,
},

activityReactionPickerRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

activityReactionButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

activityReactionButtonSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

activityReactionButtonText: {
  fontSize: 14,
},

activityReactionButtonTextSelected: {
  fontWeight: "900",
},

activityReactionSummaryRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

activityReactionSummaryPill: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

activityReactionSummaryText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
},
activityItemWrap: {
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  paddingVertical: 10,
},
groupCelebrationBanner: {
  padding: 14,
  borderRadius: 16,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.success,
  borderWidth: 1,
  marginBottom: 14,
},

groupCelebrationText: {
  color: theme.colors.success,
  fontSize: 14,
  fontWeight: "900",
  lineHeight: 19,
},
activityCelebrateHint: {
  color: theme.colors.success,
  fontSize: 12,
  fontWeight: "900",
},

activityReactionButtonSuggested: {
  borderColor: theme.colors.success,
  backgroundColor: theme.colors.badge,
},

activityReactionButtonTextSuggested: {
  fontWeight: "900",
},
teamWinsBadge: {
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.success,
  borderWidth: 1,
},

teamWinsBadgeText: {
  color: theme.colors.success,
  fontSize: 11,
  fontWeight: "900",
},

teamWinsList: {
  gap: 8,
},

teamWinRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

teamWinIcon: {
  fontSize: 18,
},

teamWinBody: {
  flex: 1,
  minWidth: 0,
},

teamWinTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

teamWinMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 2,
},
groupMoraleCardCelebrating: {
  borderColor: theme.colors.success,
  backgroundColor: theme.colors.badge,
},

groupMoraleCardNeedsAttention: {
  borderColor: theme.colors.warning,
},

groupMoraleHeader: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
},

groupMoraleEmoji: {
  fontSize: 24,
},

groupMoraleBody: {
  flex: 1,
  minWidth: 0,
},

groupMoraleTitle: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "900",
},

groupMoraleText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  fontWeight: "700",
  lineHeight: 18,
  marginTop: 3,
},
presencePulseWrap: {
  width: 16,
  height: 16,
  alignItems: "center",
  justifyContent: "center",
},

presencePulseRing: {
  position: "absolute",
  width: 16,
  height: 16,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: theme.colors.success,
  opacity: 0.35,
},

memberPresenceDotWrap: {
  width: 11,
  height: 11,
  alignItems: "center",
  justifyContent: "center",
},

memberPresencePulseRing: {
  position: "absolute",
  width: 11,
  height: 11,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: theme.colors.success,
  opacity: 0.35,
},
pressedSoft: {
  opacity: 0.72,
  transform: [{ scale: 0.99 }],
},
activityRowFreshCompletion: {
  borderColor: theme.colors.success,
  borderWidth: 1,
},
notificationMuteButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

notificationMuteButtonActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

notificationMuteButtonText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

notificationMuteButtonTextActive: {
  color: theme.colors.primary,
},

notificationCategoryGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
},

notificationCategoryChip: {
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

notificationCategoryChipActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

notificationCategoryChipMuted: {
  opacity: 0.45,
},

notificationCategoryChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},

notificationCategoryChipTextActive: {
  color: theme.colors.primary,
},

notificationCategoryChipTextMuted: {
  color: theme.colors.textMuted,
},
viewInboxButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

viewInboxButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
roleBadgeModerator: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},
adminHistoryList: {
  gap: 10,
  marginTop: 10,
},

adminHistoryRow: {
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  padding: 12,
  backgroundColor: theme.colors.surfaceMuted,
},

adminHistoryMessage: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "700",
},

adminHistoryMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  marginTop: 4,
},
reportInlineButton: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

reportInlineButtonText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},
reportPreviewBox: {
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  padding: 12,
  backgroundColor: theme.colors.surfaceMuted,
  marginTop: 10,
  marginBottom: 12,
},

reportPreviewTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

reportPreviewBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  marginTop: 4,
  lineHeight: 17,
},
moderationReportList: {
  gap: 10,
  marginTop: 12,
},

moderationReportRow: {
  padding: 12,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

moderationReportHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},

moderationReportTitle: {
  flex: 1,
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

moderationReportMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 6,
},

moderationReportNote: {
  color: theme.colors.text,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 8,
},

moderationStatusPill: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

moderationStatusPillText: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
},
moderationActionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 10,
},

moderationActionButton: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

moderationActionButtonText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

moderationActionButtonMuted: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

moderationActionButtonMutedText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},
moderationActionButtonDanger: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.danger,
  borderWidth: 1,
},

moderationActionButtonDangerText: {
  color: theme.colors.danger,
  fontSize: 11,
  fontWeight: "900",
},
moderationFocusHint: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 8,
},
moderationReportRowHighlighted: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},
moderationModeratorNote: {
  color: theme.colors.text,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 8,
  fontWeight: "700",
},
moderationActionHistoryText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  lineHeight: 17,
  marginTop: 6,
  fontWeight: "700",
},
reportReasonGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},
moderationConflictText: {
  color: theme.colors.warning,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 10,
  fontWeight: "800",
},
joinRequestList: {
  gap: 10,
  marginTop: 12,
},

joinRequestRow: {
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  padding: 12,
  backgroundColor: theme.colors.surfaceMuted,
},

joinRequestName: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

joinRequestMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  marginTop: 4,
  fontWeight: "700",
},

joinRequestMessage: {
  color: theme.colors.text,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 8,
},

joinRequestActions: {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
},

approveJoinRequestButton: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
  borderWidth: 1,
},

approveJoinRequestButtonText: {
  color: theme.colors.successText,
  fontSize: 12,
  fontWeight: "900",
},

declineJoinRequestButton: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
  borderWidth: 1,
},

declineJoinRequestButtonText: {
  color: theme.colors.dangerText,
  fontSize: 12,
  fontWeight: "900",
},
discoverySettingsLabel: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
  marginTop: 14,
  marginBottom: 8,
},

discoveryOptionList: {
  gap: 10,
},

discoveryOption: {
  padding: 12,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

discoveryOptionSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

discoveryOptionTitle: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

discoveryOptionTitleSelected: {
  color: theme.colors.primary,
},

discoveryOptionBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 4,
},

discoveryCategoryRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

discoveryCategoryChip: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

discoveryCategoryChipSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

discoveryCategoryChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},

discoveryCategoryChipTextSelected: {
  color: theme.colors.primary,
},

discoveryStatusText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  lineHeight: 19,
  marginTop: 8,
},

discoverySettingsActions: {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 14,
},

discoveryEditButton: {
  alignSelf: "flex-start",
  marginTop: 14,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

discoveryEditButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

discoverySaveButton: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

discoverySaveButtonText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

discoveryCancelButton: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

discoveryCancelButtonText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},
textArea: {
  minHeight: 90,
  textAlignVertical: "top",
},
joinRequestsCardHighlighted: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

joinRequestsFocusHint: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 8,
},
discoveryPreviewButton: {
  marginTop: 12,
  paddingVertical: 10,
  borderRadius: 12,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

discoveryPreviewButtonText: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
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
collapsibleSectionHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  minHeight: 42,
},

collapsibleSectionTextWrap: {
  flex: 1,
},

collapsibleSectionSubtitle: {
  marginTop: 3,
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 16,
  fontWeight: "700",
},

collapsibleSectionToggle: {
  minHeight: 32,
  paddingHorizontal: 13,
  paddingVertical: 6,
  borderRadius: 999,
  overflow: "hidden",
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
utilityAdminCard: {
  backgroundColor: theme.colors.surfaceMuted,
},
sharedGoalPreviewCard: {
  padding: 14,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
  marginBottom: 10,
},

openSharedGoalsButton: {
  marginTop: 8,
  paddingVertical: 12,
  borderRadius: 14,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.primary,
},

openSharedGoalsButtonText: {
  color: theme.colors.primaryText,
  fontSize: 13,
  fontWeight: "900",
},

groupPlanningBoardList: {
  gap: 10,
},

groupRoutineHeader: {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},
groupRoutineHeaderText: {
  flex: 1,
  minWidth: 180,
},
groupRoutinePreview: {
  gap: 4,
  padding: 12,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
},
groupRoutineSummary: {
  color: theme.colors.text,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
},
groupRoutineNext: {
  color: theme.colors.primary,
  fontSize: 11,
  lineHeight: 16,
  fontWeight: "900",
},

groupPlanningBoardCreateToggle: {
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupPlanningBoardCreateToggleText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

groupPlanningBoardForm: {
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  gap: 8,
},

groupPlanningBoardFormActions: {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
},

groupPlanningBoardPreview: {
  padding: 14,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
  gap: 8,
},

groupPlanningBoardTitle: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "900",
},

groupPlanningBoardMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},

groupPlanningBoardColumnRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
},

groupPlanningBoardColumnChip: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

groupPlanningBoardColumnChipText: {
  color: theme.colors.badgeText,
  fontSize: 11,
  fontWeight: "900",
},

groupPlanningBoardOpenButton: {
  alignSelf: "flex-start",
  marginTop: 2,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

groupPlanningBoardOpenButtonText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

groupPlanningBoardArchiveButton: {
  alignSelf: "flex-start",
  marginTop: 2,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupPlanningBoardArchiveButtonText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

groupPlanningBoardMoreText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  fontWeight: "800",
},
bulletinComposer: {
  gap: 8,
},

bulletinList: {
  marginTop: 12,
  gap: 10,
},

bulletinRow: {
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

bulletinTitle: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "900",
},

bulletinBody: {
  color: theme.colors.text,
  fontSize: 13,
  lineHeight: 19,
  marginTop: 6,
},

bulletinMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 8,
},
mentionHelperText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  lineHeight: 18,
},

mentionChipRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

mentionChip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

mentionChipText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
bulletinImagePickerRow: {
  marginTop: 8,
},

bulletinImagePickerButton: {
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

bulletinImagePickerButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

bulletinImagePreviewGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
},

bulletinImagePreviewWrap: {
  width: 82,
  height: 82,
  borderRadius: 14,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

bulletinImagePreview: {
  width: "100%",
  height: "100%",
},

bulletinImageRemoveButton: {
  position: "absolute",
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  borderRadius: 11,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.overlay,
},

bulletinImageRemoveText: {
  color: theme.colors.primaryText,
  fontSize: 16,
  fontWeight: "900",
  lineHeight: 18,
},
bulletinThumbnail: {
  width: "100%",
  height: 140,
  borderRadius: 14,
  marginTop: 10,
  backgroundColor: theme.colors.surfaceMuted,
},

bulletinAttachmentMeta: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 8,
},
bulletinVideoPreviewMini: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginTop: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

bulletinVideoPreviewMiniIcon: {
  fontSize: 18,
},

bulletinVideoPreviewMiniTextWrap: {
  flex: 1,
  minWidth: 0,
},

bulletinVideoPreviewMiniTitle: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},

bulletinVideoPreviewMiniUrl: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  marginTop: 2,
},
bulletinImageFallback: {
  width: "100%",
  height: 140,
  borderRadius: 14,
  marginTop: 10,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

bulletinImageFallbackText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},
moderationReportPreviewBox: {
  marginTop: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

moderationReportPreviewTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

moderationReportPreviewBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 4,
},
messageCardActionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
},

messageCardPrimaryButton: {
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

messageCardPrimaryText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

messageCardSecondaryButton: {
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

messageCardSecondaryText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
leaveGroupCard: {
  borderColor: theme.colors.dangerBorder,
},

leaveGroupButton: {
  alignSelf: "flex-start",
  marginTop: 12,
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
  borderWidth: 1,
},

leaveGroupButtonText: {
  color: theme.colors.dangerText,
  fontSize: 13,
  fontWeight: "900",
},
leaveGroupFooter: {
  marginTop: 14,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

leaveGroupFooterText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
  fontWeight: "700",
},
groupConversationPreviewList: {
  marginTop: 12,
  gap: 8,
},

groupConversationPreviewRow: {
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

groupConversationPreviewTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

groupConversationPreviewMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 3,
},

groupConversationMoreText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},
conversationMemberPickerList: {
  gap: 8,
  marginBottom: 8,
},

conversationMemberPickerRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

conversationMemberPickerRowSelected: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

conversationMemberAvatar: {
  width: 32,
  height: 32,
  borderRadius: 16,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.badge,
},

conversationMemberAvatarText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

conversationMemberInfo: {
  flex: 1,
  minWidth: 0,
},

conversationMemberName: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

conversationMemberMeta: {
  color: theme.colors.textMuted,
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
},

conversationMemberSelectedText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
  });
