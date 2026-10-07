import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
//import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  formatProgressValue,
  ProgressMeter,
} from "../../components/ProgressMeter";
import { ProgressEventCard } from "../../components/ProgressEventCard";
import { MediaAttachmentGrid } from "../../components/MediaAttachmentGrid";
import { MediaAttachmentViewer } from "../../components/media/MediaAttachmentViewer";
import { CommentMediaCandidateTray } from "../../components/media/CommentMediaCandidateTray";
import {
  pickCommentMediaCandidates,
  type PendingCommentMedia,
} from "../../components/media/commentMediaPicker";
import { dayKeyFromDate, getUserTz } from "../../services/dateKey";
import { auth, db } from "../../services/firebase";
import { writeGoalCompletion } from "../../services/goalCompletions";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "../../services/haptics";
import { normalizeGoalInput, normalizeSubtaskInput } from "../../services/goalNormalization";
import type {
  Goal,
  Subtask,
  SubtaskCompletionMode,
  SubtaskFormInput,

  SubtaskFrequency,
  SubtaskReminderPreset,
  SubtaskScheduleType,
} from "../../services/goalTypes";
import {
  pushGoalOnlyToGoogleCalendar,
  pushSubtaskToGoogleCalendar,
  removeGoalOnlyFromGoogleCalendar,
  removeSubtaskFromGoogleCalendar,
} from "../../services/googleCalendarPush";
import {
  GROUP_PRESENCE_HEARTBEAT_THROTTLE_MS,
  assignSharedGoalSubtaskToMember,
  canUseGroupHereMention,
  clearGroupGoalTyping,
  createGroupActivity,
  createGroupGoalComment,
  reserveGroupGoalCommentId,
  markGroupPresenceRecent,
  removeGroupGoalCommentReaction,
  shareGoalToGroup,
  subscribeGroupGoalCommentReactions,
  subscribeGroupGoalComments,
  subscribeGroupGoalTyping,
  subscribeGroupMembers,
  subscribeGroupPresence,
  subscribeMyGroupMemberships,
  unassignSharedGoalSubtask,
  upsertGroupGoalCommentReaction,
  upsertGroupGoalTyping,
  upsertGroupPresence,
  type GroupGoalCommentDoc,
  type GroupGoalCommentReactionDoc,
  type GroupGoalTypingDoc,
  type GroupMemberDoc,
  type GroupPresenceDoc,
} from "../../services/groups";
import {
  cancelScheduledSubtaskNotification,
  scheduleSubtaskNotification,
} from "../../services/notifications";
import {
  archiveGoalMilestone,
  completeGoalMilestone,
  createGoalMilestone,
  subscribeGoalMilestones,
  updateGoalMilestone,
  type GoalMilestoneDoc,
} from "../../services/milestones";
import {
  cancelPushReminderQueueDoc,
  upsertPushReminderQueueDoc,
} from "../../services/pushReminderQueue";
import { buildReminderPatch } from "../../services/reminders";
import {
  createMediaAttachmentId,
  createMediaUploadAttempt,
  cancelMediaUploadAttempt,
  createVideoLinkAttachment,
  deleteMediaAttachmentObjects,
  getMediaAttachmentPolicy,
  isCurrentMediaUploadAttempt,
  MAX_MEDIA_ATTACHMENTS,
  MediaAttachmentError,
  MediaUploadBatchError,
  normalizeLocalMediaCandidate,
  normalizeVideoLink,
  uploadMediaAttachmentBatch,
  uploadContextMediaAttachmentBatch,
  validateLocalMediaCandidate,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentDoc,
  type MediaAttachmentErrorCode,
  type MediaUploadBatchHandle,
  type MediaUploadAttempt,
  type MediaUploadStatus,
} from "../../services/mediaAttachments";
import {
  cancelMediaUploadSession,
  createMediaUploadSession,
  finalizeMediaUploadSession,
} from "../../services/mediaUploadSessions";
import {
  createSubtaskProgressEventId,
  deleteSubtaskAndCompletions,
  MAX_PROGRESS_COMMENT_LENGTH,
  normalizeProgressEventComment,
  recordSubtaskProgressTx,
  subscribeSubtaskProgressEvents,
  type SubtaskProgressEventDoc,
} from "../../services/subtasks";
import { UI_SIZES, type AppThemeTokens } from "../../services/theme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";


const COMMENT_MAX_LENGTH = 1000;
const QUICK_COMMENT_REACTIONS = ["👍", "❤️", "🎉"] as const;


function getPickerImageMimeType(input: {
  mimeType?: string | null;
  fileName?: string | null;
  uri: string;
}): string | null {
  const explicitMime = input.mimeType?.trim().toLowerCase();
  if (explicitMime) return explicitMime;
  const source = (input.fileName || input.uri).split("?")[0].toLowerCase();
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "image/jpeg";
  if (source.endsWith(".png")) return "image/png";
  if (source.endsWith(".webp")) return "image/webp";
  if (source.endsWith(".gif")) return "image/gif";
  if (source.endsWith(".heic")) return "image/heic";
  if (source.endsWith(".heif")) return "image/heif";
  return null;
}

