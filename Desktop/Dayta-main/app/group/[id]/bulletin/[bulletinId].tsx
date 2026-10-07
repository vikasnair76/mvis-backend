import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { MediaAttachmentGrid } from "../../../../components/MediaAttachmentGrid";
import { MediaAttachmentViewer } from "../../../../components/media/MediaAttachmentViewer";
import { CommentMediaCandidateTray } from "../../../../components/media/CommentMediaCandidateTray";
import {
  pickCommentMediaCandidates,
  type PendingCommentMedia,
} from "../../../../components/media/commentMediaPicker";
import { auth } from "../../../../services/firebase";
import {
  canUseGroupHereMention,
  createGroupBulletinComment,
  createGroupReport,
  permanentlyDeleteGroupBulletin,
  reserveGroupBulletinCommentId,
  subscribeGroupBulletin,
  subscribeGroupBulletinComments,
  subscribeGroupMembers,
  softDeleteGroupBulletin,
  updateGroupBulletin,
  type GroupBulletinCommentDoc,
  type GroupBulletinDoc,
  type GroupMemberDoc
} from "../../../../services/groups";
import {
  createMediaAttachmentId,
  createMediaUploadAttempt,
  cancelMediaUploadAttempt,
  deleteMediaAttachmentObjects,
  getMediaAttachmentPolicy,
  isCurrentMediaUploadAttempt,
  normalizeLocalMediaCandidate,
  uploadContextMediaAttachmentBatch,
  validateLocalMediaCandidate,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentDoc,
  type MediaUploadAttempt,
  type MediaUploadBatchHandle,
} from "../../../../services/mediaAttachments";
import {
  cancelMediaUploadSession,
  createMediaUploadSession,
  finalizeMediaUploadSession,
} from "../../../../services/mediaUploadSessions";
import { useAppTheme } from "../../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

const COMMENT_MAX_LENGTH = 1000;

function getActiveMentionQuery(text: string): string | null {
  const match = text.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);

  return match ? match[2].toLowerCase() : null;
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

