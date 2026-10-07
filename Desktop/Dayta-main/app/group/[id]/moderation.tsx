import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
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
import { auth } from "../../../services/firebase";
import {
  canModerateGroupContent,
  hideModerationTarget,
  restoreModerationTarget,
  subscribeGroupMembers,
  subscribeGroupReports,
  updateGroupReportStatus,
  type GroupMemberDoc,
  type GroupReportDoc,
} from "../../../services/groups";
import { useAppTheme } from "../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

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

function formatReportReasonLabel(reason: GroupReportDoc["reason"]) {
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
}

function formatReportTargetLabel(report: GroupReportDoc) {
  switch (report.targetType) {
    case "goal_comment":
      return "Goal comment";
    case "task_comment":
      return "Task comment";
    case "bulletin":
      return "Bulletin";
    case "bulletin_comment":
      return "Bulletin comment";
        case "dm_message":
      return "Direct message";  
          case "conversation_message":
      return "Conversation message";
    case "task":
      return "Shared task";
    case "activity":
      return "Activity";
    default:
      return "Content";
  }
}

function isMessagingReport(report: GroupReportDoc): boolean {
  return (
    report.targetType === "dm_message" ||
    report.targetType === "conversation_message"
  );
}

function formatModeratorActionLabel(report: GroupReportDoc): string | null {
  if (!report.lastActionType) return null;

  const actor = report.reviewedByName?.trim() || "A moderator";

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

  return time ? `${actor} ${action} · ${time}` : `${actor} ${action}`;
}

export default function GroupModerationScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === "string" ? params.id : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

const [reports, setReports] = useState<GroupReportDoc[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

const [membershipLoaded, setMembershipLoaded] = useState(false);
const [currentMember, setCurrentMember] = useState<GroupMemberDoc | null>(null);

  const [updatingReportIds, setUpdatingReportIds] = useState<Set<string>>(
  new Set()
);

const [hidingReportIds, setHidingReportIds] = useState<Set<string>>(
  new Set()
);

const [restoringReportIds, setRestoringReportIds] = useState<Set<string>>(
  new Set()
);

const openReportedTarget = (report: GroupReportDoc) => {
  if (isMessagingReport(report)) {
    Alert.alert(
      "Private thread protected",
      "Moderators can review the reported message preview and report metadata here, but cannot browse the full private thread."
    );
    return;
  }

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

  const openReports = reports.filter(
    (report) => report.status === "open" || report.status === "reviewing"
  );
  const canViewModeration =
  currentMember?.status === "active" &&
  canModerateGroupContent(currentMember.role);

useEffect(() => {
  const currentUid = auth.currentUser?.uid;

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
      console.log("[GroupModeration] membership subscription failed", err);
      setCurrentMember(null);
      setMembershipLoaded(true);
    }
  );

  return unsub;
}, [groupId]);

useEffect(() => {
  if (!groupId) {
    setReports([]);
    setLoading(false);
    return;
  }

  if (!membershipLoaded) {
    return;
  }

  if (!canViewModeration) {
    setReports([]);
    setLoading(false);
    setError("You do not have access to moderation for this group.");
    return;
  }

  setLoading(true);
  setError(null);

  const unsub = subscribeGroupReports(
    groupId,
    (items) => {
      setReports(items);
      setLoading(false);
    },
    (err) => {
      console.log("[GroupModeration] failed loading reports", err);
      setError("Could not load moderation reports.");
      setLoading(false);
    }
  );

  return unsub;
}, [groupId, membershipLoaded, canViewModeration]);

const handleUpdateReportStatus = async (
  report: GroupReportDoc,
  status: "reviewing" | "resolved" | "dismissed"
) => {
  if (!canViewModeration) {
    Alert.alert("Not allowed", "You no longer have moderation access.");
    return;
  }

  try {
    setUpdatingReportIds((current) => new Set(current).add(report.id));

    const currentUser = auth.currentUser;

await updateGroupReportStatus({
  groupId,
  reportId: report.id,
  status,
  reviewedByUid: currentUser?.uid ?? "",
  reviewedByName:
    currentUser?.displayName ?? currentUser?.email ?? "Moderator",
  resolutionNote:
    status === "resolved"
      ? "Marked resolved from moderation page."
      : status === "dismissed"
      ? "Dismissed from moderation page."
      : null,
});
  } catch (err: any) {
    console.log("[GroupModeration] update report failed", err);
    Alert.alert("Update failed", err?.message ?? "Please try again.");
  } finally {
    setUpdatingReportIds((current) => {
      const next = new Set(current);
      next.delete(report.id);
      return next;
    });
  }
};