function formatVideoDuration(durationMs?: number | null): string {
  const totalSeconds = Math.max(0, Math.round((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatMediaSize(sizeBytes?: number | null): string | null {
  if (sizeBytes == null || sizeBytes <= 0) return null;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeProgress(current: number | null, target: number | null): number {
  if (target == null || target <= 0) return 0;
  const safeCurrent = current ?? 0;
  const pct = (safeCurrent / target) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function roundMetricValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCountMetricDelta(params: {
  previousCount: number;
  nextCount: number;
  targetCount: number;
  metricValue: number;
}) {
  const { previousCount, nextCount, targetCount, metricValue } = params;

  if (targetCount <= 0 || metricValue <= 0) {
    return 0;
  }

  const safePreviousCount = clampNumber(previousCount, 0, targetCount);
  const safeNextCount = clampNumber(nextCount, 0, targetCount);

  const perUnitValue = metricValue / targetCount;

  return roundMetricValue((safeNextCount - safePreviousCount) * perUnitValue);
}

function parseYyyyMmDdToMs(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  // Basic validation (Date will auto-roll otherwise)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt.getTime(); // local midnight
}

function parseYyyyMmDdToDayKey(s: string): string | null {
  const t = s.trim();
  if (!t) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }

  return `${m[1]}-${m[2]}-${m[3]}`;
}

function formatDateToInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimeToInput(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatDayKeyForDisplay(dayKey?: string | null): string | null {
  if (!dayKey) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  const dt = new Date(y, mo, d);
  return dt.toLocaleDateString();
}

function formatMilestoneStatusLabel(status: GoalMilestoneDoc["status"]): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    case "active":
      return "Active";
    case "next":
      return "Next";
    case "backlog":
      return "Backlog";
    case "review":
      return "Review";
    case "idea":
      return "Idea";
    case "archived":
      return "Archived";
    default:
      return "Active";
  }
}

function formatMilestoneDueDate(ms?: number | null): string | null {
  if (typeof ms !== "number") return null;
  return new Date(ms).toLocaleDateString();
}

function parseMilestoneDateInput(value: string): number | null {
  return parseYyyyMmDdToMs(value);
}

function parseHhMmToParts(s: string): { hour: number; minute: number } | null {
  const t = s.trim();
  if (!t) return null;

  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  return { hour, minute };
}

function combineDateAndOptionalTimeToMs(
  dateText: string,
  timeText: string
): number | null {
  const dayMs = parseYyyyMmDdToMs(dateText);
  if (dayMs == null) return null;

  const trimmedTime = timeText.trim();
  if (!trimmedTime) {
    return dayMs;
  }

  const timeParts = parseHhMmToParts(trimmedTime);
  if (!timeParts) return null;

  const base = new Date(dayMs);
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    timeParts.hour,
    timeParts.minute,
    0,
    0
  ).getTime();
}

function formatTimeForDisplayFromMs(ms?: number | null): string | null {
  if (typeof ms !== "number") return null;

  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseCustomReminderOffsetMinutes(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function formatMetricNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";

  const rounded = Math.round(value * 1000) / 1000;

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return String(rounded).replace(/\.?0+$/, "");
}

function formatCountMetricContributionLabel(subtask: Subtask): string | null {
  if (
    subtask.completionMode !== "count" ||
    subtask.contributesToMetric !== true ||
    typeof subtask.metricValue !== "number" ||
    typeof subtask.targetCount !== "number" ||
    subtask.targetCount <= 0
  ) {
    return null;
  }

  const perCount = subtask.metricValue / subtask.targetCount;
  const unit = subtask.metricUnit ? ` ${subtask.metricUnit}` : "";

  return `+${formatMetricNumber(perCount)}${unit} per count`;
}

function formatReminderPresetLabel(preset: SubtaskReminderPreset): string {
  switch (preset) {
    case "none":
      return "None";
    case "at_time":
      return "At time";
    case "morning_of":
      return "Morning of";
    case "day_before":
      return "Day before";
    case "custom":
      return "Custom";
  }
}

function dayRangeMs(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}



function isDueToday(subtask: Subtask, tz: string, todayKey: string): boolean {
  const { start, end } = dayRangeMs();
  const todayDow = new Date().getDay();

  const scheduleType: SubtaskScheduleType =
    subtask.scheduleType === "oneTime" || subtask.frequency === "once"
      ? "oneTime"
      : "recurring";

  const freq = subtask.frequency ?? "once";

  if (scheduleType === "oneTime") {
    const completedEver =
      typeof subtask.firstCompletedAtMs === "number" && subtask.firstCompletedAtMs > 0;

    if (completedEver) return false;

    const scheduledDayKey =
      typeof subtask.scheduledDayKey === "string" && subtask.scheduledDayKey
        ? subtask.scheduledDayKey
        : typeof subtask.dueAtMs === "number"
        ? dayKeyFromDate(new Date(subtask.dueAtMs), tz)
        : null;

    if (scheduledDayKey) {
      return scheduledDayKey === todayKey;
    }

    return true;
  }

  if (typeof subtask.dueAtMs === "number" && subtask.dueAtMs >= start && subtask.dueAtMs < end) {
    return true;
  }

  if (freq === "daily") return true;

  if (freq === "weekly") {
    const wd = typeof subtask.weeklyDay === "number" ? subtask.weeklyDay : null;
    return wd === todayDow;
  }

  return false;
}

function formatCalendarExportHistoryTime(createdAtMs: number): string {
  if (!createdAtMs) return "";

  const d = new Date(createdAtMs);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString();
}

function formatSubtaskNotificationStatus(subtask: Subtask): string {
  if (subtask.notifications?.enabled !== true) {
    return "Notifications off";
  }

  if (typeof subtask.dueAtMs !== "number") {
    return "Reminder on — needs date/time";
  }

  const offset = subtask.notifications?.reminderOffsetMinutes ?? 0;
  const triggerAtMs = subtask.dueAtMs - offset * 60 * 1000;

  if (triggerAtMs <= Date.now()) {
    return "Reminder time has passed";
  }

  const isRecurring =
    subtask.scheduleType !== "oneTime" &&
    (subtask.frequency === "daily" || subtask.frequency === "weekly");

  const dateLabel = new Date(triggerAtMs).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  const timeLabel = new Date(triggerAtMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const prefix = isRecurring ? "Next reminder" : "Reminder";

  if (offset === 0) {
    return `${prefix} ${dateLabel} at ${timeLabel}`;
  }

  return `${prefix} ${dateLabel} at ${timeLabel} • ${offset} min before`;
}

function getNextNotificationDueAtMsForSubtask(params: {
  subtask: Subtask;
  fromMs?: number;
}): number | null {
  const { subtask } = params;
  const fromMs = params.fromMs ?? Date.now();

  if (subtask.notifications?.enabled !== true) {
    return null;
  }

  if (typeof subtask.dueAtMs !== "number") {
    return null;
  }

  const scheduleType: SubtaskScheduleType =
    subtask.scheduleType === "oneTime" || subtask.frequency === "once"
      ? "oneTime"
      : "recurring";

  if (scheduleType === "oneTime") {
    return null;
  }

  const baseDue = new Date(subtask.dueAtMs);

  if (subtask.frequency === "daily") {
    let next = new Date(
      baseDue.getFullYear(),
      baseDue.getMonth(),
      baseDue.getDate(),
      baseDue.getHours(),
      baseDue.getMinutes(),
      0,
      0
    );

    while (next.getTime() <= fromMs) {
      next = new Date(
        next.getFullYear(),
        next.getMonth(),
        next.getDate() + 1,
        next.getHours(),
        next.getMinutes(),
        0,
        0
      );
    }

    return next.getTime();
  }

  if (subtask.frequency === "weekly") {
    const weeklyDay =
      typeof subtask.weeklyDay === "number"
        ? subtask.weeklyDay
        : baseDue.getDay();

    let next = new Date(
      baseDue.getFullYear(),
      baseDue.getMonth(),
      baseDue.getDate(),
      baseDue.getHours(),
      baseDue.getMinutes(),
      0,
      0
    );

    while (next.getDay() !== weeklyDay || next.getTime() <= fromMs) {
      next = new Date(
        next.getFullYear(),
        next.getMonth(),
        next.getDate() + 1,
        next.getHours(),
        next.getMinutes(),
        0,
        0
      );
    }

    return next.getTime();
  }

  return null;
}

function getCalendarExportDecisionReason(params: {
  mode: "off" | "goal_only" | "subtasks";
  autoSync?: boolean | null;
  existingEventId?: string | null;
  source: "manual_export" | "auto_sync" | "remove";
}): string {
  if (params.mode === "off") {
    return "Calendar Export mode is off.";
  }

  if (params.source === "auto_sync") {
    return params.autoSync
      ? "Auto-sync is enabled."
      : "Auto-sync is not enabled.";
  }

  if (params.source === "remove") {
    return "User confirmed removal.";
  }

  if (params.existingEventId) {
    return "An exported Google Calendar event already exists, so it was updated.";
  }

  return "No exported Google Calendar event existed yet, so one was created.";
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



type DailyCompletionSnapshot = {
  completionCount: number | null;
  completedAtMs: number | null;
};

type PendingProgressImage = {
  id: string;
  sourceKey: string;
  previewUri: string;
  candidate: LocalMediaAttachmentCandidate;
  status: MediaUploadStatus;
  progress: number;
  errorCode?: MediaAttachmentErrorCode;
};

type MyGroupMembership = GroupMemberDoc & {
  groupId: string;
};

type GoalForCalendarExport = Goal;

type CalendarExportHistoryAction =
  | "goal_exported"
  | "subtasks_exported"
  | "exports_removed"
  | "auto_sync_goal"
  | "auto_sync_subtasks"
  | "sync_failed"
  | "sync_skipped";

function getCompletionSnapshotMapKey(subtaskId: string, dayKey: string) {
  return `${subtaskId}:${dayKey}`;
}

export default function GoalDetailScreen() {
 const { id, highlightSubtaskId } = useLocalSearchParams<{
  id: string;
  highlightSubtaskId?: string;
}>();
  const uid = auth.currentUser?.uid ?? null;

  const { theme } = useCurrentAppTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);

  const [goal, setGoal] = useState<Goal | null>(null);

  const [myGroups, setMyGroups] = useState<MyGroupMembership[]>([]);




const [sharingGroupId, setSharingGroupId] = useState<string | null>(null);

const [goalDiscussionGroupId, setGoalDiscussionGroupId] = useState<string | null>(null);

const [goalDiscussionComments, setGoalDiscussionComments] = useState<
  GroupGoalCommentDoc[]
>([]);

const [commentReactionsByCommentId, setCommentReactionsByCommentId] =
  useState<Record<string, GroupGoalCommentReactionDoc[]>>({});

  const [completionCelebrationText, setCompletionCelebrationText] =
  useState<string | null>(null);

  const getReactionSummaryForComment = (commentId: string) => {
  const reactions = commentReactionsByCommentId[commentId] ?? [];
  const summary: Record<string, number> = {};

  reactions.forEach((reaction) => {
    summary[reaction.emoji] = (summary[reaction.emoji] ?? 0) + 1;
  });

  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
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

const [goalDiscussionTyping, setGoalDiscussionTyping] = useState<
  GroupGoalTypingDoc[]
>([]);

const [loadingGoalDiscussionComments, setLoadingGoalDiscussionComments] =
  useState(false);

const [goalDiscussionInput, setGoalDiscussionInput] = useState("");

const [goalDiscussionMentionQuery, setGoalDiscussionMentionQuery] =
  useState("");

const [showGoalDiscussionMentionPicker, setShowGoalDiscussionMentionPicker] =
  useState(false);

  const [goalDiscussionMentionMembers, setGoalDiscussionMentionMembers] =
  useState<GroupMemberDoc[]>([]);

  
const [postingGoalDiscussionComment, setPostingGoalDiscussionComment] =
  useState(false);
const [goalCommentMedia, setGoalCommentMedia] = useState<PendingCommentMedia[]>([]);
const [goalCommentUploadProgress, setGoalCommentUploadProgress] = useState(0);
const [goalCommentUploadStatus, setGoalCommentUploadStatus] = useState<string | null>(null);
const goalCommentUploadHandleRef = useRef<MediaUploadBatchHandle | null>(null);
const goalCommentAttemptRef = useRef<MediaUploadAttempt | null>(null);
const [goalCommentViewer, setGoalCommentViewer] = useState<{
  attachments: MediaAttachmentDoc[];
  index: number;
} | null>(null);
useEffect(
  () => () => {
    if (goalCommentAttemptRef.current) {
      cancelMediaUploadAttempt(goalCommentAttemptRef.current);
      goalCommentUploadHandleRef.current?.cancel();
    }
  },
  []
);

const [showGoalDiscussion, setShowGoalDiscussion] = useState(false);
const [showAddSubtaskForm, setShowAddSubtaskForm] = useState(false);
const [showCompletedSubtasks, setShowCompletedSubtasks] = useState(false);

  const lastPresenceHeartbeatRef = useRef(0);

    const goalScrollRef = useRef<ScrollView | null>(null);
  const subtaskLayoutYByIdRef = useRef<Record<string, number>>({});
  const hasAutoScrolledToHighlightedSubtaskRef = useRef(false);

const [goalPresenceItems, setGoalPresenceItems] = useState<
  GroupPresenceDoc[]
>([]);

  const [loading, setLoading] = useState(true);
  const currentGoalDiscussionMemberRole = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  return (
    goalDiscussionMentionMembers.find((member) => member.uid === currentUid)
      ?.role ?? null
  );
}, [goalDiscussionMentionMembers]);

const canUseGoalDiscussionHereMention =
  canUseGroupHereMention(currentGoalDiscussionMemberRole);
const filteredGoalDiscussionMentions = useMemo(() => {
  const query = goalDiscussionMentionQuery.trim().toLowerCase();

  const results =
    query.length === 0
      ? goalDiscussionMentionMembers
      : goalDiscussionMentionMembers
    .filter((member) => member.uid !== auth.currentUser?.uid)
    .filter((member) =>
          (member.displayName ?? member.email ?? "")
            .toLowerCase()
            .includes(query)
        );

  return results.slice(0, 6);
}, [
  goalDiscussionMentionMembers,
  goalDiscussionMentionQuery,
]);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(false);
  
//const [contributesToMetric, setContributesToMetric] = useState(false);
const [subtaskMetricValue, setSubtaskMetricValue] = useState("");
  const [currentValue, setCurrentValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

const [subtasks, setSubtasks] = useState<Subtask[]>([]);
const [milestones, setMilestones] = useState<GoalMilestoneDoc[]>([]);
const [showAddMilestoneForm, setShowAddMilestoneForm] = useState(false);
const [milestoneTitleInput, setMilestoneTitleInput] = useState("");
const [milestoneDescriptionInput, setMilestoneDescriptionInput] = useState("");
const [milestoneDueDateInput, setMilestoneDueDateInput] = useState("");
const [savingMilestone, setSavingMilestone] = useState(false);
const [editingMilestone, setEditingMilestone] = useState<GoalMilestoneDoc | null>(null);
const [editMilestoneTitleInput, setEditMilestoneTitleInput] = useState("");
const [editMilestoneDescriptionInput, setEditMilestoneDescriptionInput] = useState("");
const [editMilestoneDueDateInput, setEditMilestoneDueDateInput] = useState("");
const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
const [newSubtaskDescription, setNewSubtaskDescription] = useState("");
const [creatingSubtask, setCreatingSubtask] = useState(false);
const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

const [subtaskNotificationsEnabled, setSubtaskNotificationsEnabled] =
  useState(false);

const [subtaskReminderOffsetMinutes, setSubtaskReminderOffsetMinutes] =
  useState<0 | 10 | 30 | 60>(0);

  const [subtaskReminderPreset, setSubtaskReminderPreset] =
  useState<SubtaskReminderPreset>("none");

const [subtaskReminderCustomOffsetInput, setSubtaskReminderCustomOffsetInput] =
  useState("");

const [showDatePicker, setShowDatePicker] = useState(false);
const [showTimePicker, setShowTimePicker] = useState(false);
const [subtaskScheduleType, setSubtaskScheduleType] =
  useState<SubtaskScheduleType>("recurring");
const [subtaskFrequency, setSubtaskFrequency] =
  useState<SubtaskFrequency>("daily");
const [subtaskDueDate, setSubtaskDueDate] = useState(""); // YYYY-MM-DD
const [subtaskDueTime, setSubtaskDueTime] = useState(""); // HH:mm
const [subtaskWeeklyDay, setSubtaskWeeklyDay] = useState<number>(new Date().getDay());

const [subtaskCompletionMode, setSubtaskCompletionMode] =
  useState<SubtaskCompletionMode>("binary");
const [subtaskTargetCountInput, setSubtaskTargetCountInput] = useState("");
const [subtaskContributesToMetric, setSubtaskContributesToMetric] = useState(false);
const tz = useMemo(() => getUserTz(), []);
const todayKey = useMemo(() => dayKeyFromDate(new Date(), tz), [tz]);

const milestoneRollup = useMemo(() => {
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(
    (milestone) => milestone.status === "completed"
  ).length;
  const milestoneProgressPercentage =
    totalMilestones > 0
      ? Math.round((completedMilestones / totalMilestones) * 100)
      : 0;

  return {
    totalMilestones,
    completedMilestones,
    milestoneProgressPercentage,
  };
}, [milestones]);

const highlightedSubtaskId =
  typeof highlightSubtaskId === "string"
    ? highlightSubtaskId
    : null;

    useEffect(() => {
  if (!highlightedSubtaskId || subtasks.length === 0) return;
  if (hasAutoScrolledToHighlightedSubtaskRef.current) return;

  const timeout = setTimeout(() => {
    const y = subtaskLayoutYByIdRef.current[highlightedSubtaskId];

    if (typeof y !== "number") return;

    hasAutoScrolledToHighlightedSubtaskRef.current = true;

    goalScrollRef.current?.scrollTo({
      y: Math.max(0, y - 90),
      animated: true,
    });

    jumpToOverviewSubtask(highlightedSubtaskId);
  }, 350);

  return () => clearTimeout(timeout);
}, [highlightedSubtaskId, subtasks.length]);

const sharedGroupIdsForGoal = useMemo(() => {
  if (!goal || !Array.isArray(goal.sharedGroupIds)) {
    return [];
  }

  return goal.sharedGroupIds.filter(
    (groupId): groupId is string => typeof groupId === "string" && groupId.length > 0
  );
}, [goal]);

const visibleSharedGroupIds = useMemo(() => {
  if (sharedGroupIdsForGoal.length === 0 || myGroups.length === 0) {
    return [];
  }

  const myGroupIdSet = new Set(myGroups.map((membership) => membership.groupId));

  return sharedGroupIdsForGoal.filter((groupId) => myGroupIdSet.has(groupId));
}, [sharedGroupIdsForGoal, myGroups]);

const activePresenceGroupId = useMemo(() => {
  return visibleSharedGroupIds[0] ?? null;
}, [visibleSharedGroupIds]);

const sharedSourceGroupLabels = useMemo(() => {
  if (visibleSharedGroupIds.length === 0) {
    return [];
  }

  return visibleSharedGroupIds.map((groupId) => {
    const membership = myGroups.find((item) => item.groupId === groupId);

    return membership?.groupName ?? groupId;
  });
}, [visibleSharedGroupIds, myGroups]);

const sharedSourceGroupText =
  sharedSourceGroupLabels.length > 0
    ? sharedSourceGroupLabels.join(", ")
    : null;

    const assignedToMeCount = subtasks.filter(
  (s) => !!uid && s.assignedToUid === uid
).length;



const sharedGoalInfoSubtitle = sharedSourceGroupText
  ? `From ${sharedSourceGroupText}`
  : "Shared with one of your groups";

useEffect(() => {
  if (!id || !goalDiscussionGroupId) {
    setGoalDiscussionComments([]);
    setLoadingGoalDiscussionComments(false);
    return;
  }

  setLoadingGoalDiscussionComments(true);

  const unsub = subscribeGroupGoalComments(
    goalDiscussionGroupId,
    String(id),
    (comments) => {
      setGoalDiscussionComments(comments.slice(0, 10));
      setLoadingGoalDiscussionComments(false);
    },
    (err) => {
      console.log("[GoalDetail] failed loading goal discussion comments", err);
      setGoalDiscussionComments([]);
      setLoadingGoalDiscussionComments(false);
    }
  );

  return unsub;
}, [id, goalDiscussionGroupId]);



useEffect(() => {
  if (!goalDiscussionGroupId || !id || goalDiscussionComments.length === 0) {
    setCommentReactionsByCommentId({});
    return;
  }

  const unsubs = goalDiscussionComments.map((comment) =>
    subscribeGroupGoalCommentReactions(
      goalDiscussionGroupId,
      String(id),
      comment.id,
      (reactions) => {
        setCommentReactionsByCommentId((current) => ({
          ...current,
          [comment.id]: reactions,
        }));
      },
      (err) => {
        console.log("[GoalDetail] failed loading comment reactions", {
          commentId: comment.id,
          err,
        });
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [goalDiscussionGroupId, id, goalDiscussionComments]);


useEffect(() => {
  if (!id || !goalDiscussionGroupId) {
    setGoalDiscussionTyping([]);
    return;
  }

  const unsub = subscribeGroupGoalTyping(
    goalDiscussionGroupId,
    String(id),
    (typing) => {
      const currentUid = auth.currentUser?.uid;

      setGoalDiscussionTyping(
        typing.filter((item) => item.uid !== currentUid)
      );
    },
    (err) => {
      console.log("[GoalDetail] failed loading discussion typing", err);
    }
  );

  return unsub;
}, [id, goalDiscussionGroupId]);

useEffect(() => {
  setGoalDiscussionGroupId(visibleSharedGroupIds[0] ?? null);
}, [visibleSharedGroupIds]);

useEffect(() => {
  if (!goalDiscussionGroupId) {
    setGoalDiscussionMentionMembers([]);
    return;
  }

  const unsub = subscribeGroupMembers(
    goalDiscussionGroupId,
    (members) => {
      const currentUid = auth.currentUser?.uid;

setGoalDiscussionMentionMembers(members);
    },
    (err) => {
      console.log("[GoalDetail] mention members failed", err);
    }
  );

  return unsub;
}, [goalDiscussionGroupId]);


useEffect(() => {
  const currentUser = auth.currentUser;

  if (
    !activePresenceGroupId ||
    !goal ||
    !id ||
    !currentUser?.uid
  ) {
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
        groupId: activePresenceGroupId,
        uid: currentUser.uid,
        displayName:
          currentUser.displayName ??
          currentUser.email ??
          null,
        email: currentUser.email ?? null,
        photoURL: currentUser.photoURL ?? null,
        activeRoute: "goal",
        activeGoalId: String(id),
        activeGoalTitle: goal.title ?? "Untitled goal",
      });
    } catch (e) {
      if (!cancelled) {
        console.log("[GoalDetail] presence heartbeat failed", e);
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
      groupId: activePresenceGroupId,
      uid: currentUser.uid,
    }).catch((e) => {
      console.log("[GoalDetail] mark recent failed", e);
    });
  };
}, [activePresenceGroupId, goal?.title, id]);


useEffect(() => {
  if (!activePresenceGroupId) {
    setGoalPresenceItems([]);
    return;
  }

  const unsub = subscribeGroupPresence(
    activePresenceGroupId,
    setGoalPresenceItems,
    (err) => {
      console.log(
        "[GoalDetail] failed loading goal presence",
        err
      );
    }
  );

  return unsub;
}, [activePresenceGroupId]);




const [completionSnapshotsByKey, setCompletionSnapshotsByKey] = useState<
  Record<string, DailyCompletionSnapshot>
>({});
const [completionSnapshotsReady, setCompletionSnapshotsReady] = useState(false);

const [progressTarget, setProgressTarget] = useState<Subtask | null>(null);
const [progressAmountInput, setProgressAmountInput] = useState("1");
const [progressNoteInput, setProgressNoteInput] = useState("");
const [savingProgressUpdate, setSavingProgressUpdate] = useState(false);
const progressSaveLockRef = useRef(false);
const [pendingProgressImages, setPendingProgressImages] = useState<
  PendingProgressImage[]
>([]);
const [progressVideoLinkInput, setProgressVideoLinkInput] = useState("");
const [pendingProgressVideoLink, setPendingProgressVideoLink] =
  useState<MediaAttachmentDoc | null>(null);
const [showProgressVideoLinkInput, setShowProgressVideoLinkInput] =
  useState(false);
const [progressVideoLinkError, setProgressVideoLinkError] = useState<
  string | null
>(null);
const [selectedHistorySubtask, setSelectedHistorySubtask] =
  useState<Subtask | null>(null);
const [progressHistoryEvents, setProgressHistoryEvents] = useState<
  SubtaskProgressEventDoc[]
>([]);
const [progressHistoryLoading, setProgressHistoryLoading] = useState(false);
const [progressHistoryError, setProgressHistoryError] = useState(false);
const [progressHistoryHasMore, setProgressHistoryHasMore] = useState(false);
const [progressHistoryLimit, setProgressHistoryLimit] = useState(20);
const [progressHistoryRetryKey, setProgressHistoryRetryKey] = useState(0);
const [progressHistoryViewer, setProgressHistoryViewer] = useState<{
  attachments: MediaAttachmentDoc[];
  index: number;
} | null>(null);
const activeProgressMediaBatchRef = useRef<MediaUploadBatchHandle | null>(null);
const progressSaveAttemptIdRef = useRef(0);
const uploadedUnsubmittedImagesRef = useRef<MediaAttachmentDoc[]>([]);
const progressTransactionStartedRef = useRef(false);
const goalDetailMountedRef = useRef(true);

useEffect(() => {
  goalDetailMountedRef.current = true;
  return () => {
    goalDetailMountedRef.current = false;
    activeProgressMediaBatchRef.current?.cancel();
    const uploaded = progressTransactionStartedRef.current
      ? []
      : uploadedUnsubmittedImagesRef.current;
    uploadedUnsubmittedImagesRef.current = [];
    if (uploaded.length > 0) {
      deleteMediaAttachmentObjects(uploaded).then((cleanup) => {
        if (cleanup.failedPaths.length > 0) {
          console.error("[GoalDetail] progress media cleanup failed", {
            failedPaths: cleanup.failedPaths,
          });
        }
      });
    }
  };
}, []);

useEffect(() => {
  if (!id || !selectedHistorySubtask) return;
  let active = true;
  setProgressHistoryLoading(true);
  setProgressHistoryError(false);
  const unsubscribe = subscribeSubtaskProgressEvents(
    String(id),
    selectedHistorySubtask.id,
    (events, hasMore) => {
      if (!active || !goalDetailMountedRef.current) return;
      setProgressHistoryEvents(events);
      setProgressHistoryLoading(false);
      setProgressHistoryError(false);
      setProgressHistoryHasMore(hasMore);
    },
    () => {
      if (!active || !goalDetailMountedRef.current) return;
      console.error("[GoalDetail] progress history subscription failed");
      setProgressHistoryEvents([]);
      setProgressHistoryLoading(false);
      setProgressHistoryError(true);
      setProgressHistoryHasMore(false);
    },
    progressHistoryLimit
  );
  return () => {
    active = false;
    unsubscribe();
  };
}, [
  id,
  progressHistoryLimit,
  progressHistoryRetryKey,
  selectedHistorySubtask,
]);

useEffect(() => {
  if (
    selectedHistorySubtask &&
    !subtasks.some((subtask) => subtask.id === selectedHistorySubtask.id)
  ) {
    setSelectedHistorySubtask(null);
    setProgressHistoryEvents([]);
  }
}, [selectedHistorySubtask, subtasks]);

const [deleteTarget, setDeleteTarget] = useState<{ id: string; title?: string } | null>(null);
const [deleting, setDeleting] = useState(false);

const [editTarget, setEditTarget] = useState<Subtask | null>(null);

type AssignmentCandidate = {
  uid: string;
  displayName: string | null;
  email: string | null;
  groupId: string;
  groupName: string | null;
};

const [assignmentTarget, setAssignmentTarget] = useState<Subtask | null>(null);
const [assignmentCandidates, setAssignmentCandidates] = useState<AssignmentCandidate[]>([]);
const [savingAssignment, setSavingAssignment] = useState(false);

const [expandedAssigneeKey, setExpandedAssigneeKey] = useState<string | null>(
  null
);

const [savingEdit, setSavingEdit] = useState(false);

const [isGoalEditOpen, setIsGoalEditOpen] = useState(false);
const [savingGoalEdit, setSavingGoalEdit] = useState(false);

const [pushingGoalCalendar, setPushingGoalCalendar] = useState(false);
const [removingGoalCalendar, setRemovingGoalCalendar] = useState(false);

const [pushingSharedCalendarSubtaskIds, setPushingSharedCalendarSubtaskIds] =
  useState<Set<string>>(new Set());

const [editGoalCalendarPushMode, setEditGoalCalendarPushMode] =
  useState<"off" | "goal_only" | "subtasks">("off");

  const [showCalendarExport, setShowCalendarExport] = useState(false);

const [editGoalReminderPreset, setEditGoalReminderPreset] =
  useState<"none" | "10m" | "30m" | "60m">("none");

  const [editGoalExportBehavior, setEditGoalExportBehavior] =
  useState<"single" | "recurring">("single");

const [editGoalTitle, setEditGoalTitle] = useState("");
const [editGoalDescription, setEditGoalDescription] = useState("");
const [editGoalMetricType, setEditGoalMetricType] = useState<Goal["metricType"]>("none");
const [editGoalMetricUnitInput, setEditGoalMetricUnitInput] = useState("");
const [editGoalMetricTargetInput, setEditGoalMetricTargetInput] = useState("");

const [showEditDatePicker, setShowEditDatePicker] = useState(false);
const [showEditTimePicker, setShowEditTimePicker] = useState(false);

const [editTitle, setEditTitle] = useState("");
const [editDescription, setEditDescription] = useState("");

const [editScheduleType, setEditScheduleType] =
  useState<SubtaskScheduleType>("recurring");
const [editFrequency, setEditFrequency] =
  useState<SubtaskFrequency>("daily");
const [editWeeklyDay, setEditWeeklyDay] = useState<number>(0);

const [editDueDate, setEditDueDate] = useState("");
const [editDueTime, setEditDueTime] = useState("");

const [editCompletionMode, setEditCompletionMode] =
  useState<SubtaskCompletionMode>("binary");
const [editTargetCountInput, setEditTargetCountInput] = useState("");

const [editContributesToMetric, setEditContributesToMetric] = useState(false);
const [editMetricValue, setEditMetricValue] = useState("");

const { width } = useWindowDimensions();
const [calendarExportHistory, setCalendarExportHistory] = useState<
  {
    id: string;
    action: string;
    summary: string;
    createdAtMs: number;
  }[]
>([]);

const isGoalCalendarExportOff = editGoalCalendarPushMode === "off";
const isNarrow = width < 380; // tweak if you want (360–420 range is common)

const latestCalendarExportDecision = useMemo(() => {
  return calendarExportHistory[0] ?? null;
}, [calendarExportHistory]);

const [editGoalAutoSync, setEditGoalAutoSync] = useState(false);

const [editNotificationsEnabled, setEditNotificationsEnabled] =
  useState(false);

const [editReminderOffsetMinutes, setEditReminderOffsetMinutes] =
  useState<0 | 10 | 30 | 60>(0);

  const [editReminderPreset, setEditReminderPreset] =
  useState<SubtaskReminderPreset>("none");

const [editReminderCustomOffsetInput, setEditReminderCustomOffsetInput] =
  useState("");

const [highlightedOverviewSubtaskId, setHighlightedOverviewSubtaskId] =
  useState<string | null>(null);

  const [assignmentOverviewFilter, setAssignmentOverviewFilter] =
  useState<"all" | "open" | "done" | "attention">("all");

  useEffect(() => {
    if (!id) return;

    const ref = doc(db, "goals", String(id));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setGoal(null);
          setLoading(false);
          return;
        }
        const data = snap.data() as Goal;

        setGoal(data);
        setLoading(false);

        // Keep input in sync with stored value
        setCurrentValue(String(data.currentMetricValue ?? ""));
      },
      (err) => {
        console.error(err);
        Alert.alert("Error", err.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!id) {
      setMilestones([]);
      return;
    }

    const unsub = subscribeGoalMilestones(
      String(id),
      setMilestones,
      (err) => {
        console.error("[GoalDetail] milestone subscription failed", err);
      }
    );

    return () => unsub();
  }, [id]);

  useEffect(() => {
  if (!id) return;

  const ref = collection(db, "goals", String(id), "subtasks");
  const q = query(ref, orderBy("createdAtMs", "desc"));

  const unsub = onSnapshot(q, (snap) => {
  const list: Subtask[] = snap.docs.map((d) => {
    const data = d.data() as Partial<Subtask>;

    return {
      id: d.id,
      goalId: typeof data.goalId === "string" ? data.goalId : String(id),
      userId: typeof data.userId === "string" ? data.userId : uid ?? "",

      assignedToUid:
  typeof data.assignedToUid === "string" ? data.assignedToUid : null,

assignedToName:
  typeof data.assignedToName === "string" ? data.assignedToName : null,

assignedToEmail:
  typeof data.assignedToEmail === "string" ? data.assignedToEmail : null,

assignedByUid:
  typeof data.assignedByUid === "string" ? data.assignedByUid : null,

assignedAtMs:
  typeof data.assignedAtMs === "number" ? data.assignedAtMs : null,

      title: typeof data.title === "string" ? data.title : "",
      description: typeof data.description === "string" ? data.description : null,

      scheduleType:
        data.scheduleType === "oneTime" ? "oneTime" : "recurring",

      frequency:
        data.frequency === "once" ||
        data.frequency === "weekly" ||
        data.frequency === "daily"
          ? data.frequency
          : "daily",

      weeklyDay:
        typeof data.weeklyDay === "number" ? data.weeklyDay : null,

      scheduledDayKey:
        typeof data.scheduledDayKey === "string" ? data.scheduledDayKey : null,

      dueAtMs:
        typeof data.dueAtMs === "number" ? data.dueAtMs : null,

        reminderPreset:
  data.reminderPreset === "at_time" ||
  data.reminderPreset === "morning_of" ||
  data.reminderPreset === "day_before" ||
  data.reminderPreset === "custom" ||
  data.reminderPreset === "none"
    ? data.reminderPreset
    : "none",

reminderAtMs:
  typeof data.reminderAtMs === "number" ? data.reminderAtMs : null,

reminderCustomOffsetMinutes:
  typeof data.reminderCustomOffsetMinutes === "number"
    ? data.reminderCustomOffsetMinutes
    : null,

notificationId:
  typeof data.notificationId === "string" ? data.notificationId : null,

      completionMode:
        data.completionMode === "count" ? "count" : "binary",

      targetCount:
        typeof data.targetCount === "number" ? data.targetCount : null,

      contributesToMetric: data.contributesToMetric === true,

      metricValue:
        typeof data.metricValue === "number" ? data.metricValue : null,

      metricUnit:
        typeof data.metricUnit === "string" ? data.metricUnit : null,

        calendarPush:
  data.calendarPush && typeof data.calendarPush === "object"
    ? {
        pushedEventId:
          typeof data.calendarPush.pushedEventId === "string"
            ? data.calendarPush.pushedEventId
            : null,
        pushedCalendarId:
          typeof data.calendarPush.pushedCalendarId === "string"
            ? data.calendarPush.pushedCalendarId
            : null,
        lastSyncedAtMs:
          typeof data.calendarPush.lastSyncedAtMs === "number"
            ? data.calendarPush.lastSyncedAtMs
            : null,
      }
    : null,
    sharedCalendarPushByUid:
  data.sharedCalendarPushByUid &&
  typeof data.sharedCalendarPushByUid === "object"
    ? (data.sharedCalendarPushByUid as Subtask["sharedCalendarPushByUid"])
    : null,
    notifications:
  data.notifications && typeof data.notifications === "object"
    ? {
        enabled: data.notifications.enabled === true,
        reminderOffsetMinutes:
          typeof data.notifications.reminderOffsetMinutes === "number"
            ? data.notifications.reminderOffsetMinutes
            : 0,
        scheduledNotificationId:
          typeof data.notifications.scheduledNotificationId === "string"
            ? data.notifications.scheduledNotificationId
            : null,
      }
    : null,

      firstCompletedAtMs:
        typeof data.firstCompletedAtMs === "number"
          ? data.firstCompletedAtMs
          : null,

      createdAtMs:
        typeof data.createdAtMs === "number" ? data.createdAtMs : Date.now(),

      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });

  setSubtasks(list);
});

  return () => unsub();
}, [id]);
useEffect(() => {
  if (!id) return;
  if (subtasks.length === 0) {
    setCompletionSnapshotsByKey({});
    setCompletionSnapshotsReady(true);
    return;
  }

  let cancelled = false;
  setCompletionSnapshotsReady(false);

  async function loadTodayCompletions() {
    const next: Record<string, DailyCompletionSnapshot> = {};

    await Promise.all(
      subtasks.map(async (s) => {
        const completionRef = doc(
          db,
          "goals",
          String(id),
          "subtasks",
          s.id,
          "completions",
          todayKey
        );

        const snap = await getDoc(completionRef);
        if (snap.exists()) {
          const data = snap.data() as {
            completionCount?: number | null;
            completedAtMs?: number | null;
          };

          next[getCompletionSnapshotMapKey(s.id, todayKey)] = {
            completionCount:
              typeof data?.completionCount === "number"
                ? data.completionCount
                : null,
            completedAtMs:
              typeof data?.completedAtMs === "number"
                ? data.completedAtMs
                : null,
          };
        }
      })
    );

    if (!cancelled) {
      setCompletionSnapshotsByKey(next);
      setCompletionSnapshotsReady(true);
    }
  }

  loadTodayCompletions().catch((error) => {
    console.error(error);
    if (!cancelled) setCompletionSnapshotsReady(true);
  });

  return () => {
    cancelled = true;
  };
}, [id, subtasks, todayKey]);




useEffect(() => {
  if (!editTarget) return;

  setEditTitle(editTarget.title ?? "");
  setEditDescription(editTarget.description ?? "");

  setEditScheduleType(editTarget.scheduleType ?? "recurring");
  setEditFrequency(editTarget.frequency ?? "daily");
  setEditWeeklyDay(editTarget.weeklyDay ?? new Date().getDay());

 if (typeof editTarget.dueAtMs === "number") {
  const d = new Date(editTarget.dueAtMs);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  setEditDueDate(`${yyyy}-${mm}-${dd}`);
  setEditDueTime(`${hh}:${min}`);
} else {
  setEditDueDate(editTarget.scheduledDayKey ?? "");
  setEditDueTime("");
}

  setEditCompletionMode(editTarget.completionMode ?? "binary");
  setEditTargetCountInput(
    editTarget.targetCount != null ? String(editTarget.targetCount) : ""
  );

  setEditContributesToMetric(editTarget.contributesToMetric === true);
  setEditMetricValue(
    editTarget.metricValue != null ? String(editTarget.metricValue) : ""
  );
  setEditNotificationsEnabled(editTarget.notifications?.enabled === true);

setEditReminderOffsetMinutes(
  editTarget.notifications?.reminderOffsetMinutes === 10 ||
  editTarget.notifications?.reminderOffsetMinutes === 30 ||
  editTarget.notifications?.reminderOffsetMinutes === 60
    ? editTarget.notifications.reminderOffsetMinutes
    : 0
);
setEditReminderPreset(editTarget.reminderPreset ?? "none");
setEditReminderCustomOffsetInput(
  typeof editTarget.reminderCustomOffsetMinutes === "number"
    ? String(editTarget.reminderCustomOffsetMinutes)
    : ""
);
}, [editTarget]);

useEffect(() => {
  if (!id) return;

  const ref = collection(db, "goals", String(id), "calendarExportHistory");
  const q = query(ref, orderBy("createdAtMs", "desc"));

  

  const unsub = onSnapshot(q, (snap) => {
    const list = snap.docs.slice(0, 3).map((d) => {
      const data = d.data();

      return {
        id: d.id,
        action: typeof data.action === "string" ? data.action : "unknown",
        summary: typeof data.summary === "string" ? data.summary : "",
        createdAtMs:
          typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
      };
    });

    setCalendarExportHistory(list);
  });

  return () => unsub();
}, [id]);

useEffect(() => {
  if (!uid) {
    setExpoPushToken(null);
    setPushNotificationsEnabled(false);
    return;
  }

  const ref = doc(db, "users", uid);

  const unsub = onSnapshot(
    ref,
    (snap) => {
      const data = snap.data() as {
        expoPushToken?: string | null;
        pushNotificationsEnabled?: boolean;
      } | undefined;

      setExpoPushToken(
        typeof data?.expoPushToken === "string" ? data.expoPushToken : null
      );

      setPushNotificationsEnabled(data?.pushNotificationsEnabled === true);
    },
    (err) => {
      console.error("[Push] user push profile subscription failed", err);
    }
  );

  return () => unsub();
}, [uid]);

useEffect(() => {
  if (!uid) {
    setMyGroups([]);
    return;
  }

  const unsub = subscribeMyGroupMemberships(
    uid,
    (next) => setMyGroups(next),
    (err) => console.log("[GoalDetail] failed loading groups", err)
  );

  return unsub;
}, [uid]);



  const canEdit = useMemo(() => {
    if (!uid || !goal) return false;
    return goal.userId === uid;
  }, [uid, goal]);

  const handleCreateMilestone = async () => {
    if (!canEdit) {
      Alert.alert("Read only", "Only the goal owner can add milestones.");
      return;
    }
    if (!id) {
      Alert.alert("Missing goal", "This goal is not available.");
      return;
    }
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in to add milestones.");
      return;
    }

    const title = milestoneTitleInput.trim();
    if (!title) {
      Alert.alert("Milestone title required", "Please enter a milestone title.");
      return;
    }

    const dueDateText = milestoneDueDateInput.trim();
    const dueAtMs = dueDateText ? parseMilestoneDateInput(dueDateText) : null;
    if (dueDateText && dueAtMs == null) {
      Alert.alert(
        "Invalid due date",
        "Use YYYY-MM-DD format, for example 2026-07-15."
      );
      return;
    }

    setSavingMilestone(true);
    try {
      await createGoalMilestone({
        goalId: String(id),
        title,
        description: milestoneDescriptionInput,
        dueAtMs,
        createdByUid: uid,
      });

      setMilestoneTitleInput("");
      setMilestoneDescriptionInput("");
      setMilestoneDueDateInput("");
      setShowAddMilestoneForm(false);
      Alert.alert("Milestone added", "Your milestone was added.");
    } catch (e: any) {
      Alert.alert("Could not add milestone", e?.message ?? "Please try again.");
    } finally {
      setSavingMilestone(false);
    }
  };

  const openEditMilestone = (milestone: GoalMilestoneDoc) => {
    if (!canEdit) {
      Alert.alert("Read only", "Only the goal owner can edit milestones.");
      return;
    }

    setEditingMilestone(milestone);
    setEditMilestoneTitleInput(milestone.title);
    setEditMilestoneDescriptionInput(milestone.description ?? "");
    setEditMilestoneDueDateInput(
      typeof milestone.dueAtMs === "number"
        ? formatDateToInput(new Date(milestone.dueAtMs))
        : ""
    );
  };

  const saveEditedMilestone = async () => {
    if (!canEdit) {
      Alert.alert("Read only", "Only the goal owner can edit milestones.");
      return;
    }
    if (!id || !editingMilestone) {
      Alert.alert("Missing milestone", "This milestone is not available.");
      return;
    }

    const title = editMilestoneTitleInput.trim();
    if (!title) {
      Alert.alert("Milestone title required", "Please enter a milestone title.");
      return;
    }

    const dueDateText = editMilestoneDueDateInput.trim();
    const dueAtMs = dueDateText ? parseMilestoneDateInput(dueDateText) : null;
    if (dueDateText && dueAtMs == null) {
      Alert.alert(
        "Invalid due date",
        "Use YYYY-MM-DD format, for example 2026-07-15."
      );
      return;
    }

    setSavingMilestone(true);
    try {
      await updateGoalMilestone({
        goalId: String(id),
        milestoneId: editingMilestone.id,
        title,
        description: editMilestoneDescriptionInput,
        dueAtMs,
      });

      setEditingMilestone(null);
      setEditMilestoneTitleInput("");
      setEditMilestoneDescriptionInput("");
      setEditMilestoneDueDateInput("");
      Alert.alert("Milestone updated", "Your milestone was updated.");
    } catch (e: any) {
      Alert.alert("Could not update milestone", e?.message ?? "Please try again.");
    } finally {
      setSavingMilestone(false);
    }
  };

  const handleCompleteMilestone = async (milestone: GoalMilestoneDoc) => {
    if (!canEdit || milestone.status === "completed") return;
    if (!id) {
      Alert.alert("Missing goal", "This goal is not available.");
      return;
    }

    setSavingMilestone(true);
    try {
      await completeGoalMilestone({
        goalId: String(id),
        milestoneId: milestone.id,
      });
      void hapticSuccess();
      Alert.alert("Milestone completed", "Nice work. The milestone is complete.");
    } catch (e: any) {
      void hapticError();
      Alert.alert("Could not complete milestone", e?.message ?? "Please try again.");
    } finally {
      setSavingMilestone(false);
    }
  };

  const handleArchiveMilestone = (milestone: GoalMilestoneDoc) => {
    if (!canEdit) return;
    if (!id) {
      Alert.alert("Missing goal", "This goal is not available.");
      return;
    }

    Alert.alert(
      "Archive milestone?",
      `Archive "${milestone.title}"? You can restore it later from data tools, but it will disappear from this goal.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            setSavingMilestone(true);
            try {
              await archiveGoalMilestone({
                goalId: String(id),
                milestoneId: milestone.id,
              });
            } catch (e: any) {
              Alert.alert(
                "Could not archive milestone",
                e?.message ?? "Please try again."
              );
            } finally {
              setSavingMilestone(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
  if (!canEdit || visibleSharedGroupIds.length === 0) {
    setAssignmentCandidates([]);
    return;
  }

  const unsubs = visibleSharedGroupIds.map((groupId) => {
    const membership = myGroups.find((item) => item.groupId === groupId);
    const membersRef = collection(db, "groups", groupId, "members");
    const membersQuery = query(membersRef, where("status", "==", "active"));

    return onSnapshot(
      membersQuery,
      (snap) => {
        setAssignmentCandidates((prev) => {
          const withoutThisGroup = prev.filter((item) => item.groupId !== groupId);

          const nextForGroup: AssignmentCandidate[] = snap.docs.map((memberDoc) => {
            const data = memberDoc.data() as Partial<GroupMemberDoc>;

            return {
              uid: memberDoc.id,
              displayName:
                typeof data.displayName === "string" ? data.displayName : null,
              email: typeof data.email === "string" ? data.email : null,
              groupId,
              groupName: membership?.groupName ?? null,
            };
          });

          return [...withoutThisGroup, ...nextForGroup];
        });
      },
      (err) => {
        console.log("[GoalDetail] failed loading assignment candidates", err);
      }
    );
  });

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [canEdit, visibleSharedGroupIds, myGroups]);

const assignedSubtaskOverviewItems = useMemo(() => {
  return subtasks
    .filter((s) => !!s.assignedToUid)
    .map((s) => {
      const completionSnapshot = getTodayCompletionSnapshot(s.id);
      const completionCount = completionSnapshot?.completionCount ?? 0;

      const isCompletedToday =
        s.completionMode === "count"
          ? typeof s.targetCount === "number" &&
            completionCount >= s.targetCount
          : completionSnapshot != null;

      return {
        subtask: s,
        assigneeLabel: formatAssigneeLabel(s),
        completionCount,
        isCompletedToday,
        completedAtMs: completionSnapshot?.completedAtMs ?? null,
      };
    });
}, [subtasks, completionSnapshotsByKey]);

const assignedOverviewDoneItems = useMemo(
  () => assignedSubtaskOverviewItems.filter((item) => item.isCompletedToday),
  [assignedSubtaskOverviewItems]
);

const assignedOverviewByAssignee = useMemo(() => {
  const map = new Map<
    string,
    {
      assigneeUid: string;
      assigneeLabel: string;
      assignedCount: number;
      openCount: number;
      doneCount: number;
      items: typeof assignedSubtaskOverviewItems;
    }
  >();

  assignedSubtaskOverviewItems.forEach((item) => {
    const uidKey = item.subtask.assignedToUid ?? "unknown";

    const existing =
      map.get(uidKey) ??
      {
        assigneeUid: uidKey,
        assigneeLabel: item.assigneeLabel,
        assignedCount: 0,
        openCount: 0,
        doneCount: 0,
        items: [],
      };

    existing.assignedCount += 1;

    if (item.isCompletedToday) {
      existing.doneCount += 1;
    } else {
      existing.openCount += 1;
    }

    existing.items.push(item);

    map.set(uidKey, existing);
  });

  return Array.from(map.values()).sort((a, b) =>
    a.assigneeLabel.localeCompare(b.assigneeLabel)
  );
}, [assignedSubtaskOverviewItems]);

const assignedAttentionItems = useMemo(() => {
  const now = Date.now();

  return assignedSubtaskOverviewItems.filter((item) => {
    const s = item.subtask;

    if (item.isCompletedToday) {
      return false;
    }

    const overdue =
      typeof s.dueAtMs === "number" &&
      s.dueAtMs < now;

    const unassigned =
      !s.assignedToUid;

    const staleAssignment =
      typeof s.assignedAtMs === "number" &&
      now - s.assignedAtMs >
        1000 * 60 * 60 * 24 * 7;

    return overdue || unassigned || staleAssignment;
  });
}, [assignedSubtaskOverviewItems]);

const assignedOverviewOpenItems = useMemo(
  () => assignedSubtaskOverviewItems.filter((item) => !item.isCompletedToday),
  [assignedSubtaskOverviewItems]
);

  const isSharedGoalViewer = useMemo(() => {
  if (!uid || !goal) return false;

  return goal.userId !== uid && goal.visibility === "group_shared";
}, [uid, goal]);

const canEditSubtasks = canEdit;

const canCompleteSubtask = (subtask: Subtask) => {
  if (canEdit) return true;
  if (!uid) return false;

  return (
    goal?.visibility === "group_shared" &&
    subtask.assignedToUid === uid
  );
};

  const isMetricEnabled = goal?.metricType != null && goal.metricType !== "none";

function getTodayCompletionSnapshot(subtaskId: string): DailyCompletionSnapshot | null {
  return completionSnapshotsByKey[getCompletionSnapshotMapKey(subtaskId, todayKey)] ?? null;
}

function isCompletedTodayBySubtask(subtaskId: string): boolean {
  const snap = getTodayCompletionSnapshot(subtaskId);
  if (!snap) return false;

  const subtask = subtasks.find((s) => s.id === subtaskId);
  if (!subtask) return false;

  if (subtask.completionMode === "count") {
    return (
      typeof subtask.targetCount === "number" &&
      (snap.completionCount ?? 0) >= subtask.targetCount
    );
  }

  return true;
}

  const metricLine = useMemo(() => {
    if (!goal) return "";
    if (goal.metricTargetValue == null) return "No metric target set";
    const unit = goal.metricUnit ? ` ${goal.metricUnit}` : "";
    const cur = goal.currentMetricValue ?? 0;
    return `${cur}/${goal.metricTargetValue}${unit}`;
  }, [goal]);
const { activeSubtasks, completedSubtasks } = (() => {
  const active: Subtask[] = [];
  const completed: Subtask[] = [];

  subtasks.forEach((subtask) => {
    if (isCompletedTodayBySubtask(subtask.id)) {
      completed.push(subtask);
    } else {
      active.push(subtask);
    }
  });

  return {
    activeSubtasks: active,
    completedSubtasks: completed,
  };
})();

const todaysVisibleSubtasks = useMemo(
  () => activeSubtasks.filter((s) => isDueToday(s, tz, todayKey)),
  [activeSubtasks, tz, todayKey]
);

const todaysInProgressSubtasks = useMemo(
  () =>
    todaysVisibleSubtasks.filter((s) => {
      if (s.completionMode !== "count") return false;
      const snap = getTodayCompletionSnapshot(s.id);
      return (snap?.completionCount ?? 0) > 0;
    }),
  [todaysVisibleSubtasks, completionSnapshotsByKey]
);

const todaysNotStartedSubtasks = useMemo(
  () =>
    todaysVisibleSubtasks.filter((s) => {
      if (s.completionMode === "count") {
        const snap = getTodayCompletionSnapshot(s.id);
        return (snap?.completionCount ?? 0) === 0;
      }
      return true;
    }),
  [todaysVisibleSubtasks, completionSnapshotsByKey]
);
const otherSubtasks = useMemo(
  () => activeSubtasks.filter((s) => !isDueToday(s, tz, todayKey)),
  [activeSubtasks, tz, todayKey]
);

const assignedToMeSubtasks = useMemo(() => {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return [];

  return subtasks.filter((s) => s.assignedToUid === currentUid);
}, [subtasks]);

function isSubtaskEligibleForCalendarPush(subtask: Subtask): boolean {
  if (typeof subtask.dueAtMs === "number") return true;

  if (
    typeof subtask.scheduledDayKey === "string" &&
    subtask.scheduledDayKey.trim()
  ) {
    return true;
  }

  return false;
}

function canShowAssignedSharedCalendarPushLabel(subtask: Subtask): boolean {
  if (!uid || !goal) return false;

  return (
    goal.visibility === "group_shared" &&
    goal.userId !== uid &&
    subtask.assignedToUid === uid
  );
}

function getAssignedSharedCalendarPushLabel(subtask: Subtask): string {
  if (!isSubtaskEligibleForCalendarPush(subtask)) {
    return "Add date/time to enable Google Calendar";
  }

  if (isCompletedTodayBySubtask(subtask.id)) {
    return "Completed tasks will not be exported";
  }

  return "Add to my Google Calendar";
}

const getAssignedSharedCalendarPushHelper = (
  subtask: Subtask
) => {
  const state = getMySharedCalendarPushState(subtask);
  const disabledReason =
    getAssignedSharedCalendarDisabledReason(subtask);

  if (disabledReason) {
    return disabledReason;
  }

  if (state?.status === "linked") {
    return "Linked to your Google Calendar. Updates only affect your calendar copy.";
  }

  if (state?.status === "removed") {
    return "Removed from your Google Calendar. You can add it again anytime.";
  }

  if (state?.status === "failed") {
    return "Calendar sync failed. Try again when your calendar connection is ready.";
  }

  return "Ready to add to your Google Calendar.";
};

function getMySharedCalendarPushState(subtask: Subtask) {
  if (!uid) return null;

  return subtask.sharedCalendarPushByUid?.[uid] ?? null;
}

function canUpdateAssignedSharedCalendarExport(subtask: Subtask): boolean {
  const state = getMySharedCalendarPushState(subtask);

  if (state?.status !== "linked") return true;
  if (!isSubtaskEligibleForCalendarPush(subtask)) return false;
  if (isCompletedTodayBySubtask(subtask.id)) return false;

  return true;
}

function getAssignedSharedCalendarDisabledReason(subtask: Subtask): string | null {
  const state = getMySharedCalendarPushState(subtask);

  if (!isSubtaskEligibleForCalendarPush(subtask)) {
    return state?.status === "linked"
      ? "This task is linked, but it needs a date/time before it can be updated."
      : "Add a date/time before exporting this assigned task.";
  }

  if (isCompletedTodayBySubtask(subtask.id)) {
    return state?.status === "linked"
      ? "This task is already completed today. Remove it from your calendar if you no longer need it."
      : "Completed tasks are not exported right now.";
  }

  return null;
}

const eligibleSubtasksForGoalPush = useMemo(
  () =>
    subtasks
      .filter(isSubtaskEligibleForCalendarPush)
      .filter((s) => !isCompletedTodayBySubtask(s.id))
      .sort((a, b) => {
        const aMs =
          typeof a.dueAtMs === "number"
            ? a.dueAtMs
            : Date.parse(`${a.scheduledDayKey}T00:00:00`);

        const bMs =
          typeof b.dueAtMs === "number"
            ? b.dueAtMs
            : Date.parse(`${b.scheduledDayKey}T00:00:00`);

        return aMs - bMs;
      }),
  [subtasks, completionSnapshotsByKey]
);

const eligibleSubtasksForSubtaskPush = useMemo(
  () => subtasks.filter(isSubtaskEligibleForCalendarPush),
  [subtasks]
);

const activeGoalViewers = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  return goalPresenceItems.filter(
    (item) =>
      item.status === "online" &&
      item.activeRoute === "goal" &&
      item.activeGoalId === String(id) &&
      item.uid !== currentUid
  );
}, [goalPresenceItems, id]);

const visibleAssignmentOverviewItems = useMemo(() => {
  if (assignmentOverviewFilter === "open") return assignedOverviewOpenItems;
  if (assignmentOverviewFilter === "done") return assignedOverviewDoneItems;
  if (assignmentOverviewFilter === "attention") return assignedAttentionItems;

  return assignedSubtaskOverviewItems;
}, [
  assignmentOverviewFilter,
  assignedSubtaskOverviewItems,
  assignedOverviewOpenItems,
  assignedOverviewDoneItems,
  assignedAttentionItems,
]);

const showAssignmentByMember =
  assignmentOverviewFilter === "all";

const showAssignmentAttention =
  assignmentOverviewFilter === "all" ||
  assignmentOverviewFilter === "attention";

const showAssignmentOpen =
  assignmentOverviewFilter === "all" ||
  assignmentOverviewFilter === "open";

const showAssignmentDone =
  assignmentOverviewFilter === "all" ||
  assignmentOverviewFilter === "done";

const maybeScheduleSubtaskNotification = async (params: {
  subtaskId: string;
  title: string;
  reminderAtMs: number | null;
  notifications: {
    enabled: boolean;
  };
}): Promise<string | null> => {
  if (!id) return null;
  if (!params.notifications.enabled) return null;
  if (typeof params.reminderAtMs !== "number") return null;

  if (params.reminderAtMs <= Date.now()) {
    console.log("[Notifications] skipped past reminder", {
      subtaskId: params.subtaskId,
      reminderAtMs: params.reminderAtMs,
    });

    return null;
  }

  const scheduledNotificationId = await scheduleSubtaskNotification({
    goalId: String(id),
    subtaskId: params.subtaskId,
    title: params.title,
    dueAtMs: params.reminderAtMs,
  });

  return scheduledNotificationId;
};

const maybeUpsertPushReminderQueue = async (params: {
  subtaskId: string;
  title: string;
  reminderAtMs: number | null;
}) => {
  if (!uid || !id) return null;
  if (!pushNotificationsEnabled) return null;

  return upsertPushReminderQueueDoc({
    uid,
    goalId: String(id),
    subtaskId: params.subtaskId,
    title: params.title,
    reminderAtMs: params.reminderAtMs,
    expoPushToken,
  });
};


const createSubtask = async () => {
  if (!canEditSubtasks) {
    Alert.alert(
      "Read only",
      "Only the goal owner can create subtasks."
    );
    return;
  }
  if (!id || !goal) return;

  if (!auth.currentUser) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  const trimmedDate = subtaskDueDate.trim();
  const trimmedTime = subtaskDueTime.trim();

  const dueAtMs = trimmedDate
    ? combineDateAndOptionalTimeToMs(trimmedDate, trimmedTime)
    : null;

  const scheduledDayKey = trimmedDate ? parseYyyyMmDdToDayKey(trimmedDate) : null;

  if (trimmedDate && !scheduledDayKey) {
    Alert.alert("Invalid date", "Use YYYY-MM-DD (example: 2026-02-21).");
    return;
  }

  if (trimmedDate && dueAtMs == null) {
    Alert.alert(
      "Invalid date or time",
      "Use date as YYYY-MM-DD and time as HH:mm (example: 09:30 or 14:05)."
    );
    return;
  }

  if (!trimmedDate && trimmedTime) {
    Alert.alert("Missing date", "Please enter a date if you want to set a time.");
    return;
  }

  if (subtaskContributesToMetric) {
  const rawMetric = subtaskMetricValue.trim();
  const parsedMetric = rawMetric ? Number(rawMetric) : NaN;

  if (!rawMetric || !Number.isFinite(parsedMetric) || parsedMetric <= 0) {
    Alert.alert(
      "Invalid metric value",
      "Please enter a metric contribution greater than 0."
    );
    return;
  }
}

  const formInput: SubtaskFormInput = {
    title: newSubtaskTitle,
    description: newSubtaskDescription,

    scheduleType: subtaskScheduleType,
    frequency: subtaskFrequency,
    weeklyDay: subtaskWeeklyDay,
    scheduledDayKey,
    dueAtMs,

    completionMode: subtaskCompletionMode,
    targetCountInput: subtaskTargetCountInput,

    contributesToMetric: subtaskContributesToMetric,
    metricValueInput: subtaskMetricValue,
  };

 let normalized;
try {
  normalized = normalizeSubtaskInput(formInput, {
    id: String(id),
    userId: goal.userId,
    metricType: goal.metricType,
    metricUnit: goal.metricUnit,
  });
} catch (e: any) {
  Alert.alert("Invalid subtask", e?.message ?? "Please review your subtask details.");
  return;
}

const customReminderOffsetMinutes =
  subtaskReminderPreset === "custom"
    ? parseCustomReminderOffsetMinutes(subtaskReminderCustomOffsetInput)
    : null;

if (subtaskReminderPreset === "custom" && customReminderOffsetMinutes == null) {
  Alert.alert(
    "Invalid reminder",
    "Enter a custom reminder offset greater than 0 minutes."
  );
  return;
}

const reminderPatch = buildReminderPatch({
  dueAtMs: normalized.dueAtMs,
  preset: subtaskReminderPreset,
  customOffsetMinutes: customReminderOffsetMinutes,
});

try {
  setCreatingSubtask(true);

    const createdRef = await addDoc(collection(db, "goals", String(id), "subtasks"), {
  ...normalized,
  ...reminderPatch,
  notificationId: null,
  notifications: {
    enabled: subtaskNotificationsEnabled,
    reminderOffsetMinutes: subtaskReminderOffsetMinutes,
    scheduledNotificationId: null,
  },
  firstCompletedAtMs: null,
  createdAtMs: Date.now(),
  createdAt: serverTimestamp(),
});

const scheduledNotificationId = await maybeScheduleSubtaskNotification({
  subtaskId: createdRef.id,
  title: normalized.title,
  reminderAtMs: reminderPatch.reminderAtMs,
  notifications: {
    enabled: subtaskNotificationsEnabled,
  },
});

if (scheduledNotificationId) {
  await updateDoc(createdRef, {
    notificationId: scheduledNotificationId,
    "notifications.scheduledNotificationId": scheduledNotificationId,
    updatedAt: serverTimestamp(),
  });
}

await maybeUpsertPushReminderQueue({
  subtaskId: createdRef.id,
  title: normalized.title,
  reminderAtMs: reminderPatch.reminderAtMs,
});

    setNewSubtaskTitle("");
    setNewSubtaskDescription("");
    setSubtaskMetricValue("");
    setSubtaskDueDate("");
    setSubtaskDueTime("");
    setSubtaskScheduleType("recurring");
    setSubtaskFrequency("daily");
    setSubtaskWeeklyDay(new Date().getDay());
    setSubtaskCompletionMode("binary");
    setSubtaskTargetCountInput("");
    setSubtaskContributesToMetric(false);

    setSubtaskNotificationsEnabled(false);
setSubtaskReminderOffsetMinutes(0);
setSubtaskReminderPreset("none");
setSubtaskReminderCustomOffsetInput("");

    if (goal.calendarPush?.autoSync && (goal.calendarPush?.mode ?? "off") === "subtasks") {
  await runGoalAutoSyncAfterSubtaskChange();
  Alert.alert("Added and synced", "Subtask added and Calendar Export synced.");
} else {
  let notificationMessage = "Reminder is off.";

if (subtaskNotificationsEnabled) {
  if (typeof reminderPatch.reminderAtMs !== "number") {
    notificationMessage = "Reminder not scheduled — choose a reminder and task time.";
  } else if (!scheduledNotificationId) {
    notificationMessage = "Reminder not scheduled — reminder time has already passed.";
  } else {
    notificationMessage = "Reminder scheduled.";
  }
}

Alert.alert(
  "Added",
  `Subtask created. ${notificationMessage}`
);
}
  } catch (e: any) {
    console.error(e);
    Alert.alert("Subtask failed", e?.message ?? "Unknown error");
  } finally {
    setCreatingSubtask(false);
  }
};

function toUserFriendlyErrorMessage(e: any): string {
  const code = String(e?.code ?? "").toLowerCase();
  const msg = String(e?.message ?? e ?? "");

  // once-task already completed ever
  if (
    msg.includes("already completed") ||
    msg.includes("one-time subtask") ||
    (msg.includes("once") && msg.includes("already"))
  ) {
    return "That one-time subtask was already completed earlier. (You can only undo it the same day you completed it.)";
  }

  if (
    code.includes("permission-denied") ||
    msg === "Not allowed" ||
    msg.toLowerCase().includes("permission")
  ) {
    return "You no longer have permission to update this subtask.";
  }
  if (
    code.includes("unavailable") ||
    code.includes("network") ||
    msg.toLowerCase().includes("network")
  ) {
    return "Progress could not be saved. Check your connection and try again.";
  }
  if (code.includes("cancelled") || code.includes("canceled")) {
    return "Your upload was cancelled. Progress was not saved.";
  }
  return "Progress could not be saved. Please try again.";
}

const handleDatePicked = (_: any, selected?: Date) => {
  setShowDatePicker(false);
  if (!selected) return;

  setSubtaskDueDate(formatDateToInput(selected));
};

const handleTimePicked = (_: any, selected?: Date) => {
  setShowTimePicker(false);
  if (!selected) return;

  setSubtaskDueTime(formatTimeToInput(selected));
};

const handleEditDatePicked = (_: any, selected?: Date) => {
  setShowEditDatePicker(false);
  if (!selected) return;

  setEditDueDate(formatDateToInput(selected));
};

const handleEditTimePicked = (_: any, selected?: Date) => {
  setShowEditTimePicker(false);
  if (!selected) return;

  setEditDueTime(formatTimeToInput(selected));
};

const pickProgressImages = async () => {
  if (savingProgressUpdate) return;
  const remaining =
    MAX_MEDIA_ATTACHMENTS -
    pendingProgressImages.length -
    (pendingProgressVideoLink ? 1 : 0);
  if (remaining <= 0) {
    Alert.alert(
      "Attachment limit reached",
      `You can attach up to ${MAX_MEDIA_ATTACHMENTS} items.`
    );
    return;
  }

  try {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo access needed",
        "Allow photo-library access to attach images to this progress update."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
      quality: 1,
    });
    if (result.canceled) return;

    const existingKeys = new Set(
      pendingProgressImages.map((image) => image.sourceKey)
    );
    const additions: PendingProgressImage[] = [];
    let rejectionMessage: string | null = null;

    for (const asset of result.assets) {
      if (additions.length >= remaining) break;
      const sourceKey = asset.assetId?.trim() || asset.uri;
      if (existingKeys.has(sourceKey)) continue;
      existingKeys.add(sourceKey);

      const mimeType = getPickerImageMimeType({
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        uri: asset.uri,
      });
      if (mimeType === "image/heic" || mimeType === "image/heif") {
        rejectionMessage =
          "HEIC and HEIF images are not supported yet. Choose a JPEG, PNG, or WebP image.";
        continue;
      }
      if (!mimeType) {
        rejectionMessage = "This image format is not supported.";
        continue;
      }

      const candidate = normalizeLocalMediaCandidate({
        localUri: asset.uri,
        type: mimeType === "image/gif" ? "gif" : "image",
        mimeType,
        fileName: asset.fileName,
        sizeBytes: asset.fileSize,
        width: asset.width > 0 ? asset.width : null,
        height: asset.height > 0 ? asset.height : null,
      });
      if (!candidate) {
        rejectionMessage = "This image could not be prepared.";
        continue;
      }

      try {
        validateLocalMediaCandidate(candidate);
      } catch (error) {
        rejectionMessage =
          error instanceof MediaAttachmentError &&
          error.code === "file_too_large"
            ? mimeType === "image/gif"
              ? "This GIF is larger than 15 MB."
              : "This image is larger than 10 MB."
            : "This image format is not supported.";
        continue;
      }

      additions.push({
        id: createMediaAttachmentId(),
        sourceKey,
        previewUri: asset.uri,
        candidate,
        status: "pending",
        progress: 0,
      });
    }

    if (additions.length > 0) {
      setPendingProgressImages((previous) => [
        ...previous,
        ...additions,
      ].slice(0, MAX_MEDIA_ATTACHMENTS));
    }
    if (rejectionMessage) {
      Alert.alert("Some images were not added", rejectionMessage);
    }
  } catch (error) {
    console.error("[GoalDetail] image picker failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    Alert.alert(
      "Photos unavailable",
      "Your photo library could not be opened. Please try again."
    );
  }
};

const pickProgressVideo = async () => {
  if (savingProgressUpdate) return;
  const existingVideo = pendingProgressImages.some(
    (item) => item.candidate.type === "video"
  );
  if (existingVideo) {
    Alert.alert("Video already attached", "Remove it before choosing another.");
    return;
  }
  if (
    pendingProgressImages.length + (pendingProgressVideoLink ? 1 : 0) >=
    MAX_MEDIA_ATTACHMENTS
  ) {
    Alert.alert(
      "Attachment limit reached",
      `You can attach up to ${MAX_MEDIA_ATTACHMENTS} items.`
    );
    return;
  }

  try {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Media access needed",
        "Allow photo-library access to attach a video to this progress update."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const sourceKey = asset.assetId?.trim() || asset.uri;
    if (pendingProgressImages.some((item) => item.sourceKey === sourceKey)) {
      Alert.alert("Already selected", "This video is already attached.");
      return;
    }
    const mimeType = asset.mimeType?.trim().toLowerCase();
    if (mimeType !== "video/mp4") {
      Alert.alert(
        "Unsupported video",
        "Choose an MP4 video. MOV and QuickTime videos are not supported."
      );
      return;
    }
    const candidate = normalizeLocalMediaCandidate({
      localUri: asset.uri,
      type: "video",
      mimeType,
      fileName: asset.fileName,
      sizeBytes: asset.fileSize,
      width: asset.width > 0 ? asset.width : null,
      height: asset.height > 0 ? asset.height : null,
      durationMs: asset.duration,
    });
    if (!candidate) {
      Alert.alert("Video unavailable", "This video could not be prepared.");
      return;
    }
    try {
      validateLocalMediaCandidate(candidate);
    } catch (error) {
      const message =
        error instanceof MediaAttachmentError &&
        error.code === "file_too_large"
          ? "Videos must be smaller than 50 MB."
          : error instanceof MediaAttachmentError &&
            error.code === "video_too_long"
          ? "Videos must be 30 seconds or shorter."
          : "The video size and duration must be available. Choose another MP4.";
      Alert.alert("Video not added", message);
      return;
    }
    setPendingProgressImages((previous) => [
      ...previous,
      {
        id: createMediaAttachmentId(),
        sourceKey,
        previewUri: asset.uri,
        candidate,
        status: "pending",
        progress: 0,
      },
    ]);
  } catch (error) {
    console.error("[GoalDetail] video picker failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    Alert.alert(
      "Videos unavailable",
      "Your media library could not be opened. Please try again."
    );
  }
};

const removePendingProgressImage = (attachmentId: string) => {
  if (savingProgressUpdate) return;
  setPendingProgressImages((previous) =>
    previous.filter((image) => image.id !== attachmentId)
  );
};

const cancelProgressMediaUpload = () => {
  activeProgressMediaBatchRef.current?.cancel();
};

const addProgressVideoLink = () => {
  setProgressVideoLinkError(null);
  if (!uid) {
    setProgressVideoLinkError("Sign in before adding a video link.");
    return;
  }
  if (pendingProgressVideoLink) {
    setProgressVideoLinkError("A video link is already attached.");
    return;
  }
  if (pendingProgressImages.length >= MAX_MEDIA_ATTACHMENTS) {
    setProgressVideoLinkError(
      `You can attach up to ${MAX_MEDIA_ATTACHMENTS} items.`
    );
    return;
  }

  const normalized = normalizeVideoLink(progressVideoLinkInput);
  if (!normalized) {
    setProgressVideoLinkError(
      "Enter a valid YouTube, youtu.be, or YouTube Shorts link."
    );
    return;
  }

  try {
    setPendingProgressVideoLink(
      createVideoLinkAttachment({
        rawUrl: normalized.externalUrl,
        createdByUid: uid,
      })
    );
    setProgressVideoLinkInput("");
    setShowProgressVideoLinkInput(false);
  } catch {
    setProgressVideoLinkError("Enter a valid YouTube video link.");
  }
};

const removeProgressVideoLink = () => {
  if (savingProgressUpdate) return;
  setPendingProgressVideoLink(null);
  setProgressVideoLinkError(null);
};

const openProgressUpdate = (subtask: Subtask) => {
  if (!completionSnapshotsReady) {
    Alert.alert("Loading progress", "Please wait a moment and try again.");
    return;
  }

  if (!canCompleteSubtask(subtask)) {
    Alert.alert("Read only", "You can only progress subtasks assigned to you.");
    return;
  }

  const current = getTodayCompletionSnapshot(subtask.id)?.completionCount ?? 0;
  if (
    subtask.completionMode === "count" &&
    typeof subtask.targetCount === "number" &&
    current >= subtask.targetCount
  ) {
    Alert.alert("Target reached", "This subtask is already at its target.");
    return;
  }

  setProgressTarget(subtask);
  progressSaveAttemptIdRef.current += 1;
  setProgressAmountInput("1");
  setProgressNoteInput("");
  setPendingProgressImages([]);
  setPendingProgressVideoLink(null);
  setProgressVideoLinkInput("");
  setShowProgressVideoLinkInput(false);
  setProgressVideoLinkError(null);
};

const closeProgressUpdate = () => {
  if (savingProgressUpdate) {
    activeProgressMediaBatchRef.current?.cancel();
    return;
  }
  progressSaveAttemptIdRef.current += 1;
  activeProgressMediaBatchRef.current?.cancel();
  setProgressTarget(null);
  setProgressAmountInput("1");
  setProgressNoteInput("");
  setPendingProgressImages([]);
  setPendingProgressVideoLink(null);
  setProgressVideoLinkInput("");
  setShowProgressVideoLinkInput(false);
  setProgressVideoLinkError(null);
};

const saveProgressUpdate = async () => {
  if (savingProgressUpdate || progressSaveLockRef.current) return;
  const subtaskId = progressTarget?.id;
  if (!subtaskId) return;
  if (!id) return;
  if (!uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  const key = `${subtaskId}:${todayKey}`;
  if (pendingIds.has(key)) return;

 const subtask = subtasks.find((s) => s.id === subtaskId);

if (!subtask) {
  Alert.alert("Not found", "This subtask is no longer available.");
  return;
}

if (!canCompleteSubtask(subtask)) {
  Alert.alert(
    "Read only",
    "You can only complete subtasks assigned to you."
  );
  return;
}

const isNowCompleting = !isCompletedTodayBySubtask(subtaskId);
const requestedAmount =
  subtask.completionMode === "count" ? Number(progressAmountInput.trim()) : 1;

if (
  subtask.completionMode === "count" &&
  (!Number.isFinite(requestedAmount) ||
    requestedAmount <= 0 ||
    !Number.isInteger(requestedAmount))
) {
  Alert.alert("Invalid amount", "Enter a positive whole-number progress amount.");
  return;
}

let normalizedProgressNote: string | null;
try {
  normalizedProgressNote = normalizeProgressEventComment(progressNoteInput);
} catch {
  Alert.alert(
    "Note is too long",
    `Progress notes can be up to ${MAX_PROGRESS_COMMENT_LENGTH} characters.`
  );
  return;
}

const saveAttemptId = ++progressSaveAttemptIdRef.current;
setPendingIds((prev) => new Set(prev).add(key));
setSavingProgressUpdate(true);
progressSaveLockRef.current = true;
let progressCommitted = false;
let uploadedImagesForAttempt: MediaAttachmentDoc[] = [];
let reservedProgressEventId: string | undefined;
let progressUploadSessionId: string | null = null;

  try {
    reservedProgressEventId =
      pendingProgressImages.length > 0 || pendingProgressVideoLink
        ? createSubtaskProgressEventId(String(id), subtaskId)
        : undefined;

    if (reservedProgressEventId && pendingProgressImages.length > 0) {
      const progressContext = {
        type: "progress" as const,
        goalId: String(id),
        subtaskId,
        progressEventId: reservedProgressEventId,
      };
      const session = await createMediaUploadSession({
        uploaderUid: uid,
        context: progressContext,
      });
      progressUploadSessionId = session.id;
      setPendingProgressImages((previous) =>
        previous.map((image) => ({
          ...image,
          status: "pending",
          progress: 0,
          errorCode: undefined,
        }))
      );

      const batch = uploadMediaAttachmentBatch({
        items: pendingProgressImages.map((image) => ({
          attachmentId: image.id,
          candidate: image.candidate,
        })),
        uploaderUid: uid,
        goalId: String(id),
        subtaskId,
        progressEventId: reservedProgressEventId,
        uploadSessionId: session.id,
        onItemProgress: (attachmentId, progress) => {
          if (
            !goalDetailMountedRef.current ||
            saveAttemptId !== progressSaveAttemptIdRef.current
          ) return;
          setPendingProgressImages((previous) =>
            previous.map((image) =>
              image.id === attachmentId
                ? { ...image, progress }
                : image
            )
          );
        },
        onItemStatus: (attachmentId, status, errorCode) => {
          if (
            !goalDetailMountedRef.current ||
            saveAttemptId !== progressSaveAttemptIdRef.current
          ) return;
          setPendingProgressImages((previous) =>
            previous.map((image) =>
              image.id === attachmentId
                ? { ...image, status, errorCode }
                : image
            )
          );
        },
      });
      activeProgressMediaBatchRef.current = batch;

      try {
        const batchResult = await batch.promise;
        uploadedImagesForAttempt = batchResult.attachments;
        uploadedUnsubmittedImagesRef.current = batchResult.attachments;
      } catch (error) {
        await cancelMediaUploadSession(session.id, uid).catch(() => undefined);
        progressUploadSessionId = null;
        const batchError =
          error instanceof MediaUploadBatchError ? error : null;
        if (batchError?.cleanupResult.failedPaths.length) {
          console.error("[GoalDetail] progress media cleanup failed", {
            failedPaths: batchError.cleanupResult.failedPaths,
          });
        }
        console.error("[GoalDetail] progress media upload failed", {
          code:
            error instanceof MediaAttachmentError
              ? error.code
              : "upload_failed",
        });
        if (
          goalDetailMountedRef.current &&
          saveAttemptId === progressSaveAttemptIdRef.current
        ) {
          setPendingProgressImages((previous) =>
            previous.map((image) => ({
              ...image,
              status:
                image.id === batchError?.attachmentId &&
                batchError.code !== "cancelled"
                  ? "failed"
                  : "pending",
              progress: 0,
              errorCode:
                image.id === batchError?.attachmentId
                  ? batchError.code
                  : undefined,
            }))
          );
          Alert.alert(
            batchError?.code === "cancelled"
              ? "Upload cancelled"
              : "Attachments could not be uploaded",
            batchError?.code === "cancelled"
              ? "Your progress has not been saved."
              : "One or more attachments could not be uploaded. Your progress has not been saved."
          );
        }
        return;
      } finally {
        if (activeProgressMediaBatchRef.current === batch) {
          activeProgressMediaBatchRef.current = null;
        }
      }
    }

console.log("[Notifications] next recurring due candidate", {
  subtaskId,
  nextDueAtMs: subtask
    ? getNextNotificationDueAtMsForSubtask({ subtask })
    : null,
});

    progressTransactionStartedRef.current = true;
    const result = await recordSubtaskProgressTx({
      goalId: String(id),
      subtaskId,
      dayKey: todayKey,
      actorUid: uid,
      actorName: auth.currentUser?.displayName ?? null,
      actorEmail: auth.currentUser?.email ?? null,
      action:
        subtask.completionMode === "count"
          ? "increment"
          : isNowCompleting
          ? "complete"
          : "undo",
      delta: subtask.completionMode === "count" ? requestedAmount : null,
      comment: normalizedProgressNote,
      progressEventId: reservedProgressEventId,
      attachments: [
        ...uploadedImagesForAttempt,
        ...(pendingProgressVideoLink ? [pendingProgressVideoLink] : []),
      ],
    });
    progressTransactionStartedRef.current = false;

    if (!result.changed) {
      if (progressUploadSessionId) {
        await cancelMediaUploadSession(
          progressUploadSessionId, uid).catch(() => undefined);
        progressUploadSessionId = null;
      }
      if (uploadedImagesForAttempt.length > 0) {
        const cleanup = await deleteMediaAttachmentObjects(
          uploadedImagesForAttempt,
          {
            type: "progress",
            goalId: String(id),
            subtaskId,
            progressEventId: reservedProgressEventId!,
          }
        );
        uploadedUnsubmittedImagesRef.current = [];
        if (cleanup.failedPaths.length > 0) {
          console.error("[GoalDetail] progress media cleanup failed", {
            failedPaths: cleanup.failedPaths,
          });
        }
      }
      Alert.alert("No change", "This subtask is already at its target.");
      return;
    }
    progressCommitted = true;
    if (result.action === "undo") {
      void hapticSelection();
    } else {
      void hapticSuccess();
    }
    if (progressUploadSessionId) {
      await finalizeMediaUploadSession(progressUploadSessionId, uid).catch(
        (error) => console.warn(
          "[GoalDetail] progress upload session finalization failed", error)
      );
      progressUploadSessionId = null;
    }

    setCompletionSnapshotsByKey((previous) => {
      const next = { ...previous };
      const snapshotKey = getCompletionSnapshotMapKey(subtaskId, todayKey);
      if (result.action === "undo") {
        delete next[snapshotKey];
      } else {
        next[snapshotKey] = {
          completionCount: result.resultingValue,
          completedAtMs: result.completed ? Date.now() : null,
        };
      }
      return next;
    });
    uploadedUnsubmittedImagesRef.current = [];
    setProgressTarget(null);
    setProgressAmountInput("1");
    setProgressNoteInput("");
    setPendingProgressImages([]);
    setPendingProgressVideoLink(null);
    setProgressVideoLinkInput("");
    setShowProgressVideoLinkInput(false);
    setProgressVideoLinkError(null);

   /**  if (
  goal &&
  subtask &&
  subtask.contributesToMetric &&
  typeof subtask.metricValue === "number" &&
  subtask.metricValue > 0
) {
  const previousSnapshot = getTodayCompletionSnapshot(subtaskId);

const previousCount =
  previousSnapshot?.completionCount ?? 0;

  const rawNextCount =
  subtask.completionMode === "count"
    ? isNowCompleting
      ? previousCount + 1
      : previousCount - 1
    : isNowCompleting
    ? 1
    : 0;

const nextCount =
  subtask.completionMode === "count" &&
  typeof subtask.targetCount === "number"
    ? clampNumber(rawNextCount, 0, subtask.targetCount)
    : clampNumber(rawNextCount, 0, 1);

  let metricDelta = 0;

  if (
    subtask.completionMode === "count" &&
    typeof subtask.targetCount === "number"
  ) {
    metricDelta = getCountMetricDelta({
      previousCount,
      nextCount,
      targetCount: subtask.targetCount,
      metricValue: subtask.metricValue,
    });
  } else {
    metricDelta = isNowCompleting
      ? subtask.metricValue
      : -subtask.metricValue;
  }

  if (metricDelta !== 0) {
    const currentMetric =
      typeof goal.currentMetricValue === "number"
        ? goal.currentMetricValue
        : 0;

  const nextMetricValue = roundMetricValue(
  Math.max(0, currentMetric + metricDelta)
);

    const target =
      goal.metricTargetValue ?? 0;

    const nextProgress =
      computeProgress(nextMetricValue, target);

    await updateDoc(doc(db, "goals", String(id)), {
      currentMetricValue: nextMetricValue,
      progressPercentage: nextProgress,
      updatedAt: serverTimestamp(),
    });
  }
} **/

    if (result.completed && isNowCompleting && subtask) {
  await maybeWriteSubtaskCompletionActivity(subtask);
}

if (
  result.completed &&
  isNowCompleting &&
  subtask &&
  (goal?.visibility === "group_shared" || goal?.sharedGroupIds?.length)
) {
  showCompletionCelebration(subtask.title);
}

   if (result.completed && isNowCompleting) {
  await cancelScheduledSubtaskNotification(
    subtask?.notificationId ??
subtask?.notifications?.scheduledNotificationId ??
null
  );

    if (subtask) {
    await cancelPushReminderQueueDoc({
      goalId: String(id),
      subtaskId: subtask.id,
    }).catch((err) => {
      console.log("[Push] no queue doc to cancel on completion or cancel failed", err);
    });
  }

 const isRecurringNotificationSubtask =
  subtask?.scheduleType !== "oneTime" &&
  (subtask?.frequency === "daily" || subtask?.frequency === "weekly");

const nextDueAtMs =
  subtask && isRecurringNotificationSubtask
    ? getNextNotificationDueAtMsForSubtask({ subtask })
    : null;

  const nextReminderPatch =
  subtask && nextDueAtMs
    ? buildReminderPatch({
        dueAtMs: nextDueAtMs,
        preset: subtask.reminderPreset ?? "none",
        customOffsetMinutes: subtask.reminderCustomOffsetMinutes ?? null,
      })
    : null;

const nextScheduledNotificationId =
  subtask && nextReminderPatch
    ? await maybeScheduleSubtaskNotification({
        subtaskId: subtask.id,
        title: subtask.title,
        reminderAtMs: nextReminderPatch.reminderAtMs,
        notifications: {
          enabled: subtask.notifications?.enabled === true,
        },
      })
    : null;

  await updateDoc(doc(db, "goals", String(id), "subtasks", subtaskId), {
  dueAtMs: nextDueAtMs ?? subtask?.dueAtMs ?? null,
  reminderAtMs: nextReminderPatch?.reminderAtMs ?? subtask?.reminderAtMs ?? null,
  notificationId: nextScheduledNotificationId ?? null,
  "notifications.scheduledNotificationId": nextScheduledNotificationId ?? null,
  updatedAt: serverTimestamp(),
});

if (subtask && nextReminderPatch?.reminderAtMs) {
  await maybeUpsertPushReminderQueue({
    subtaskId: subtask.id,
    title: subtask.title,
    reminderAtMs: nextReminderPatch.reminderAtMs,
  });
}
}
  } catch (e: any) {
    progressTransactionStartedRef.current = false;
    if (progressUploadSessionId) {
      await cancelMediaUploadSession(
        progressUploadSessionId, uid).catch(() => undefined);
      progressUploadSessionId = null;
    }
    if (progressCommitted) {
      console.error("[GoalDetail] progress follow-up failed", {
        code: typeof e?.code === "string" ? e.code : "unknown",
      });
      return;
    }

    if (uploadedImagesForAttempt.length > 0) {
      const cleanup = await deleteMediaAttachmentObjects(
        uploadedImagesForAttempt,
        {
          type: "progress",
          goalId: String(id),
          subtaskId,
          progressEventId: reservedProgressEventId!,
        }
      );
      uploadedUnsubmittedImagesRef.current = [];
      if (cleanup.failedPaths.length > 0) {
        console.error("[GoalDetail] progress media cleanup failed", {
          failedPaths: cleanup.failedPaths,
        });
      }
      if (
        goalDetailMountedRef.current &&
        saveAttemptId === progressSaveAttemptIdRef.current
      ) {
        setPendingProgressImages((previous) =>
          previous.map((image) => ({
            ...image,
            status: "pending",
            progress: 0,
            errorCode: undefined,
          }))
        );
      }
    }

    console.error("[GoalDetail] progress save failed", {
      code: typeof e?.code === "string" ? e.code : "unknown",
    });

    void hapticError();
    Alert.alert(
      "Can’t complete",
      toUserFriendlyErrorMessage(e)
    );
  } finally {
    if (saveAttemptId === progressSaveAttemptIdRef.current) {
      progressSaveLockRef.current = false;
      setSavingProgressUpdate(false);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }
};
const requestDeleteSubtask = (subtaskId: string, title?: string) => {
  if (!canEditSubtasks) {
    Alert.alert("Read only", "Only the goal owner can delete subtasks.");
    return;
  }

  console.log("[UI] delete pressed (pre-confirm)", { goalId: String(id), subtaskId });
  setDeleteTarget({ id: subtaskId, title });
};

const requestEditSubtask = (subtask: Subtask) => {
  if (!canEditSubtasks) {
    Alert.alert("Read only", "Only the goal owner can edit subtasks.");
    return;
  }

  setEditTarget(subtask);
};

const requestEditGoal = () => {
  if (!canEdit) {
    Alert.alert("Read only", "Only the goal owner can edit this goal.");
    return;
  }

  if (!goal) return;

  setEditGoalTitle(goal.title ?? "");
  setEditGoalDescription(goal.description ?? "");
  setEditGoalMetricType(goal.metricType ?? "none");
  setEditGoalMetricUnitInput(goal.metricUnit ?? "");
  setEditGoalMetricTargetInput(
    goal.metricTargetValue != null ? String(goal.metricTargetValue) : ""
  );

  setEditGoalCalendarPushMode(goal.calendarPush?.mode ?? "off");
setEditGoalReminderPreset(goal.calendarPush?.reminderPreset ?? "none");
setEditGoalExportBehavior(goal.calendarPush?.exportBehavior ?? "single");
  setIsGoalEditOpen(true);
  setEditGoalAutoSync(goal.calendarPush?.autoSync ?? false);
};

function buildEditGuardrailMessages(original: Subtask, draft: {
  completionMode: SubtaskCompletionMode;
  targetCountInput: string;
  contributesToMetric: boolean;
  metricValueInput: string;
  scheduleType: SubtaskScheduleType;
  scheduledDayKey: string | null;
}): string[] {
  const messages: string[] = [];

  const originalMode = original.completionMode ?? "binary";
  const nextMode = draft.completionMode;

  if (originalMode !== nextMode) {
    messages.push("Completion behavior will change for future completions.");
  }

  const originalTarget =
    typeof original.targetCount === "number" ? original.targetCount : null;

  const nextTargetRaw = draft.targetCountInput.trim();
  const nextTarget =
    nextTargetRaw && Number.isInteger(Number(nextTargetRaw))
      ? Number(nextTargetRaw)
      : null;

  if (nextMode === "count" && originalTarget !== nextTarget) {
    messages.push("Target count will change for future completions.");
  }

  if (original.contributesToMetric === true && draft.contributesToMetric === false) {
    messages.push("This subtask will stop contributing to goal progress.");
  }

  const originalMetricValue =
    typeof original.metricValue === "number" ? original.metricValue : null;
  const nextMetricValue =
    draft.metricValueInput.trim() && Number.isFinite(Number(draft.metricValueInput))
      ? Number(draft.metricValueInput)
      : null;

  if (
    draft.contributesToMetric &&
    original.contributesToMetric &&
    originalMetricValue !== nextMetricValue
  ) {
    messages.push("Metric contribution value will change for future completions.");
  }

  const originalDayKey =
    typeof original.scheduledDayKey === "string" ? original.scheduledDayKey : null;

  if (
    draft.scheduleType === "oneTime" &&
    original.scheduleType === "oneTime" &&
    originalDayKey !== draft.scheduledDayKey
  ) {
    messages.push("The scheduled date for this one-time subtask will change.");
  }

  return messages;
}

function confirmEditGuardrails(messages: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (messages.length === 0) {
      resolve(true);
      return;
    }

    Alert.alert(
      "Confirm changes",
      `${messages.join("\n\n")}\n\nExisting completion history will not be rewritten.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: "Continue",
          onPress: () => resolve(true),
        },
      ]
    );
  });
}

const runGoalAutoSyncAfterSubtaskChange = async () => {
  try {
    if (!id || !goal) return;

    if (!goal.calendarPush?.autoSync) return;
    if ((goal.calendarPush?.mode ?? "off") !== "subtasks") return;

    await handlePushSubtasksToGoogleCalendar();
  } catch (e: any) {
    console.error("[AutoSync] subtask sync failed", e);

    if (isGooglePermissionError(e)) {
      showGooglePermissionAlert();
      return;
    }

    Alert.alert("Auto-sync failed", e?.message ?? "Unknown error");
  }
};

const saveEditedSubtask = async () => {
  if (!id || !goal || !editTarget) return;

  const trimmedDate = editDueDate.trim();
  const trimmedTime = editDueTime.trim();

  const dueAtMs = trimmedDate
    ? combineDateAndOptionalTimeToMs(trimmedDate, trimmedTime)
    : null;

  const scheduledDayKey = trimmedDate ? parseYyyyMmDdToDayKey(trimmedDate) : null;

  if (trimmedDate && !scheduledDayKey) {
    Alert.alert("Invalid date", "Use YYYY-MM-DD (example: 2026-02-21).");
    return;
  }

  if (trimmedDate && dueAtMs == null) {
    Alert.alert(
      "Invalid date or time",
      "Use date as YYYY-MM-DD and time as HH:mm (example: 09:30 or 14:05)."
    );
    return;
  }

  if (!trimmedDate && trimmedTime) {
    Alert.alert("Missing date", "Please enter a date if you want to set a time.");
    return;
  }

  if (editContributesToMetric) {
    const rawMetric = editMetricValue.trim();
    const parsedMetric = rawMetric ? Number(rawMetric) : NaN;

    if (!rawMetric || !Number.isFinite(parsedMetric) || parsedMetric <= 0) {
      Alert.alert(
        "Invalid metric value",
        "Please enter a metric contribution greater than 0."
      );
      return;
    }
  }

  const guardrailMessages = buildEditGuardrailMessages(editTarget, {
  completionMode: editCompletionMode,
  targetCountInput: editTargetCountInput,
  contributesToMetric: editContributesToMetric,
  metricValueInput: editMetricValue,
  scheduleType: editScheduleType,
  scheduledDayKey,
});

const shouldContinue = await confirmEditGuardrails(guardrailMessages);
if (!shouldContinue) {
  return;
}

  const formInput: SubtaskFormInput = {
    title: editTitle,
    description: editDescription,

    scheduleType: editScheduleType,
    frequency: editFrequency,
    weeklyDay: editWeeklyDay,
    scheduledDayKey,
    dueAtMs,

    completionMode: editCompletionMode,
    targetCountInput: editTargetCountInput,

    contributesToMetric: editContributesToMetric,
    metricValueInput: editMetricValue,
  };

 let normalized;
try {
  normalized = normalizeSubtaskInput(formInput, {
    id: String(id),
    userId: goal.userId,
    metricType: goal.metricType,
    metricUnit: goal.metricUnit,
  });
} catch (e: any) {
  Alert.alert("Invalid subtask", e?.message ?? "Please review your subtask details.");
  return;
}

const customReminderOffsetMinutes =
  editReminderPreset === "custom"
    ? parseCustomReminderOffsetMinutes(editReminderCustomOffsetInput)
    : null;

if (editReminderPreset === "custom" && customReminderOffsetMinutes == null) {
  Alert.alert(
    "Invalid reminder",
    "Enter a custom reminder offset greater than 0 minutes."
  );
  return;
}

const reminderPatch = buildReminderPatch({
  dueAtMs: normalized.dueAtMs,
  preset: editReminderPreset,
  customOffsetMinutes: customReminderOffsetMinutes,
});

try {
  setSavingEdit(true);

  await cancelScheduledSubtaskNotification(
    editTarget.notificationId ??
      editTarget.notifications?.scheduledNotificationId ??
      null
  );

  const scheduledNotificationId = await maybeScheduleSubtaskNotification({
    subtaskId: editTarget.id,
    title: normalized.title,
    reminderAtMs: reminderPatch.reminderAtMs,
    notifications: {
      enabled: editNotificationsEnabled,
    },
  });

  await updateDoc(doc(db, "goals", String(id), "subtasks", editTarget.id), {
    ...normalized,
    ...reminderPatch,
    notificationId: scheduledNotificationId ?? null,
    notifications: {
      enabled: editNotificationsEnabled,
      reminderOffsetMinutes: editReminderOffsetMinutes,
      scheduledNotificationId: scheduledNotificationId ?? null,
    },
    updatedAt: serverTimestamp(),
  });

  if (editNotificationsEnabled) {
  await maybeUpsertPushReminderQueue({
    subtaskId: editTarget.id,
    title: normalized.title,
    reminderAtMs: reminderPatch.reminderAtMs,
  });
} else {
  await cancelPushReminderQueueDoc({
    goalId: String(id),
    subtaskId: editTarget.id,
  }).catch((err) => {
    console.log("[Push] no queue doc to cancel or cancel failed", err);
  });
}

    setEditTarget(null);

if (goal.calendarPush?.autoSync && (goal.calendarPush?.mode ?? "off") === "subtasks") {
  await runGoalAutoSyncAfterSubtaskChange();
  Alert.alert(
  "Saved and synced",
  editNotificationsEnabled
    ? "Subtask updated, reminder refreshed, and Calendar Export synced."
    : "Subtask updated, reminder turned off, and Calendar Export synced."
);
} else {
  Alert.alert(
  "Saved",
  editNotificationsEnabled
    ? "Subtask updated. Reminder settings were refreshed."
    : "Subtask updated. Reminder is off."
);
}
  } catch (e: any) {
    console.error(e);
    Alert.alert("Save failed", e?.message ?? "Unknown error");
  } finally {
    setSavingEdit(false);
  }
};

function buildGoalEditGuardrailMessages(
  original: Goal,
  draft: {
  metricType: Goal["metricType"];
  metricUnit: string | null;
  metricTargetValue: number | null;
  calendarPushMode: "off" | "goal_only" | "subtasks";
  autoSync: boolean;
}
): string[] {
  const messages: string[] = [];

  if (original.metricType !== draft.metricType) {
    messages.push("Goal metric type will change.");
  }

  if (original.metricType !== "none" && draft.metricType === "none") {
    messages.push("This goal will stop tracking measurable progress.");
  }

  if (
    original.metricType !== "none" &&
    draft.metricType !== "none" &&
    original.metricUnit !== draft.metricUnit
  ) {
    messages.push("Metric unit will change.");
  }

  if (
    original.metricTargetValue !== draft.metricTargetValue &&
    draft.metricType !== "none"
  ) {
    messages.push("Metric target will change.");
  }
const originalPushMode = original.calendarPush?.mode ?? "off";

if (originalPushMode !== draft.calendarPushMode) {
  messages.push(
    "Calendar push mode will change. Existing pushed items may be replaced on next sync."
  );
}


  return messages;
}

function confirmGoalEditGuardrails(messages: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (messages.length === 0) {
      resolve(true);
      return;
    }

    Alert.alert(
      "Confirm changes",
      `${messages.join("\n\n")}\n\nExisting progress will not be rewritten.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ]
    );
  });
}

function isGooglePermissionError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "");
  return msg.includes("403") || msg.includes("401");
}

function showGooglePermissionAlert() {
  Alert.alert(
    "Google Calendar permission required",
    "Please reconnect Google Calendar in Settings, then try again."
  );
}

function formatAssigneeLabel(subtask: Subtask): string {
  return (
    subtask.assignedToName ??
    subtask.assignedToEmail ??
    "Unassigned"
  );
}

const writeCalendarExportHistory = async (params: {
  action: CalendarExportHistoryAction;
  summary: string;
}) => {
  if (!id || !goal) return;

  await addDoc(collection(db, "goals", String(id), "calendarExportHistory"), {
    userId: goal.userId,
    goalId: String(id),
    action: params.action,
    summary: params.summary,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });
};

const runGoalAutoSyncAfterEdit = async (savedGoal: GoalForCalendarExport) => {
   try {
  if (!id) return;

  if (!savedGoal.calendarPush?.autoSync) return;
  if ((savedGoal.calendarPush?.mode ?? "off") === "off") return;

  if ((savedGoal.calendarPush?.mode ?? "off") === "goal_only") {
    const result = await pushGoalOnlyToGoogleCalendar({
      goal: savedGoal,
      subtasks: eligibleSubtasksForGoalPush,
      existingEventId: savedGoal.calendarPush?.pushedGoalEventId ?? null,
    });

    await updateDoc(doc(db, "goals", String(id)), {
      calendarPush: {
        ...savedGoal.calendarPush,
        lastSyncedAtMs: Date.now(),
        pushedGoalEventId: result.eventId,
        pushedGoalCalendarId: result.calendarId,
      },
      updatedAt: serverTimestamp(),
    });

    return;
  }

  if ((savedGoal.calendarPush?.mode ?? "off") === "subtasks") {
    await handlePushSubtasksToGoogleCalendar();
  }
  } catch (e: any) {
    console.error("[AutoSync] goal edit sync failed", e);

    if (isGooglePermissionError(e)) {
      showGooglePermissionAlert();
      return;
    }

    Alert.alert("Auto-sync failed", e?.message ?? "Unknown error");
  }
};

const saveEditedGoal = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Read only", "Only the goal owner can edit this goal.");
    return;
  }

  const formInput = {
    title: editGoalTitle,
    description: editGoalDescription,
    metricType: editGoalMetricType,
    metricUnitInput: editGoalMetricUnitInput,
    metricTargetValueInput: editGoalMetricTargetInput,
  };

  let normalized;
  try {
    normalized = normalizeGoalInput(formInput);
    const guardrailMessages = buildGoalEditGuardrailMessages(goal, {
  metricType: normalized.metricType,
  metricUnit: normalized.metricUnit,
  metricTargetValue: normalized.metricTargetValue,
  calendarPushMode: editGoalCalendarPushMode,
  autoSync: editGoalAutoSync,
});

const shouldContinue = await confirmGoalEditGuardrails(guardrailMessages);
if (!shouldContinue) {
  return;
}
  } catch (e: any) {
    Alert.alert("Invalid goal", e?.message ?? "Please review your goal details.");
    return;
  }

  try {
    setSavingGoalEdit(true);

    const nextCurrentMetricValue =
      normalized.metricType === "none"
        ? null
        : (goal.currentMetricValue ?? 0);

    const nextProgressPercentage =
      normalized.metricType === "none"
        ? 0
        : computeProgress(nextCurrentMetricValue, normalized.metricTargetValue);

    const shouldComplete =
      normalized.metricType !== "none" &&
      normalized.metricTargetValue != null &&
      normalized.metricTargetValue > 0 &&
      (nextCurrentMetricValue ?? 0) >= normalized.metricTargetValue;

      const savedGoal: Goal = {
  ...goal,
  title: normalized.title,
  description: normalized.description,
  metricType: normalized.metricType,
  metricUnit: normalized.metricUnit,
  metricTargetValue: normalized.metricTargetValue,
  currentMetricValue: nextCurrentMetricValue,
  progressPercentage: nextProgressPercentage,
  status: shouldComplete
    ? "completed"
    : goal.status === "completed"
    ? "active"
    : goal.status,
  completedAtMs: shouldComplete ? goal.completedAtMs ?? Date.now() : null,
  calendarPush: {
    mode: editGoalCalendarPushMode,
    reminderPreset: editGoalReminderPreset,
    lastSyncedAtMs: goal.calendarPush?.lastSyncedAtMs ?? null,
    pushedGoalEventId: goal.calendarPush?.pushedGoalEventId ?? null,
    pushedGoalCalendarId: goal.calendarPush?.pushedGoalCalendarId ?? null,
    exportBehavior: editGoalExportBehavior,
    autoSync: editGoalAutoSync,
  },
};

    await updateDoc(doc(db, "goals", String(id)), {
  title: savedGoal.title,
  description: savedGoal.description,
  metricType: savedGoal.metricType,
  metricUnit: savedGoal.metricUnit,
  metricTargetValue: savedGoal.metricTargetValue,
  currentMetricValue: savedGoal.currentMetricValue,
  progressPercentage: savedGoal.progressPercentage,
  status: savedGoal.status,
  completedAtMs: savedGoal.completedAtMs,
  calendarPush: savedGoal.calendarPush,
  updatedAt: serverTimestamp(),
});

    setIsGoalEditOpen(false);

if (editGoalAutoSync && editGoalCalendarPushMode !== "off") {
  await runGoalAutoSyncAfterEdit(savedGoal);

  await writeCalendarExportHistory({
    action:
      editGoalCalendarPushMode === "goal_only"
        ? "auto_sync_goal"
        : "auto_sync_subtasks",
    summary: `Auto-sync ran after goal edit. Reason: ${getCalendarExportDecisionReason({
      mode: editGoalCalendarPushMode,
      autoSync: editGoalAutoSync,
      existingEventId: savedGoal.calendarPush?.pushedGoalEventId ?? null,
      source: "auto_sync",
    })}`,
  });

  Alert.alert("Saved and synced", "Goal updated and Calendar Export synced.");
} else {
  Alert.alert("Saved", "Goal updated.");
}
  } catch (e: any) {
    console.error(e);
    Alert.alert("Save failed", e?.message ?? "Unknown error");
  } finally {
    setSavingGoalEdit(false);
  }
};

const handlePushGoalOnlyToGoogleCalendar = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Not allowed", "You can only push your own goals.");
    return;
  }

  if ((goal.calendarPush?.mode ?? "off") !== "goal_only") {
    Alert.alert(
      "Goal push mode required",
      'Set Calendar Push mode to "Push goal only" first.'
    );
    return;
  }

if (eligibleSubtasksForGoalPush.length === 0) {
  Alert.alert(
    "Needs a scheduled subtask",
    "Add a date to at least one incomplete subtask before exporting this goal. Smart Goal Export uses the earliest scheduled incomplete subtask as the goal event date."
  );
  return;
}



  try {
    setPushingGoalCalendar(true);

    await cleanupForCalendarPushMode("goal_only");

    const result = await pushGoalOnlyToGoogleCalendar({
      goal,
      subtasks: eligibleSubtasksForGoalPush,
      existingEventId: goal.calendarPush?.pushedGoalEventId ?? null,
    });

    await updateDoc(doc(db, "goals", String(id)), {
      calendarPush: {
        mode: goal.calendarPush?.mode ?? "goal_only",
        reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
        lastSyncedAtMs: Date.now(),
        pushedGoalEventId: result.eventId,
        pushedGoalCalendarId: result.calendarId,
        exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
        autoSync: goal.calendarPush?.autoSync ?? false,
      },
      updatedAt: serverTimestamp(),
    });

    await writeCalendarExportHistory({
  action: "goal_exported",
  summary: `${
    goal.calendarPush?.pushedGoalEventId
      ? "Updated exported goal event."
      : "Created exported goal event."
  } Reason: ${getCalendarExportDecisionReason({
    mode: goal.calendarPush?.mode ?? "off",
    autoSync: goal.calendarPush?.autoSync ?? false,
    existingEventId: goal.calendarPush?.pushedGoalEventId ?? null,
    source: "manual_export",
  })}`,
});

    Alert.alert(
  goal.calendarPush?.pushedGoalEventId ? "Updated" : "Exported",
  "Goal event synced to Google Calendar."
);
  } catch (e: any) {
  console.error(e);
  const msg = String(e?.message ?? "");

  if (msg.includes("404") || msg.includes("410")) {
    try {
      await updateDoc(doc(db, "goals", String(id)), {
        calendarPush: {
          mode: goal.calendarPush?.mode ?? "goal_only",
          reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
          lastSyncedAtMs: null,
          pushedGoalEventId: null,
          pushedGoalCalendarId: null,
          exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
          autoSync: goal.calendarPush?.autoSync ?? false,
        },
        updatedAt: serverTimestamp(),
      });

      Alert.alert(
        "Stale event repaired",
        "The previous Google Calendar event was missing. Tap Export now again to recreate it."
      );
      return;
    } catch (repairError: any) {
      console.error("[Calendar Push] stale goal repair failed", repairError);
    }
  }

  if (msg.includes("403")) {
    Alert.alert(
      "Permission required",
      "Please reconnect Google Calendar to grant permission."
    );
  } else {
    Alert.alert("Push failed", msg || "Unknown error");
  }
} finally {
    setPushingGoalCalendar(false);
  }
};

const handlePushSubtasksToGoogleCalendar = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Not allowed", "You can only push your own goals.");
    return;
  }

  if ((goal.calendarPush?.mode ?? "off") !== "subtasks") {
    Alert.alert(
      "Subtask push mode required",
      'Set Calendar Push mode to "Push subtasks" first.'
    );
    return;
  }

  if (eligibleSubtasksForSubtaskPush.length === 0) {
    Alert.alert(
      "Nothing to push",
      "No eligible subtasks have a date or time to push yet."
    );
    return;
  }

  try {
    setPushingGoalCalendar(true);

    await cleanupForCalendarPushMode("subtasks");

    const ineligiblePreviouslyPushed = subtasks.filter(
  (s) =>
    !isSubtaskEligibleForCalendarPush(s) &&
    !!s.calendarPush?.pushedEventId
);

for (const subtask of ineligiblePreviouslyPushed) {
  const staleEventId = subtask.calendarPush?.pushedEventId ?? null;
  if (!staleEventId) continue;

  console.log("[Calendar Push] removing ineligible pushed subtask", {
    goalId: id,
    subtaskId: subtask.id,
    eventId: staleEventId,
  });

  await removeSubtaskFromGoogleCalendar({
    eventId: staleEventId,
  });

  await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
    calendarPush: {
      pushedEventId: null,
      pushedCalendarId: null,
      lastSyncedAtMs: null,
    },
    updatedAt: serverTimestamp(),
  });


}



    let successCount = 0;
const failures: string[] = [];

for (const subtask of eligibleSubtasksForSubtaskPush) {
  try {
    console.log("[Calendar Push] pushing subtask", {
      goalId: id,
      subtaskId: subtask.id,
      existingEventId: subtask.calendarPush?.pushedEventId ?? null,
    });

    const result = await pushSubtaskToGoogleCalendar({
      goal,
      subtask,
      existingEventId: subtask.calendarPush?.pushedEventId ?? null,
    });

    await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
      calendarPush: {
        pushedEventId: result.eventId,
        pushedCalendarId: result.calendarId,
        lastSyncedAtMs: Date.now(),
      },
      updatedAt: serverTimestamp(),
    });

    successCount += 1;
  } catch (subtaskError: any) {
    console.error("[Calendar Push] subtask push failed", {
      goalId: id,
      subtaskId: subtask.id,
      error: subtaskError,
    });

    const msg = String(subtaskError?.message ?? "");
if (msg.includes("404") || msg.includes("410")) {
  await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
    calendarPush: {
      pushedEventId: null,
      pushedCalendarId: null,
      lastSyncedAtMs: null,
    },
    updatedAt: serverTimestamp(),
  });
}

    failures.push(subtask.title || "Untitled subtask");
  }
}

    await updateDoc(doc(db, "goals", String(id)), {
      calendarPush: {
        mode: goal.calendarPush?.mode ?? "subtasks",
        reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
        lastSyncedAtMs: Date.now(),
        pushedGoalEventId: null,
        pushedGoalCalendarId: null,
        exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
      },
      updatedAt: serverTimestamp(),
    });

    await writeCalendarExportHistory({
  action: "subtasks_exported",
  summary: `Synced ${successCount} subtask event(s)${
    failures.length > 0 ? ` with ${failures.length} failure(s)` : ""
  }. Reason: ${getCalendarExportDecisionReason({
    mode: goal.calendarPush?.mode ?? "off",
    autoSync: goal.calendarPush?.autoSync ?? false,
    existingEventId: null,
    source: "manual_export",
  })}`,
});

    if (failures.length === 0) {
 Alert.alert(
  goal.calendarPush?.lastSyncedAtMs ? "Updated" : "Exported",
  `Synced ${successCount} subtask event(s) to Google Calendar.`
);
} else if (successCount > 0) {
  Alert.alert(
    "Partially exported",
    `Synced ${successCount} subtask event(s).\n\nFailed: ${failures.join(", ")}`
  );
} else {
  Alert.alert(
    "Push failed",
    `No subtask events were synced.\n\nFailed: ${failures.join(", ")}`
  );
}
 } finally {
    setPushingGoalCalendar(false);
  }
};

const handlePushAssignedSharedSubtaskToGoogleCalendar = async (
  subtask: Subtask
) => {
  if (!id || !goal || !uid) return;

  if (!canShowAssignedSharedCalendarPushLabel(subtask)) {
    Alert.alert(
      "Not allowed",
      "You can only export shared tasks assigned to you."
    );
    return;
  }

  if (!isSubtaskEligibleForCalendarPush(subtask)) {
    Alert.alert(
      "Needs a date or time",
      "Add a schedule before exporting this assigned task."
    );
    return;
  }

  if (isCompletedTodayBySubtask(subtask.id)) {
    Alert.alert(
      "Already completed",
      "Completed assigned tasks are not exported right now."
    );
    return;
  }

  const existingState = getMySharedCalendarPushState(subtask);
  const existingEventId =
    existingState?.status === "linked"
      ? existingState.pushedEventId
      : null;

  try {
    setPushingSharedCalendarSubtaskIds((prev) => {
      const next = new Set(prev);
      next.add(subtask.id);
      return next;
    });

    const result = await pushSubtaskToGoogleCalendar({
      goal: {
        ...goal,
        title: `[Shared] ${goal.title ?? "Shared goal"}`,
        description: sharedSourceGroupText
          ? `Shared goal from ${sharedSourceGroupText}`
          : goal.description ?? "Shared goal assigned to you in Dayta.",
      },
      subtask: {
        ...subtask,
        title: `[Shared] ${subtask.title ?? "Assigned task"}`,
      },
      existingEventId,
    });

    await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
      [`sharedCalendarPushByUid.${uid}`]: {
  pushedEventId: result.eventId,
  pushedCalendarId: result.calendarId,
  lastSyncedAtMs: Date.now(),
  status: "linked",
  ownerUid: uid,
  source: "assigned_shared_subtask",
  goalId: String(id),
  subtaskId: subtask.id,
},
      updatedAt: serverTimestamp(),
    });

    Alert.alert(
      existingEventId ? "Updated" : "Added",
      "Assigned task synced to your Google Calendar."
    );
  } catch (e: any) {
    console.error("[Shared Calendar Push] assigned subtask push failed", e);

    await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
      [`sharedCalendarPushByUid.${uid}`]: {
  pushedEventId: existingEventId,
  pushedCalendarId: existingState?.pushedCalendarId ?? null,
  lastSyncedAtMs: existingState?.lastSyncedAtMs ?? null,
  status: "failed",
  ownerUid: uid,
  source: "assigned_shared_subtask",
  goalId: String(id),
  subtaskId: subtask.id,
},
      updatedAt: serverTimestamp(),
    }).catch(console.error);

    Alert.alert("Calendar sync failed", e?.message ?? "Unknown error");
  } finally {
    setPushingSharedCalendarSubtaskIds((prev) => {
      const next = new Set(prev);
      next.delete(subtask.id);
      return next;
    });
  }
};

const handleRemoveAssignedSharedSubtaskFromGoogleCalendar = async (
  subtask: Subtask
) => {
  if (!id || !goal || !uid) return;

  const existingState = getMySharedCalendarPushState(subtask);
  const existingEventId =
    existingState?.status === "linked"
      ? existingState.pushedEventId
      : null;

  if (!existingEventId) {
    Alert.alert(
      "Nothing to remove",
      "This assigned task is not linked to your Google Calendar."
    );
    return;
  }

  try {
    setPushingSharedCalendarSubtaskIds((prev) => {
      const next = new Set(prev);
      next.add(subtask.id);
      return next;
    });

    await removeSubtaskFromGoogleCalendar({
  eventId: existingEventId,
});

    await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
[`sharedCalendarPushByUid.${uid}`]: {
  pushedEventId: null,
  pushedCalendarId: existingState?.pushedCalendarId ?? null,
  lastSyncedAtMs: Date.now(),
  status: "removed",
  ownerUid: uid,
  source: "assigned_shared_subtask",
  goalId: String(id),
  subtaskId: subtask.id,
},
      updatedAt: serverTimestamp(),
    });

    Alert.alert(
      "Removed",
      "Assigned task removed from your Google Calendar."
    );
  } catch (e: any) {
    console.error("[Shared Calendar Push] assigned subtask remove failed", e);
    Alert.alert("Remove failed", e?.message ?? "Unknown error");
  } finally {
    setPushingSharedCalendarSubtaskIds((prev) => {
      const next = new Set(prev);
      next.delete(subtask.id);
      return next;
    });
  }
};

const handleRemoveGoalOnlyFromGoogleCalendar = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Not allowed", "You can only remove your own pushed goals.");
    return;
  }

  const existingEventId = goal.calendarPush?.pushedGoalEventId ?? null;

  if (!existingEventId) {
    Alert.alert("Nothing to remove", "This goal has not been pushed yet.");
    return;
  }

  const shouldContinue = await new Promise<boolean>((resolve) => {
  Alert.alert(
    "Remove pushed event?",
    "This will remove the goal event from Google Calendar.",
    [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Remove", style: "destructive", onPress: () => resolve(true) },
    ]
  );
});

if (!shouldContinue) return;

  try {
    setRemovingGoalCalendar(true);

    await removeGoalOnlyFromGoogleCalendar({
      eventId: existingEventId,
    });

    await updateDoc(doc(db, "goals", String(id)), {
      calendarPush: {
        mode: goal.calendarPush?.mode ?? "off",
        reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
        lastSyncedAtMs: null,
        pushedGoalEventId: null,
        pushedGoalCalendarId: null,
        exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
      },
      updatedAt: serverTimestamp(),
    });

   await writeCalendarExportHistory({
  action: "exports_removed",
  summary: `Removed exported goal event. Reason: ${getCalendarExportDecisionReason({
    mode: goal.calendarPush?.mode ?? "off",
    autoSync: goal.calendarPush?.autoSync ?? false,
    existingEventId: existingEventId,
    source: "remove",
  })}`,
});

    Alert.alert("Removed", "Pushed Google Calendar event removed.");
  } catch (e: any) {
    console.error(e);
    Alert.alert("Remove failed", e?.message ?? "Unknown error");
  } finally {
    setRemovingGoalCalendar(false);
  }
};

const handleRemoveSubtasksFromGoogleCalendar = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Not allowed", "You can only remove your own pushed subtasks.");
    return;
  }

  const pushedSubtasks = subtasks.filter(
    (s) => !!s.calendarPush?.pushedEventId
  );

  if (pushedSubtasks.length === 0) {
    Alert.alert("Nothing to remove", "This goal has no pushed subtasks yet.");
    return;
  }

  const shouldContinue = await new Promise<boolean>((resolve) => {
  Alert.alert(
    "Remove pushed subtask events?",
    `This will remove ${pushedSubtasks.length} pushed subtask event(s) from Google Calendar.`,
    [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Remove", style: "destructive", onPress: () => resolve(true) },
    ]
  );
});

if (!shouldContinue) return;

  try {
    setRemovingGoalCalendar(true);

    for (const subtask of pushedSubtasks) {
      const existingEventId = subtask.calendarPush?.pushedEventId ?? null;
      if (!existingEventId) continue;

      console.log("[Calendar Push] removing subtask event", {
        goalId: id,
        subtaskId: subtask.id,
        eventId: existingEventId,
      });

      await removeSubtaskFromGoogleCalendar({
        eventId: existingEventId,
      });

      await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
        calendarPush: {
          pushedEventId: null,
          pushedCalendarId: null,
          lastSyncedAtMs: null,
        },
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, "goals", String(id)), {
      calendarPush: {
        mode: goal.calendarPush?.mode ?? "subtasks",
        reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
        lastSyncedAtMs: null,
        pushedGoalEventId: null,
        pushedGoalCalendarId: null,
        exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
      },
      updatedAt: serverTimestamp(),
    });

    await writeCalendarExportHistory({
  action: "exports_removed",
  summary: `Removed ${pushedSubtasks.length} exported subtask event(s). Reason: ${getCalendarExportDecisionReason({
    mode: goal.calendarPush?.mode ?? "off",
    autoSync: goal.calendarPush?.autoSync ?? false,
    existingEventId: null,
    source: "remove",
  })}`,
});

    Alert.alert("Removed", "Pushed subtask events removed.");
  } catch (e: any) {
    console.error(e);

    const msg = String(e?.message ?? "");
    if (msg.includes("403")) {
      Alert.alert(
        "Permission required",
        "Please reconnect Google Calendar to grant permission."
      );
    } else {
      Alert.alert("Remove failed", msg || "Unknown error");
    }
  } finally {
    setRemovingGoalCalendar(false);
  }
};

const confirmDeleteSubtask = async () => {
  if (!id || !deleteTarget) return;

  if (!canEditSubtasks) {
    Alert.alert("Read only", "Only the goal owner can delete subtasks.");
    return;
  }

  const deleteId = deleteTarget.id;

  console.log("[UI] delete confirmed", { goalId: String(id), subtaskId: deleteId });

  try {
    setDeleting(true);

  
    const subtaskToDelete = subtasks.find((s) => s.id === deleteId);

await cancelScheduledSubtaskNotification(
  subtaskToDelete?.notificationId ??
    subtaskToDelete?.notifications?.scheduledNotificationId ??
    null
);

await cancelPushReminderQueueDoc({
  goalId: String(id),
  subtaskId: deleteId,
}).catch((err) => {
  console.log("[Push] no queue doc to cancel on delete or cancel failed", err);
});

await deleteSubtaskAndCompletions(String(id), deleteId);

    // ✅ instant UI updates
   setCompletionSnapshotsByKey((prev) => {
  const next = { ...prev };
  delete next[getCompletionSnapshotMapKey(deleteId, todayKey)];
  return next;
});

    setSubtasks((prev) => prev.filter((s) => s.id !== deleteId));

    console.log("[UI] delete tx success", { goalId: String(id), subtaskId: deleteId });
    setDeleteTarget(null);
  } catch (e: any) {
    console.error("[UI] delete tx failed", e);
    Alert.alert("Delete failed", e?.message ?? "Unknown error");
  } finally {
    setDeleting(false);
  }
};

const cleanupGoalOnlyPushArtifacts = async () => {
  if (!id || !goal) return;

  const existingGoalEventId = goal.calendarPush?.pushedGoalEventId ?? null;

  if (existingGoalEventId) {
    console.log("[Calendar Push] cleanup goal-only event", {
      goalId: id,
      eventId: existingGoalEventId,
    });

    await removeGoalOnlyFromGoogleCalendar({
      eventId: existingGoalEventId,
    });
  }

  await updateDoc(doc(db, "goals", String(id)), {
    calendarPush: {
      mode: goal.calendarPush?.mode ?? "off",
      reminderPreset: goal.calendarPush?.reminderPreset ?? "none",
      lastSyncedAtMs: null,
      pushedGoalEventId: null,
      pushedGoalCalendarId: null,
      exportBehavior: goal.calendarPush?.exportBehavior ?? "single",
    },
    updatedAt: serverTimestamp(),
  });
};

const cleanupSubtaskPushArtifacts = async () => {
  if (!id) return;

  const pushedSubtasks = subtasks.filter((s) => !!s.calendarPush?.pushedEventId);

  for (const subtask of pushedSubtasks) {
    const eventId = subtask.calendarPush?.pushedEventId ?? null;
    if (!eventId) continue;

    console.log("[Calendar Push] cleanup subtask event", {
      goalId: id,
      subtaskId: subtask.id,
      eventId,
    });

    await removeSubtaskFromGoogleCalendar({ eventId });

    await updateDoc(doc(db, "goals", String(id), "subtasks", subtask.id), {
      calendarPush: {
        pushedEventId: null,
        pushedCalendarId: null,
        lastSyncedAtMs: null,
      },
      updatedAt: serverTimestamp(),
    });
  }
};

const cleanupForCalendarPushMode = async (
  targetMode: "off" | "goal_only" | "subtasks"
) => {
  if (!goal) return;

  const currentMode = goal.calendarPush?.mode ?? "off";

  console.log("[Calendar Push] mode cleanup", {
    currentMode,
    targetMode,
  });

  if (targetMode === "off") {
    await cleanupGoalOnlyPushArtifacts();
    await cleanupSubtaskPushArtifacts();
    return;
  }

  if (targetMode === "goal_only") {
    if (currentMode === "subtasks") {
      await cleanupSubtaskPushArtifacts();
    }
    return;
  }

  if (targetMode === "subtasks") {
    if (currentMode === "goal_only") {
      await cleanupGoalOnlyPushArtifacts();
    }
  }
};

const getAssignmentCandidateLabel = (candidate: AssignmentCandidate) => {
  return candidate.displayName ?? candidate.email ?? candidate.uid;
};

const getAssignmentCompletionPreview = (item: {
  isCompletedToday: boolean;
  completedAtMs: number | null;
  completionCount: number;
  subtask: Subtask;
}) => {
  if (item.isCompletedToday) {
    if (item.completedAtMs) {
      return `✓ Completed today at ${new Date(item.completedAtMs).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }

    return "✓ Completed today";
  }

  if (item.subtask.completionMode === "count") {
    return item.completionCount > 0
      ? `In progress (${item.completionCount}/${item.subtask.targetCount ?? "?"})`
      : `No activity today (${item.completionCount}/${item.subtask.targetCount ?? "?"})`;
  }

  return "No activity today";
};

const jumpToOverviewSubtask = (subtaskId: string) => {
  setHighlightedOverviewSubtaskId(subtaskId);

  setTimeout(() => {
    setHighlightedOverviewSubtaskId(null);
  }, 2400);
};

const assignSubtaskToCandidate = async (
  subtask: Subtask,
  candidate: AssignmentCandidate
) => {
  if (!id || !goal || !uid || !canEdit) return;

  const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
    ? goal.sharedGroupIds
    : [];

  if (sharedGroupIds.length === 0) {
    Alert.alert("Assignment failed", "This goal is not linked to a shared group.");
    return;
  }

  try {
    setSavingAssignment(true);

    await Promise.all(
      sharedGroupIds.map((groupId) =>
        assignSharedGoalSubtaskToMember({
          groupId,
          goalId: String(id),
          goalTitle: goal.title ?? "Untitled goal",
          subtaskId: subtask.id,
          subtaskTitle: subtask.title ?? "a subtask",
          assignedToUid: candidate.uid,
          assignedToName: candidate.displayName ?? null,
          assignedToEmail: candidate.email ?? null,
          assignedByUid: uid,
          assignedByName:
            auth.currentUser?.displayName ??
            auth.currentUser?.email ??
            null,
        })
      )
    );

    setAssignmentTarget(null);
  } catch (e: any) {
    console.log("[GoalDetail] assign subtask failed", e);
    Alert.alert("Assignment failed", e?.message ?? "Unknown error");
  } finally {
    setSavingAssignment(false);
  }
};

const unassignSubtask = async (subtask: Subtask) => {
  if (!id || !goal || !uid || !canEdit) return;

  const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
    ? goal.sharedGroupIds
    : [];

  if (sharedGroupIds.length === 0) {
    Alert.alert("Unassign failed", "This goal is not linked to a shared group.");
    return;
  }

  try {
    setSavingAssignment(true);

    await Promise.all(
      sharedGroupIds.map((groupId) =>
        unassignSharedGoalSubtask({
          groupId,
          goalId: String(id),
          goalTitle: goal.title ?? "Untitled goal",
          subtaskId: subtask.id,
          subtaskTitle: subtask.title ?? "a subtask",
          unassignedByUid: uid,
          unassignedByName:
            auth.currentUser?.displayName ??
            auth.currentUser?.email ??
            null,
        })
      )
    );

    setAssignmentTarget(null);
  } catch (e: any) {
    console.log("[GoalDetail] unassign subtask failed", e);
    Alert.alert("Unassign failed", e?.message ?? "Unknown error");
  } finally {
    setSavingAssignment(false);
  }
};

const openProgressHistory = (subtask: Subtask) => {
  setProgressHistoryEvents([]);
  setProgressHistoryLimit(20);
  setProgressHistoryError(false);
  setProgressHistoryHasMore(false);
  setSelectedHistorySubtask(subtask);
};

const closeProgressHistory = () => {
  setProgressHistoryViewer(null);
  setSelectedHistorySubtask(null);
  setProgressHistoryEvents([]);
  setProgressHistoryLoading(false);
  setProgressHistoryError(false);
  setProgressHistoryHasMore(false);
  setProgressHistoryLimit(20);
};

const getProgressHistoryMemberLabel = (
  memberUid?: string | null
): string | null => {
  if (!memberUid) return null;
  const member = goalDiscussionMentionMembers.find(
    (candidate) => candidate.uid === memberUid
  );
  return member?.displayName ?? member?.email ?? null;
};

const SubtaskRow = ({
  s,
  showMeta = true,
}: {
  s: Subtask;
  showMeta?: boolean;
}) => {
  const pending = pendingIds.has(`${s.id}:${todayKey}`);
  const completionSnapshot = getTodayCompletionSnapshot(s.id);
  const isCompleted = isCompletedTodayBySubtask(s.id);
  const countProgressCurrent = completionSnapshot?.completionCount ?? 0;
  const hasCountProgress =
    completionSnapshotsReady &&
    s.completionMode === "count" &&
    typeof s.targetCount === "number" &&
    Number.isFinite(s.targetCount) &&
    s.targetCount > 0;
  const hasMetricProgress =
    hasCountProgress &&
    s.contributesToMetric === true &&
    typeof s.metricValue === "number" &&
    Number.isFinite(s.metricValue) &&
    s.metricValue > 0;
  const meterCurrent = hasMetricProgress
    ? roundMetricValue(
        (s.metricValue! * countProgressCurrent) / s.targetCount!
      )
    : countProgressCurrent;
  const meterTarget = hasMetricProgress ? s.metricValue! : s.targetCount!;
  const meterUnit = hasMetricProgress ? s.metricUnit : null;

  const assignedToCurrentUser =
  !!auth.currentUser?.uid &&
  s.assignedToUid === auth.currentUser.uid;

  const canCompleteThisSubtask = canCompleteSubtask(s);

  const isHighlightedSubtask =
  highlightedSubtaskId === s.id;

  const scheduleLabel =
    s.scheduleType === "oneTime" || s.frequency === "once"
      ? "one time"
      : s.frequency ?? "once";

const countMetricContributionLabel = formatCountMetricContributionLabel(s);

const metricLabel =
  countMetricContributionLabel
    ? ` • ${countMetricContributionLabel}`
    : s.contributesToMetric && typeof s.metricValue === "number"
    ? ` • +${formatMetricNumber(s.metricValue)}${s.metricUnit ? ` ${s.metricUnit}` : ""}`
    : "";

  const actionLabel =
    s.completionMode === "count"
      ? isCompleted
        ? "Done"
        : "+1"
      : isCompleted
      ? "Undo"
      : "Complete";

  return (
  <View
  onLayout={(event) => {
    subtaskLayoutYByIdRef.current[s.id] = event.nativeEvent.layout.y;
  }}
  style={[
    styles.subtaskRowContainer,
    assignedToCurrentUser && styles.subtaskCardAssignedToMe,
    (isHighlightedSubtask || highlightedOverviewSubtaskId === s.id) &&
  styles.subtaskCardHighlighted,
  ]}
>
      {/* Row body = edit */}
     <Pressable
  onPress={() => {
    if (!canEditSubtasks) return;
    requestEditSubtask(s);
  }}
  disabled={!canEditSubtasks}
  style={[
    styles.subtaskRowLeft,
    pending && { opacity: 0.5 },
    !canEditSubtasks && styles.readOnlySubtaskRow,
  ]}
>
        <View style={styles.subtaskTitleRow}>
  <Text style={styles.subtaskStatusMark}>
    {s.completionMode === "count"
      ? isCompleted
        ? "✓"
        : "+"
      : isCompleted
      ? "✓"
      : "○"}
  </Text>

  <Text style={styles.subtaskText} numberOfLines={2}>
    {s.title}
  </Text>
</View>

        <View
  style={[
    styles.subtaskAssigneePill,
    !s.assignedToUid && styles.subtaskAssigneePillEmpty,
  ]}
>
{assignedToCurrentUser ? (
  <View style={styles.assignedToMeBadge}>
    <Text style={styles.assignedToMeBadgeText}>
      Assigned to me
    </Text>
  </View>
) : null}
  <Text
    style={[
      styles.subtaskAssigneePillText,
      !s.assignedToUid && styles.subtaskAssigneePillTextEmpty,
    ]}
    numberOfLines={1}
  >
    {s.assignedToUid
      ? `Assigned to ${formatAssigneeLabel(s)}`
      : "Unassigned"}
  </Text>
</View>
{canEdit ? (
<Pressable
  style={styles.reassignTaskButton}
  onPress={() => setAssignmentTarget(s)}
>
    <Text style={styles.reassignTaskButtonText}>
      {s.assignedToUid ? "Reassign task" : "Assign task"}
    </Text>
  </Pressable>
) : null}

        {isHighlightedSubtask ? (
  <Text style={styles.subtaskHighlightHint}>
    Opened from assignment notification
  </Text>
) : null}

        {!!s.description && (
          <Text style={styles.subtaskDescription}>{s.description}</Text>
        )}

        {hasCountProgress ? (
          <View style={styles.subtaskProgressMeter}>
            <ProgressMeter
              current={meterCurrent}
              target={meterTarget}
              unit={meterUnit}
              completed={isCompleted}
              label={hasMetricProgress ? "Progress today" : "Count today"}
              compact
              theme={theme}
            />
          </View>
        ) : null}

{isSharedGoalViewer ? (
  <Text
    style={[
      styles.sharedCompletionStatus,
      isCompleted && styles.sharedCompletionStatusDone,
    ]}
  >
    {canCompleteThisSubtask
      ? isCompleted
        ? "Completed today by you"
        : s.completionMode === "count"
        ? `Your progress today: ${completionSnapshot?.completionCount ?? 0}/${
            s.targetCount ?? "?"
          }`
        : "Assigned to you"
      : isCompleted
      ? "Completed today"
      : s.completionMode === "count"
      ? `Progress today: ${completionSnapshot?.completionCount ?? 0}/${
          s.targetCount ?? "?"
        }`
      : "Read only"}
  </Text>
) : null}

{canShowAssignedSharedCalendarPushLabel(s) ? (
  <View style={styles.assignedSharedCalendarCard}>
    <Text style={styles.assignedSharedCalendarKicker}>
      Google Calendar
    </Text>

<Pressable
  disabled={
    pushingSharedCalendarSubtaskIds.has(s.id) ||
    !canUpdateAssignedSharedCalendarExport(s)
  }
  onPress={() => handlePushAssignedSharedSubtaskToGoogleCalendar(s)}
  style={[
    styles.assignedSharedCalendarButton,
    !canUpdateAssignedSharedCalendarExport(s) &&
      styles.assignedSharedCalendarButtonDisabled,
    pushingSharedCalendarSubtaskIds.has(s.id) && styles.buttonDisabled,
  ]}
>
  <Text
    style={[
      styles.assignedSharedCalendarButtonText,
!canUpdateAssignedSharedCalendarExport(s) &&
  styles.assignedSharedCalendarButtonTextDisabled,
    ]}
  >
{pushingSharedCalendarSubtaskIds.has(s.id)
  ? "Syncing..."
  : getMySharedCalendarPushState(s)?.status === "linked"
  ? canUpdateAssignedSharedCalendarExport(s)
    ? "Update my Google Calendar"
    : "Update unavailable"
  : getMySharedCalendarPushState(s)?.status === "failed"
  ? "Retry Google Calendar Export"
  : "Add to my Google Calendar"}
  </Text>
</Pressable>

{getMySharedCalendarPushState(s)?.status === "linked" ? (
  <Pressable
    disabled={pushingSharedCalendarSubtaskIds.has(s.id)}
    onPress={() =>
      handleRemoveAssignedSharedSubtaskFromGoogleCalendar(s)
    }
    style={[
      styles.assignedSharedCalendarRemoveButton,
      pushingSharedCalendarSubtaskIds.has(s.id) &&
        styles.buttonDisabled,
    ]}
  >
    <Text style={styles.assignedSharedCalendarRemoveButtonText}>
      Remove from my Google Calendar
    </Text>
  </Pressable>
) : null}

{getMySharedCalendarPushState(s)?.status ? (
  <Text style={styles.assignedSharedCalendarStatus}>
    {getMySharedCalendarPushState(s)?.status === "linked"
      ? "✓ Linked"
      : getMySharedCalendarPushState(s)?.status === "removed"
      ? "Removed"
      : getMySharedCalendarPushState(s)?.status === "failed"
      ? "Sync failed"
      : ""}
  </Text>
) : null}

<Text style={styles.assignedSharedCalendarHelper}>
  {getAssignedSharedCalendarPushHelper(s)}
</Text>
  </View>
) : null}

        {showMeta && (
          <Text style={styles.subtaskMeta}>
            {scheduleLabel}
            {typeof s.scheduledDayKey === "string" && s.scheduledDayKey
              ? ` • ${formatDayKeyForDisplay(s.scheduledDayKey)}`
              : typeof s.dueAtMs === "number"
              ? ` • due ${new Date(s.dueAtMs).toLocaleDateString()}`
              : ""}
            {typeof s.dueAtMs === "number"
              ? ` • ${formatTimeForDisplayFromMs(s.dueAtMs)}`
              : ""}
            {metricLabel}
            {s.assignedAtMs
  ? ` • assigned ${new Date(s.assignedAtMs).toLocaleDateString()}`
  : ""}
          </Text>
        )}

        <View
  style={[
    styles.notificationBadge,
    !s.notifications?.enabled && styles.notificationBadgeOff,
    s.notifications?.enabled &&
      typeof s.dueAtMs === "number" &&
      s.dueAtMs <= Date.now() &&
      styles.notificationBadgeExpired,
  ]}
>
  <Text
    style={[
      styles.notificationBadgeText,
      !s.notifications?.enabled && styles.notificationBadgeOffText,
      s.notifications?.enabled &&
        typeof s.dueAtMs === "number" &&
        s.dueAtMs <= Date.now() &&
        styles.notificationBadgeExpiredText,
    ]}
  >
    {formatSubtaskNotificationStatus(s)}
  </Text>
</View>

{s.completionMode === "count" && !isCompleted && canCompleteThisSubtask ? (
  <Text style={styles.countActionHint}>Tap +1 to add progress</Text>
) : null}
      </Pressable>

  <View style={styles.subtaskActionsColumn}>
  {canCompleteThisSubtask ? (
  <Pressable
    onPress={() => {
      openProgressUpdate(s);
    }}
    disabled={pending}
    style={[
      styles.subtaskActionBtn,
      styles.subtaskCompleteBtn,
      isCompleted && styles.subtaskCompleteBtnDone,
      pending && styles.subtaskActionBtnDisabled,
    ]}
  >
    <Text
      style={[
        styles.subtaskCompleteBtnText,
        isCompleted && styles.subtaskCompleteBtnDoneText,
      ]}
    >
      {actionLabel}
    </Text>
  </Pressable>
  ) : null}

  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`View progress history for ${s.title}`}
    onPress={() => openProgressHistory(s)}
    style={styles.subtaskHistoryButton}
  >
    <Text style={styles.subtaskHistoryButtonText}>Progress history</Text>
  </Pressable>

  {canEdit ? (
  <Pressable
    onPress={() => setDeleteTarget({ id: s.id, title: s.title })}
    style={styles.trashBtn}
  >
    <Text style={styles.trashIcon}>Delete</Text>
  </Pressable>
) : null}
</View>
    </View>
  );
};

const handleShareGoalToGroup = async (groupId: string) => {
  if (!goal || !uid || !id) {
    Alert.alert("Not ready", "Goal or user is not loaded yet.");
    return;
  }

  try {
    setSharingGroupId(groupId);

   await shareGoalToGroup({
  goalId: String(id),
  groupId,
  ownerUserId: goal.userId,
  sharedByUid: uid,
  sharedByName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
});

    Alert.alert("Goal shared", "This goal is now shared with the group.");
  } catch (e: any) {
    console.log("[GoalDetail] share goal failed", e);
    Alert.alert("Share failed", e?.message ?? "Unknown error");
  } finally {
    setSharingGroupId(null);
  }
};

const handleSelectGoalDiscussionMention = (
  member: GroupMemberDoc
) => {
  const label =
    member.displayName ??
    member.email ??
    "user";

  const nextText = goalDiscussionInput.replace(
    /@([^\s@]*)$/,
    `@${label} `
  );

  setGoalDiscussionInput(nextText);
  setGoalDiscussionMentionQuery("");
  setShowGoalDiscussionMentionPicker(false);
};

const handlePostGoalDiscussionComment = async () => {
  const currentUser = auth.currentUser;
  const body = goalDiscussionInput.trim();

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!id || !goal || !goalDiscussionGroupId) {
    Alert.alert("Not ready", "Discussion is not available yet.");
    return;
  }

 if (body.length > COMMENT_MAX_LENGTH) {
  Alert.alert(
    "Comment too long",
    `Comments must be ${COMMENT_MAX_LENGTH} characters or fewer.`
  );
  return;
}
  if (!body && goalCommentMedia.length === 0) {
    Alert.alert("Comment required", "Write a comment or add an attachment.");
    return;
  }

  const goalId = String(id);
  const commentId = reserveGroupGoalCommentId(goalDiscussionGroupId, goalId);
  const context = {
    type: "shared_goal_comment" as const,
    groupId: goalDiscussionGroupId,
    goalId,
    commentId,
  };
  const attempt = createMediaUploadAttempt();
  goalCommentAttemptRef.current = attempt;
  let sessionId: string | null = null;
  let uploaded: MediaAttachmentDoc[] = [];
  try {
    setPostingGoalDiscussionComment(true);
    setGoalCommentUploadProgress(0);
    setGoalCommentUploadStatus(
      goalCommentMedia.length > 0 ? "Preparing attachments…" : "Posting comment…"
    );
    if (goalCommentMedia.length > 0) {
      const session = await createMediaUploadSession({
        uploaderUid: currentUser.uid,
        context,
      });
      sessionId = session.id;
      const progressById = new Map<string, number>();
      const batch = uploadContextMediaAttachmentBatch({
        items: goalCommentMedia.map((item) => ({
          attachmentId: item.id,
          candidate: item.candidate,
        })),
        uploaderUid: currentUser.uid,
        context,
        uploadSessionId: session.id,
        onItemProgress: (attachmentId, progress) => {
          if (!isCurrentMediaUploadAttempt(attempt, goalCommentAttemptRef.current)) return;
          progressById.set(attachmentId, progress);
          const aggregate =
            [...progressById.values()].reduce((sum, value) => sum + value, 0) /
            goalCommentMedia.length;
          setGoalCommentUploadProgress(aggregate);
          setGoalCommentUploadStatus(
            `Uploading attachments… ${Math.round(aggregate * 100)}%`
          );
        },
      });
      goalCommentUploadHandleRef.current = batch;
      uploaded = (await batch.promise).attachments;
      if (!isCurrentMediaUploadAttempt(attempt, goalCommentAttemptRef.current)) {
        throw new Error("cancelled");
      }
    }

    await createGroupGoalComment({
      groupId: goalDiscussionGroupId,
      goalId,
      goalTitle: goal.title ?? "Untitled goal",
      body,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName ?? currentUser.email ?? null,
      attachments: uploaded,
      commentId,
    });
    if (sessionId) {
      await finalizeMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }

    await clearGroupGoalTyping({
  groupId: goalDiscussionGroupId,
  goalId: String(id),
  uid: currentUser.uid,
}).catch((err) => {
  console.log("[GoalDetail] clear typing after comment failed", err);
});

    setGoalDiscussionInput("");
    setGoalCommentMedia([]);
    setGoalCommentUploadStatus(null);
  } catch {
    if (uploaded.length > 0) {
      await deleteMediaAttachmentObjects(uploaded, context);
    }
    if (sessionId) {
      await cancelMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }
    const cancelled = attempt.cancelled;
    setGoalCommentUploadStatus(
      cancelled ? "Upload cancelled." : "The comment could not be posted."
    );
    Alert.alert(
      cancelled ? "Upload cancelled" : "Comment failed",
      "Your comment was not posted."
    );
  } finally {
    if (goalCommentAttemptRef.current?.id === attempt.id) {
      goalCommentAttemptRef.current = null;
      goalCommentUploadHandleRef.current = null;
      setPostingGoalDiscussionComment(false);
    }
  }
};

