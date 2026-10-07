import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { auth } from "../../../../services/firebase";
import {
  canUseGroupHereMention,
  createGroupTaskComment,
  DEFAULT_GROUP_NOTIFICATION_PREFERENCES,
  setGroupTaskNotificationsMuted,
  subscribeGroupMembers,
  subscribeGroupNotificationPreferences,
  subscribeGroupTask,
  subscribeGroupTaskComments,
  updateGroupTaskPlanning,
  type GroupMemberDoc,
  type GroupNotificationPreferences,
  type GroupTaskCommentDoc,
  type GroupTaskDoc,
  type GroupTaskPriority
} from "../../../../services/groups";
import { useAppTheme } from "../../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

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

function getActiveMentionQuery(text: string): string | null {
  const match = text.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);

  return match ? match[2].toLowerCase() : null;
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

export default function GroupTaskDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    taskId?: string;
  }>();

  const groupId = typeof params.id === "string" ? params.id : "";
  const taskId = typeof params.taskId === "string" ? params.taskId : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [task, setTask] = useState<GroupTaskDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savingPlanning, setSavingPlanning] = useState(false);

  const [taskComments, setTaskComments] = useState<GroupTaskCommentDoc[]>([]);
const [commentInput, setCommentInput] = useState("");
const [postingComment, setPostingComment] = useState(false);

const [notificationPreferences, setNotificationPreferences] =
  useState<GroupNotificationPreferences>(
    DEFAULT_GROUP_NOTIFICATION_PREFERENCES
  );

const [updatingTaskMute, setUpdatingTaskMute] = useState(false);

const [mentionMembers, setMentionMembers] = useState<GroupMemberDoc[]>([]);

const currentMemberRole = useMemo(() => {
  const currentUid = auth.currentUser?.uid;
  return mentionMembers.find((member) => member.uid === currentUid)?.role ?? null;
}, [mentionMembers]);

const canUseHereMention = canUseGroupHereMention(currentMemberRole);

  const getDueAtMsForPreset = (
  preset: "clear" | "today" | "tomorrow" | "week"
) => {
  if (preset === "clear") return null;

  const now = new Date();

  if (preset === "today") {
    const due = new Date(now);
    due.setHours(20, 0, 0, 0);
    return due.getTime();
  }

  if (preset === "tomorrow") {
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

const isTaskMuted = notificationPreferences.mutedTaskIds.includes(taskId);

const handleSetPriority = async (priority: GroupTaskPriority | null) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !task) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setSavingPlanning(true);

    await updateGroupTaskPlanning({
      groupId,
      taskId: task.id,
      updatedByUid: currentUser.uid,
      updatedByName: currentUser.displayName ?? currentUser.email ?? null,
      updatedByEmail: currentUser.email ?? null,
      priority,
      dueAtMs: task.dueAtMs ?? null,
    });
  } catch (e: any) {
    Alert.alert("Update failed", e?.message ?? "Unknown error");
  } finally {
    setSavingPlanning(false);
  }
};

