import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
    hapticError,
    hapticSelection,
    hapticSuccess,
} from "../../../services/haptics";
import {
    claimGroupTask,
    completeGroupTask,
    releaseGroupTask,
    reopenGroupTask,
    subscribeGroupTasks,
    type GroupTaskDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

type TaskFilter =
  | "all"
  | "open"
  | "mine"
  | "claimed"
  | "completed"
  | "attention";

type TaskSort = "updated" | "newest" | "oldest" | "priority";

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

export default function GroupTasksScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [tasks, setTasks] = useState<GroupTaskDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [claimingIds, setClaimingIds] = useState<Set<string>>(new Set());
const [releasingIds, setReleasingIds] = useState<Set<string>>(new Set());
const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
const [reopeningIds, setReopeningIds] = useState<Set<string>>(new Set());
const pendingTaskIdsRef = useRef(new Set<string>());

const isTaskMutationPending = (taskId: string) =>
  claimingIds.has(taskId) ||
  releasingIds.has(taskId) ||
  completingIds.has(taskId) ||
  reopeningIds.has(taskId);

const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
const [taskSort, setTaskSort] = useState<TaskSort>("updated");

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status === "unclaimed"),
    [tasks]
  );

  const claimedTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === "claimed" || task.status === "in_progress"
      ),
    [tasks]
  );

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed"),
    [tasks]
  );

  const getTaskSignalLabel = (task: GroupTaskDoc) => {
  const nowMs = Date.now();

  if (
    typeof task.dueAtMs === "number" &&
    task.dueAtMs > 0 &&
    task.dueAtMs <= nowMs + 24 * 60 * 60 * 1000 &&
    task.status !== "completed"
  ) {
    return "Due soon";
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

const attentionTasks = useMemo(() => {
  return tasks.filter((task) => !!getTaskSignalLabel(task));
}, [tasks]);

const dueSoonTasks = useMemo(() => {
  const nowMs = Date.now();

  return tasks
    .filter(
      (task) =>
        task.status !== "completed" &&
        typeof task.dueAtMs === "number" &&
        task.dueAtMs > 0 &&
        task.dueAtMs <= nowMs + 24 * 60 * 60 * 1000
    )
    .sort((a, b) => (a.dueAtMs ?? 0) - (b.dueAtMs ?? 0));
}, [tasks]);

  const visibleTasks = useMemo(() => {
  const currentUid = auth.currentUser?.uid ?? null;

  const priorityRank = (priority?: string | null) => {
    if (priority === "high") return 0;
    if (priority === "medium") return 1;
    if (priority === "low") return 2;
    return 3;
  };

  const filtered = tasks.filter((task) => {
    if (taskFilter === "open") return task.status === "unclaimed";
    if (taskFilter === "mine") return task.claimedByUid === currentUid;
    if (taskFilter === "claimed") {
      return task.status === "claimed" || task.status === "in_progress";
    }
    if (taskFilter === "completed") return task.status === "completed";

    if (taskFilter === "attention") return !!getTaskSignalLabel(task);

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (taskSort === "priority") {
      const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAtMs - a.updatedAtMs;
    }

    if (taskSort === "newest") {
      return b.createdAtMs - a.createdAtMs;
    }

    if (taskSort === "oldest") {
      return a.createdAtMs - b.createdAtMs;
    }

    return b.updatedAtMs - a.updatedAtMs;
  });
}, [tasks, taskFilter, taskSort]);

  useEffect(() => {
    if (!groupId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsub = subscribeGroupTasks(
      groupId,
      (next) => {
        setTasks(next);
        setLoading(false);
      },
      (err) => {
        console.log("[GroupTasks] failed loading tasks", err);
        setError("Could not load shared tasks.");
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

  const handleClaimTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }
  if (pendingTaskIdsRef.current.has(task.id)) return;
  pendingTaskIdsRef.current.add(task.id);

  try {
    setClaimingIds((current) => new Set(current).add(task.id));

    await claimGroupTask({
      groupId,
      taskId: task.id,
      claimedByUid: currentUser.uid,
      claimedByName: currentUser.displayName ?? currentUser.email ?? null,
      claimedByEmail: currentUser.email ?? null,
    });
    void hapticSuccess();
  } catch (e: any) {
    void hapticError();
    Alert.alert("Claim failed", e?.message ?? "Unknown error");
  } finally {
    pendingTaskIdsRef.current.delete(task.id);
    setClaimingIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleReleaseTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }
  if (pendingTaskIdsRef.current.has(task.id)) return;
  pendingTaskIdsRef.current.add(task.id);

  try {
    setReleasingIds((current) => new Set(current).add(task.id));

    await releaseGroupTask({
      groupId,
      taskId: task.id,
      releasedByUid: currentUser.uid,
      releasedByName: currentUser.displayName ?? currentUser.email ?? null,
      releasedByEmail: currentUser.email ?? null,
    });
    void hapticSelection();
  } catch (e: any) {
    void hapticError();
    Alert.alert("Release failed", e?.message ?? "Unknown error");
  } finally {
    pendingTaskIdsRef.current.delete(task.id);
    setReleasingIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleCompleteTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }
  if (pendingTaskIdsRef.current.has(task.id)) return;
  pendingTaskIdsRef.current.add(task.id);

  try {
    setCompletingIds((current) => new Set(current).add(task.id));

    await completeGroupTask({
      groupId,
      taskId: task.id,
      completedByUid: currentUser.uid,
      completedByName: currentUser.displayName ?? currentUser.email ?? null,
      completedByEmail: currentUser.email ?? null,
    });
    void hapticSuccess();
  } catch (e: any) {
    void hapticError();
    Alert.alert("Complete failed", e?.message ?? "Unknown error");
  } finally {
    pendingTaskIdsRef.current.delete(task.id);
    setCompletingIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const handleReopenTask = async (task: GroupTaskDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    Alert.alert("Sign in required", "Please sign in first.");
    return;
  }
  if (pendingTaskIdsRef.current.has(task.id)) return;
  pendingTaskIdsRef.current.add(task.id);

  try {
    setReopeningIds((current) => new Set(current).add(task.id));

    await reopenGroupTask({
      groupId,
      taskId: task.id,
      reopenedByUid: currentUser.uid,
      reopenedByName: currentUser.displayName ?? currentUser.email ?? null,
      reopenedByEmail: currentUser.email ?? null,
    });
    void hapticSelection();
  } catch (e: any) {
    void hapticError();
    Alert.alert("Reopen failed", e?.message ?? "Unknown error");
  } finally {
    pendingTaskIdsRef.current.delete(task.id);
    setReopeningIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
  }
};

const renderTaskRow = (task: GroupTaskDoc) => {
  const currentUid = auth.currentUser?.uid ?? null;
  const isMine = task.claimedByUid === currentUid;
  const taskMutationPending = isTaskMutationPending(task.id);

  return (
  <Pressable
    key={task.id}
    style={({ pressed }) => [
      styles.taskRow,
      pressed && styles.taskRowPressed,
    ]}
    onPress={() =>
      router.push(`/group/${groupId}/task/${task.id}`)
    }
    accessibilityRole="button"
    accessibilityLabel={`Open ${task.title}, ${task.status.replace(/_/g, " ")}`}
  >
      <View style={styles.taskMain}>
        <Text style={styles.taskTitle} numberOfLines={1}>
          {task.title}
        </Text>

        {!!task.description ? (
          <Text style={styles.taskDescription} numberOfLines={2}>
            {task.description}
          </Text>
        ) : null}

        <Text style={styles.taskMeta} numberOfLines={1}>
          {task.status}
          {task.priority ? ` · ${task.priority} priority` : ""}
          {task.claimedByName || task.claimedByEmail
            ? ` · claimed by ${task.claimedByName ?? task.claimedByEmail}`
            : ""}
        </Text>

        {formatGroupTaskDueLabel(task.dueAtMs) ? (
  <Text style={styles.taskDueText}>
    {formatGroupTaskDueLabel(task.dueAtMs)}
  </Text>
) : null}

        <Text style={styles.taskTime}>
          Updated {formatRelativeTime(task.updatedAtMs)}
        </Text>

        {getTaskSignalLabel(task) ? (
  <View style={styles.taskSignalInline}>
    <Text style={styles.taskSignalInlineText}>
      {getTaskSignalLabel(task)}
    </Text>
  </View>
) : null}
      </View>

      {task.status === "unclaimed" ? (
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.actionPressed,
            taskMutationPending && styles.buttonDisabled,
          ]}
         onPress={(event) => {
  event.stopPropagation();
  handleClaimTask(task);
}}
          disabled={taskMutationPending}
          accessibilityRole="button"
          accessibilityLabel={`Claim ${task.title}`}
          accessibilityState={{
            disabled: taskMutationPending,
            busy: taskMutationPending,
          }}
        >
          <Text style={styles.actionButtonText}>
            {claimingIds.has(task.id) ? "Claiming…" : "Claim"}
          </Text>
        </Pressable>
      ) : task.status === "completed" ? (
        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.actionPressed,
            taskMutationPending && styles.buttonDisabled,
          ]}
         onPress={(event) => {
  event.stopPropagation();
  handleReopenTask(task);
}}
          disabled={taskMutationPending}
          accessibilityRole="button"
          accessibilityLabel={`Reopen ${task.title}`}
          accessibilityState={{
            disabled: taskMutationPending,
            busy: taskMutationPending,
          }}
        >
          <Text style={styles.secondaryButtonText}>
            {reopeningIds.has(task.id) ? "Reopening…" : "Reopen"}
          </Text>
        </Pressable>
      ) : isMine ? (
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [
              styles.doneButton,
              pressed && styles.actionPressed,
              taskMutationPending && styles.buttonDisabled,
            ]}
            onPress={(event) => {
  event.stopPropagation();
  handleCompleteTask(task);
}}
            disabled={taskMutationPending}
            accessibilityRole="button"
            accessibilityLabel={`Complete ${task.title}`}
            accessibilityState={{
              disabled: taskMutationPending,
              busy: taskMutationPending,
            }}
          >
            <Text style={styles.doneButtonText}>
              {completingIds.has(task.id) ? "Completing…" : "Done"}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.actionPressed,
              taskMutationPending && styles.buttonDisabled,
            ]}
            onPress={(event) => {
  event.stopPropagation();
  handleReleaseTask(task);
}}
            disabled={taskMutationPending}
            accessibilityRole="button"
            accessibilityLabel={`Release ${task.title}`}
            accessibilityState={{
              disabled: taskMutationPending,
              busy: taskMutationPending,
            }}
          >
            <Text style={styles.secondaryButtonText}>
              {releasingIds.has(task.id) ? "Releasing…" : "Release"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>Claimed</Text>
        </View>
      )}
    </Pressable>
  );
};

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.actionPressed,
        ]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to group"
      >
        <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
        <Text style={styles.backButtonText}>Group</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Shared tasks</Text>
        <Text style={styles.subtitle}>
          Group-level work across open, claimed, and completed tasks.
        </Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading shared tasks...</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No shared tasks yet</Text>
          <Text style={styles.helperText}>
            Shared group tasks created from the dashboard will appear here.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>
              {openTasks.length} open · {claimedTasks.length} claimed ·{" "}
              {completedTasks.length} completed
            </Text>
          </View>

          <View style={styles.card}>
  <Text style={styles.cardTitle}>Filters</Text>

  <View style={styles.filterRow}>
    {([
      ["all", "All"],
      ["open", "Open"],
      ["mine", "Mine"],
      ["claimed", "Claimed"],
      ["completed", "Done"],
      ["attention", "Needs attention"],
    ] as Array<[TaskFilter, string]>).map(([value, label]) => {
      const active = taskFilter === value;

      return (
        <Pressable
          key={value}
          style={[
            styles.filterPill,
            active && styles.filterPillActive,
          ]}
          onPress={() => setTaskFilter(value)}
        >
          <Text
            style={[
              styles.filterPillText,
              active && styles.filterPillTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      );
    })}
  </View>

  <Text style={styles.smallLabel}>Sort by</Text>

  <View style={styles.filterRow}>
    {([
      ["updated", "Recently updated"],
      ["priority", "Priority"],
      ["newest", "Newest"],
      ["oldest", "Oldest"],
    ] as Array<[TaskSort, string]>).map(([value, label]) => {
      const active = taskSort === value;

      return (
        <Pressable
          key={value}
          style={[
            styles.sortPill,
            active && styles.filterPillActive,
          ]}
          onPress={() => setTaskSort(value)}
        >
          <Text
            style={[
              styles.filterPillText,
              active && styles.filterPillTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      );
    })}
  </View>
</View>

{dueSoonTasks.length > 0 ? (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>
      Due soon · {dueSoonTasks.length}
    </Text>

    <Text style={styles.helperText}>
      These shared tasks are due within the next 24 hours.
    </Text>

    <View style={styles.dueSoonList}>
      {dueSoonTasks.slice(0, 3).map((task) => (
        <View key={task.id} style={styles.dueSoonRow}>
          <View style={styles.taskMain}>
            <Text style={styles.taskTitle} numberOfLines={1}>
              {task.title}
            </Text>

            <Text style={styles.taskMeta} numberOfLines={1}>
              {formatGroupTaskDueLabel(task.dueAtMs) ?? "Due soon"}
              {task.priority ? ` · ${task.priority} priority` : ""}
            </Text>
          </View>

          <View style={styles.attentionPill}>
            <Text style={styles.attentionPillText}>Due soon</Text>
          </View>
        </View>
      ))}
    </View>
  </View>
) : null}

         <View style={styles.card}>
  <Text style={styles.cardTitle}>
    Tasks · {visibleTasks.length}
  </Text>

  {visibleTasks.length === 0 ? (
    <Text style={styles.helperText}>
      No tasks match this filter yet.
    </Text>
  ) : (
    visibleTasks.map(renderTaskRow)
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

    card: {
      padding: 16,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
    },

    summaryCard: {
      padding: 14,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 14,
    },

    summaryText: {
      color: theme.colors.text,
      fontWeight: "900",
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

    taskRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },

    taskRowPressed: {
      opacity: 0.82,
    },

    taskMain: {
      flex: 1,
      minWidth: 0,
    },

    taskTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },

    taskDescription: {
      color: theme.colors.textMuted,
      marginTop: 4,
      lineHeight: 18,
      fontSize: 13,
    },

    taskMeta: {
      color: theme.colors.textMuted,
      marginTop: 6,
      fontSize: 12,
      fontWeight: "800",
    },

    taskTime: {
      color: theme.colors.textMuted,
      marginTop: 3,
      fontSize: 11,
      fontWeight: "700",
    },

    statusPill: {
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },

    statusPillCompleted: {
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
    },

    statusPillText: {
      color: theme.colors.primary,
      fontSize: 11,
      fontWeight: "900",
    },
    actionRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
},

actionButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

actionButtonText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},

actionPressed: {
  opacity: 0.78,
},

doneButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.success,
},

doneButtonText: {
  color: theme.colors.primaryText,
  fontSize: 11,
  fontWeight: "900",
},

secondaryButton: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

secondaryButtonText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},

buttonDisabled: {
  opacity: 0.5,
},
filterRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

filterPill: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

filterPillActive: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

filterPillText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

filterPillTextActive: {
  color: theme.colors.primary,
},

sortPill: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

smallLabel: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
  marginTop: 14,
  marginBottom: 8,
},
dueSoonList: {
  marginTop: 12,
  gap: 8,
},

dueSoonRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

attentionPill: {
  paddingHorizontal: 9,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.warning,
  borderWidth: 1,
},

attentionPillText: {
  color: theme.colors.warning,
  fontSize: 11,
  fontWeight: "900",
},

taskSignalInline: {
  alignSelf: "flex-start",
  marginTop: 6,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.warning,
  borderWidth: 1,
},

taskSignalInlineText: {
  color: theme.colors.warning,
  fontSize: 10,
  fontWeight: "900",
},
taskDueText: {
  color: theme.colors.textMuted,
  marginTop: 5,
  fontSize: 12,
  fontWeight: "800",
},
  });