const handlePickGoalCommentMedia = async () => {
  try {
    const selected = await pickCommentMediaCandidates({
      contextType: "shared_goal_comment",
      remaining:
        getMediaAttachmentPolicy("shared_goal_comment").maxAttachments -
        goalCommentMedia.length,
      existingVideoCount: goalCommentMedia.filter(
        (item) => item.candidate.type === "video"
      ).length,
    });
    setGoalCommentMedia((current) => [...current, ...selected]);
  } catch (error: any) {
    Alert.alert("Media not added", error?.message ?? "This media is not supported.");
  }
};

const cancelGoalCommentUpload = () => {
  const attempt = goalCommentAttemptRef.current;
  if (!attempt) return;
  cancelMediaUploadAttempt(attempt);
  goalCommentUploadHandleRef.current?.cancel();
  setGoalCommentUploadStatus("Cancelling upload…");
};

const handleToggleCommentReaction = async (
  comment: GroupGoalCommentDoc,
  emoji: string
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!id || !goalDiscussionGroupId) {
    Alert.alert("Not ready", "Discussion is not available yet.");
    return;
  }

  const existingReaction = getMyReactionForComment(comment.id);

  try {
    if (existingReaction?.emoji === emoji) {
      await removeGroupGoalCommentReaction({
        groupId: goalDiscussionGroupId,
        goalId: String(id),
        commentId: comment.id,
        uid: currentUser.uid,
      });
      return;
    }

    await upsertGroupGoalCommentReaction({
      groupId: goalDiscussionGroupId,
      goalId: String(id),
      commentId: comment.id,
      uid: currentUser.uid,
      emoji,
      displayName: currentUser.displayName ?? currentUser.email ?? null,
      email: currentUser.email ?? null,
    });
  } catch (err: any) {
    console.log("[GoalDetail] toggle comment reaction failed", err);
    Alert.alert("Reaction failed", err?.message ?? "Unknown error");
  }
};