export default function GroupBulletinDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    bulletinId?: string;
  }>();

  const groupId = typeof params.id === "string" ? params.id : "";
  const bulletinId =
    typeof params.bulletinId === "string" ? params.bulletinId : "";

  const { themeId: selectedThemeId } = useCurrentAppTheme();
  const theme = useAppTheme(selectedThemeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [bulletin, setBulletin] = useState<GroupBulletinDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const [comments, setComments] = useState<GroupBulletinCommentDoc[]>([]);
const [loadingComments, setLoadingComments] = useState(true);
const [commentsError, setCommentsError] = useState<string | null>(null);
const [commentInput, setCommentInput] = useState("");
const [postingComment, setPostingComment] = useState(false);
const [commentMedia, setCommentMedia] = useState<PendingCommentMedia[]>([]);
const [commentUploadProgress, setCommentUploadProgress] = useState(0);
const [commentUploadStatus, setCommentUploadStatus] = useState<string | null>(null);
const commentUploadHandleRef = useRef<MediaUploadBatchHandle | null>(null);
const commentAttemptRef = useRef<MediaUploadAttempt | null>(null);
const [commentViewer, setCommentViewer] = useState<{
  attachments: MediaAttachmentDoc[];
  index: number;
} | null>(null);
useEffect(
  () => () => {
    if (commentAttemptRef.current) {
      cancelMediaUploadAttempt(commentAttemptRef.current);
      commentUploadHandleRef.current?.cancel();
    }
  },
  []
);
const [mentionMembers, setMentionMembers] = useState<GroupMemberDoc[]>([]);
const [membershipLoaded, setMembershipLoaded] = useState(false);
const [hasActiveMembership, setHasActiveMembership] = useState(false);
const [reportingBulletin, setReportingBulletin] = useState(false);
const [editingBulletin, setEditingBulletin] = useState(false);
const [editTitle, setEditTitle] = useState("");
const [editBody, setEditBody] = useState("");
const [editAttachments, setEditAttachments] = useState<MediaAttachmentDoc[]>([]);
const [editNewMedia, setEditNewMedia] = useState<{ id: string; candidate: LocalMediaAttachmentCandidate }[]>([]);
const [savingBulletin, setSavingBulletin] = useState(false);
const [editUploadProgress, setEditUploadProgress] = useState(0);
const [editUploadStatus, setEditUploadStatus] = useState<string | null>(null);
const editUploadHandleRef = useRef<MediaUploadBatchHandle | null>(null);
const editAttemptRef = useRef<MediaUploadAttempt | null>(null);
const [reportingCommentIds, setReportingCommentIds] = useState<Set<string>>(
  new Set()
);

const currentMemberRole = useMemo(() => {
  const currentUid = auth.currentUser?.uid;

  return (
    mentionMembers.find((member) => member.uid === currentUid)?.role ?? null
  );
}, [mentionMembers]);

const canUseHereMention =
  canUseGroupHereMention(currentMemberRole);
const canManageBulletin = currentMemberRole === "owner" ||
  currentMemberRole === "admin" ||
  currentMemberRole === "moderator";

const beginEditBulletin = () => {
  if (!bulletin) return;
  setEditTitle(bulletin.title);
  setEditBody(bulletin.body);
  setEditAttachments(bulletin.attachments);
  setEditNewMedia([]);
  setEditingBulletin(true);
};

const cancelBulletinEditUpload = () => {
  const attempt = editAttemptRef.current;
  if (!attempt) return;
  cancelMediaUploadAttempt(attempt);
  editUploadHandleRef.current?.cancel();
  setEditUploadStatus("Cancelling upload…");
};

const closeBulletinEditor = () => {
  if (savingBulletin) {
    Alert.alert(
      "Upload in progress",
      "Cancel the upload before closing this editor."
    );
    return;
  }
  setEditingBulletin(false);
};

const saveBulletinEdit = async () => {
  if (!bulletin || savingBulletin) return;
  const finalCount = editAttachments.length + editNewMedia.length;
  const finalVideoCount =
    editAttachments.filter((attachment) => attachment.type === "video").length +
    editNewMedia.filter((item) => item.candidate.type === "video").length;
  if (finalCount > 4 || finalVideoCount > 1) {
    Alert.alert(
      "Media limit reached",
      finalCount > 4
        ? "You can attach up to 4 items."
        : "Only one uploaded video can be attached."
    );
    return;
  }
  const removed = bulletin.attachments.filter(
    (attachment) => !editAttachments.some((item) => item.id === attachment.id)
  );
  const context = { type: "bulletin" as const, groupId, bulletinId };
  let sessionId: string | null = null;
  let newlyUploaded: MediaAttachmentDoc[] = [];
  const attempt = createMediaUploadAttempt();
  editAttemptRef.current = attempt;
  try {
    setSavingBulletin(true);
    setEditUploadProgress(0);
    setEditUploadStatus(
      editNewMedia.length > 0 ? "Preparing attachments…" : "Saving bulletin…"
    );
    if (editNewMedia.length > 0) {
      const session = await createMediaUploadSession({
        uploaderUid: auth.currentUser!.uid,
        context,
      });
      sessionId = session.id;
      if (!isCurrentMediaUploadAttempt(attempt, editAttemptRef.current)) {
        throw new Error("Upload cancelled.");
      }
      const itemProgress = new Map<string, number>();
      const batch = uploadContextMediaAttachmentBatch({
        items: editNewMedia.map((item) => ({ attachmentId: item.id, candidate: item.candidate })),
        uploaderUid: auth.currentUser!.uid,
        context,
        uploadSessionId: session.id,
        onItemProgress: (attachmentId, progress) => {
          if (!isCurrentMediaUploadAttempt(attempt, editAttemptRef.current)) return;
          itemProgress.set(attachmentId, progress);
          const aggregate =
            [...itemProgress.values()].reduce((total, value) => total + value, 0) /
            editNewMedia.length;
          setEditUploadProgress(aggregate);
          setEditUploadStatus(`Uploading attachments… ${Math.round(aggregate * 100)}%`);
        },
      });
      editUploadHandleRef.current = batch;
      newlyUploaded = (await batch.promise).attachments;
      if (!isCurrentMediaUploadAttempt(attempt, editAttemptRef.current)) {
        throw new Error("Upload cancelled.");
      }
    }
    await updateGroupBulletin({
      groupId,
      bulletinId,
      title: editTitle,
      body: editBody,
      attachments: [...editAttachments, ...newlyUploaded],
    });
    if (sessionId) await finalizeMediaUploadSession(sessionId, auth.currentUser!.uid);
    setEditingBulletin(false);
    if (removed.length > 0) {
      const cleanup = await deleteMediaAttachmentObjects(removed, context);
      if (cleanup.failedPaths.length > 0) {
        Alert.alert(
          "Bulletin updated",
          "The bulletin was updated, but an old attachment could not be cleaned up."
        );
      }
    }
  } catch {
    if (newlyUploaded.length > 0) await deleteMediaAttachmentObjects(newlyUploaded, context);
    if (sessionId) await cancelMediaUploadSession(sessionId, auth.currentUser!.uid).catch(() => undefined);
    const cancelled = attempt.cancelled;
    setEditUploadStatus(cancelled ? "Upload cancelled." : "The upload could not be completed.");
    Alert.alert(
      cancelled ? "Upload cancelled" : "Update failed",
      cancelled
        ? "Your bulletin was not changed."
        : "The upload could not be completed. Your bulletin was not changed."
    );
  } finally {
    if (editAttemptRef.current?.id === attempt.id) {
      editAttemptRef.current = null;
      editUploadHandleRef.current = null;
      setSavingBulletin(false);
    }
  }
};

const pickEditMedia = async () => {
  const remaining = 4 - editAttachments.length - editNewMedia.length;
  if (remaining <= 0) return;
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
  });
  if (result.canceled) return;
  const next: typeof editNewMedia = [];
  for (const asset of result.assets) {
    const source = (asset.fileName || asset.uri).split("?")[0].toLowerCase();
    const mimeType = asset.mimeType?.toLowerCase() ||
      (source.endsWith(".mp4") ? "video/mp4" : source.endsWith(".gif") ? "image/gif" :
        source.endsWith(".png") ? "image/png" : source.endsWith(".webp") ? "image/webp" : "image/jpeg");
    const candidate = normalizeLocalMediaCandidate({
      localUri: asset.uri,
      type: mimeType === "video/mp4" ? "video" : mimeType === "image/gif" ? "gif" : "image",
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
      const existingVideoCount =
        editAttachments.filter((attachment) => attachment.type === "video").length +
        editNewMedia.filter((item) => item.candidate.type === "video").length +
        next.filter((item) => item.candidate.type === "video").length;
      if (candidate.type === "video" && existingVideoCount >= 1) {
        Alert.alert("Media not added", "Only one uploaded video can be attached.");
        continue;
      }
      next.push({ id: createMediaAttachmentId(), candidate });
    } catch (error: any) {
      Alert.alert("Media not added", error?.message ?? "This file is not supported.");
    }
  }
  setEditNewMedia((current) => [...current, ...next].slice(0, remaining + current.length));
};