const handleHideReportedContent = async (report: GroupReportDoc) => {
  if (!canViewModeration) {
    Alert.alert("Not allowed", "You no longer have moderation access.");
    return;
  }

Alert.alert(
  isMessagingReport(report) ? "Hide reported message?" : "Hide reported content?",
  isMessagingReport(report)
    ? "This will hide only the reported message from the private thread. Moderators still cannot browse the full thread."
    : "This will hide the reported content from group views.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Hide",
        style: "destructive",
        onPress: async () => {
          try {
            setHidingReportIds((current) => new Set(current).add(report.id));

           const currentUser = auth.currentUser;

await hideModerationTarget({
  groupId,
  reportId: report.id,
  targetType: report.targetType,
  targetId: report.targetId,
  hiddenByUid: currentUser?.uid ?? "",
  hiddenByName: currentUser?.displayName ?? currentUser?.email ?? null,
  goalId: report.goalId ?? null,
  taskId: report.taskId ?? null,
  bulletinId: report.bulletinId ?? null,
    dmId: report.dmId ?? null,
  targetPreviewTitle: report.targetPreviewTitle ?? null,
  targetPreviewBody: report.targetPreviewBody ?? null,
    conversationId: report.conversationId ?? null,
});
          } catch (err: any) {
            console.log("[GroupModeration] hide content failed", err);
            Alert.alert("Hide failed", err?.message ?? "Please try again.");
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
const handleRestoreReportedContent = async (report: GroupReportDoc) => {
  if (!canViewModeration) {
    Alert.alert("Not allowed", "You no longer have moderation access.");
    return;
  }

  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || restoringReportIds.has(report.id)) {
    return;
  }

Alert.alert(
  isMessagingReport(report)
    ? "Restore reported message?"
    : "Restore reported content?",
  isMessagingReport(report)
    ? "This will restore only the reported message. Moderators still cannot browse the full private thread."
    : "This will make the hidden content visible to group members again.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Restore",
        onPress: async () => {
          try {
            setRestoringReportIds((current) => new Set(current).add(report.id));

            await restoreModerationTarget({
              groupId,
              targetType: report.targetType,
              targetId: report.targetId,
              reportId: report.id,
              restoredByUid: currentUser.uid,
              restoredByName:
                currentUser.displayName ?? currentUser.email ?? null,
              goalId: report.goalId ?? null,
                dmId: report.dmId ?? null,
              taskId: report.taskId ?? null,
              bulletinId: report.bulletinId ?? null,
              targetPreviewTitle: report.targetPreviewTitle ?? null,
              targetPreviewBody: report.targetPreviewBody ?? null,
                conversationId: report.conversationId ?? null,
            });
          } catch (err: any) {
            console.log("[GroupModeration] restore content failed", err);
            Alert.alert("Restore failed", err?.message ?? "Please try again.");
          } finally {
            setRestoringReportIds((current) => {
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
        <Text style={styles.title}>Moderation</Text>
        <Text style={styles.subtitle}>
          Review reports, track actions, and keep group content safe.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{openReports.length} open</Text>
        <Text style={styles.summaryText}>
          {reports.length} total report{reports.length === 1 ? "" : "s"}
        </Text>
      </View>

{!membershipLoaded ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Checking moderation access...</Text>
  </View>
) : loading ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading reports...</Text>
  </View>
) : error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.helperText}>
            Member reports will appear here for moderators to review.
          </Text>
        </View>
      ) : (
reports.map((report) => {
  const currentUid = auth.currentUser?.uid ?? null;

  const isSelfModerationConflict =
    !!currentUid &&
    (report.reporterUid === currentUid ||
      report.targetAuthorUid === currentUid);

  return (
    <View key={report.id} style={styles.reportRow}>
            <View style={styles.reportHeader}>
              <Text style={styles.reportTitle}>
                {formatReportTargetLabel(report)}
              </Text>

              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{report.status}</Text>
              </View>
            </View>

<Text style={styles.reportMeta}>
  Reason: {formatReportReasonLabel(report.reason)}
</Text>
{isMessagingReport(report) ? (
  <View style={styles.privateReviewBox}>
    <Text style={styles.privateReviewTitle}>Preview-only message review</Text>
    <Text style={styles.privateReviewText}>
      Only the reported message preview, author, reporter, and reason are shown.
      Full private thread browsing is disabled for moderators.
    </Text>
  </View>
) : null}
{report.targetPreviewTitle ? (
  <View style={styles.reportPreviewBox}>
    <Text style={styles.reportPreviewTitle}>
      {report.targetPreviewTitle}
    </Text>

    {report.targetPreviewBody ? (
      <Text style={styles.reportPreviewBody} numberOfLines={4}>
        {report.targetPreviewBody}
      </Text>
    ) : null}
  </View>
) : null}

<Text style={styles.reportMeta}>
    {report.targetType === "dm_message" ||
  report.targetType === "conversation_message"
    ? "Message from"
    : "Target"}
  :{" "}
  {report.targetAuthorName ?? "Unknown author"}
</Text>

{!!report.note ? (
              <Text style={styles.reportNote} numberOfLines={4}>
                “{report.note}”
              </Text>
            ) : null}

{!!report.moderatorNote ? (
  <Text style={styles.moderatorNote}>
    Moderator note: {report.moderatorNote}
  </Text>
) : null}

{!!report.resolutionNote ? (
  <Text style={styles.moderatorNote}>
    Resolution: {report.resolutionNote}
  </Text>
) : null}

{formatModeratorActionLabel(report) ? (
  <Text style={styles.actionHistoryText}>
    {formatModeratorActionLabel(report)}
  </Text>
) : null}

<Text style={styles.reportMeta}>
  Reported by {report.reporterName ?? report.reporterEmail ?? "Someone"} ·{" "}
              {formatRelativeTime(report.createdAtMs)}
            </Text>

            {report.reviewedByName || report.reviewedAtMs ? (
              <Text style={styles.reportMeta}>
                Last action by {report.reviewedByName ?? "a moderator"} ·{" "}
                {formatRelativeTime(report.reviewedAtMs)}
              </Text>
            ) : null}

{isSelfModerationConflict ? (
  <Text style={styles.conflictText}>
    You cannot moderate a report involving your own report or content.
  </Text>
) : (
  <View style={styles.actionRow}>
{!isMessagingReport(report) &&
    (report.goalId ||
      report.taskId ||
      report.bulletinId) ? (
    <Pressable
      style={styles.actionButton}
      onPress={() => openReportedTarget(report)}
    >
      <Text style={styles.actionButtonText}>
  {report.targetType === "dm_message" ||
  report.targetType === "conversation_message"
    ? "Open thread"
    : "Open target"}
</Text>
    </Pressable>
  ) : null}

  {report.status !== "resolved" && report.status !== "dismissed" ? (
    <Pressable
      style={[
        styles.actionButtonDanger,
        hidingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleHideReportedContent(report)}
      disabled={hidingReportIds.has(report.id)}
    >
      <Text style={styles.actionButtonDangerText}>
        {hidingReportIds.has(report.id)
  ? "Hiding..."
  : isMessagingReport(report)
  ? "Hide message"
  : "Hide content"}
      </Text>
    </Pressable>
  ) : null}

   {report.lastActionType === "hidden" && report.status === "resolved" ? (
  <Pressable
    style={[
      styles.actionButton,
      restoringReportIds.has(report.id) && styles.buttonDisabled,
    ]}
    onPress={() => handleRestoreReportedContent(report)}
    disabled={restoringReportIds.has(report.id)}
  >
    <Text style={styles.actionButtonText}>
      {restoringReportIds.has(report.id)
  ? "Restoring..."
  : isMessagingReport(report)
  ? "Restore message"
  : "Restore content"}
    </Text>
  </Pressable>
) : null}

  {report.status !== "reviewing" &&
  report.status !== "resolved" &&
  report.status !== "dismissed" ? (
    <Pressable
      style={[
        styles.actionButton,
        updatingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleUpdateReportStatus(report, "reviewing")}
      disabled={updatingReportIds.has(report.id)}
    >
      <Text style={styles.actionButtonText}>Reviewing</Text>
    </Pressable>
  ) : null}

{report.status !== "resolved" &&
report.status !== "dismissed" ? (
  <>
    <Pressable
      style={[
        styles.actionButton,
        updatingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleUpdateReportStatus(report, "resolved")}
      disabled={updatingReportIds.has(report.id)}
    >
      <Text style={styles.actionButtonText}>Resolve</Text>
    </Pressable>

    <Pressable
      style={[
        styles.actionButtonMuted,
        updatingReportIds.has(report.id) && styles.buttonDisabled,
      ]}
      onPress={() => handleUpdateReportStatus(report, "dismissed")}
      disabled={updatingReportIds.has(report.id)}
    >
      <Text style={styles.actionButtonMutedText}>Dismiss</Text>
    </Pressable>
  </>
) : null}
  </View>
)}
          </View>
  );
})
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
    summaryCard: {
      padding: 16,
      borderRadius: 18,
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
    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
    },
    reportRow: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 10,
    },
    reportHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 8,
    },
    reportTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "900",
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    statusPillText: {
      color: theme.colors.primary,
      fontSize: 10,
      fontWeight: "900",
    },
    reportMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
      fontWeight: "700",
    },
    reportNote: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 8,
    },
    moderatorNote: {
      color: theme.colors.text,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 8,
      fontWeight: "800",
    },
    buttonDisabled: {
  opacity: 0.5,
},

actionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
},

actionButton: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

actionButtonText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

actionButtonMuted: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

actionButtonMutedText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},

actionButtonDanger: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
  borderWidth: 1,
},

actionButtonDangerText: {
  color: theme.colors.dangerText,
  fontSize: 12,
  fontWeight: "900",
},
reportPreviewBox: {
  marginTop: 10,
  padding: 10,
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
  fontSize: 12,
  lineHeight: 18,
  marginTop: 4,
},

actionHistoryText: {
  color: theme.colors.primary,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 8,
  fontWeight: "900",
},
conflictText: {
  color: theme.colors.danger,
  fontSize: 12,
  fontWeight: "900",
  lineHeight: 18,
  marginTop: 12,
},
privateReviewBox: {
  marginTop: 10,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

privateReviewTitle: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},

privateReviewText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 4,
  fontWeight: "700",
},
  });