const handleGoalDiscussionInputChange = async (text: string) => {
  setGoalDiscussionInput(text);

  const mentionMatch = text.match(/@([^\s@]*)$/);

  if (mentionMatch) {
    setGoalDiscussionMentionQuery(mentionMatch[1]);
    setShowGoalDiscussionMentionPicker(true);
  } else {
    setGoalDiscussionMentionQuery("");
    setShowGoalDiscussionMentionPicker(false);
  }



  const currentUser = auth.currentUser;

  if (!id || !goalDiscussionGroupId || !currentUser?.uid) {
    return;
  }

  try {
    if (text.trim()) {
      await upsertGroupGoalTyping({
        groupId: goalDiscussionGroupId,
        goalId: String(id),
        uid: currentUser.uid,
        displayName: currentUser.displayName ?? currentUser.email ?? null,
        email: currentUser.email ?? null,
      });
    } else {
      await clearGroupGoalTyping({
        groupId: goalDiscussionGroupId,
        goalId: String(id),
        uid: currentUser.uid,
      });
    }
  } catch (err) {
    console.log("[GoalDetail] update discussion typing failed", err);
  }
};

const maybeWriteSubtaskCompletionActivity = async (subtask: Subtask) => {
  if (!goal || !uid || !id) return;

  const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
    ? goal.sharedGroupIds
    : [];

  if (sharedGroupIds.length === 0) return;

  await Promise.all(
    sharedGroupIds.map((groupId) =>
      createGroupActivity({
        groupId,
        type: "subtask_completed",
        actorUid: uid,
        actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
        goalId: String(id),
        goalTitle: goal.title ?? "Untitled goal",
        message: `completed "${subtask.title ?? "a subtask"}" in "${goal.title ?? "Untitled goal"}"`,
      }).catch((err) => {
        console.log("[GroupActivity] failed writing completion activity", err);
      })
    )
  );
};