const requestDeleteBulletin = () => {
  if (!bulletin) return;
  const actions: Parameters<typeof Alert.alert>[2] = [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: async () => {
        try {
          await softDeleteGroupBulletin(groupId, bulletinId);
          router.back();
        } catch {
          Alert.alert("Delete failed", "Please try again.");
        }
      },
    },
  ];
  if (currentMemberRole === "owner") {
    actions.push({
      text: "Delete permanently",
      style: "destructive",
      onPress: async () => {
        try {
          await permanentlyDeleteGroupBulletin(groupId, bulletinId);
          await deleteMediaAttachmentObjects(bulletin.attachments, {
            type: "bulletin",
            groupId,
            bulletinId,
          });
          router.back();
        } catch {
          Alert.alert("Delete failed", "Please try again.");
        }
      },
    });
  }
  Alert.alert(
    "Delete bulletin?",
    "Soft delete preserves media. Permanent deletion also removes uploaded media.",
    actions
  );
};

useEffect(() => {
  if (!groupId || !bulletinId) {
    setBulletin(null);
    setLoading(false);
    setErrorText("Missing bulletin.");
    return;
  }

  if (!membershipLoaded) {
    return;
  }

  if (!hasActiveMembership) {
    setBulletin(null);
    setLoading(false);
    setErrorText("You no longer have access to this group.");
    return;
  }

  setLoading(true);
    setErrorText(null);

    const unsub = subscribeGroupBulletin(
      groupId,
      bulletinId,
      (item) => {
        setBulletin(item);
        setLoading(false);
      },
      (err) => {
        console.log("[BulletinDetail] subscription failed", err);
        setErrorText("Could not load bulletin.");
        setLoading(false);
      }
    );

    return unsub;
  }, [groupId, bulletinId, membershipLoaded, hasActiveMembership]);