const handleSetDuePreset = async (
  preset: "clear" | "today" | "tomorrow" | "week"
) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !task) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  try {
    setSavingPlanning(true);

    await updateGroupTaskPlanning({
      groupId,
      taskId: task.id,
      updatedByUid: currentUser.uid,
      updatedByName: currentUser.displayName ?? currentUser.email ?? null,
      updatedByEmail: currentUser.email ?? null,
      priority: task.priority ?? null,
      dueAtMs: getDueAtMsForPreset(preset),
    });
  } catch (e: any) {
    Alert.alert("Update failed", e?.message ?? "Unknown error");
  } finally {
    setSavingPlanning(false);
  }
};

  useEffect(() => {
    if (!groupId || !taskId) {
      setTask(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribeGroupTask(
  groupId,
  taskId,
  (nextTask) => {
    setTask(nextTask);
    setLoading(false);
  },
  (err) => {
    console.log("[GroupTaskDetail] failed loading task", err);
    setError("Could not load shared task.");
    setLoading(false);
  }
);

    return unsub;
  }, [groupId, taskId]);

  useEffect(() => {
  if (!groupId || !taskId) {
    setTaskComments([]);
    return;
  }

  const unsub = subscribeGroupTaskComments(
    groupId,
    taskId,
    setTaskComments,
    (err) => {
      console.log("[GroupTaskDetail] failed loading task comments", err);
    }
  );

  return unsub;
}, [groupId, taskId]);

useEffect(() => {
  const currentUser = auth.currentUser;

  if (!groupId || !currentUser?.uid) {
    setNotificationPreferences(DEFAULT_GROUP_NOTIFICATION_PREFERENCES);
    return;
  }

  const unsub = subscribeGroupNotificationPreferences(
    currentUser.uid,
    groupId,
    setNotificationPreferences,
    (err) => {
      console.log("[GroupTaskDetail] notification preferences failed", err);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId) {
    setMentionMembers([]);
    return;
  }

  const unsub = subscribeGroupMembers(
    groupId,
    (members) => {
      const currentUid = auth.currentUser?.uid;

setMentionMembers(members);
    },
    (err) => {
      console.log("[GroupTaskDetail] mention members failed", err);
    }
  );

  return unsub;
}, [groupId]);

const handleToggleTaskMute = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || !taskId || updatingTaskMute) {
    return;
  }

  try {
    setUpdatingTaskMute(true);

    await setGroupTaskNotificationsMuted({
      uid: currentUser.uid,
      groupId,
      taskId,
      muted: !isTaskMuted,
    });
  } catch (err) {
    console.log("[GroupTaskDetail] toggle task mute failed", err);
    Alert.alert(
      "Could not update notifications",
      "Please try again in a moment."
    );
  } finally {
    setUpdatingTaskMute(false);
  }
};

const getMentionTokenForMember = (member: GroupMemberDoc) => {
  const source =
    member.displayName ??
    member.email?.split("@")[0] ??
    member.uid;

  return source
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
};

const activeMentionQuery = useMemo(
  () => getActiveMentionQuery(commentInput),
  [commentInput]
);

const filteredMentionMembers = useMemo(() => {
  if (activeMentionQuery == null) {
    return [];
  }

return mentionMembers
  .filter((member) => member.uid !== auth.currentUser?.uid)
  .filter((member) => {
      const token = getMentionTokenForMember(member);
      const label = `${member.displayName ?? ""} ${member.email ?? ""}`
        .trim()
        .toLowerCase();

      if (!activeMentionQuery) return true;

      return token.includes(activeMentionQuery) || label.includes(activeMentionQuery);
    })
    .slice(0, 6);
}, [mentionMembers, activeMentionQuery]);

const showMentionSuggestions = activeMentionQuery != null;

const handleInsertMention = (member: GroupMemberDoc) => {
  const token = getMentionTokenForMember(member);

  if (!token) return;

  setCommentInput((current) => {
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

const handlePostComment = async () => {
  const currentUser = auth.currentUser;
  const body = commentInput.trim();

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }

  if (!task) {
    Alert.alert("Not ready", "Task is not loaded yet.");
    return;
  }

  if (!body) {
    Alert.alert("Comment required", "Write a comment first.");
    return;
  }

  try {
    setPostingComment(true);

    await createGroupTaskComment({
      groupId,
      taskId: task.id,
      taskTitle: task.title,
      body,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName ?? currentUser.email ?? null,
    });

    setCommentInput("");
  } catch (e: any) {
    console.log("[GroupTaskDetail] post task comment failed", e);
    Alert.alert("Comment failed", e?.message ?? "Unknown error");
  } finally {
    setPostingComment(false);
  }
};

 return (
  <KeyboardAvoidingView
    style={styles.keyboardAvoidingRoot}
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
  >
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Shared tasks</Text>
      </Pressable>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading shared task...</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !task ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Task not found</Text>
          <Text style={styles.helperText}>
            This task may have been deleted or you may not have access.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>{task.title}</Text>

            <View style={styles.metaRow}>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{task.status}</Text>
              </View>

              {task.priority ? (
                <View style={styles.priorityPill}>
                  <Text style={styles.priorityPillText}>
                    {task.priority} priority
                  </Text>
                </View>
              ) : null}
            </View>

            

            {!!task.description ? (
              <Text style={styles.description}>{task.description}</Text>
            ) : (
              <Text style={styles.descriptionMuted}>
                No description yet.
              </Text>
            )}
          </View>



                    <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Task notifications</Text>

              <Pressable
                style={[
                  styles.taskMuteButton,
                  isTaskMuted && styles.taskMuteButtonActive,
                  updatingTaskMute && styles.buttonDisabled,
                ]}
                onPress={handleToggleTaskMute}
                disabled={updatingTaskMute}
              >
                <Text
                  style={[
                    styles.taskMuteButtonText,
                    isTaskMuted && styles.taskMuteButtonTextActive,
                  ]}
                >
                  {isTaskMuted ? "Muted" : "Mute task"}
                </Text>
              </Pressable>
            </View>

           <Text style={styles.helperText}>
  {isTaskMuted
    ? "You will not receive comment inbox items for this shared task."
    : "Mute this task to stop comment inbox items for this shared task."}
</Text>

{notificationPreferences.muted ? (
  <Text style={styles.taskMuteMutedGroupNote}>
    Group notifications are currently muted, so this task setting will only
    matter after the group is unmuted.
  </Text>
) : null}

          <View style={styles.taskMuteStatusRow}>
  <Text style={styles.taskMuteStatusLabel}>Current setting</Text>
  <Text
    style={[
      styles.taskMuteStatusValue,
      isTaskMuted && styles.taskMuteStatusValueMuted,
    ]}
  >
    {isTaskMuted ? "Task muted" : "Task active"}
  </Text>
</View>
          </View>

          <View style={styles.card}>
  <Text style={styles.cardTitle}>Priority</Text>

  <View style={styles.chipRow}>
    {([
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      [null, "Clear"],
    ] as Array<[GroupTaskPriority | null, string]>).map(([priority, label]) => {
      const active = task.priority === priority;

      return (
        <Pressable
          key={label}
          style={[
            styles.editChip,
            active && styles.editChipActive,
            savingPlanning && styles.buttonDisabled,
          ]}
          onPress={() => handleSetPriority(priority)}
          disabled={savingPlanning}
        >
          <Text
            style={[
              styles.editChipText,
              active && styles.editChipTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      );
    })}
  </View>
</View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Timing</Text>

            <Text style={styles.detailText}>
              {formatGroupTaskDueLabel(task.dueAtMs) ?? "No due date"}
            </Text>

            <Text style={styles.detailMeta}>
              Updated {formatRelativeTime(task.updatedAtMs)}
            </Text>

            <Text style={styles.sectionLabel}>Set due</Text>

<View style={styles.chipRow}>
  {([
    ["today", "Today 8pm"],
    ["tomorrow", "Tomorrow 8pm"],
    ["week", "In 1 week"],
    ["clear", "Clear"],
  ] as Array<["today" | "tomorrow" | "week" | "clear", string]>).map(
    ([preset, label]) => (
      <Pressable
        key={preset}
        style={[
          styles.editChip,
          savingPlanning && styles.buttonDisabled,
        ]}
        onPress={() => handleSetDuePreset(preset)}
        disabled={savingPlanning}
      >
        <Text style={styles.editChipText}>{label}</Text>
      </Pressable>
    )
  )}
</View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ownership</Text>

            <Text style={styles.detailText}>
              Created by{" "}
              {task.createdByName ??
                task.createdByEmail ??
                task.createdByUid ??
                "someone"}
            </Text>

            <Text style={styles.detailText}>
              Claimed by{" "}
              {task.claimedByName ??
                task.claimedByEmail ??
                task.claimedByUid ??
                "no one yet"}
            </Text>

            <Text style={styles.detailText}>
              Completed by{" "}
              {task.completedByName ??
                task.completedByUid ??
                "not completed yet"}
            </Text>
          </View>

        <View style={styles.card}>
  <Text style={styles.cardTitle}>
    Comments · {taskComments.length}
  </Text>

  {taskComments.length === 0 ? (
    <Text style={styles.helperText}>
      No comments yet. Add context, blockers, or updates for this shared task.
    </Text>
  ) : (
    <View style={styles.commentList}>
      {taskComments.map((comment) => (
        <View key={comment.id} style={styles.commentRow}>
          <Text style={styles.commentAuthor}>
            {comment.authorName ?? "Someone"}
          </Text>

          <Text style={styles.commentBody}>
            {comment.body}
          </Text>

          <Text style={styles.commentMeta}>
            {formatRelativeTime(comment.createdAtMs)}
          </Text>
        </View>
      ))}
    </View>
  )}

  <View style={styles.commentComposer}>
<Text style={styles.mentionHelperText}>
  Type @ to mention a group member.
</Text>

{showMentionSuggestions ? (
  filteredMentionMembers.length > 0 ? (
    <View style={styles.mentionChipRow}>
      {canUseHereMention &&
"here".startsWith(activeMentionQuery) ? (
  <Pressable
    style={styles.mentionChip}
    onPress={() => setCommentInput((current) => current.replace(/(^|\s)@([a-zA-Z0-9._-]*)$/, "$1@here "))}
  >
    <Text style={styles.mentionChipText}>@here</Text>
  </Pressable>
) : null}
      {filteredMentionMembers.map((member) => {
        const token = getMentionTokenForMember(member);

        return (
          <Pressable
            key={member.uid}
            style={styles.mentionChip}
            onPress={() => handleInsertMention(member)}
          >
            <Text style={styles.mentionChipText}>@{token}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : (
    <Text style={styles.mentionPeopleText}>
      No matching members.
    </Text>
  )
) : null}
  <TextInput
  value={commentInput}
  onChangeText={setCommentInput}
  maxLength={1000}
  placeholder="Add a task comment..."
  placeholderTextColor={theme.colors.textMuted}
  style={styles.commentInput}
  multiline
/>

    <Text style={styles.commentLengthText}>
      {commentInput.length}/1000
    </Text>

    <Pressable
      style={[
        styles.commentButton,
        (!commentInput.trim() || postingComment) && styles.buttonDisabled,
      ]}
      onPress={handlePostComment}
      disabled={!commentInput.trim() || postingComment}
    >
      <Text style={styles.commentButtonText}>
        {postingComment ? "Posting..." : "Post comment"}
      </Text>
    </Pressable>
  </View>
</View>
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 20,
      paddingTop: 70,
      paddingBottom: 260,
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
    title: {
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: "900",
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    statusPill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },
    statusPillText: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    priorityPill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    priorityPillText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
    },
    description: {
      color: theme.colors.text,
      marginTop: 14,
      lineHeight: 21,
    },
    descriptionMuted: {
      color: theme.colors.textMuted,
      marginTop: 14,
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
      fontWeight: "800",
      marginBottom: 12,
    },
    helperText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    detailText: {
      color: theme.colors.text,
      fontWeight: "800",
      lineHeight: 22,
      marginBottom: 8,
    },
    detailMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
    },
    loadingText: {
      color: theme.colors.textMuted,
      marginTop: 10,
      textAlign: "center",
    },
    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
      lineHeight: 18,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
      marginBottom: 8,
    },
    sectionLabel: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
  marginTop: 14,
  marginBottom: 8,
},

chipRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

editChip: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

editChipActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

editChipText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

editChipTextActive: {
  color: theme.colors.primary,
},

buttonDisabled: {
  opacity: 0.5,
},
commentList: {
  gap: 8,
},

commentRow: {
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

commentAuthor: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
  marginBottom: 4,
},

commentBody: {
  color: theme.colors.text,
  fontSize: 13,
  lineHeight: 19,
},

commentMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  marginTop: 6,
},

commentComposer: {
  marginTop: 12,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
  gap: 8,
},

commentInput: {
  minHeight: 46,
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

commentLengthText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "700",
  alignSelf: "flex-end",
},

commentButton: {
  alignSelf: "flex-end",
  backgroundColor: theme.colors.primary,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 8,
},

commentButtonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 13,
},
cardTitleRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 12,
},

taskMuteButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
},

taskMuteButtonActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

taskMuteButtonText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

taskMuteButtonTextActive: {
  color: theme.colors.primary,
},
taskMuteMutedGroupNote: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  lineHeight: 18,
  marginTop: 8,
},

taskMuteStatusRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 12,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

taskMuteStatusLabel: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},

taskMuteStatusValue: {
  color: theme.colors.success,
  fontSize: 12,
  fontWeight: "900",
},

taskMuteStatusValueMuted: {
  color: theme.colors.primary,
},
keyboardAvoidingRoot: {
  flex: 1,
  backgroundColor: theme.colors.background,
},
mentionHelperText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  lineHeight: 18,
},

mentionPeopleText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
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
  });