const showCompletionCelebration = (subtaskTitle?: string | null) => {
  setCompletionCelebrationText(
    `🎉 Nice work completing "${subtaskTitle ?? "a shared task"}"!`
  );

  setTimeout(() => {
    setCompletionCelebrationText(null);
  }, 2600);
};


  const handleSave = async () => {
  if (!id || !goal) return;

  if (!canEdit) {
    Alert.alert("Not allowed", "You can only edit your own goals.");
    return;
  }

  const target = goal.metricTargetValue;
  const trimmed = currentValue.trim();
  const nextCurrent = trimmed === "" ? null : Number(trimmed);

  if (trimmed !== "" && Number.isNaN(nextCurrent)) {
    Alert.alert("Invalid number", "Current value must be a number.");
    return;
  }

  const nextProgress = computeProgress(nextCurrent, target);



  // Goal should be considered completed only if there is a valid target
  // and the current value meets or exceeds it.
  const shouldComplete =
    target != null && target > 0 && (nextCurrent ?? 0) >= target;

  const wasAlreadyCompleted = goal.status === "completed";
  const isTransitioningToCompleted = shouldComplete && !wasAlreadyCompleted;

  const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
  ? goal.sharedGroupIds
  : [];

  // Preserve the existing completion timestamp if the goal is already completed
  // and remains completed on this save.
  const completedAtMs =
    isTransitioningToCompleted
      ? Date.now()
      : shouldComplete
      ? goal.completedAtMs ?? Date.now()
      : null;

  const nextStatus: Goal["status"] =
    shouldComplete
      ? "completed"
      : goal.status === "completed"
      ? "active"
      : goal.status;

  try {
    setSaving(true);

    // Write historical completion record only on the transition into completed.
    if (isTransitioningToCompleted) {
      await writeGoalCompletion(
        {
          id: String(id),
          userId: goal.userId,
          title: goal.title,
          description: goal.description ?? null,
          metricType: goal.metricType,
          metricUnit: goal.metricUnit,
          metricTargetValue: goal.metricTargetValue,
          currentMetricValue: nextCurrent,
          progressPercentage: nextProgress,
        },
        completedAtMs!
      );
    }
const savedProgressPercentage = nextProgress;

const previousProgress =
  typeof goal.progressPercentage === "number"
    ? goal.progressPercentage
    : 0;

const progressChanged =
  savedProgressPercentage !== previousProgress;

   await updateDoc(doc(db, "goals", String(id)), {
  currentMetricValue: nextCurrent,
  progressPercentage: nextProgress,
  status: nextStatus,
  completedAtMs: completedAtMs,
  updatedAt: serverTimestamp(),
});

if (sharedGroupIds.length > 0 && progressChanged) {
  await Promise.all(
    sharedGroupIds.map((groupId) =>
      createGroupActivity({
        groupId,
        type: "note_created",
        actorUid: uid!,
        actorName:
          auth.currentUser?.displayName ??
          auth.currentUser?.email ??
          null,
        goalId: String(id),
        goalTitle: goal.title ?? "Untitled goal",
        message: `updated progress on "${goal.title ?? "Untitled goal"}" (${savedProgressPercentage}%)`,
      }).catch((err) => {
        console.log("[GroupActivity] failed writing progress activity", err);
      })
    )
  );
}

if (sharedGroupIds.length > 0 && isTransitioningToCompleted) {
  await Promise.all(
    sharedGroupIds.map((groupId) =>
      createGroupActivity({
        groupId,
        type: "note_created",
        actorUid: uid!,
        actorName:
          auth.currentUser?.displayName ??
          auth.currentUser?.email ??
          null,
        goalId: String(id),
        goalTitle: goal.title ?? "Untitled goal",
        message: `completed "${goal.title ?? "Untitled goal"}"`,
      }).catch((err) => {
        console.log("[GroupActivity] failed writing goal completion activity", err);
      })
    )
  );
}

Alert.alert("Saved", "Progress updated.");
  } catch (e: any) {
    console.error(e);
    Alert.alert("Save failed", e?.message ?? "Unknown error");
  } finally {
    setSaving(false);
  }
};

const liveProgressTarget = progressTarget
  ? subtasks.find((subtask) => subtask.id === progressTarget.id) ?? null
  : null;
const progressCurrent = liveProgressTarget
  ? getTodayCompletionSnapshot(liveProgressTarget.id)?.completionCount ?? 0
  : 0;
const progressTargetCount =
  liveProgressTarget?.completionMode === "count" &&
  typeof liveProgressTarget.targetCount === "number"
    ? liveProgressTarget.targetCount
    : 1;
const parsedProgressAmount = Number(progressAmountInput.trim());
const hasValidProgressAmount =
  liveProgressTarget?.completionMode !== "count" ||
  (Number.isFinite(parsedProgressAmount) &&
    parsedProgressAmount > 0 &&
    Number.isInteger(parsedProgressAmount));
const previewAppliedAmount =
  liveProgressTarget?.completionMode === "count" && hasValidProgressAmount
    ? Math.max(
        0,
        Math.min(parsedProgressAmount, progressTargetCount - progressCurrent)
      )
    : 0;
const previewResultingCount =
  liveProgressTarget?.completionMode === "count"
    ? progressCurrent + previewAppliedAmount
    : 1;
const progressNoteIsValid =
  progressNoteInput.trim().length <= MAX_PROGRESS_COMMENT_LENGTH;
const isProgressMediaUploading = pendingProgressImages.some(
  (image) => image.status === "preparing" || image.status === "uploading"
);
const progressAttachmentCount =
  pendingProgressImages.length + (pendingProgressVideoLink ? 1 : 0);