useEffect(() => {
  if (!groupId || !bulletinId || !membershipLoaded || !hasActiveMembership) {
    setComments([]);
    setLoadingComments(false);
    setCommentsError(null);
    return;
  }

  setLoadingComments(true);
  setCommentsError(null);

  const unsub = subscribeGroupBulletinComments(
    groupId,
    bulletinId,
    (items) => {
      setComments(
  canUseHereMention
    ? items
    : items.filter((item) => item.hiddenByModeration !== true)
);
      setLoadingComments(false);
    },
    (err) => {
      console.log("[BulletinDetail] comments subscription failed", err);
      setCommentsError("Could not load comments.");
      setLoadingComments(false);
    }
  );

  return unsub;
}, [groupId, bulletinId, canUseHereMention, membershipLoaded, hasActiveMembership]);

useEffect(() => {
  const currentUid = auth.currentUser?.uid;

  if (!groupId || !currentUid) {
    setMentionMembers([]);
    setHasActiveMembership(false);
    setMembershipLoaded(true);
    return;
  }

  setMembershipLoaded(false);

  const unsub = subscribeGroupMembers(
    groupId,
    (members) => {
      const activeMembers = members.filter(
        (member) => member.status === "active"
      );

      setMentionMembers(activeMembers);

      setHasActiveMembership(
        activeMembers.some((member) => member.uid === currentUid)
      );

      setMembershipLoaded(true);
    },
    (err) => {
      console.log("[BulletinDetail] mention members failed", err);
      setMentionMembers([]);
      setHasActiveMembership(false);
      setMembershipLoaded(true);
    }
  );

  return unsub;
}, [groupId]);

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

  if (!currentUser?.uid || !groupId || !bulletinId || postingComment) return;

  const body = commentInput.trim();

  if (!body && commentMedia.length === 0) {
    Alert.alert("Comment required", "Write a comment or add an attachment.");
    return;
  }

  if (body.length > COMMENT_MAX_LENGTH) {
    Alert.alert("Too long", "Comments must be 1000 characters or fewer.");
    return;
  }

  const commentId = reserveGroupBulletinCommentId(groupId, bulletinId);
  const context = {
    type: "bulletin_comment" as const,
    groupId,
    bulletinId,
    commentId,
  };
  const attempt = createMediaUploadAttempt();
  commentAttemptRef.current = attempt;
  let sessionId: string | null = null;
  let uploaded: MediaAttachmentDoc[] = [];
  try {
    setPostingComment(true);
    setCommentUploadProgress(0);
    setCommentUploadStatus(
      commentMedia.length > 0 ? "Preparing attachments…" : "Posting comment…"
    );
    if (commentMedia.length > 0) {
      const session = await createMediaUploadSession({
        uploaderUid: currentUser.uid,
        context,
      });
      sessionId = session.id;
      const progressById = new Map<string, number>();
      const batch = uploadContextMediaAttachmentBatch({
        items: commentMedia.map((item) => ({
          attachmentId: item.id,
          candidate: item.candidate,
        })),
        uploaderUid: currentUser.uid,
        context,
        uploadSessionId: session.id,
        onItemProgress: (attachmentId, progress) => {
          if (!isCurrentMediaUploadAttempt(attempt, commentAttemptRef.current)) return;
          progressById.set(attachmentId, progress);
          const aggregate =
            [...progressById.values()].reduce((sum, value) => sum + value, 0) /
            commentMedia.length;
          setCommentUploadProgress(aggregate);
          setCommentUploadStatus(
            `Uploading attachments… ${Math.round(aggregate * 100)}%`
          );
        },
      });
      commentUploadHandleRef.current = batch;
      uploaded = (await batch.promise).attachments;
      if (!isCurrentMediaUploadAttempt(attempt, commentAttemptRef.current)) {
        throw new Error("cancelled");
      }
    }

    await createGroupBulletinComment({
      groupId,
      bulletinId,
      bulletinTitle: bulletin?.title ?? null,
      body,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName ?? currentUser.email ?? null,
      authorEmail: currentUser.email ?? null,
      attachments: uploaded,
      commentId,
    });
    if (sessionId) {
      await finalizeMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }

    setCommentInput("");
    setCommentMedia([]);
    setCommentUploadStatus(null);
  } catch {
    if (uploaded.length > 0) {
      await deleteMediaAttachmentObjects(uploaded, context);
    }
    if (sessionId) {
      await cancelMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }
    const cancelled = attempt.cancelled;
    setCommentUploadStatus(cancelled ? "Upload cancelled." : "The comment could not be posted.");
    Alert.alert(
      cancelled ? "Upload cancelled" : "Comment failed",
      "Your comment was not posted."
    );
  } finally {
    if (commentAttemptRef.current?.id === attempt.id) {
      commentAttemptRef.current = null;
      commentUploadHandleRef.current = null;
      setPostingComment(false);
    }
  }
};

const handlePickCommentMedia = async () => {
  try {
    const selected = await pickCommentMediaCandidates({
      contextType: "bulletin_comment",
      remaining: getMediaAttachmentPolicy("bulletin_comment").maxAttachments - commentMedia.length,
      existingVideoCount: commentMedia.filter((item) => item.candidate.type === "video").length,
    });
    setCommentMedia((current) => [...current, ...selected]);
  } catch (error: any) {
    Alert.alert("Media not added", error?.message ?? "This media is not supported.");
  }
};

const cancelCommentUpload = () => {
  const attempt = commentAttemptRef.current;
  if (!attempt) return;
  cancelMediaUploadAttempt(attempt);
  commentUploadHandleRef.current?.cancel();
  setCommentUploadStatus("Cancelling upload…");
};

const handleReportBulletin = async () => {
  const currentUser = auth.currentUser;

  if (
    !currentUser?.uid ||
    !groupId ||
    !bulletin ||
    reportingBulletin
  ) {
    return;
  }

  Alert.alert(
    "Report bulletin",
    "Report this bulletin to moderators?",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            setReportingBulletin(true);

await createGroupReport({
  groupId,

  targetType: "bulletin",
  targetId: bulletin.id,

  bulletinId: bulletin.id,
targetPreviewTitle: bulletin.title,
targetPreviewBody: bulletin.body,

  reason: "other",
  note: "",

  targetAuthorUid: bulletin.authorUid ?? null,
  targetAuthorName: bulletin.authorName ?? bulletin.authorEmail ?? null,

  reporterUid: currentUser.uid,
  reporterName: currentUser.displayName ?? currentUser.email ?? null,
  reporterEmail: currentUser.email ?? null,
});

            Alert.alert(
              "Reported",
              "Moderators have been notified."
            );
          } catch (err: any) {
            console.log(
              "[BulletinDetail] report bulletin failed",
              err
            );

            Alert.alert(
              "Report failed",
              err?.message ?? "Please try again."
            );
          } finally {
            setReportingBulletin(false);
          }
        },
      },
    ]
  );
};