const canSaveProgressUpdate =
  !!liveProgressTarget &&
  canCompleteSubtask(liveProgressTarget) &&
  hasValidProgressAmount &&
  progressNoteIsValid &&
  (liveProgressTarget.completionMode !== "count" ||
    previewAppliedAmount > 0) &&
  !savingProgressUpdate;

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Goal</Text>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (!goal) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Not found</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
  <KeyboardAvoidingView
  style={[styles.screen, { flex: 1 }]}
    behavior={Platform.OS === "ios" ? "padding" : undefined}
  >
    <ScrollView
      ref={goalScrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="always"
  keyboardDismissMode="on-drag"
    >
      <View style={styles.goalHeroCard}>
  <View style={styles.goalHeroTopRow}>
    <View style={styles.goalHeroTextWrap}>
      <View style={styles.goalHeroTitleRow}>
  <Text style={styles.goalHeroTitle}>{goal.title}</Text>

  {isSharedGoalViewer ? (
    <Text style={styles.sharedGoalBadge}>
      Shared Goal
    </Text>
  ) : null}
</View>

      {!!goal.description && (
        <Text style={styles.goalHeroDescription}>
          {goal.description}
        </Text>
      )}
    </View>

    <View
      style={[
        styles.goalHeroStatusBadge,
        goal.status === "completed" &&
          styles.goalHeroStatusBadgeCompleted,
      ]}
    >
      <Text
        style={[
          styles.goalHeroStatusBadgeText,
          goal.status === "completed" &&
            styles.goalHeroStatusBadgeCompletedText,
        ]}
      >
        {goal.status}
      </Text>
    </View>
  </View>

  <View style={styles.goalHeroStatsRow}>
    <View style={styles.goalHeroStatCard}>
      <Text style={styles.goalHeroStatValue}>
        {goal.progressPercentage}%
      </Text>
      <Text style={styles.goalHeroStatLabel}>progress</Text>
    </View>

    <View style={styles.goalHeroStatDivider} />

    <View style={styles.goalHeroStatCard}>
      <Text style={styles.goalHeroStatValue}>
        {subtasks.length}
      </Text>
      <Text style={styles.goalHeroStatLabel}>subtasks</Text>
    </View>

    <View style={styles.goalHeroStatDivider} />

    <View style={styles.goalHeroStatCard}>
      <Text style={styles.goalHeroStatValue}>
        {goal.metricType}
      </Text>
      <Text style={styles.goalHeroStatLabel}>metric</Text>
    </View>
  </View>
</View>

      {completionCelebrationText ? (
  <View style={styles.completionCelebrationBanner}>
    <Text style={styles.completionCelebrationText}>
      {completionCelebrationText}
    </Text>
  </View>
) : null}

      {activeGoalViewers.length > 0 ? (
  <View style={styles.goalPresenceCard}>
    <Text style={styles.goalPresenceTitle}>
      Viewing this goal now
    </Text>

    {activeGoalViewers.slice(0, 4).map((viewer) => (
      <View
        key={viewer.uid}
        style={styles.goalPresenceRow}
      >
        <View style={styles.goalPresenceAvatar}>
          <Text style={styles.goalPresenceAvatarText}>
            {(viewer.displayName ?? viewer.email ?? "?")
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </View>

        <Text style={styles.goalPresenceText}>
          {viewer.displayName ??
            viewer.email ??
            "Someone"}{" "}
          is viewing this goal
        </Text>

        <View style={styles.goalPresenceOnlineDot} />
      </View>
    ))}

    {activeGoalViewers.length > 4 ? (
      <Text style={styles.goalPresenceMoreText}>
        +{activeGoalViewers.length - 4} more viewers
      </Text>
    ) : null}
  </View>
) : null}

{isSharedGoalViewer ? (
  <View style={styles.sharedReadOnlyBanner}>
    <Text style={styles.sharedReadOnlyTitle}>Shared goal</Text>

    {sharedSourceGroupText ? (
      <Text style={styles.sharedSourceGroupText}>
        From: {sharedSourceGroupText}
      </Text>
    ) : null}

<Text style={styles.sharedReadOnlyText}>
  You can complete and schedule subtasks assigned to you.
  Goal editing, deleting, sharing, and Calendar Export remain owner-only.
</Text>
  </View>
) : null}

{isSharedGoalViewer ? (
  <View style={styles.sharedGoalInfoCard}>
    <Text style={styles.sharedGoalInfoKicker}>Shared goal</Text>
    <Text style={styles.sharedGoalInfoTitle}>{sharedGoalInfoSubtitle}</Text>

    <View style={styles.sharedGoalInfoRow}>
      <Text style={styles.sharedGoalInfoLabel}>Your assignments</Text>
      <Text style={styles.sharedGoalInfoValue}>
        {assignedToMeCount} subtask{assignedToMeCount === 1 ? "" : "s"}
      </Text>
    </View>

    <View style={styles.sharedGoalInfoRow}>
      <Text style={styles.sharedGoalInfoLabel}>Your access</Text>
<Text style={styles.sharedGoalInfoValue}>
  Complete + schedule assigned work
</Text>
    </View>

<Text style={styles.sharedGoalInfoHelper}>
  Owner/admin controls stay protected. You can participate in discussion,
  complete assigned work, and manage scheduling for your assigned subtasks.
</Text>
  </View>
) : null}

{canEdit ? (
  <View style={styles.assignmentOverviewCard}>
    <Text style={styles.cardTitle}>Assignment overview</Text>

    <Text style={styles.helperText}>
      Quick view of assigned shared-goal work and today’s progress.
    </Text>

    <View style={styles.assignmentOverviewSummaryRow}>
      <View style={styles.assignmentOverviewSummaryPill}>
        <Text style={styles.assignmentOverviewSummaryValue}>
          {assignedSubtaskOverviewItems.length}
        </Text>
        <Text style={styles.assignmentOverviewSummaryLabel}>assigned</Text>
      </View>

      <View style={styles.assignmentOverviewSummaryPill}>
        <Text style={styles.assignmentOverviewSummaryValue}>
          {assignedOverviewOpenItems.length}
        </Text>
        <Text style={styles.assignmentOverviewSummaryLabel}>open</Text>
      </View>

      <View style={styles.assignmentOverviewSummaryPill}>
        <Text style={styles.assignmentOverviewSummaryValue}>
          {assignedOverviewDoneItems.length}
        </Text>
        <Text style={styles.assignmentOverviewSummaryLabel}>done</Text>
      </View>

      <View style={styles.assignmentOverviewSummaryPill}>

  <Text style={styles.assignmentOverviewSummaryValue}>
    {assignedAttentionItems.length}
  </Text>
  <Text style={styles.assignmentOverviewSummaryLabel}>
    attention
  </Text>
</View>
    </View>

    <View style={styles.assignmentOverviewFilterRow}>
  {(["all", "open", "done", "attention"] as const).map((filter) => (
    <Pressable
      key={filter}
      onPress={() => setAssignmentOverviewFilter(filter)}
      style={[
        styles.assignmentOverviewFilterChip,
        assignmentOverviewFilter === filter &&
          styles.assignmentOverviewFilterChipActive,
      ]}
    >
      <Text
        style={[
          styles.assignmentOverviewFilterChipText,
          assignmentOverviewFilter === filter &&
            styles.assignmentOverviewFilterChipTextActive,
        ]}
      >
        {filter}
      </Text>
    </Pressable>
  ))}
</View>

{showAssignmentByMember && assignedOverviewByAssignee.length > 0 ? (
  <View style={styles.assignmentOverviewMemberRollupCard}>
    <Text style={styles.assignmentOverviewSectionLabel}>
      By member
    </Text>

    {assignedOverviewByAssignee.map((member) => {
      const expanded = expandedAssigneeKey === member.assigneeUid;

      return (
        <View key={`assignment-member-rollup-${member.assigneeUid}`}>
          <Pressable
            onPress={() =>
              setExpandedAssigneeKey((current) =>
                current === member.assigneeUid ? null : member.assigneeUid
              )
            }
            style={styles.assignmentOverviewMemberRollupRow}
          >
            <View style={styles.assignmentOverviewTextWrap}>
              <Text
                style={styles.assignmentOverviewMemberName}
                numberOfLines={1}
              >
                {member.assigneeLabel}
              </Text>

              <Text style={styles.assignmentOverviewMemberMeta}>
                {member.assignedCount} assigned • {member.doneCount} done •{" "}
                {member.openCount} open
              </Text>
            </View>

            <Text style={styles.assignmentOverviewExpandText}>
              {expanded ? "Hide" : "Show"}
            </Text>
          </Pressable>

          {expanded ? (
            <View style={styles.assignmentOverviewMemberDetailList}>
              {member.items.map((item) => {
                const s = item.subtask;

                return (
                  <View
                    key={`assignment-member-detail-${member.assigneeUid}-${s.id}`}
                    style={styles.assignmentOverviewMemberDetailRow}
                  >
                    <View style={styles.assignmentOverviewTextWrap}>
                      <Text
                        style={styles.assignmentOverviewTitle}
                        numberOfLines={1}
                      >
                        {s.title}
                      </Text>

                      {s.completionMode === "count" ? (
                        <Text style={styles.assignmentOverviewMeta}>
                          Progress today: {item.completionCount}/
                          {s.targetCount ?? "?"}
                        </Text>
                      ) : null}
                    </View>

<View style={styles.assignmentOverviewDetailActions}>
  <Text
    style={[
      styles.assignmentOverviewStatus,
      item.isCompletedToday &&
        styles.assignmentOverviewStatusDone,
    ]}
  >
    {item.isCompletedToday ? "Done" : "Open"}
  </Text>

  <Pressable
    onPress={() => setAssignmentTarget(s)}
    style={styles.assignmentOverviewReassignButton}
  >
    <Text style={styles.assignmentOverviewReassignText}>
      Reassign
    </Text>
  </Pressable>

  <Pressable
    onPress={() =>
  Alert.alert(
    "Unassign task?",
    `Remove ${formatAssigneeLabel(s)} from "${s.title}"?`,
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Unassign",
        style: "destructive",
        onPress: () => unassignSubtask(s),
      },
    ]
  )
}
    style={styles.assignmentOverviewUnassignButton}
  >
    <Text style={styles.assignmentOverviewUnassignText}>
      Unassign
    </Text>
  </Pressable>
</View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    })}
  </View>
) : null}

{showAssignmentAttention && assignedAttentionItems.length > 0 ? (
  <>
    <Text style={styles.assignmentOverviewAttentionLabel}>
      Needs attention
    </Text>

    {assignedAttentionItems.map((item) => {
      const s = item.subtask;

      const overdue =
        typeof s.dueAtMs === "number" &&
        s.dueAtMs < Date.now();

      const staleAssignment =
        typeof s.assignedAtMs === "number" &&
        Date.now() - s.assignedAtMs >
          1000 * 60 * 60 * 24 * 7;

      return (
        <View
          key={`assignment-attention-${s.id}`}
          style={styles.assignmentAttentionRow}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={styles.assignmentOverviewTitle}
              numberOfLines={1}
            >
              {s.title}
            </Text>

            <Text
              style={styles.assignmentOverviewMeta}
              numberOfLines={1}
            >
              Assigned to {item.assigneeLabel}
            </Text>

            

            <Text style={styles.assignmentAttentionReason}>
              {overdue
                ? "Overdue"
                : staleAssignment
                ? "Assigned over 7 days ago"
                : "Needs review"}
            </Text>
          </View>

          <View style={styles.assignmentAttentionBadge}>
            <Text style={styles.assignmentAttentionBadgeText}>
              Attention
            </Text>
            <Pressable
    onPress={() => setAssignmentTarget(s)}
    style={styles.assignmentOverviewReassignButton}
  >
    <Text style={styles.assignmentOverviewReassignText}>
      Reassign
    </Text>
  </Pressable>
          </View>
        </View>
      );
    })}
  </>
) : null}

   {visibleAssignmentOverviewItems.length === 0 ? (
      <View style={styles.assignmentOverviewEmptyCard}>
        <Text style={styles.assignmentOverviewEmptyTitle}>
          No assigned subtasks yet
        </Text>
        <Text style={styles.assignmentOverviewEmptyText}>
          {assignmentOverviewFilter === "all"
  ? "Use Assign task on a subtask to delegate shared work."
  : `No ${assignmentOverviewFilter} assignments right now.`}
        </Text>
      </View>
    ) : (
      <>
        {showAssignmentOpen && assignedOverviewOpenItems.length > 0 ? (
          <>
            <Text style={styles.assignmentOverviewSectionLabel}>Open</Text>
            {assignedOverviewOpenItems.map((item) => {
              const s = item.subtask;

              return (
                <View key={`assignment-open-${s.id}`} style={styles.assignmentOverviewRow}>
                  <View style={styles.assignmentOverviewTextWrap}>
                    <Text style={styles.assignmentOverviewTitle} numberOfLines={1}>
                      {s.title}
                    </Text>

                    <Text style={styles.assignmentOverviewMeta} numberOfLines={1}>
                      Assigned to {item.assigneeLabel}
                    </Text>

<Text style={styles.assignmentOverviewHistoryPreview}>
  {getAssignmentCompletionPreview(item)}
</Text>

                    {s.completionMode === "count" ? (
                      <Text style={styles.assignmentOverviewMeta}>
                        Progress today: {item.completionCount}/{s.targetCount ?? "?"}
                      </Text>
                    ) : null}
                  </View>

                 <View style={styles.assignmentOverviewDetailActions}>
  <Text style={styles.assignmentOverviewStatus}>
    Open
  </Text>

  <Pressable
    onPress={() => setAssignmentTarget(s)}
    style={styles.assignmentOverviewReassignButton}
  >
    <Text style={styles.assignmentOverviewReassignText}>
      Reassign
    </Text>
  </Pressable>
</View>
                </View>
              );
            })}
          </>
        ) : null}

        {showAssignmentDone && assignedOverviewDoneItems.length > 0 ? (
          <>
            <Text style={styles.assignmentOverviewSectionLabel}>Done today</Text>
            {assignedOverviewDoneItems.map((item) => {
              const s = item.subtask;

              return (
                <View key={`assignment-done-${s.id}`} style={styles.assignmentOverviewRow}>
                  <View style={styles.assignmentOverviewTextWrap}>
                    <Text style={styles.assignmentOverviewTitle} numberOfLines={1}>
                      {s.title}
                    </Text>

                    <Text style={styles.assignmentOverviewMeta} numberOfLines={1}>
                      Assigned to {item.assigneeLabel}
                    </Text>

<Text style={styles.assignmentOverviewHistoryPreview}>
  {getAssignmentCompletionPreview(item)}
</Text>

                    {item.completedAtMs ? (
                      <Text style={styles.assignmentOverviewMeta}>
                        Completed: {new Date(item.completedAtMs).toLocaleDateString()}
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.assignmentOverviewStatus,
                      styles.assignmentOverviewStatusDone,
                    ]}
                  >
                    Done
                  </Text>
                </View>
              );
            })}
          </>
        ) : null}
      </>
    )}
  </View>
) : null}

{goalDiscussionGroupId ? (
  <View style={styles.softCard}>
    <Pressable
      onPress={() => setShowGoalDiscussion((prev) => !prev)}
      style={styles.collapsibleSectionHeader}
    >
      <View style={styles.collapsibleSectionTextWrap}>
        <Text style={styles.cardTitle}>Discussion</Text>
        <Text style={styles.collapsibleSectionSubtitle}>
          {goalDiscussionComments.length === 0
            ? "No comments yet"
            : `${goalDiscussionComments.length} recent comment${
                goalDiscussionComments.length === 1 ? "" : "s"
              }`}
        </Text>
      </View>

      <Text style={styles.collapsibleSectionToggle}>
        {showGoalDiscussion ? "Hide" : "Show"}
      </Text>
    </Pressable>

    {showGoalDiscussion && (
      <>

    {loadingGoalDiscussionComments ? (
      <Text style={styles.muted}>Loading comments…</Text>
    ) : goalDiscussionComments.length === 0 ? (
      <Text style={styles.muted}>
        No comments yet. Group discussion for this shared goal will appear here.
      </Text>
    ) : (
      <View style={styles.goalDiscussionList}>
        {goalDiscussionComments.map((comment) => (
          <View key={comment.id} style={styles.goalDiscussionComment}>
            <Text style={styles.goalDiscussionAuthor}>
              {comment.authorName ?? "Someone"}
            </Text>

            <Text style={styles.goalDiscussionBody}>
              {comment.body}
            </Text>
            {!comment.hiddenByModeration ? (
              <MediaAttachmentGrid
                attachments={comment.attachments}
                onAttachmentPress={(_, index) =>
                  setGoalCommentViewer({
                    attachments: comment.attachments,
                    index,
                  })
                }
                theme={theme}
              />
            ) : null}

            <Text style={styles.goalDiscussionMeta}>
              {formatRelativeTime(comment.createdAtMs)}
            </Text>

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
        onPress={() => handleToggleCommentReaction(comment, emoji)}
      >
        <Text style={styles.commentQuickReactionText}>
          {emoji}
        </Text>
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
        ))}
      </View>
        )}

        {goalDiscussionTyping.length > 0 ? (
  <Text style={styles.goalDiscussionTypingText}>
    {goalDiscussionTyping[0].displayName ??
      goalDiscussionTyping[0].email ??
      "Someone"}{" "}
    is typing…
  </Text>
) : null}

    <View style={styles.goalDiscussionComposer}>
      <TextInput
        value={goalDiscussionInput}
        onChangeText={handleGoalDiscussionInputChange}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder="Add a comment..."
        placeholderTextColor={theme.colors.textMuted}
        style={styles.goalDiscussionInput}
        multiline
      />
      {showGoalDiscussionMentionPicker &&
filteredGoalDiscussionMentions.length > 0 ? (
  <View style={styles.mentionPicker}>
    {canUseGoalDiscussionHereMention &&
"here".startsWith(goalDiscussionMentionQuery) ? (
  <Pressable
    style={styles.mentionPickerItem}
    onPress={() => {
      setGoalDiscussionInput((current) =>
        current.replace(/(^|\s)@([^\s@]*)$/, "$1@here ")
      );
      setGoalDiscussionMentionQuery("");
      setShowGoalDiscussionMentionPicker(false);
    }}
  >
    <Text style={styles.mentionPickerName}>@here</Text>
  </Pressable>
) : null}
    {filteredGoalDiscussionMentions.map((member) => (
      <Pressable
        key={member.uid}
        style={styles.mentionPickerItem}
        onPress={() =>
          handleSelectGoalDiscussionMention(member)
        }
      >
        <Text style={styles.mentionPickerName}>
          {member.displayName ??
            member.email ??
            "Unknown"}
        </Text>
      </Pressable>
    ))}
  </View>
) : null}
      <Text style={styles.commentLengthText}>
  {goalDiscussionInput.length}/{COMMENT_MAX_LENGTH}
</Text>

      <Pressable
        style={[
          styles.goalDiscussionButton,
          postingGoalDiscussionComment && styles.buttonDisabled,
        ]}
        onPress={handlePostGoalDiscussionComment}
        disabled={postingGoalDiscussionComment}
      >
        <Text style={styles.goalDiscussionButtonText}>
          {postingGoalDiscussionComment ? "Posting..." : "Post"}
        </Text>
      </Pressable>
        </View>
      </>
    )}
  </View>
) : null}

<MediaAttachmentViewer
  attachments={goalCommentViewer?.attachments ?? []}
  initialIndex={goalCommentViewer?.index ?? 0}
  onRequestClose={() => setGoalCommentViewer(null)}
  presentationTitle="Comment media"
  visible={goalCommentViewer !== null}
/>

{assignedToMeSubtasks.length > 0 ? (
  <View style={styles.softCard}>
    <Text style={styles.cardTitle}>Assigned to me</Text>

    <Text style={styles.helperText}>
      These tasks were assigned to you from a shared group.
    </Text>

    <View style={styles.assignedToMeList}>
      {assignedToMeSubtasks.map((s) => (
        <SubtaskRow
          key={`assigned-to-me-${s.id}`}
          s={s}
          showMeta
        />
      ))}
    </View>
  </View>
) : null}

{canEdit ? (
      <View style={styles.utilityCard}>
  <Text style={styles.cardTitle}>Share to group</Text>

  <Text style={styles.helperText}>
    Share this goal with one of your groups. Group sharing keeps you as the goal owner.
  </Text>

  {myGroups.length === 0 ? (
    <Text style={styles.muted}>
      You are not in any groups yet.
    </Text>
  ) : (
    myGroups.map((membership) => {
      const sharedGroupIds = Array.isArray(goal.sharedGroupIds)
  ? goal.sharedGroupIds
  : [];



const alreadyShared = sharedGroupIds.includes(membership.groupId);

      return (
        <Pressable
          key={membership.groupId}
          style={[
            styles.shareGroupButton,
            alreadyShared && styles.shareGroupButtonShared,
            sharingGroupId === membership.groupId && styles.buttonDisabled,
          ]}
          onPress={() => handleShareGoalToGroup(membership.groupId)}
          disabled={alreadyShared || sharingGroupId === membership.groupId}
        >
          <Text style={styles.shareGroupButtonText}>
            {membership.groupName ?? membership.groupId}
          </Text>

          <Text style={styles.shareGroupButtonMeta}>
            {alreadyShared
              ? "Already shared"
              : sharingGroupId === membership.groupId
              ? "Sharing..."
              : `Share as ${membership.role}`}
          </Text>
        </Pressable>
      );
    })
  )}
  </View>
) : null}

<Modal
  visible={!!selectedHistorySubtask}
  transparent
  animationType="fade"
  onRequestClose={closeProgressHistory}
>
  <View style={styles.modalBackdrop}>
    <View
      accessibilityViewIsModal
      style={styles.progressHistoryModalCard}
    >
      <View style={styles.progressHistoryHeader}>
        <View style={styles.progressHistoryHeaderText}>
          <Text accessibilityRole="header" style={styles.modalTitle}>
            Progress history
          </Text>
          <Text style={styles.progressHistorySubtaskTitle}>
            {selectedHistorySubtask?.title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close progress history"
          onPress={closeProgressHistory}
          style={styles.progressHistoryCloseButton}
        >
          <Text style={styles.progressHistoryCloseText}>Close</Text>
        </Pressable>
      </View>

      <FlatList
        data={progressHistoryEvents}
        keyExtractor={(event) => event.id}
        contentContainerStyle={styles.progressHistoryList}
        renderItem={({ item }) => (
          <ProgressEventCard
            currentUserUid={uid}
            event={item}
            memberLabel={getProgressHistoryMemberLabel(item.authorUid)}
            onAttachmentPress={(_, index) =>
              setProgressHistoryViewer({
                attachments: item.attachments,
                index,
              })
            }
            reverterLabel={getProgressHistoryMemberLabel(item.revertedByUid)}
            theme={theme}
          />
        )}
        ListEmptyComponent={
          progressHistoryLoading ? (
            <View style={styles.progressHistoryState}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={styles.progressHistoryStateTitle}>
                Loading progress history…
              </Text>
            </View>
          ) : progressHistoryError ? (
            <View style={styles.progressHistoryState}>
              <Text style={styles.progressHistoryStateTitle}>
                Progress history could not be loaded.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setProgressHistoryEvents([]);
                  setProgressHistoryRetryKey((value) => value + 1);
                }}
                style={styles.progressHistoryRetryButton}
              >
                <Text style={styles.progressHistoryRetryText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.progressHistoryState}>
              <Text style={styles.progressHistoryStateTitle}>
                No progress updates yet.
              </Text>
              <Text style={styles.progressHistoryStateBody}>
                Completions, increments, notes, and attachments will appear
                here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          progressHistoryEvents.length > 0 ? (
            <View style={styles.progressHistoryFooter}>
              {progressHistoryLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : null}
              {progressHistoryHasMore &&
              progressHistoryLimit < 250 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: progressHistoryLoading,
                    disabled: progressHistoryLoading,
                  }}
                  disabled={progressHistoryLoading}
                  onPress={() =>
                    setProgressHistoryLimit((value) =>
                      Math.min(250, value + 20)
                    )
                  }
                  style={[
                    styles.progressHistoryLoadButton,
                    progressHistoryLoading && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.progressHistoryLoadText}>
                    Load older updates
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
      />
    </View>
  </View>
</Modal>

<MediaAttachmentViewer
  attachments={progressHistoryViewer?.attachments ?? []}
  initialIndex={progressHistoryViewer?.index ?? 0}
  onRequestClose={() => setProgressHistoryViewer(null)}
  presentationTitle="Progress media"
  visible={progressHistoryViewer !== null}
/>

<Modal
  visible={!!progressTarget}
  transparent
  animationType="fade"
  onRequestClose={closeProgressUpdate}
>
  <Pressable style={styles.modalBackdrop} onPress={closeProgressUpdate}>
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.progressModalKeyboardView}
    >
      <Pressable style={styles.modalCard} onPress={() => {}}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.modalScrollContent}
        >
          <Text accessibilityRole="header" style={styles.modalTitle}>
            {liveProgressTarget?.completionMode === "count"
              ? "Add progress"
              : liveProgressTarget &&
                isCompletedTodayBySubtask(liveProgressTarget.id)
              ? "Undo completion?"
              : "Complete subtask"}
          </Text>

          <Text style={styles.modalText}>
            {liveProgressTarget?.title ??
              "This subtask is no longer available."}
          </Text>

          {liveProgressTarget?.completionMode === "count" ? (
            <>
              <View style={styles.progressPreviewCard}>
                <Text style={styles.progressPreviewLabel}>Current progress</Text>
                <Text style={styles.progressPreviewValue}>
                  {formatProgressValue(progressCurrent)} /{" "}
                  {formatProgressValue(progressTargetCount)}
                </Text>
              </View>

              <Text style={styles.label}>Amount</Text>
              <TextInput
                accessibilityLabel="Progress amount"
                value={progressAmountInput}
                onChangeText={setProgressAmountInput}
                editable={!savingProgressUpdate}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="1"
                style={styles.input}
              />
              {!hasValidProgressAmount ? (
                <Text style={styles.progressValidationText}>
                  Enter a positive whole number.
                </Text>
              ) : null}

              <View
                accessible
                accessibilityLabel={`After update, ${formatProgressValue(
                  previewResultingCount
                )} of ${formatProgressValue(progressTargetCount)}`}
                style={styles.progressPreviewCard}
              >
                <Text style={styles.progressPreviewLabel}>After update</Text>
                <Text style={styles.progressPreviewValue}>
                  {formatProgressValue(previewResultingCount)} /{" "}
                  {formatProgressValue(progressTargetCount)}
                </Text>
                {hasValidProgressAmount &&
                previewAppliedAmount < parsedProgressAmount ? (
                  <Text style={styles.progressPreviewHint}>
                    Only {formatProgressValue(previewAppliedAmount)} will be
                    added because progress is capped at the target.
                  </Text>
                ) : null}
                {previewResultingCount >= progressTargetCount ? (
                  <Text style={styles.progressPreviewComplete}>
                    This update will complete the target.
                  </Text>
                ) : null}
                {liveProgressTarget.contributesToMetric &&
                typeof liveProgressTarget.metricValue === "number" &&
                liveProgressTarget.metricValue > 0 ? (
                  <Text style={styles.progressPreviewHint}>
                    Metric contribution after update:{" "}
                    {formatProgressValue(
                      roundMetricValue(
                        (liveProgressTarget.metricValue *
                          previewResultingCount) /
                          progressTargetCount
                      )
                    )}{" "}
                    / {formatProgressValue(liveProgressTarget.metricValue)}
                    {liveProgressTarget.metricUnit
                      ? ` ${liveProgressTarget.metricUnit}`
                      : ""}
                  </Text>
                ) : null}
              </View>
            </>
          ) : liveProgressTarget &&
            isCompletedTodayBySubtask(liveProgressTarget.id) ? (
            <Text style={styles.progressUndoText}>
              This will mark the subtask incomplete. A linked progress update
              will remain in history and be marked as reverted when available.
            </Text>
          ) : (
            <Text style={styles.progressUndoText}>
              This subtask will be marked complete.
            </Text>
          )}

          {liveProgressTarget &&
          !(
            liveProgressTarget.completionMode === "binary" &&
            isCompletedTodayBySubtask(liveProgressTarget.id)
          ) ? (
            <>
              <View style={styles.progressNoteHeader}>
                <Text style={styles.label}>Progress note (optional)</Text>
                <Text style={styles.progressNoteCounter}>
                  {progressNoteInput.length}/{MAX_PROGRESS_COMMENT_LENGTH}
                </Text>
              </View>
              <TextInput
                accessibilityLabel="Progress note, optional"
                value={progressNoteInput}
                onChangeText={setProgressNoteInput}
                editable={!savingProgressUpdate}
                multiline
                maxLength={MAX_PROGRESS_COMMENT_LENGTH}
                placeholder="What changed?"
                style={[styles.input, styles.progressNoteInput]}
              />
            </>
          ) : null}

          {liveProgressTarget &&
          !(
            liveProgressTarget.completionMode === "binary" &&
            isCompletedTodayBySubtask(liveProgressTarget.id)
          ) ? (
            <View style={styles.progressImagesSection}>
              <View style={styles.progressImagesHeader}>
                <View style={styles.progressImagesHeaderText}>
                  <Text style={styles.label}>Attachments (optional)</Text>
                  <Text style={styles.progressImagesCount}>
                    {progressAttachmentCount} of {MAX_MEDIA_ATTACHMENTS} selected
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Attach images"
                  disabled={
                    savingProgressUpdate ||
                    progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS
                  }
                  onPress={pickProgressImages}
                  style={[
                    styles.progressImagesAddButton,
                    (savingProgressUpdate ||
                      progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.progressImagesAddButtonText}>
                    Add photos or GIFs
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Attach an MP4 video"
                  disabled={
                    savingProgressUpdate ||
                    progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS ||
                    pendingProgressImages.some(
                      (item) => item.candidate.type === "video"
                    )
                  }
                  onPress={pickProgressVideo}
                  style={[
                    styles.progressImagesAddButton,
                    (savingProgressUpdate ||
                      progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS ||
                      pendingProgressImages.some(
                        (item) => item.candidate.type === "video"
                      )) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.progressImagesAddButtonText}>
                    Add video
                  </Text>
                </Pressable>
              </View>

              {pendingProgressImages.length > 0 ? (
                <View style={styles.progressImageGrid}>
                  {pendingProgressImages.map((image, index) => (
                    <View
                      accessible
                      accessibilityLabel={`Selected ${
                        image.candidate.type === "gif"
                          ? "GIF"
                          : image.candidate.type === "video"
                          ? "video"
                          : "image"
                      } ${index + 1} of ${
                        pendingProgressImages.length
                      }, ${image.status}`}
                      key={image.id}
                      style={styles.progressImageTile}
                    >
                      {image.candidate.type === "video" ? (
                        <View
                          style={[
                            styles.progressImageThumbnail,
                            styles.progressVideoPlaceholder,
                          ]}
                        >
                          <Text style={styles.progressVideoPlaceholderBadge}>
                            VIDEO
                          </Text>
                          <Text style={styles.progressVideoPlaceholderTitle}>
                            {image.candidate.fileName || "MP4 video"}
                          </Text>
                          <Text style={styles.progressVideoPlaceholderMeta}>
                            {formatVideoDuration(image.candidate.durationMs)}
                            {formatMediaSize(image.candidate.sizeBytes)
                              ? ` · ${formatMediaSize(
                                  image.candidate.sizeBytes
                                )}`
                              : ""}
                          </Text>
                        </View>
                      ) : (
                        <ExpoImage
                          source={{ uri: image.previewUri }}
                          contentFit="cover"
                          style={styles.progressImageThumbnail}
                        />
                      )}
                      {image.status === "preparing" ||
                      image.status === "uploading" ? (
                        <View style={styles.progressImageStatusOverlay}>
                          <Text style={styles.progressImageStatusText}>
                            {image.status === "preparing"
                              ? "Preparing..."
                              : `${Math.round(image.progress * 100)}%`}
                          </Text>
                        </View>
                      ) : image.status === "failed" ? (
                        <View style={styles.progressImageStatusOverlay}>
                          <Text style={styles.progressImageErrorText}>
                            Upload failed
                          </Text>
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove selected ${
                          image.candidate.type === "gif"
                            ? "GIF"
                            : image.candidate.type === "video"
                            ? "video"
                            : "image"
                        } ${index + 1}`}
                        disabled={savingProgressUpdate}
                        onPress={() => removePendingProgressImage(image.id)}
                        style={[
                          styles.progressImageRemoveButton,
                          savingProgressUpdate && styles.buttonDisabled,
                        ]}
                      >
                        <Text style={styles.progressImageRemoveText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : !pendingProgressVideoLink ? (
                <Text style={styles.progressImagesHelper}>
                  Images up to 10 MB, GIFs up to 15 MB, or one MP4 up to 30
                  seconds and 50 MB.
                </Text>
              ) : null}

              {pendingProgressVideoLink ? (
                <View style={styles.progressVideoLinkCard}>
                  {pendingProgressVideoLink.thumbnailUrl ? (
                    <ExpoImage
                      source={{ uri: pendingProgressVideoLink.thumbnailUrl }}
                      contentFit="cover"
                      style={styles.progressVideoLinkThumbnail}
                    />
                  ) : null}
                  <View style={styles.progressVideoLinkBody}>
                    <Text style={styles.progressVideoLinkProvider}>
                      YouTube video
                    </Text>
                    <Text style={styles.progressVideoLinkMeta}>
                      Opens in YouTube or your browser
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove YouTube video link"
                      disabled={savingProgressUpdate}
                      onPress={removeProgressVideoLink}
                      style={styles.progressVideoLinkRemoveButton}
                    >
                      <Text style={styles.progressImageRemoveText}>
                        Remove link
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : showProgressVideoLinkInput ? (
                <View style={styles.progressVideoLinkInputCard}>
                  <Text style={styles.label}>YouTube video link</Text>
                  <TextInput
                    accessibilityLabel="YouTube video link"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!savingProgressUpdate}
                    keyboardType="url"
                    value={progressVideoLinkInput}
                    onChangeText={(value) => {
                      setProgressVideoLinkInput(value);
                      setProgressVideoLinkError(null);
                    }}
                    placeholder="https://youtu.be/..."
                    style={styles.input}
                  />
                  {progressVideoLinkError ? (
                    <Text style={styles.progressValidationText}>
                      {progressVideoLinkError}
                    </Text>
                  ) : null}
                  <View style={styles.progressVideoLinkActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={savingProgressUpdate}
                      onPress={() => {
                        setShowProgressVideoLinkInput(false);
                        setProgressVideoLinkInput("");
                        setProgressVideoLinkError(null);
                      }}
                      style={[
                        styles.progressVideoLinkActionButton,
                        styles.modalCancel,
                      ]}
                    >
                      <Text style={styles.modalBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={savingProgressUpdate}
                      onPress={addProgressVideoLink}
                      style={[
                        styles.progressVideoLinkActionButton,
                        styles.modalPrimary,
                      ]}
                    >
                      <Text
                        style={[styles.modalBtnText, styles.modalPrimaryText]}
                      >
                        Add link
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    savingProgressUpdate ||
                    progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS
                  }
                  onPress={() => {
                    setShowProgressVideoLinkInput(true);
                    setProgressVideoLinkError(null);
                  }}
                  style={[
                    styles.progressVideoLinkAddButton,
                    (savingProgressUpdate ||
                      progressAttachmentCount >= MAX_MEDIA_ATTACHMENTS) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.progressVideoLinkAddButtonText}>
                    Add YouTube link
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}

          <View style={styles.modalRow}>
            <Pressable
              accessibilityRole="button"
              style={[styles.modalBtn, styles.modalCancel]}
              onPress={
                isProgressMediaUploading
                  ? cancelProgressMediaUpload
                  : closeProgressUpdate
              }
              disabled={savingProgressUpdate && !isProgressMediaUploading}
            >
              <Text style={styles.modalBtnText}>
                {isProgressMediaUploading ? "Cancel upload" : "Cancel"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: !canSaveProgressUpdate,
                busy: savingProgressUpdate,
              }}
              style={[
                styles.modalBtn,
                styles.modalPrimary,
                !canSaveProgressUpdate && styles.buttonDisabled,
              ]}
              onPress={saveProgressUpdate}
              disabled={!canSaveProgressUpdate}
            >
              <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
                {savingProgressUpdate
                  ? "Saving..."
                  : liveProgressTarget?.completionMode === "count"
                  ? "Save progress"
                  : liveProgressTarget &&
                    isCompletedTodayBySubtask(liveProgressTarget.id)
                  ? "Undo completion"
                  : "Mark complete"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  </Pressable>
</Modal>

      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDeleteTarget(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Delete subtask?</Text>

            <Text style={styles.modalText}>
              {deleteTarget?.title ? `“${deleteTarget.title}”\n\n` : ""}
              This can’t be undone.
            </Text>

            <View style={styles.modalRow}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.modalBtn, styles.modalPrimary]}
                onPress={confirmDeleteSubtask}
                disabled={deleting}
              >
                <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
                  {deleting ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
     </Modal>


{/* Assignment Modal */}
<Modal
  visible={!!assignmentTarget}
  transparent
  animationType="fade"
  onRequestClose={() => setAssignmentTarget(null)}
>
  <Pressable style={styles.modalBackdrop} onPress={() => setAssignmentTarget(null)}>
    <Pressable style={styles.modalCard} onPress={() => {}}>
      <Text style={styles.modalTitle}>
        {assignmentTarget?.assignedToUid ? "Reassign task" : "Assign task"}
      </Text>

      <Text style={styles.modalText}>
        {assignmentTarget?.title ?? "Selected subtask"}
      </Text>

      {assignmentCandidates.length === 0 ? (
        <Text style={styles.muted}>
          No active group members found for this shared goal yet.
        </Text>
      ) : (
        <View style={styles.assignmentCandidateList}>
          {assignmentCandidates.map((candidate) => {
            const selected = assignmentTarget?.assignedToUid === candidate.uid;

            return (
              <Pressable
                key={candidate.uid}
                disabled={savingAssignment || selected || !assignmentTarget}
                onPress={() => {
                  if (!assignmentTarget) return;
                  assignSubtaskToCandidate(assignmentTarget, candidate);
                }}
                style={[
                  styles.assignmentCandidateButton,
                  selected && styles.assignmentCandidateButtonSelected,
                  savingAssignment && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.assignmentCandidateName}>
                  {getAssignmentCandidateLabel(candidate)}
                </Text>

                <Text style={styles.assignmentCandidateMeta}>
                  {selected
                    ? "Currently assigned"
                    : candidate.groupName
                    ? `From ${candidate.groupName}`
                    : "Group member"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.modalRow}>
        {assignmentTarget?.assignedToUid ? (
          <Pressable
            style={[styles.modalBtn, styles.modalCancel]}
            disabled={savingAssignment}
            onPress={() => {
              if (!assignmentTarget) return;
              unassignSubtask(assignmentTarget);
            }}
          >
            <Text style={styles.modalBtnText}>
              {savingAssignment ? "Saving..." : "Unassign"}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.modalBtn, styles.modalPrimary]}
          disabled={savingAssignment}
          onPress={() => setAssignmentTarget(null)}
        >
          <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
            Done
          </Text>
        </Pressable>
      </View>
    </Pressable>
  </Pressable>
</Modal>

{/* Edit Modal */}
<Modal
  visible={!!editTarget}
  transparent
  animationType="fade"
  onRequestClose={() => setEditTarget(null)}
>
  <Pressable style={styles.modalBackdrop} onPress={() => setEditTarget(null)}>
  <Pressable style={styles.modalCard} onPress={() => {}}>
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.modalScrollContent}
    >
      <Text style={styles.modalTitle}>Edit subtask</Text>

<View style={[styles.formSection, styles.formSectionFirst]}>
  <Text style={styles.formSectionTitle}>Basics</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Title</Text>
<TextInput
  value={editTitle}
  onChangeText={setEditTitle}
  style={styles.input}
/>

<Text style={[styles.label, { marginTop: 10 }]}>Description</Text>
<TextInput
  value={editDescription}
  onChangeText={setEditDescription}
  style={styles.input}
  multiline
/>
</View>
<View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Schedule</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Schedule type</Text>
<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  <Pressable
    onPress={() => setEditScheduleType("recurring")}
    style={[
      styles.pill,
      editScheduleType === "recurring" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Recurring</Text>
  </Pressable>

  <Pressable
    onPress={() => setEditScheduleType("oneTime")}
    style={[
      styles.pill,
      editScheduleType === "oneTime" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>One time</Text>
  </Pressable>
</View>

{editScheduleType === "recurring" && (
  <>
    <Text style={[styles.label, { marginTop: 10 }]}>Recurrence</Text>
    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      <Pressable
        onPress={() => setEditFrequency("daily")}
        style={[
          styles.pill,
          editFrequency === "daily" && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>Daily</Text>
      </Pressable>

      <Pressable
        onPress={() => setEditFrequency("weekly")}
        style={[
          styles.pill,
          editFrequency === "weekly" && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>Weekly</Text>
      </Pressable>
    </View>

    {editFrequency === "weekly" && (
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
          <Pressable
            key={label}
            onPress={() => setEditWeeklyDay(idx)}
            style={[
              styles.pill,
              editWeeklyDay === idx && styles.pillActive,
            ]}
          >
            <Text style={styles.pillText}>{label}</Text>
          </Pressable>
        ))}
      </View>
    )}
  </>
)}

<Text style={[styles.label, { marginTop: 10 }]}>
  {editScheduleType === "oneTime" ? "Scheduled date" : "Due date"}
</Text>

<View style={styles.clearableInputRow}>
{Platform.OS === "ios" ? (
  <TextInput
    value={editDueDate}
    onChangeText={setEditDueDate}
    placeholder={
      editScheduleType === "oneTime"
        ? "YYYY-MM-DD scheduled date"
        : "YYYY-MM-DD due date (optional)"
    }
    placeholderTextColor={theme.colors.textMuted}
    keyboardType="numbers-and-punctuation"
    autoCorrect={false}
    autoCapitalize="none"
    style={[styles.input, styles.clearableInputMain]}
  />
) : (
  <Pressable
    onPress={() => setShowEditDatePicker(true)}
    style={[styles.input, styles.clearableInputMain]}
  >
    <Text>
      {editDueDate
        ? `📅 ${formatDayKeyForDisplay(editDueDate)}`
        : editScheduleType === "oneTime"
        ? "Select scheduled date"
        : "Select due date (optional)"}
    </Text>
  </Pressable>
)}

  {editDueDate ? (
    <Pressable
      style={styles.clearInputButton}
      onPress={() => {
        setEditDueDate("");
        setEditDueTime("");
      }}
    >
      <Text style={styles.clearInputButtonText}>Clear</Text>
    </Pressable>
  ) : null}
</View>

<Text style={[styles.label, { marginTop: 10 }]}>Time (optional)</Text>
<View style={styles.clearableInputRow}>
{Platform.OS === "ios" ? (
  <TextInput
    value={editDueTime}
    onChangeText={setEditDueTime}
    placeholder="HH:mm (optional)"
    placeholderTextColor={theme.colors.textMuted}
    keyboardType="numbers-and-punctuation"
    autoCorrect={false}
    autoCapitalize="none"
    style={[styles.input, styles.clearableInputMain]}
  />
) : (
  <Pressable
    onPress={() => {
      if (!editDueDate) {
        Alert.alert("Select date first", "Please pick a date before setting time.");
        return;
      }
      setShowEditTimePicker(true);
    }}
    style={[styles.input, styles.clearableInputMain]}
  >
    <Text>
      {editDueTime ? `⏰ ${editDueTime}` : "Select time (optional)"}
    </Text>
  </Pressable>
)}

  {editDueTime ? (
    <Pressable
      style={styles.clearInputButton}
      onPress={() => setEditDueTime("")}
    >
      <Text style={styles.clearInputButtonText}>Clear</Text>
    </Pressable>
  ) : null}
</View>
</View>

<View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Notifications</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Notifications</Text>

  <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  <Pressable
    onPress={() => setEditNotificationsEnabled(false)}
    style={[
      styles.pill,
      !editNotificationsEnabled && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Off</Text>
  </Pressable>

  <Pressable
    onPress={() => setEditNotificationsEnabled(true)}
    style={[
      styles.pill,
      editNotificationsEnabled && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>On</Text>
  </Pressable>
</View>

{editNotificationsEnabled && (
  <>
    <Text style={[styles.label, { marginTop: 10 }]}>Reminder timing</Text>

    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      {([0, 10, 30, 60] as const).map((minutes) => (
        <Pressable
          key={minutes}
          onPress={() => setEditReminderOffsetMinutes(minutes)}
          style={[
            styles.pill,
            editReminderOffsetMinutes === minutes && styles.pillActive,
          ]}
        >
          <Text style={styles.pillText}>
            {minutes === 0 ? "At time" : `${minutes} min before`}
          </Text>
        </Pressable>
      ))}
    </View>

    <Text style={styles.helperText}>
  Notifications require a scheduled date and time. If the reminder time has already passed, no notification will be scheduled.
</Text>
  </>
)}

<Text style={[styles.label, { marginTop: 10 }]}>Reminder model</Text>
<Text style={styles.helperText}>
  This saves the new reminder setting. Notification scheduling will switch to this next.
</Text>

<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  {(["none", "at_time", "morning_of", "day_before", "custom"] as SubtaskReminderPreset[]).map(
    (preset) => (
      <Pressable
        key={preset}
        onPress={() => setEditReminderPreset(preset)}
        style={[
          styles.pill,
          editReminderPreset === preset && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>
          {formatReminderPresetLabel(preset)}
        </Text>
      </Pressable>
    )
  )}
</View>

{editReminderPreset === "custom" && (
  <TextInput
    value={editReminderCustomOffsetInput}
    onChangeText={setEditReminderCustomOffsetInput}
    placeholder="Minutes before task time"
    keyboardType="number-pad"
    style={styles.input}
  />
)}
</View>
{isMetricEnabled && (
  <View style={styles.formSection}>
    <Text style={styles.formSectionTitle}>Progress contribution</Text>
    <Text style={styles.label}>Goal progress contribution</Text>

    <View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
      <Pressable
        onPress={() => {
  setEditContributesToMetric(false);
  setEditMetricValue("");
}}
        style={[
          styles.pill,
          !editContributesToMetric && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>off</Text>
      </Pressable>

      <Pressable
        onPress={() => setEditContributesToMetric(true)}
        style={[
          styles.pill,
          editContributesToMetric && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>contributes</Text>
      </Pressable>
    </View>

    {editContributesToMetric && (
      <View style={styles.fullWidth}>
        <Text style={[styles.label, { marginTop: 8 }]}>
          Metric value ({goal?.metricUnit ?? "value"})
        </Text>

        <TextInput
          placeholder="Enter metric value"
          value={editMetricValue}
          onChangeText={setEditMetricValue}
          keyboardType="numeric"
          style={[styles.input, styles.fullWidth]}
        />

        <Text style={styles.helperText}>
          {editCompletionMode === "count"
            ? `Each count contributes a proportional amount to goal progress${goal?.metricUnit ? ` (${goal.metricUnit})` : ""}.`
            : `Applied when this subtask is completed${goal?.metricUnit ? ` (${goal.metricUnit})` : ""}.`}
        </Text>
      </View>
    )}
  </View>
)}

<View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Completion</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Completion mode</Text>
<View style={{ flexDirection: "row", gap: 8 }}>
  <Pressable
    onPress={() => setEditCompletionMode("binary")}
    style={[
      styles.pill,
      editCompletionMode === "binary" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Binary</Text>
  </Pressable>

  <Pressable
    onPress={() => setEditCompletionMode("count")}
    style={[
      styles.pill,
      editCompletionMode === "count" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Count</Text>
  </Pressable>
</View>

{editCompletionMode === "count" && (
  <TextInput
    value={editTargetCountInput}
    onChangeText={setEditTargetCountInput}
    placeholder="Target count"
    style={styles.input}
    keyboardType="numeric"
  />
)}
</View>

      <View style={styles.modalRow}>
  <Pressable
    style={[styles.modalBtn, styles.modalCancel]}
    onPress={() => setEditTarget(null)}
    disabled={savingEdit}
  >
    <Text style={styles.modalBtnText}>Cancel</Text>
  </Pressable>

  <Pressable
    style={[styles.modalBtn, styles.modalPrimary, savingEdit && styles.buttonDisabled]}
    onPress={saveEditedSubtask}
    disabled={savingEdit}
  >
    <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
      {savingEdit ? "Saving..." : "Save"}
    </Text>
  </Pressable>
</View>
</ScrollView>
    </Pressable>
  </Pressable>
</Modal>

<Modal
  visible={isGoalEditOpen}
  transparent
  animationType="fade"
  onRequestClose={() => setIsGoalEditOpen(false)}
>
  <View style={styles.modalBackdrop}>
  <Pressable
    style={StyleSheet.absoluteFill}
    onPress={() => setIsGoalEditOpen(false)}
  />

  <View style={styles.modalCard}>
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.modalScrollContent}
    >
     <Text style={styles.modalTitle}>Edit goal</Text>

<View style={[styles.formSection, styles.formSectionFirst]}>
  <Text style={styles.formSectionTitle}>Basics</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Title</Text>
      <TextInput
        value={editGoalTitle}
        onChangeText={setEditGoalTitle}
        style={styles.input}
      />

      <Text style={[styles.label, { marginTop: 10 }]}>Description</Text>
      <TextInput
        value={editGoalDescription}
        onChangeText={setEditGoalDescription}
        style={styles.input}
        multiline
      />
</View>
      <View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Metric</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Metric type</Text>
      <View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
        {(["none", "hours", "weight", "pages", "reps", "custom"] as Goal["metricType"][]).map(
          (type) => (
            <Pressable
              key={type}
              onPress={() => setEditGoalMetricType(type)}
              style={[
                styles.pill,
                editGoalMetricType === type && styles.pillActive,
              ]}
            >
              <Text style={styles.pillText}>{type}</Text>
            </Pressable>
          )
        )}
      </View>

      <Text style={[styles.label, { marginTop: 10 }]}>Metric unit</Text>
      <TextInput
        value={editGoalMetricUnitInput}
        onChangeText={setEditGoalMetricUnitInput}
        placeholder="e.g. hours, lbs, pages"
        style={styles.input}
      />

      <Text style={[styles.label, { marginTop: 10 }]}>Metric target</Text>
      <TextInput
        value={editGoalMetricTargetInput}
        onChangeText={setEditGoalMetricTargetInput}
        placeholder="e.g. 50"
        keyboardType="numeric"
        style={styles.input}
      />
</View>
     <View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Calendar Export</Text>
<Text style={styles.helperText}>
  Controls what gets sent to Google Calendar.
</Text>

<Text style={[styles.label, { marginTop: 10 }]}>Export mode</Text>
<View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
  <Pressable
    onPress={() => setEditGoalCalendarPushMode("off")}
    style={[
      styles.pill,
      editGoalCalendarPushMode === "off" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Off</Text>
  </Pressable>

  <Pressable
    onPress={() => setEditGoalCalendarPushMode("goal_only")}
    style={[
      styles.pill,
      editGoalCalendarPushMode === "goal_only" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Push goal only</Text>
  </Pressable>

  <Pressable
    onPress={() => setEditGoalCalendarPushMode("subtasks")}
    style={[
      styles.pill,
      editGoalCalendarPushMode === "subtasks" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Push subtasks</Text>
  </Pressable>
</View>

<Text style={[styles.label, { marginTop: 12 }]}>Export behavior</Text>
<Text style={styles.helperText}>
  Single events create one-time entries. Recurring events repeat daily/weekly subtasks.
</Text>

<View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
  <Pressable
    disabled={isGoalCalendarExportOff}
    onPress={() => setEditGoalExportBehavior("single")}
    style={[
      styles.pill,
      editGoalExportBehavior === "single" && styles.pillActive,
      isGoalCalendarExportOff && styles.pillDisabled,
    ]}
  >
    <Text style={styles.pillText}>Single events</Text>
  </Pressable>

  <Pressable
    disabled={isGoalCalendarExportOff}
    onPress={() => setEditGoalExportBehavior("recurring")}
    style={[
      styles.pill,
      editGoalExportBehavior === "recurring" && styles.pillActive,
      isGoalCalendarExportOff && styles.pillDisabled,
    ]}
  >
    <Text style={styles.pillText}>Recurring events</Text>
  </Pressable>
</View>

<Text style={[styles.sectionTitle, { marginTop: 16 }]}>Automation</Text>
<Text style={styles.helperText}>
  Manual means you tap Export now. Auto-sync updates exported events after edits.
</Text>

<View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
  <Pressable
    onPress={() => setEditGoalAutoSync(false)}
    style={[
      styles.pill,
      !editGoalAutoSync && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Manual</Text>
  </Pressable>

  <Pressable
    disabled={isGoalCalendarExportOff}
    onPress={() => {
      if (editGoalAutoSync) return;

      Alert.alert(
        "Enable auto-sync?",
        "Auto-sync will update exported Google Calendar events after goal or subtask edits. It will not remove exported events without confirmation.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Enable", onPress: () => setEditGoalAutoSync(true) },
        ]
      );
    }}
    style={[
      styles.pill,
      editGoalAutoSync && styles.pillActive,
      isGoalCalendarExportOff && styles.pillDisabled,
    ]}
  >
    <Text style={styles.pillText}>Auto-sync</Text>
  </Pressable>
</View>

<Text style={[styles.sectionTitle, { marginTop: 16 }]}>Reminders</Text>
<Text style={styles.helperText}>
  Reminder settings apply to exported Google Calendar events.
</Text>

<View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
  {(["none", "10m", "30m", "60m"] as const).map((preset) => (
    <Pressable
      key={preset}
      disabled={isGoalCalendarExportOff}
      onPress={() => setEditGoalReminderPreset(preset)}
      style={[
        styles.pill,
        editGoalReminderPreset === preset && styles.pillActive,
        isGoalCalendarExportOff && styles.pillDisabled,
      ]}
    >
      <Text style={styles.pillText}>
        {preset === "none"
          ? "None"
          : preset === "10m"
          ? "10 min"
          : preset === "30m"
          ? "30 min"
          : "60 min"}
      </Text>
    </Pressable>
  ))}
</View>

<Text style={styles.helperText}>
  Exported events are never removed automatically.
</Text>

<Text style={styles.helperText}>
  Off keeps this goal out of Google Calendar. “Push goal only” creates one calendar event for the goal. “Push subtasks” exports eligible subtasks.

  {"\n\n"}Single events create one-time entries. Recurring events repeat automatically based on subtask schedule.

  {"\n\n"}Manual means Calendar Export only updates when you tap “Export now”. Auto-sync will update exported events after edits. Exported events are never removed automatically.
</Text>
</View>
      <View style={styles.modalRow}>
        <Pressable
          style={[styles.modalBtn, styles.modalCancel]}
          onPress={() => setIsGoalEditOpen(false)}
          disabled={savingGoalEdit}
        >
          <Text style={styles.modalBtnText}>Cancel</Text>
        </Pressable>

        <Pressable
  style={[styles.modalBtn, styles.modalPrimary, savingGoalEdit && styles.buttonDisabled]}
  onPress={saveEditedGoal}
  disabled={savingGoalEdit}
>
  <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
    {savingGoalEdit ? "Saving..." : "Save"}
  </Text>
</Pressable>
      </View>
     </ScrollView>
  </View>
</View>
</Modal>

<View style={[styles.card, styles.goalProgressCard]}>
  <View style={styles.goalProgressHeaderRow}>
    <View style={styles.goalProgressHeaderTextWrap}>
      <Text style={styles.cardTitle}>Progress</Text>
      <Text style={styles.goalProgressSubtitle}>
        {goal.metricType} • {metricLine}
      </Text>
    </View>

    <View
      style={[
        styles.goalStatusBadge,
        goal.status === "completed" && styles.goalStatusBadgeCompleted,
      ]}
    >
      <Text
        style={[
          styles.goalStatusBadgeText,
          goal.status === "completed" && styles.goalStatusBadgeCompletedText,
        ]}
      >
        {goal.status}
      </Text>
    </View>
  </View>

  <View style={styles.goalProgressPercentRow}>
    <Text style={styles.goalProgressPercentText}>
      {goal.progressPercentage}%
    </Text>
    <Text style={styles.goalProgressPercentLabel}>complete</Text>
  </View>

  <View style={styles.progressRow}>
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${goal.progressPercentage}%` }]} />
    </View>
  </View>

{canEdit ? (
  <>
        <Text style={styles.progressInputLabel}>Update current value</Text>
        <TextInput
          value={currentValue}
          onChangeText={setCurrentValue}
          placeholder="e.g., 12"
          keyboardType="numeric"
          style={styles.input}
          editable={canEdit}
        />
      <Pressable
  style={[styles.button, styles.secondary, !canEdit && styles.buttonDisabled]}
  onPress={requestEditGoal}
  disabled={!canEdit}
>
  <Text style={[styles.buttonText, styles.secondaryButtonText]}>
  Edit goal
</Text>
</Pressable>


        <Pressable
          style={[styles.button, (!canEdit || saving) && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!canEdit || saving}
        >
          <Text style={styles.buttonText}>{saving ? "Saving..." : "Save progress"}</Text>
        </Pressable>

        {!canEdit && (
          <Text style={styles.muted}>
            You’re not signed in or this goal doesn’t belong to you.
          </Text>
        )}
         </>
) : null}
      </View>

{canEdit ? (
<View style={styles.utilityCard}>
  <Pressable
    onPress={() => setShowCalendarExport((prev) => !prev)}
    style={styles.collapsibleSectionHeader}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Calendar Export</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {(goal.calendarPush?.mode ?? "off") === "off"
          ? "Not exporting"
          : (goal.calendarPush?.mode ?? "off") === "goal_only"
          ? "Goal-only export"
          : `${subtasks.filter((s) => s.calendarPush?.pushedEventId).length} subtask event(s) linked`}
      </Text>
    </View>

    <Text style={styles.collapsibleSectionToggle}>
      {showCalendarExport ? "Hide" : "Show"}
    </Text>
  </Pressable>

  {showCalendarExport && (
    <>
      <Text style={styles.helperText}>
  {(goal.calendarPush?.mode ?? "off") === "off"
    ? "Not exporting to Google Calendar."
    : (goal.calendarPush?.mode ?? "off") === "goal_only"
    ? "Exporting the goal as a calendar event."
    : (goal.calendarPush?.exportBehavior ?? "single") === "recurring"
    ? "Exporting eligible subtasks as recurring calendar events."
    : "Exporting eligible subtasks as single calendar events."}
</Text>

 <Text style={[styles.label, { marginTop: 8 }]}>Mode</Text>

<View
  style={[
    styles.statusBadge,
    (goal.calendarPush?.mode ?? "off") === "off" && styles.statusBadgeMuted,
  ]}
>
  <Text
    style={[
      styles.statusBadgeText,
      (goal.calendarPush?.mode ?? "off") === "off" &&
        styles.statusBadgeMutedText,
    ]}
  >
    {(goal.calendarPush?.mode ?? "off") === "goal_only"
      ? "Goal only"
      : (goal.calendarPush?.mode ?? "off") === "subtasks"
      ? "Subtasks"
      : "Off"}
  </Text>
</View>

<Text style={[styles.label, { marginTop: 10 }]}>Reminders</Text>
<Text style={styles.value}>
  {(goal.calendarPush?.reminderPreset ?? "none") === "10m"
    ? "10 minutes before each event"
    : (goal.calendarPush?.reminderPreset ?? "none") === "30m"
    ? "30 minutes before each event"
    : (goal.calendarPush?.reminderPreset ?? "none") === "60m"
    ? "60 minutes before each event"
    : "No reminders"}
</Text>

  <Text style={[styles.label, { marginTop: 10 }]}>Export behavior</Text>
<Text style={styles.value}>
  {(goal.calendarPush?.exportBehavior ?? "single") === "recurring"
    ? "Recurring events"
    : "Single events"}
</Text>

<Text style={styles.helperText}>
  Single events create one-time calendar entries. Recurring events repeat automatically based on subtask schedule.
</Text>

<Text style={[styles.label, { marginTop: 10 }]}>Auto-sync</Text>
<Text style={styles.value}>
  {goal.calendarPush?.autoSync
    ? "Auto-sync enabled — updates after edits"
: "Manual sync only — tap Export now to sync"}
</Text>

<Text style={styles.helperText}>
  Auto-sync updates exported events, but never removes Google Calendar events automatically.
</Text>

  <Text style={[styles.label, { marginTop: 10 }]}>Sync status</Text>

<View
  style={[
    styles.statusBadge,
    !goal.calendarPush?.lastSyncedAtMs && styles.statusBadgeMuted,
  ]}
>
  <Text
    style={[
      styles.statusBadgeText,
      !goal.calendarPush?.lastSyncedAtMs && styles.statusBadgeMutedText,
    ]}
  >
    {goal.calendarPush?.lastSyncedAtMs
      ? `Last synced ${new Date(goal.calendarPush.lastSyncedAtMs).toLocaleString()}`
      : "Not exported yet"}
  </Text>
</View>

  {(goal.calendarPush?.mode ?? "off") === "goal_only" &&
  !!goal.calendarPush?.pushedGoalEventId && (
    <Text style={styles.value}>1 goal event linked</Text>
)}

{(goal.calendarPush?.mode ?? "off") === "subtasks" && (
  <Text style={styles.value}>
    {subtasks.filter((s) => s.calendarPush?.pushedEventId).length} subtask event(s) linked
  </Text>
)}

  <Pressable
  style={[
    styles.button,
    styles.secondary,
    (!canEdit || pushingGoalCalendar) && styles.buttonDisabled,
  ]}
  onPress={() => {
  const mode = goal.calendarPush?.mode ?? "off";

  if (mode === "goal_only") {
    handlePushGoalOnlyToGoogleCalendar();
    return;
  }

  if (mode === "subtasks") {
    handlePushSubtasksToGoogleCalendar();
    return;
  }

  writeCalendarExportHistory({
  action: "sync_skipped",
  summary: `Skipped export. Reason: ${getCalendarExportDecisionReason({
    mode: "off",
    autoSync: goal.calendarPush?.autoSync ?? false,
    existingEventId: null,
    source: "manual_export",
  })}`,
}).catch(console.error);

Alert.alert(
  "Choose an export mode",
  'Set Calendar Export mode to "Push goal only" or "Push subtasks" first.'
);
}}
  disabled={!canEdit || pushingGoalCalendar}
>
<Text
  style={[
    styles.buttonText,
    styles.secondaryButtonText,
    (!canEdit || pushingGoalCalendar) && styles.buttonDisabledText,
  ]}
>
  {pushingGoalCalendar
    ? "Syncing..."
    : goal.calendarPush?.lastSyncedAtMs
    ? "Update export"
    : "Export now"}
</Text>
</Pressable>

<Text style={styles.helperText}>
  Export now will create missing Google Calendar events and update existing exported events.
</Text>

  <Pressable
  style={[
    styles.button,
    styles.secondary,
    (!canEdit || removingGoalCalendar) && styles.buttonDisabled,
  ]}
  onPress={() => {
  const mode = goal.calendarPush?.mode ?? "off";

  if (mode === "goal_only") {
    handleRemoveGoalOnlyFromGoogleCalendar();
    return;
  }

  if (mode === "subtasks") {
    handleRemoveSubtasksFromGoogleCalendar();
    return;
  }

  Alert.alert(
    "Nothing to remove",
    "This goal is not currently set to push calendar items."
  );
}}
  disabled={!canEdit || removingGoalCalendar}
>
  <Text
  style={[
    styles.buttonText,
    styles.secondaryButtonText,
    (!canEdit || removingGoalCalendar) && styles.buttonDisabledText,
  ]}
>
  {removingGoalCalendar ? "Removing..." : "Remove exported items"}
</Text>
</Pressable>

{latestCalendarExportDecision && (
  <>
    <Text style={[styles.label, { marginTop: 14 }]}>Last decision</Text>
    <Text style={styles.helperText}>
      {latestCalendarExportDecision.summary}
    </Text>
  </>
)}

<Text style={[styles.label, { marginTop: 14 }]}>Recent activity</Text>

{calendarExportHistory.length === 0 ? (
  <Text style={styles.helperText}>No export history yet.</Text>
) : (
  <View style={{ gap: 6, marginTop: 4 }}>
    {calendarExportHistory.map((item) => (
      <Text
  key={item.id}
  style={[
  styles.helperText,
  item.action === "sync_failed" && styles.historyErrorText,
  item.action === "sync_skipped" && styles.historySkippedText,
]}
>
        • {item.summary}
{item.createdAtMs
  ? ` — ${formatCalendarExportHistoryTime(item.createdAtMs)}`
  : ""}
      </Text>
    ))}
  </View>
)}
    </>
  )}
</View>
) : null}

      <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()}>
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>
  Back to Goals
</Text>
      </Pressable>

      {milestones.length > 0 || canEdit ? (
        <View
          style={[
            styles.card,
            {
              marginTop: 14,
              borderWidth: 1.5,
            },
          ]}
        >
          <Text style={styles.cardTitle}>Milestones</Text>
          <Text style={styles.helperText}>
            Milestones break this goal into bigger checkpoints.
          </Text>

          <View style={styles.milestoneProgressText}>
            <Text style={styles.value}>
              {milestoneRollup.completedMilestones} of{" "}
              {milestoneRollup.totalMilestones} milestone
              {milestoneRollup.totalMilestones === 1 ? "" : "s"} complete
            </Text>
            <Text style={styles.helperText}>
              {milestoneRollup.milestoneProgressPercentage}% milestone progress
            </Text>
          </View>

          <View style={styles.milestoneProgressTrack}>
            <View
              style={[
                styles.milestoneProgressFill,
                {
                  width: `${milestoneRollup.milestoneProgressPercentage}%`,
                },
              ]}
            />
          </View>

          {canEdit ? (
            <Pressable
              style={styles.milestoneAddButton}
              onPress={() => setShowAddMilestoneForm((prev) => !prev)}
            >
              <Text style={styles.milestoneAddButtonText}>
                {showAddMilestoneForm ? "Cancel add" : "+ Add milestone"}
              </Text>
            </Pressable>
          ) : null}

          {canEdit && showAddMilestoneForm ? (
            <View style={styles.milestoneForm}>
              <Text style={styles.label}>Title *</Text>
              <TextInput
                value={milestoneTitleInput}
                onChangeText={setMilestoneTitleInput}
                placeholder="Milestone title"
                style={styles.input}
              />

              <Text style={[styles.label, { marginTop: 8 }]}>Description</Text>
              <TextInput
                value={milestoneDescriptionInput}
                onChangeText={setMilestoneDescriptionInput}
                placeholder="Optional notes"
                style={styles.input}
                multiline
              />

              <Text style={[styles.label, { marginTop: 8 }]}>
                Due date optional
              </Text>
              <TextInput
                value={milestoneDueDateInput}
                onChangeText={setMilestoneDueDateInput}
                placeholder="YYYY-MM-DD, optional"
                style={styles.input}
                autoCapitalize="none"
              />
              <Text style={styles.helperText}>
                Use format YYYY-MM-DD, for example 2026-07-15.
              </Text>

              <View style={styles.milestoneFormActions}>
                <Pressable
                  style={[styles.modalBtn, styles.modalCancel]}
                  onPress={() => {
                    setMilestoneTitleInput("");
                    setMilestoneDescriptionInput("");
                    setMilestoneDueDateInput("");
                    setShowAddMilestoneForm(false);
                  }}
                  disabled={savingMilestone}
                >
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.modalBtn,
                    styles.modalPrimary,
                    savingMilestone && styles.buttonDisabled,
                  ]}
                  onPress={handleCreateMilestone}
                  disabled={savingMilestone}
                >
                  <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
                    {savingMilestone ? "Saving..." : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {milestones.length > 0 ? (
          <View style={styles.milestoneList}>
            {milestones.map((milestone) => {
              const dueLabel =
                typeof milestone.dueAtMs === "number"
                  ? `Due ${formatMilestoneDueDate(milestone.dueAtMs)}`
                  : null;
              const progressLabel =
                typeof milestone.progressPercentage === "number"
                  ? `${milestone.progressPercentage}% complete`
                  : null;
              const meta = [dueLabel, progressLabel].filter(Boolean).join(" - ");

              return (
                <View key={milestone.id} style={styles.milestoneRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.milestoneTitle} numberOfLines={2}>
                      {milestone.title}
                    </Text>
                    {milestone.description ? (
                      <Text style={styles.milestoneDescription}>
                        {milestone.description}
                      </Text>
                    ) : null}
                    {meta ? (
                      <Text style={styles.milestoneMeta}>{meta}</Text>
                    ) : null}

                    {canEdit ? (
                      <View style={styles.milestoneActionRow}>
                        {milestone.status !== "completed" ? (
                          <Pressable
                            style={[
                              styles.milestoneActionButton,
                              savingMilestone && styles.buttonDisabled,
                            ]}
                            onPress={() => handleCompleteMilestone(milestone)}
                            disabled={savingMilestone}
                          >
                            <Text style={styles.milestoneActionButtonText}>
                              Complete
                            </Text>
                          </Pressable>
                        ) : null}

                        <Pressable
                          style={[
                            styles.milestoneActionButton,
                            savingMilestone && styles.buttonDisabled,
                          ]}
                          onPress={() => openEditMilestone(milestone)}
                          disabled={savingMilestone}
                        >
                          <Text style={styles.milestoneActionButtonText}>
                            Edit
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.milestoneActionButton,
                            savingMilestone && styles.buttonDisabled,
                          ]}
                          onPress={() => handleArchiveMilestone(milestone)}
                          disabled={savingMilestone}
                        >
                          <Text style={styles.milestoneActionButtonText}>
                            Archive
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.milestoneBadge}>
                    <Text style={styles.milestoneBadgeText}>
                      {milestone.status === "completed"
                        ? "✓ Completed"
                        : formatMilestoneStatusLabel(milestone.status)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          ) : canEdit ? (
            <Text style={styles.muted}>No milestones yet.</Text>
          ) : null}
        </View>
      ) : null}

      <View
  style={[
    styles.card,
    {
      marginTop: 14,
      borderWidth: 1.5,
    },
  ]}
>
  <Pressable
    onPress={() => setShowAddSubtaskForm((prev) => !prev)}
    style={styles.collapsibleSectionHeader}
  >
    <View style={styles.collapsibleSectionTextWrap}>
      <Text style={styles.cardTitle}>Subtasks</Text>
      <Text style={styles.collapsibleSectionSubtitle}>
        {subtasks.length === 0
          ? "No subtasks yet"
          : `${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}`}
      </Text>
    </View>

    {canEdit ? (
      <Text style={styles.collapsibleSectionToggle}>
        {showAddSubtaskForm ? "Hide form" : "+ Add"}
      </Text>
    ) : null}
  </Pressable>

{canEdit && showAddSubtaskForm ? (
  <>
<View style={[styles.formSection, styles.formSectionFirst]}>
  <Text style={styles.formSectionTitle}>Basics</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Title *</Text>
<View style={[styles.createRow, isNarrow && styles.createRowNarrow]}>
  <TextInput
    style={[
      styles.input,
      styles.titleInput,
      isNarrow && styles.fullWidth,
    ]}
    placeholder="e.g. Read 10 pages"
    value={newSubtaskTitle}
    onChangeText={setNewSubtaskTitle}
  />
</View>

<Text style={[styles.label, { marginTop: 10 }]}>Description (optional)</Text>
<TextInput
  style={[
    styles.input,
    styles.fullWidth,
  ]}
  placeholder="Add details or notes for this subtask"
  value={newSubtaskDescription}
  onChangeText={setNewSubtaskDescription}
  multiline
/>
</View>
  {/* Metric */}
{isMetricEnabled && (
  <View style={styles.formSection}>
    <Text style={styles.formSectionTitle}>Progress contribution</Text>
  <View style={[styles.fullWidth, { marginTop: 6 }]}>
    <Text style={styles.label}>Goal progress contribution</Text>

    <View style={[styles.rowWrapLocal, { marginTop: 6 }]}>
      <Pressable
        onPress={() => setSubtaskContributesToMetric(false)}
        style={[
          styles.pill,
          !subtaskContributesToMetric && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>off</Text>
      </Pressable>

      <Pressable
        onPress={() => setSubtaskContributesToMetric(true)}
        style={[
          styles.pill,
          subtaskContributesToMetric && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>contributes</Text>
      </Pressable>
    </View>

   {subtaskContributesToMetric && (
  <View style={styles.fullWidth}>
    <Text style={[styles.label, { marginTop: 8 }]}>
      Metric value ({goal?.metricUnit ?? "value"})
    </Text>

    <TextInput
      placeholder={`Enter metric value`}
      value={subtaskMetricValue}
      onChangeText={setSubtaskMetricValue}
      keyboardType="numeric"
      style={[styles.input, styles.fullWidth]}
    />

    <Text style={styles.helperText}>
      {subtaskCompletionMode === "count"
  ? `Each count contributes a proportional amount to goal progress${goal?.metricUnit ? ` (${goal.metricUnit})` : ""}.`
  : `Applied when this subtask is completed${goal?.metricUnit ? ` (${goal.metricUnit})` : ""}.`}
    </Text>
  </View>
)}
   </View>
</View>
)}

  


<View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Schedule</Text>

  <Text style={[styles.label, { marginTop: 4 }]}>Schedule type</Text>

<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  <Pressable
    onPress={() => setSubtaskScheduleType("recurring")}
    style={[
      styles.pill,
      subtaskScheduleType === "recurring" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Recurring</Text>
  </Pressable>

  <Pressable
    onPress={() => setSubtaskScheduleType("oneTime")}
    style={[
      styles.pill,
      subtaskScheduleType === "oneTime" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>One time</Text>
  </Pressable>
</View>
{/* Frequency */}
{subtaskScheduleType === "recurring" && (
  <>
    <Text style={[styles.label, { marginTop: 10 }]}>Recurrence</Text>

    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      {(["daily", "weekly"] as const).map((f) => (
        <Pressable
          key={f}
          onPress={() => setSubtaskFrequency(f)}
          style={[styles.pill, subtaskFrequency === f && styles.pillActive]}
        >
          <Text style={styles.pillText}>{f}</Text>
        </Pressable>
      ))}
    </View>

    {subtaskFrequency === "weekly" && (
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => (
          <Pressable
            key={label}
            onPress={() => setSubtaskWeeklyDay(idx)}
            style={[styles.pill, subtaskWeeklyDay === idx && styles.pillActive]}
          >
            <Text style={styles.pillText}>{label}</Text>
          </Pressable>
        ))}
      </View>
    )}
  </>
)}

<Text style={[styles.label, { marginTop: 10 }]}>Completion mode</Text>

<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  <Pressable
    onPress={() => setSubtaskCompletionMode("binary")}
    style={[
      styles.pill,
      subtaskCompletionMode === "binary" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Binary</Text>
  </Pressable>

  <Pressable
    onPress={() => setSubtaskCompletionMode("count")}
    style={[
      styles.pill,
      subtaskCompletionMode === "count" && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Count</Text>
  </Pressable>
</View>

{subtaskCompletionMode === "count" && (
  <View style={{ marginTop: 8 }}>
    <Text style={styles.label}>Target count</Text>
    <TextInput
      value={subtaskTargetCountInput}
      onChangeText={setSubtaskTargetCountInput}
      placeholder="e.g. 3"
      keyboardType="numeric"
      style={styles.input}
    />
  </View>
)}

<Text style={styles.helperText}>
  {subtaskCompletionMode === "count"
    ? "Each tap adds 1. The subtask is complete once the target count is reached."
    : "One tap marks this subtask complete for the day."}
</Text>
</View>
<View style={styles.formSection}>
  <Text style={styles.formSectionTitle}>Timing & reminders</Text>

  {/* Due date */}
  <Text style={[styles.label, { marginTop: 4 }]}>
  {subtaskScheduleType === "oneTime" ? "Scheduled date" : "Due date"}
</Text>

<View style={styles.clearableInputRow}>
{Platform.OS === "ios" ? (
  <TextInput
    value={subtaskDueDate}
    onChangeText={setSubtaskDueDate}
    placeholder={
      subtaskScheduleType === "oneTime"
        ? "YYYY-MM-DD scheduled date"
        : "YYYY-MM-DD due date (optional)"
    }
    placeholderTextColor={theme.colors.textMuted}
    keyboardType="numbers-and-punctuation"
    autoCorrect={false}
    autoCapitalize="none"
    style={[styles.input, styles.clearableInputMain]}
  />
) : (
  <Pressable
    onPress={() => setShowDatePicker(true)}
    style={[styles.input, styles.clearableInputMain]}
  >
    <Text>
      {subtaskDueDate
        ? `📅 ${formatDayKeyForDisplay(subtaskDueDate)}`
        : subtaskScheduleType === "oneTime"
        ? "Select scheduled date"
        : "Select due date (optional)"}
    </Text>
  </Pressable>
)}

  {subtaskDueDate ? (
    <Pressable
      style={styles.clearInputButton}
      onPress={() => {
        setSubtaskDueDate("");
        setSubtaskDueTime("");
      }}
    >
      <Text style={styles.clearInputButtonText}>Clear</Text>
    </Pressable>
  ) : null}
</View>
<Text style={[styles.label, { marginTop: 10 }]}>Time (optional)</Text>

<View style={styles.clearableInputRow}>
{Platform.OS === "ios" ? (
  <TextInput
    value={subtaskDueTime}
    onChangeText={setSubtaskDueTime}
    placeholder="HH:mm (optional)"
    placeholderTextColor={theme.colors.textMuted}
    keyboardType="numbers-and-punctuation"
    autoCorrect={false}
    autoCapitalize="none"
    style={[styles.input, styles.clearableInputMain]}
  />
) : (
  <Pressable
    onPress={() => {
      if (!subtaskDueDate) {
        Alert.alert("Select date first", "Please pick a date before setting time.");
        return;
      }
      setShowTimePicker(true);
    }}
    style={[styles.input, styles.clearableInputMain]}
  >
    <Text>
      {subtaskDueTime
        ? `⏰ ${subtaskDueTime}`
        : "Select time (optional)"}
    </Text>
  </Pressable>
)}

  {subtaskDueTime ? (
    <Pressable
      style={styles.clearInputButton}
      onPress={() => setSubtaskDueTime("")}
    >
      <Text style={styles.clearInputButtonText}>Clear</Text>
    </Pressable>
  ) : null}
</View>

<Text style={styles.helperText}>
  Reminders are scheduled locally on this device and automatically stay in sync when tasks are edited, completed, or deleted.
</Text>

<Text style={[styles.label, { marginTop: 10 }]}>Notifications</Text>

<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  <Pressable
    onPress={() => setSubtaskNotificationsEnabled(false)}
    style={[
      styles.pill,
      !subtaskNotificationsEnabled && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>Off</Text>
  </Pressable>

  <Pressable
    onPress={() => setSubtaskNotificationsEnabled(true)}
    style={[
      styles.pill,
      subtaskNotificationsEnabled && styles.pillActive,
    ]}
  >
    <Text style={styles.pillText}>On</Text>
  </Pressable>
</View>

{subtaskNotificationsEnabled && (
  <>
    <Text style={[styles.label, { marginTop: 10 }]}>Reminder timing</Text>

    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      {([0, 10, 30, 60] as const).map((minutes) => (
        <Pressable
          key={minutes}
          onPress={() => setSubtaskReminderOffsetMinutes(minutes)}
          style={[
            styles.pill,
            subtaskReminderOffsetMinutes === minutes && styles.pillActive,
          ]}
        >
          <Text style={styles.pillText}>
            {minutes === 0 ? "At time" : `${minutes} min before`}
          </Text>
        </Pressable>
      ))}
    </View>

    <Text style={styles.helperText}>
      Notifications require a scheduled date and time.
    </Text>
  </>
)}

<Text style={[styles.label, { marginTop: 10 }]}>Reminder model</Text>
<Text style={styles.helperText}>
  This saves the new reminder setting. Notification scheduling will switch to this next.
</Text>

<View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
  {(["none", "at_time", "morning_of", "day_before", "custom"] as SubtaskReminderPreset[]).map(
    (preset) => (
      <Pressable
        key={preset}
        onPress={() => setSubtaskReminderPreset(preset)}
        style={[
          styles.pill,
          subtaskReminderPreset === preset && styles.pillActive,
        ]}
      >
        <Text style={styles.pillText}>
          {formatReminderPresetLabel(preset)}
        </Text>
      </Pressable>
    )
  )}
</View>

{subtaskReminderPreset === "custom" && (
  <TextInput
    value={subtaskReminderCustomOffsetInput}
    onChangeText={setSubtaskReminderCustomOffsetInput}
    placeholder="Minutes before task time"
    keyboardType="number-pad"
    style={styles.input}
  />
)}
</View>
{canEdit ? (
  <Pressable
    style={[styles.button, creatingSubtask && styles.buttonDisabled]}
    onPress={createSubtask}
    disabled={creatingSubtask}
  >
    <Text style={styles.buttonText}>
      {creatingSubtask ? "Adding..." : "Add subtask"}
    </Text>
  </Pressable>
) : null}
  </>
) : null}
{isSharedGoalViewer ? (
  <Text style={styles.sharedSubtaskHint}>
    You can complete subtasks assigned to you. Editing stays owner-only.
  </Text>
) : null}
{todaysVisibleSubtasks.length > 0 && (
  <View style={{ marginTop: 12 }}>
    <Text style={[styles.cardTitle, { marginBottom: 6 }]}>Today</Text>

    {todaysInProgressSubtasks.length > 0 && (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.subsectionLabel}>In progress</Text>
        {todaysInProgressSubtasks.map((s) => (
          <SubtaskRow key={`today-progress-${s.id}`} s={s} />
        ))}
      </View>
    )}

    {todaysNotStartedSubtasks.length > 0 && (
      <View>
        <Text style={styles.subsectionLabel}>Up next</Text>
        {todaysNotStartedSubtasks.map((s) => (
          <SubtaskRow key={`today-next-${s.id}`} s={s} />
        ))}
      </View>
    )}
  </View>
)}

{otherSubtasks.map((s) => (
  <SubtaskRow key={s.id} s={s} />
))}

{completedSubtasks.length > 0 && (
  <View style={styles.completedSubtasksSection}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Completed subtasks, ${completedSubtasks.length}, ${
        showCompletedSubtasks ? "expanded" : "collapsed"
      }`}
      accessibilityState={{ expanded: showCompletedSubtasks }}
      onPress={() => setShowCompletedSubtasks((current) => !current)}
      style={styles.completedSubtasksHeader}
    >
      <Text style={styles.completedSubtasksTitle}>
        Completed subtasks ({completedSubtasks.length})
      </Text>
      <Text style={styles.completedSubtasksChevron} aria-hidden>
        {showCompletedSubtasks ? "▼" : "▶"}
      </Text>
    </Pressable>

    {showCompletedSubtasks &&
      completedSubtasks.map((s) => (
        <SubtaskRow key={`completed-${s.id}`} s={s} />
      ))}
  </View>
)}

 {subtasks.length === 0 && (
  <Text style={styles.muted}>No subtasks yet.</Text>
)}
      </View>

<Modal
  visible={!!editingMilestone}
  transparent
  animationType="fade"
  onRequestClose={() => setEditingMilestone(null)}
>
  <Pressable style={styles.modalBackdrop} onPress={() => setEditingMilestone(null)}>
    <Pressable style={styles.modalCard} onPress={() => {}}>
      <Text style={styles.modalTitle}>Edit milestone</Text>

      <Text style={[styles.label, { marginTop: 12 }]}>Title *</Text>
      <TextInput
        value={editMilestoneTitleInput}
        onChangeText={setEditMilestoneTitleInput}
        placeholder="Milestone title"
        style={styles.input}
      />

      <Text style={[styles.label, { marginTop: 8 }]}>Description</Text>
      <TextInput
        value={editMilestoneDescriptionInput}
        onChangeText={setEditMilestoneDescriptionInput}
        placeholder="Optional notes"
        style={styles.input}
        multiline
      />
      <CommentMediaCandidateTray
        disabled={postingGoalDiscussionComment}
        items={goalCommentMedia}
        onRemove={(attachmentId) =>
          setGoalCommentMedia((current) =>
            current.filter((item) => item.id !== attachmentId)
          )
        }
        theme={theme}
      />
      {goalCommentMedia.length <
      getMediaAttachmentPolicy("shared_goal_comment").maxAttachments ? (
        <Pressable
          accessibilityLabel="Add media to shared goal comment"
          accessibilityRole="button"
          disabled={postingGoalDiscussionComment}
          onPress={handlePickGoalCommentMedia}
          style={styles.goalDiscussionButton}
        >
          <Text style={styles.goalDiscussionButtonText}>Add media</Text>
        </Pressable>
      ) : null}
      {goalCommentUploadStatus ? (
        <View style={styles.goalDiscussionUploadRow}>
          <Text style={styles.muted}>{goalCommentUploadStatus}</Text>
          {postingGoalDiscussionComment && goalCommentMedia.length > 0 ? (
            <Pressable
              onPress={cancelGoalCommentUpload}
              style={styles.goalDiscussionButton}
            >
              <Text style={styles.goalDiscussionButtonText}>
                Cancel {Math.round(goalCommentUploadProgress * 100)}%
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.label, { marginTop: 8 }]}>Due date optional</Text>
      <TextInput
        value={editMilestoneDueDateInput}
        onChangeText={setEditMilestoneDueDateInput}
        placeholder="YYYY-MM-DD, optional"
        style={styles.input}
        autoCapitalize="none"
      />
      <Text style={styles.helperText}>
        Use format YYYY-MM-DD, for example 2026-07-15.
      </Text>

      <View style={styles.modalRow}>
        <Pressable
          style={[styles.modalBtn, styles.modalCancel]}
          onPress={() => setEditingMilestone(null)}
          disabled={savingMilestone}
        >
          <Text style={styles.modalBtnText}>Cancel</Text>
        </Pressable>

        <Pressable
          style={[
            styles.modalBtn,
            styles.modalPrimary,
            savingMilestone && styles.buttonDisabled,
          ]}
          onPress={saveEditedMilestone}
          disabled={savingMilestone}
        >
          <Text style={[styles.modalBtnText, styles.modalPrimaryText]}>
            {savingMilestone ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  </Pressable>
</Modal>

{showDatePicker && (
  <DateTimePicker
    value={new Date()}
    mode="date"
    display={Platform.OS === "ios" ? "spinner" : "default"}
    onChange={handleDatePicked}
  />
)}

{showTimePicker && (
  <DateTimePicker
    value={new Date()}
    mode="time"
    display={Platform.OS === "ios" ? "spinner" : "default"}
    onChange={handleTimePicked}
  />
)}

{showEditDatePicker && (
  <DateTimePicker
    value={new Date()}
    mode="date"
    display={Platform.OS === "ios" ? "spinner" : "default"}
    onChange={handleEditDatePicked}
  />
)}

{showEditTimePicker && (
  <DateTimePicker
    value={new Date()}
    mode="time"
    display={Platform.OS === "ios" ? "spinner" : "default"}
    onChange={handleEditTimePicked}
  />
)}

    </ScrollView>
  </KeyboardAvoidingView>
  
);

}

const makeStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
  container: {
  padding: 16,
  gap: 14,
  backgroundColor: theme.colors.background,
},
  center: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  backgroundColor: theme.colors.background,
},
goalHeroCard: {
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 22,
  padding: 18,
  gap: 16,

  shadowColor: "#000",
  shadowOpacity: 0.04,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
},

goalHeroTopRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 14,
},

goalHeroTextWrap: {
  flex: 1,
},

goalHeroTitle: {
  fontSize: 30,
  lineHeight: 34,
  fontWeight: "900",
  color: theme.colors.text,
},

goalHeroDescription: {
  marginTop: 6,
  fontSize: 14,
  lineHeight: 21,
  color: theme.colors.textMuted,
  fontWeight: "600",
},

goalHeroStatusBadge: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
},

goalHeroStatusBadgeCompleted: {
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
},

goalHeroStatusBadgeText: {
  fontSize: 11,
  fontWeight: "900",
  textTransform: "capitalize",
  color: theme.colors.primary,
},

goalHeroStatusBadgeCompletedText: {
  color: theme.colors.successText,
},

goalHeroStatsRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
},

goalHeroStatCard: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
},

goalHeroStatValue: {
  fontSize: 22,
  lineHeight: 26,
  fontWeight: "900",
  color: theme.colors.text,
},

goalHeroStatLabel: {
  fontSize: 11,
  fontWeight: "800",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: theme.colors.textMuted,
},

goalHeroStatDivider: {
  width: 1,
  alignSelf: "stretch",
  backgroundColor: theme.colors.border,
  opacity: 0.7,
},
title: {
  fontSize: 24,
  fontWeight: "900",
  marginBottom: 2,
  color: theme.colors.text,
},
 desc: {
  color: theme.colors.textMuted,
},
 muted: {
  color: theme.colors.textMuted,
  marginTop: 8,
  textAlign: "center",
},

 card: {
  marginTop: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 14,
  padding: 14,
  gap: 4,
  backgroundColor: theme.colors.surface,
},

utilityCard: {
  marginTop: 6,
  borderRadius: 14,
  padding: 14,
  gap: 4,

  backgroundColor: theme.colors.surfaceMuted,

  borderWidth: 0,
},

softCard: {
  marginTop: 6,
  borderRadius: 14,
  padding: 14,
  gap: 4,

  backgroundColor: theme.colors.surfaceMuted,

  borderWidth: 1,
  borderColor: theme.colors.border,
  opacity: 0.96,
},

collapsibleSectionHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  paddingVertical: 2,
},

collapsibleSectionTextWrap: {
  flex: 1,
},

collapsibleSectionSubtitle: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: "700",
  color: theme.colors.textMuted,
  lineHeight: 16,
},

collapsibleSectionToggle: {
  minHeight: 36,
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: 18,
  overflow: "hidden",
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
  cardTitle: {
  fontSize: 16,
  fontWeight: "700",
  color: theme.colors.text,
},
 label: {
  fontSize: 12,
  color: theme.colors.textMuted,
},
  value: {
  fontSize: 14,
  color: theme.colors.text,
  fontWeight: "600",
},

 input: {
  marginTop: 6,
  backgroundColor: theme.colors.inputBackground,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: theme.colors.text,
},

  
goalProgressCard: {
  gap: 10,
  marginTop: 10,

  borderWidth: 1.5,
  borderColor: theme.colors.border,
},

goalProgressHeaderRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
},

goalProgressHeaderTextWrap: {
  flex: 1,
},

goalProgressSubtitle: {
  marginTop: 2,
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
  fontWeight: "700",
},

goalStatusBadge: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
},

goalStatusBadgeCompleted: {
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
},

goalStatusBadgeText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.primary,
  textTransform: "capitalize",
},

goalStatusBadgeCompletedText: {
  color: theme.colors.successText,
},

goalProgressPercentRow: {
  flexDirection: "row",
  alignItems: "baseline",
  gap: 6,
},

goalProgressPercentText: {
  fontSize: 28,
  fontWeight: "900",
  color: theme.colors.text,
},

goalProgressPercentLabel: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.textMuted,
},

progressRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginTop: 0,
},

progressTrack: {
  flex: 1,
  height: 10,
  backgroundColor: theme.colors.surfaceMuted,
  borderRadius: 999,
  overflow: "hidden",
},

progressFill: {
  height: "100%",
  backgroundColor: theme.colors.primary,
},

progressText: {
  width: 48,
  textAlign: "right",
  fontWeight: "700",
  color: theme.colors.text,
},

progressInputLabel: {
  marginTop: 8,
  fontSize: 12,
  color: theme.colors.textMuted,
  fontWeight: "800",
},
button: {
  minHeight: 44,
  backgroundColor: theme.colors.primary,
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  marginTop: 12,
  borderWidth: 1,
  borderColor: theme.colors.primaryStrong,
},

secondary: {
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
},

buttonDisabled: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  opacity: 1,
},

buttonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 14,
},

secondaryButtonText: {
  color: theme.colors.secondaryText,
},

buttonDisabledText: {
  color: theme.colors.textMuted,
},
pill: {
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
},

pillActive: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

pillDisabled: {
  opacity: 0.45,
},

pillText: {
  fontSize: 12,
  fontWeight: "700",
  color: theme.colors.text,
},
milestoneList: {
  marginTop: 10,
  gap: 10,
},

milestoneRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  padding: 12,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

milestoneTitle: {
  fontSize: 15,
  lineHeight: 20,
  fontWeight: "900",
  color: theme.colors.text,
},

milestoneMeta: {
  marginTop: 7,
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
  fontWeight: "700",
},

milestoneDescription: {
  marginTop: 5,
  fontSize: 13,
  lineHeight: 18,
  color: theme.colors.textMuted,
},

milestoneBadge: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

milestoneBadgeText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.badgeText,
},

milestoneProgressTrack: {
  marginTop: 10,
  height: 9,
  borderRadius: 999,
  overflow: "hidden",
  backgroundColor: theme.colors.surfaceMuted,
},

milestoneProgressFill: {
  height: "100%",
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

milestoneProgressText: {
  marginTop: 10,
},

milestoneActionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 10,
},

milestoneActionButton: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

milestoneActionButtonText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.primary,
},

milestoneAddButton: {
  marginTop: 12,
  minHeight: 38,
  paddingHorizontal: 12,
  paddingVertical: 9,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

milestoneAddButtonText: {
  fontSize: 13,
  fontWeight: "900",
  color: theme.colors.badgeText,
},

milestoneForm: {
  marginTop: 12,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

milestoneFormActions: {
  flexDirection: "row",
  gap: 10,
  marginTop: 12,
},
subtaskCompleted: {
  opacity: 0.6,
},

subtaskTitleRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 8,
},

subtaskStatusMark: {
  width: 18,
  marginTop: 1,
  fontSize: 15,
  fontWeight: "900",
  color: theme.colors.text,
  textAlign: "center",
},

subtaskText: {
  flex: 1,
  fontSize: 16,
  lineHeight: 21,
  fontWeight: "800",
  color: theme.colors.text,
},

subtaskRowContainer: {
  marginTop: 10,
  padding: 12,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
  flexDirection: "row",
  gap: 12,
},

subtaskRowLeft: {
  flex: 1,
  minWidth: 0,
},

subtaskDescription: {
  marginTop: 5,
  fontSize: 13,
  lineHeight: 18,
  color: theme.colors.textMuted,
},

subtaskMeta: {
  marginTop: 7,
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
  fontWeight: "600",
},

subtaskActionsColumn: {
  justifyContent: "flex-start",
  alignItems: "flex-end",
  gap: 8,
  paddingTop: 2,
},

subtaskActionBtn: {
  minHeight: 36,
  minWidth: 74,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
},

subtaskCompleteBtn: {
  backgroundColor: theme.colors.primary,
  borderWidth: 1,
  borderColor: theme.colors.primaryStrong,
},

subtaskCompleteBtnDone: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
},

subtaskCompleteBtnText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

subtaskCompleteBtnDoneText: {
  color: theme.colors.textMuted,
},

subtaskActionBtnDisabled: {
  opacity: 0.5,
},

subtaskHistoryButton: {
  minHeight: 36,
  maxWidth: 118,
  paddingHorizontal: 10,
  paddingVertical: 7,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 18,
  borderWidth: 1,
  borderColor: theme.colors.secondaryBorder,
  backgroundColor: theme.colors.secondaryBackground,
},

subtaskHistoryButtonText: {
  color: theme.colors.secondaryText,
  fontSize: 11,
  lineHeight: 15,
  fontWeight: "900",
  textAlign: "center",
},

trashBtn: {
  minHeight: 30,
  paddingHorizontal: 10,
  paddingVertical: 6,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 18,
  borderWidth: 1,
  borderColor: theme.colors.dangerBorder,
  backgroundColor: theme.colors.dangerBackground,
},

trashIcon: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.dangerText,
},



createRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
createRowNarrow: { alignItems: "stretch" },

titleInput: { flex: 1, minWidth: 180 },
metricInput: { width: 140 },

fullWidth: { width: "100%" },
addBtn: { marginTop: 6, paddingVertical: 12, paddingHorizontal: 16 },
fullWidthBtn: { width: "100%" },




modalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
},

modalCard: {
  width: "100%",
  maxWidth: 520,
  maxHeight: "88%",
  borderRadius: 18,
  padding: 16,
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

modalScrollContent: {
  paddingBottom: 12,
},

modalTitle: {
  fontSize: 18,
  fontWeight: "800",
  color: theme.colors.text,
},

progressHistoryModalCard: {
  width: "100%",
  maxWidth: 620,
  height: "88%",
  overflow: "hidden",
  borderRadius: 18,
  backgroundColor: theme.colors.background,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

progressHistoryHeader: {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 12,
  padding: 16,
  borderBottomWidth: 1,
  borderBottomColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

progressHistoryHeaderText: {
  flex: 1,
  minWidth: 0,
},

progressHistorySubtaskTitle: {
  marginTop: 3,
  color: theme.colors.textMuted,
  fontSize: 13,
  lineHeight: 19,
  fontWeight: "700",
},

progressHistoryCloseButton: {
  minHeight: 40,
  paddingHorizontal: 12,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 20,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

progressHistoryCloseText: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},

progressHistoryList: {
  flexGrow: 1,
  gap: 12,
  padding: 14,
},

progressHistoryState: {
  flex: 1,
  minHeight: 220,
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 24,
},

progressHistoryStateTitle: {
  color: theme.colors.text,
  fontSize: 15,
  lineHeight: 21,
  fontWeight: "900",
  textAlign: "center",
},

progressHistoryStateBody: {
  color: theme.colors.textMuted,
  fontSize: 13,
  lineHeight: 19,
  textAlign: "center",
},

progressHistoryRetryButton: {
  minHeight: 42,
  paddingHorizontal: 16,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 21,
  backgroundColor: theme.colors.primary,
},

progressHistoryRetryText: {
  color: theme.colors.primaryText,
  fontSize: 13,
  fontWeight: "900",
},

progressHistoryFooter: {
  minHeight: 64,
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
},

progressHistoryLoadButton: {
  minHeight: 42,
  paddingHorizontal: 16,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 21,
  borderWidth: 1,
  borderColor: theme.colors.secondaryBorder,
  backgroundColor: theme.colors.secondaryBackground,
},

progressHistoryLoadText: {
  color: theme.colors.secondaryText,
  fontSize: 13,
  fontWeight: "900",
},

modalText: {
  marginTop: 8,
  fontSize: 14,
  lineHeight: 20,
  color: theme.colors.textMuted,
},

progressModalKeyboardView: {
  width: "100%",
  maxWidth: 520,
  maxHeight: "100%",
  alignItems: "center",
},

progressPreviewCard: {
  marginTop: 12,
  padding: 12,
  gap: 3,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

progressPreviewLabel: {
  fontSize: 11,
  lineHeight: 16,
  fontWeight: "800",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
},

progressPreviewValue: {
  fontSize: 20,
  lineHeight: 26,
  fontWeight: "900",
  color: theme.colors.text,
},

progressPreviewHint: {
  fontSize: 12,
  lineHeight: 18,
  fontWeight: "600",
  color: theme.colors.textMuted,
},

progressPreviewComplete: {
  fontSize: 12,
  lineHeight: 18,
  fontWeight: "900",
  color: theme.colors.successText,
},

progressValidationText: {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
  color: theme.colors.dangerText,
},

progressUndoText: {
  marginTop: 12,
  fontSize: 13,
  lineHeight: 20,
  fontWeight: "600",
  color: theme.colors.text,
},

progressNoteHeader: {
  marginTop: 14,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 6,
},

progressNoteCounter: {
  fontSize: 11,
  lineHeight: 16,
  color: theme.colors.textMuted,
},

progressNoteInput: {
  minHeight: 96,
  textAlignVertical: "top",
},

progressImagesSection: {
  marginTop: 14,
  gap: 10,
},

progressImagesHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 10,
},

progressImagesHeaderText: {
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 140,
},

progressImagesCount: {
  marginTop: 2,
  fontSize: 11,
  lineHeight: 16,
  color: theme.colors.textMuted,
},

progressImagesAddButton: {
  minHeight: 40,
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.primaryStrong,
  backgroundColor: theme.colors.primary,
  alignItems: "center",
  justifyContent: "center",
},

progressImagesAddButtonText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "900",
},

progressImagesHelper: {
  fontSize: 11,
  lineHeight: 16,
  color: theme.colors.textMuted,
},

progressImageGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 10,
},

progressImageTile: {
  width: "47%",
  minWidth: 120,
  flexGrow: 1,
  overflow: "hidden",
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

progressImageThumbnail: {
  width: "100%",
  aspectRatio: 1,
  backgroundColor: theme.colors.surfaceMuted,
},

progressVideoPlaceholder: {
  minHeight: 150,
  padding: 14,
  alignItems: "center",
  justifyContent: "center",
},

progressVideoPlaceholderBadge: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

progressVideoPlaceholderTitle: {
  marginTop: 8,
  color: theme.colors.text,
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "800",
  textAlign: "center",
},

progressVideoPlaceholderMeta: {
  marginTop: 4,
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
  textAlign: "center",
},

progressImageStatusOverlay: {
  ...StyleSheet.absoluteFillObject,
  bottom: 40,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.overlay,
},

progressImageStatusText: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 10,
  overflow: "hidden",
  color: "#FFFFFF",
  backgroundColor: theme.colors.overlay,
  fontSize: 12,
  fontWeight: "900",
},

progressImageErrorText: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 10,
  overflow: "hidden",
  color: theme.colors.dangerText,
  backgroundColor: theme.colors.dangerBackground,
  fontSize: 12,
  fontWeight: "900",
},

progressImageRemoveButton: {
  minHeight: 40,
  paddingHorizontal: 10,
  alignItems: "center",
  justifyContent: "center",
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

progressImageRemoveText: {
  color: theme.colors.dangerText,
  fontSize: 12,
  fontWeight: "900",
},

progressVideoLinkCard: {
  flexDirection: "row",
  overflow: "hidden",
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

progressVideoLinkThumbnail: {
  width: 112,
  minHeight: 92,
  backgroundColor: theme.colors.surfaceMuted,
},

progressVideoLinkBody: {
  flex: 1,
  minWidth: 0,
  padding: 10,
  justifyContent: "center",
},

progressVideoLinkProvider: {
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "900",
  color: theme.colors.text,
},

progressVideoLinkMeta: {
  marginTop: 2,
  fontSize: 11,
  lineHeight: 16,
  color: theme.colors.textMuted,
},

progressVideoLinkRemoveButton: {
  minHeight: 36,
  marginTop: 6,
  alignSelf: "flex-start",
  justifyContent: "center",
},

progressVideoLinkInputCard: {
  padding: 12,
  gap: 8,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

progressVideoLinkActions: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

progressVideoLinkActionButton: {
  flexGrow: 1,
  minWidth: 110,
  minHeight: 40,
  paddingHorizontal: 12,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 16,
},

progressVideoLinkAddButton: {
  minHeight: 40,
  paddingHorizontal: 12,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 16,
  borderWidth: 1,
  borderColor: theme.colors.secondaryBorder,
  backgroundColor: theme.colors.secondaryBackground,
},

progressVideoLinkAddButtonText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.secondaryText,
},

modalRow: {
  flexDirection: "row",
  gap: 10,
  marginTop: 16,
},

modalBtn: {
  flex: 1,
  minHeight: 44,
  paddingVertical: 11,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
},

modalCancel: {
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

modalPrimary: {
  backgroundColor: theme.colors.primary,
},

modalBtnText: {
  fontSize: 13,
  fontWeight: "800",
  color: theme.colors.text,
},

modalPrimaryText: {
  color: theme.colors.text,
},


rowWrapLocal: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
},
helperText: {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
},


formSection: {
  marginTop: 12,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

formSectionFirst: {
  marginTop: 8,
  paddingTop: 0,
  borderTopWidth: 0,
},

formSectionTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: theme.colors.text,
},

formSectionHint: {
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
  fontWeight: "600",
},

subsectionLabel: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.textMuted,
  marginTop: 6,
  marginBottom: 4,
  textTransform: "uppercase",
},

completedSubtasksSection: {
  marginTop: 12,
},

completedSubtasksHeader: {
  minHeight: 44,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: 10,
},

completedSubtasksTitle: {
  fontSize: 14,
  fontWeight: "800",
  color: theme.colors.textMuted,
},

completedSubtasksChevron: {
  fontSize: 12,
  color: theme.colors.textMuted,
},

subtaskProgressMeter: {
  marginTop: 10,
},

countActionHint: {
  marginTop: 4,
  fontSize: 12,
  color: theme.colors.textMuted,
},

historyErrorText: {
  color: theme.colors.danger,
  fontWeight: "800",
},

historySkippedText: {
  color: theme.colors.warning,
  fontWeight: "800",
},

sectionTitle: {
  fontSize: 16,
  fontWeight: "800",
  color: theme.colors.primary,
  marginTop: 8,
  marginBottom: 4,
},

notificationBadge: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
},

notificationBadgeText: {
  fontSize: 12,
  color: theme.colors.badgeText,
  fontWeight: "700",
},

notificationBadgeOff: {
  backgroundColor: theme.colors.surfaceMuted,
},

notificationBadgeExpired: {
  backgroundColor: theme.colors.surfaceMuted,
},

notificationBadgeOffText: {
  color: theme.colors.textMuted,
},

notificationBadgeExpiredText: {
  color: theme.colors.danger,
},
screen: {
  backgroundColor: theme.colors.background,
},
statusBadge: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
},

statusBadgeText: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.badgeText,
},

statusBadgeMuted: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
},

statusBadgeMutedText: {
  color: theme.colors.textMuted,
},
shareGroupButton: {
  padding: 12,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
  marginTop: 10,
},

shareGroupButtonShared: {
  opacity: 0.65,
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

shareGroupButtonText: {
  color: theme.colors.text,
  fontSize: 15,
  fontWeight: "800",
},

shareGroupButtonMeta: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 12,
  fontWeight: "700",
},
sharedReadOnlyBanner: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  borderRadius: 14,
  padding: 12,
  marginBottom: 12,
},

sharedReadOnlyTitle: {
  color: theme.colors.primary,
  fontSize: 14,
  fontWeight: "900",
},

sharedReadOnlyText: {
  color: theme.colors.textMuted,
  marginTop: 6,
  lineHeight: 18,
  fontSize: 13,
},

readOnlySubtaskRow: {
  opacity: 0.9,
},
sharedCompletionStatus: {
  color: theme.colors.textMuted,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: 999,
  alignSelf: "flex-start",
  paddingHorizontal: 8,
  paddingVertical: 4,
  marginTop: 8,
  fontSize: 12,
  fontWeight: "800",
},

sharedCompletionStatusDone: {
  color: theme.colors.success,
  borderColor: theme.colors.success,
  backgroundColor: theme.colors.badge,
},

sharedSubtaskHint: {
  color: theme.colors.textMuted,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: 12,
  padding: 10,
  marginTop: 12,
  lineHeight: 18,
  fontSize: 13,
},
goalDiscussionList: {
  gap: 10,
},

goalDiscussionComment: {
  padding: 10,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

goalDiscussionAuthor: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
  marginBottom: 4,
},

goalDiscussionBody: {
  color: theme.colors.text,
  fontSize: 14,
  lineHeight: 19,
},

goalDiscussionMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  marginTop: 6,
},
goalDiscussionComposer: {
  marginTop: 12,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},
goalDiscussionUploadRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
},

goalDiscussionInput: {
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

goalDiscussionButton: {
  alignSelf: "flex-end",
  backgroundColor: theme.colors.primary,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

goalDiscussionButtonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 13,
},
commentLengthText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  alignSelf: "flex-end",
},
subtaskAssigneePill: {
  alignSelf: "flex-start",
  marginTop: 8,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

subtaskAssigneePillEmpty: {
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
},

subtaskAssigneePillText: {
  color: theme.colors.primary,
  fontSize: 11,
  fontWeight: "900",
},

subtaskAssigneePillTextEmpty: {
  color: theme.colors.secondaryText,
},

subtaskCardAssignedToMe: {
  borderColor: theme.colors.primary,
  borderWidth: 1.5,
},

assignedToMeBadge: {
  alignSelf: "flex-start",
  marginBottom: 4,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

assignedToMeBadgeText: {
  color: theme.colors.primaryText,
  fontSize: 10,
  fontWeight: "900",
},

reassignTaskButton: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
  borderWidth: 1,
},

reassignTaskButtonText: {
  color: theme.colors.secondaryText,
  fontSize: 11,
  fontWeight: "900",
},
assignedToMeList: {
  marginTop: 10,
  gap: 10,
},
subtaskCardHighlighted: {
  borderWidth: 2,
  borderColor: theme.colors.warning,
},

subtaskHighlightHint: {
  color: theme.colors.warning,
  fontSize: 11,
  fontWeight: "900",
  marginTop: 6,
},
goalPresenceCard: {
  padding: 14,
  borderRadius: 16,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  marginTop: 12,
  marginBottom: 14,
},

goalPresenceTitle: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
  marginBottom: 8,
},

goalPresenceRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingVertical: 5,
},

goalPresenceAvatar: {
  width: 28,
  height: 28,
  borderRadius: 14,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

goalPresenceAvatarText: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},

goalPresenceText: {
  flex: 1,
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "800",
},

goalPresenceOnlineDot: {
  width: 8,
  height: 8,
  borderRadius: 4,
  backgroundColor: theme.colors.success,
},

goalPresenceMoreText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 6,
},
goalDiscussionTypingText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 8,
  marginBottom: 4,
},
commentReactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
},

commentReactionChip: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

commentReactionText: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},
commentQuickReactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
},

commentQuickReactionButton: {
  width: 34,
  height: 30,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

commentQuickReactionButtonActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

commentQuickReactionText: {
  fontSize: 16,
},
completionCelebrationBanner: {
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  marginTop: 12,
  marginBottom: 12,
},

completionCelebrationText: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
  lineHeight: 18,
},
clearableInputRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

clearableInputMain: {
  flex: 1,
},

clearInputButton: {
  minHeight: 42,
  paddingHorizontal: 12,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.secondaryBackground,
  borderWidth: 1,
  borderColor: theme.colors.secondaryBorder,
  marginTop: 6,
},

clearInputButtonText: {
  color: theme.colors.secondaryText,
  fontSize: 12,
  fontWeight: "900",
},
sharedSourceGroupText: {
  marginTop: 4,
  fontSize: 13,
  fontWeight: "800",
  color: theme.colors.primary,
},
goalHeroTitleRow: {
  flexDirection: "row",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
},
sharedGoalBadge: {
  alignSelf: "flex-start",
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: UI_SIZES.radius.xl,
  overflow: "hidden",
},
sharedGoalInfoCard: {
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: UI_SIZES.radius.lg,
  padding: 14,
  gap: 8,
},

sharedGoalInfoKicker: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.primary,
  textTransform: "uppercase",
  letterSpacing: 0.6,
},

sharedGoalInfoTitle: {
  fontSize: 15,
  fontWeight: "900",
  color: theme.colors.text,
},

sharedGoalInfoRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  gap: 12,
},

sharedGoalInfoLabel: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.textMuted,
},

sharedGoalInfoValue: {
  flex: 1,
  textAlign: "right",
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.text,
},

sharedGoalInfoHelper: {
  marginTop: 2,
  fontSize: 12,
  lineHeight: 17,
  color: theme.colors.textMuted,
},
assignmentCandidateList: {
  gap: 8,
  marginTop: 10,
},

assignmentCandidateButton: {
  padding: 12,
  borderRadius: UI_SIZES.radius.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

assignmentCandidateButtonSelected: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

assignmentCandidateName: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "900",
},

assignmentCandidateMeta: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 2,
},
assignedSharedCalendarCard: {
  marginTop: 10,
  padding: 10,
  borderRadius: UI_SIZES.radius.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

assignedSharedCalendarKicker: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
},

assignedSharedCalendarButton: {
  minHeight: UI_SIZES.buttonHeight.sm,
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

assignedSharedCalendarButtonDisabled: {
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

assignedSharedCalendarButtonText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.primary,
},

assignedSharedCalendarButtonTextDisabled: {
  color: theme.colors.textMuted,
},

assignedSharedCalendarHelper: {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 16,
  color: theme.colors.textMuted,
},
assignedSharedCalendarRemoveButton: {
  marginTop: 8,
  minHeight: UI_SIZES.buttonHeight.sm,
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

assignedSharedCalendarRemoveButtonText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.textMuted,
},
assignedSharedCalendarStatus: {
  fontSize: 12,
  fontWeight: "700",
  marginTop: 8,
},
assignmentOverviewCard: {
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: UI_SIZES.radius.lg,
  padding: UI_SIZES.cardPadding.md,
  gap: 10,
},

assignmentOverviewRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

assignmentOverviewTextWrap: {
  flex: 1,
},

assignmentOverviewTitle: {
  fontSize: 14,
  fontWeight: "900",
  color: theme.colors.text,
},

assignmentOverviewMeta: {
  marginTop: 3,
  fontSize: 12,
  color: theme.colors.textMuted,
},

assignmentOverviewStatus: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.warningText,
  backgroundColor: theme.colors.warningBackground,
  borderColor: theme.colors.warningBorder,
  borderWidth: 1,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: UI_SIZES.radius.xl,
  overflow: "hidden",
},

assignmentOverviewStatusDone: {
  color: theme.colors.successText,
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
},
assignmentOverviewSummaryRow: {
  flexDirection: "row",
  gap: 8,
},

assignmentOverviewSummaryPill: {
  flex: 1,
  padding: 10,
  borderRadius: UI_SIZES.radius.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

assignmentOverviewSummaryValue: {
  fontSize: 18,
  fontWeight: "900",
  color: theme.colors.text,
},

assignmentOverviewSummaryLabel: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "800",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
},

assignmentOverviewSectionLabel: {
  marginTop: 8,
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},

assignmentOverviewEmptyCard: {
  padding: 12,
  borderRadius: UI_SIZES.radius.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

assignmentOverviewEmptyTitle: {
  fontSize: 14,
  fontWeight: "900",
  color: theme.colors.text,
},

assignmentOverviewEmptyText: {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 16,
  color: theme.colors.textMuted,
},
assignmentOverviewMemberRollupCard: {
  marginTop: 4,
  padding: 10,
  borderRadius: UI_SIZES.radius.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
  gap: 8,
},

assignmentOverviewMemberRollupRow: {
  gap: 2,
},

assignmentOverviewMemberName: {
  fontSize: 13,
  fontWeight: "900",
  color: theme.colors.text,
},

assignmentOverviewMemberMeta: {
  fontSize: 12,
  color: theme.colors.textMuted,
},
assignmentOverviewAttentionLabel: {
  marginTop: 8,
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.warningText,
  textTransform: "uppercase",
},

assignmentAttentionRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

assignmentAttentionReason: {
  marginTop: 4,
  fontSize: 12,
  fontWeight: "700",
  color: theme.colors.warningText,
},

assignmentAttentionBadge: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: UI_SIZES.radius.xl,
  backgroundColor: theme.colors.warningBackground,
  borderWidth: 1,
  borderColor: theme.colors.warningBorder,
},

assignmentAttentionBadgeText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.warningText,
},
assignmentOverviewExpandText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.primary,
},

assignmentOverviewMemberDetailList: {
  marginTop: 8,
  gap: 8,
},

assignmentOverviewMemberDetailRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  paddingTop: 8,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},
assignmentOverviewDetailActions: {
  alignItems: "flex-end",
  gap: 6,
},

assignmentOverviewReassignButton: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

assignmentOverviewReassignText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.primary,
},
assignmentOverviewUnassignButton: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.dangerBorder,
  backgroundColor: theme.colors.dangerBackground,
},

assignmentOverviewUnassignText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.dangerText,
},
assignmentOverviewHistoryPreview: {
  marginTop: 3,
  fontSize: 12,
  fontWeight: "700",
  color: theme.colors.primary,
},
assignmentOverviewViewButton: {
  paddingHorizontal: 8,
  paddingVertical: 5,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

assignmentOverviewViewText: {
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.text,
},
assignmentOverviewFilterRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

assignmentOverviewFilterChip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: UI_SIZES.radius.xl,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
},

assignmentOverviewFilterChipActive: {
  borderColor: theme.colors.primary,
  backgroundColor: theme.colors.badge,
},

assignmentOverviewFilterChipText: {
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.textMuted,
  textTransform: "capitalize",
},

assignmentOverviewFilterChipTextActive: {
  color: theme.colors.badgeText,
},
mentionPicker: {
  marginTop: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 12,
  backgroundColor: theme.colors.surface,
  overflow: "hidden",
},

mentionPickerItem: {
  paddingHorizontal: 12,
  paddingVertical: 10,
},

mentionPickerName: {
  color: theme.colors.text,
  fontSize: 14,
  fontWeight: "600",
},
pickerOverlay: {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  backgroundColor: "rgba(0,0,0,0.35)",
},

pickerSheet: {
  width: "90%",
  maxWidth: 420,
  padding: 16,
  borderRadius: 18,
  backgroundColor: "#FFFFFF",
},
});