const handleReportComment = async (comment: GroupBulletinCommentDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || !bulletin || reportingCommentIds.has(comment.id)) {
    return;
  }

  Alert.alert(
    "Report comment",
    "Report this comment to moderators?",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            setReportingCommentIds((prev) => {
              const next = new Set(prev);
              next.add(comment.id);
              return next;
            });

            await createGroupReport({
              groupId,

              targetType: "bulletin_comment",
              targetId: comment.id,

              bulletinId: bulletin.id,
              commentId: comment.id,

              reason: "other",
              note: "",

              targetPreviewTitle: `Comment on ${bulletin.title}`,
targetPreviewBody: comment.body,

              targetAuthorUid: comment.authorUid ?? null,
              targetAuthorName:
                comment.authorName ?? comment.authorEmail ?? null,

              reporterUid: currentUser.uid,
              reporterName: currentUser.displayName ?? currentUser.email ?? null,
              reporterEmail: currentUser.email ?? null,
            });

            Alert.alert("Reported", "Moderators have been notified.");
          } catch (err: any) {
            console.log("[BulletinDetail] report comment failed", err);
            Alert.alert("Report failed", err?.message ?? "Please try again.");
          } finally {
            setReportingCommentIds((prev) => {
              const next = new Set(prev);
              next.delete(comment.id);
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
          <Text style={styles.loadingText}>Loading bulletin...</Text>
        </View>
      ) : errorText ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Could not load bulletin</Text>
          <Text style={styles.emptyText}>{errorText}</Text>
        </View>
      ) : !bulletin || bulletin.deletedByAuthor || (bulletin.hiddenByModeration && !canUseHereMention) ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Bulletin unavailable</Text>
          <Text style={styles.emptyText}>
            This bulletin may have been removed or hidden by moderation.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Bulletin</Text>
{bulletin.hiddenByModeration ? (
  <View style={styles.hiddenModerationBadge}>
    <Text style={styles.hiddenModerationBadgeText}>
      Hidden by moderation
    </Text>
  </View>
) : null}
          <Text style={styles.title}>{bulletin.title}</Text>

<View style={styles.metaRow}>
  <Text style={styles.meta}>
    {bulletin.authorName ?? bulletin.authorEmail ?? "Someone"} ·{" "}
    {formatRelativeTime(bulletin.createdAtMs)}
  </Text>

<Pressable
  style={styles.reportButton}
  onPress={handleReportBulletin}
  disabled={reportingBulletin || !hasActiveMembership}
>
    <Text style={styles.reportButtonText}>
      Report
    </Text>
  </Pressable>
</View>

<Text style={styles.body}>{bulletin.body}</Text>

{canManageBulletin ? (
  <View style={styles.metaRow}>
    <Pressable style={styles.reportButton} onPress={beginEditBulletin}>
      <Text style={styles.reportButtonText}>Edit</Text>
    </Pressable>
    <Pressable style={styles.reportButton} onPress={requestDeleteBulletin}>
      <Text style={styles.reportButtonText}>Delete</Text>
    </Pressable>
  </View>
) : null}

{editingBulletin ? (
  <View style={styles.commentComposer}>
    <TextInput value={editTitle} onChangeText={setEditTitle} style={styles.commentInput} placeholder="Title" />
    <TextInput value={editBody} onChangeText={setEditBody} style={styles.commentInput} multiline placeholder="Message" />
    {editAttachments.map((attachment) => (
      <View key={attachment.id} style={styles.metaRow}>
        <Text style={styles.meta}>{attachment.fileName || attachment.title || attachment.type}</Text>
        <Pressable onPress={() => setEditAttachments((current) => current.filter((item) => item.id !== attachment.id))}>
          <Text style={styles.reportButtonText}>Remove</Text>
        </Pressable>
      </View>
    ))}
    {editNewMedia.map((item) => (
      <View key={item.id} style={styles.metaRow}>
        <Text style={styles.meta}>{item.candidate.fileName || item.candidate.type}</Text>
        <Pressable onPress={() => setEditNewMedia((current) => current.filter((candidate) => candidate.id !== item.id))}>
          <Text style={styles.reportButtonText}>Remove</Text>
        </Pressable>
      </View>
    ))}
    {editAttachments.length + editNewMedia.length < 4 ? (
      <Pressable style={styles.reportButton} onPress={pickEditMedia}>
        <Text style={styles.reportButtonText}>Add media</Text>
      </Pressable>
    ) : null}
    <View style={styles.metaRow}>
      <Pressable style={styles.reportButton} onPress={closeBulletinEditor}>
        <Text style={styles.reportButtonText}>Cancel</Text>
      </Pressable>
      <Pressable style={styles.reportButton} onPress={saveBulletinEdit} disabled={savingBulletin}>
        <Text style={styles.reportButtonText}>{savingBulletin ? "Saving…" : "Save"}</Text>
      </Pressable>
    </View>
    {editUploadStatus ? (
      <View>
        <Text style={styles.meta}>{editUploadStatus}</Text>
        {savingBulletin && editNewMedia.length > 0 ? (
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{Math.round(editUploadProgress * 100)}%</Text>
            <Pressable style={styles.reportButton} onPress={cancelBulletinEditUpload}>
              <Text style={styles.reportButtonText}>Cancel upload</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ) : null}
  </View>
) : null}

<MediaAttachmentGrid
  attachments={bulletin.attachments}
  theme={theme}
  onAttachmentPress={(_, index) => setViewerIndex(index)}
/>

{false && (bulletin?.videoUrls?.length ?? 0) > 0 ? (
  <View style={styles.bulletinVideoList}>
    {bulletin?.videoUrls?.map((videoUrl) => (
      <Pressable
        key={videoUrl}
        style={styles.bulletinVideoCard}
        onPress={() => {
          Linking.openURL(videoUrl).catch((err) => {
            console.log("[BulletinDetail] open video failed", err);
            Alert.alert("Could not open video", "Please try again.");
          });
        }}
      >
        <Text style={styles.bulletinVideoIcon}>🎬</Text>

        <View style={styles.bulletinVideoTextWrap}>
          <Text style={styles.bulletinVideoTitle}>Video link</Text>
          <Text style={styles.bulletinVideoUrl} numberOfLines={1}>
            {videoUrl}
          </Text>
        </View>

        <Text style={styles.bulletinVideoOpenText}>Open →</Text>
      </Pressable>
    ))}
  </View>
) : null}

<View style={styles.commentsSection}>
  <Text style={styles.commentsTitle}>
    Comments · {comments.length}
  </Text>

{hasActiveMembership ? (
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
      placeholder="Write a comment"
      placeholderTextColor={theme.colors.textMuted}
      style={styles.commentInput}
      multiline
      maxLength={COMMENT_MAX_LENGTH}
    />
    <CommentMediaCandidateTray
      disabled={postingComment}
      items={commentMedia}
      onRemove={(attachmentId) =>
        setCommentMedia((current) =>
          current.filter((item) => item.id !== attachmentId)
        )
      }
      theme={theme}
    />
    {commentMedia.length <
    getMediaAttachmentPolicy("bulletin_comment").maxAttachments ? (
      <Pressable
        accessibilityLabel="Add media to comment"
        accessibilityRole="button"
        disabled={postingComment}
        onPress={handlePickCommentMedia}
        style={styles.reportButton}
      >
        <Text style={styles.reportButtonText}>Add media</Text>
      </Pressable>
    ) : null}
    {commentUploadStatus ? (
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{commentUploadStatus}</Text>
        {postingComment && commentMedia.length > 0 ? (
          <Pressable onPress={cancelCommentUpload} style={styles.reportButton}>
            <Text style={styles.reportButtonText}>
              Cancel {Math.round(commentUploadProgress * 100)}%
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null}

    <Text style={styles.commentLengthText}>
      {commentInput.length}/{COMMENT_MAX_LENGTH}
    </Text>

    <Pressable
      style={[
        styles.commentButton,
        postingComment && styles.buttonDisabled,
      ]}
      onPress={handlePostComment}
      disabled={postingComment}
    >
      <Text style={styles.commentButtonText}>
        {postingComment ? "Posting..." : "Post comment"}
      </Text>
    </Pressable>
  </View>
  ) : null}

  {loadingComments ? (
    <View style={styles.inlineLoading}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={styles.loadingText}>Loading comments...</Text>
    </View>
  ) : commentsError ? (
    <Text style={styles.errorText}>{commentsError}</Text>
  ) : comments.length === 0 ? (
    <Text style={styles.emptyText}>
      No comments yet. Start the discussion.
    </Text>
  ) : (
    <View style={styles.commentList}>
      {comments.map((comment) => (
        <View key={comment.id} style={styles.commentRow}>
          <Text style={styles.commentAuthor}>
            {comment.authorName ?? comment.authorEmail ?? "Someone"}
          </Text>
{comment.hiddenByModeration ? (
  <Text style={styles.hiddenCommentBadge}>
    Hidden by moderation
  </Text>
) : null}
          <Text style={styles.commentBody}>{comment.body}</Text>
          {!comment.hiddenByModeration ? (
            <MediaAttachmentGrid
              attachments={comment.attachments}
              onAttachmentPress={(_, index) =>
                setCommentViewer({
                  attachments: comment.attachments,
                  index,
                })
              }
              theme={theme}
            />
          ) : null}

<View style={styles.commentMetaRow}>
  <Text style={styles.commentMeta}>
    {formatRelativeTime(comment.createdAtMs)}
  </Text>

<Pressable
  style={styles.commentReportButton}
  onPress={() => handleReportComment(comment)}
  disabled={reportingCommentIds.has(comment.id) || !hasActiveMembership}
>
    <Text style={styles.commentReportButtonText}>
      Report
    </Text>
  </Pressable>
</View>
        </View>
      ))}
    </View>
  )}
</View>
        </View>
      )}

      <MediaAttachmentViewer
        attachments={bulletin?.attachments ?? []}
        initialIndex={viewerIndex ?? 0}
        onRequestClose={() => setViewerIndex(null)}
        presentationTitle={bulletin?.title}
        visible={viewerIndex !== null}
      />
      <MediaAttachmentViewer
        attachments={commentViewer?.attachments ?? []}
        initialIndex={commentViewer?.index ?? 0}
        onRequestClose={() => setCommentViewer(null)}
        presentationTitle="Comment media"
        visible={commentViewer !== null}
      />
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    container: {
      padding: 18,
      paddingBottom: 40,
      backgroundColor: theme.colors.background,
      gap: 14,
    },

    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 8,
    },

    backButtonText: {
      color: theme.colors.primary,
      fontWeight: "900",
      fontSize: 14,
    },

    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 22,
      padding: 16,
    },

    eyebrow: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 8,
    },

    title: {
      color: theme.colors.text,
      fontSize: 24,
      fontWeight: "900",
      lineHeight: 30,
    },

    meta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 8,
    },

    body: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 18,
    },

    loadingText: {
      color: theme.colors.textMuted,
      fontWeight: "800",
      marginTop: 10,
      textAlign: "center",
    },

    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: "900",
    },

    emptyText: {
      color: theme.colors.textMuted,
      lineHeight: 20,
      marginTop: 8,
    },
    commentsSection: {
  marginTop: 22,
  paddingTop: 16,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},

commentsTitle: {
  color: theme.colors.text,
  fontSize: 16,
  fontWeight: "900",
},

commentComposer: {
  marginTop: 12,
  gap: 8,
},

commentInput: {
  minHeight: 72,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
  color: theme.colors.text,
  borderRadius: 14,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  lineHeight: 19,
  textAlignVertical: "top",
},

commentLengthText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  alignSelf: "flex-end",
},

commentButton: {
  alignSelf: "flex-end",
  backgroundColor: theme.colors.primary,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 9,
},

commentButtonText: {
  color: theme.colors.primaryText,
  fontWeight: "900",
  fontSize: 13,
},

buttonDisabled: {
  opacity: 0.55,
},

inlineLoading: {
  marginTop: 12,
  alignItems: "center",
  gap: 8,
},

errorText: {
  color: theme.colors.danger,
  fontWeight: "800",
  marginTop: 12,
},

commentList: {
  marginTop: 14,
  gap: 10,
},

commentRow: {
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

commentAuthor: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

commentBody: {
  color: theme.colors.text,
  fontSize: 14,
  lineHeight: 20,
  marginTop: 6,
},

commentMeta: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginTop: 8,
},
metaRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 8,
},

reportButton: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

reportButtonText: {
  color: theme.colors.danger,
  fontSize: 11,
  fontWeight: "900",
},
commentMetaRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 8,
},

commentReportButton: {
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

commentReportButtonText: {
  color: theme.colors.danger,
  fontSize: 11,
  fontWeight: "900",
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
bulletinImageGrid: {
  marginTop: 14,
  gap: 10,
},

bulletinImageWrap: {
  borderRadius: 16,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceMuted,
},

bulletinImage: {
  width: "100%",
  height: 220,
},
imageViewerBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.92)",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
},

imageViewerCloseButton: {
  position: "absolute",
  top: 54,
  right: 18,
  zIndex: 2,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: theme.colors.surface,
},

imageViewerCloseText: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

imageViewerImage: {
  width: "100%",
  height: "80%",
},
bulletinVideoList: {
  marginTop: 14,
  gap: 10,
},

bulletinVideoCard: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

bulletinVideoIcon: {
  fontSize: 20,
},

bulletinVideoTextWrap: {
  flex: 1,
  minWidth: 0,
},

bulletinVideoTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

bulletinVideoUrl: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
  marginTop: 2,
},

bulletinVideoOpenText: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
bulletinImageFallback: {
  width: "100%",
  height: 220,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.surfaceMuted,
},

bulletinImageFallbackText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "900",
},
hiddenModerationBadge: {
  alignSelf: "flex-start",
  marginBottom: 10,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
  borderWidth: 1,
},

hiddenModerationBadgeText: {
  color: theme.colors.dangerText,
  fontSize: 11,
  fontWeight: "900",
},
hiddenCommentBadge: {
  color: theme.colors.danger,
  fontSize: 11,
  fontWeight: "900",
  marginTop: 4,
},
  });
}
