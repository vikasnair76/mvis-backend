import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { auth } from "../../../../services/firebase";
import { MediaAttachmentGrid } from "../../../../components/MediaAttachmentGrid";
import { MediaAttachmentViewer } from "../../../../components/media/MediaAttachmentViewer";
import { MediaCandidateTray } from "../../../../components/media/CommentMediaCandidateTray";
import {
  pickComposerMediaCandidates,
  type PendingCommentMedia,
} from "../../../../components/media/commentMediaPicker";
import {
  cancelMediaUploadAttempt,
  createMediaUploadAttempt,
  deleteMediaAttachmentObjects,
  getMediaAttachmentPolicy,
  isCurrentMediaUploadAttempt,
  uploadContextMediaAttachmentBatch,
  type MediaAttachmentDoc,
  type MediaUploadAttempt,
  type MediaUploadBatchHandle,
} from "../../../../services/mediaAttachments";
import {
  cancelMediaUploadSession,
  createMediaUploadSession,
  finalizeMediaUploadSession,
} from "../../../../services/mediaUploadSessions";
import {
  clearGroupDmTyping,
  createGroupReport,
  deleteGroupDmMessageForAuthor,
  editGroupDmMessageForAuthor,
  markGroupDmRead,
  getSafeMessagePreview,
  reserveGroupDmMessageId,
  sendGroupDmMessage,
  subscribeGroupDmMessages,
  subscribeGroupDmReactions,
  subscribeGroupDmTyping,
  subscribeMyGroupDms,
  toggleGroupDmReaction,
  upsertGroupDmTyping,
  type GroupDmDoc,
  type GroupDmMessageDoc,
  type GroupDmReactionDoc,
  type GroupDmTypingDoc
} from "../../../../services/groups";
import { useAppTheme } from "../../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

const DM_MESSAGE_MAX_LENGTH = 2000;

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

function formatMessageTime(ms?: number | null): string {
  if (!ms) return "";

  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateSeparator(ms?: number | null): string {
  if (!ms) return "Recently";

  const date = new Date(ms);
  const today = new Date();

  const dateDay = new Date(date);
  dateDay.setHours(0, 0, 0, 0);

  const todayDay = new Date(today);
  todayDay.setHours(0, 0, 0, 0);

  const yesterdayDay = new Date(todayDay);
  yesterdayDay.setDate(yesterdayDay.getDate() - 1);

  if (dateDay.getTime() === todayDay.getTime()) return "Today";
  if (dateDay.getTime() === yesterdayDay.getTime()) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === today.getFullYear()
        ? undefined
        : "numeric",
  });
}

function getDayKey(ms?: number | null): string {
  if (!ms) return "recent";

  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export default function GroupDmThreadScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    dmId?: string;
  }>();

  const groupId = typeof params.id === "string" ? params.id : "";
  const dmId = typeof params.dmId === "string" ? params.dmId : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const scrollViewRef = useRef<ScrollView | null>(null);

  const messageYByIdRef = useRef<Record<string, number>>({});
const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
  null
);
const [dm, setDm] = useState<GroupDmDoc | null>(null);
const [dmMetadataLoaded, setDmMetadataLoaded] = useState(false);
const [messages, setMessages] = useState<GroupDmMessageDoc[]>([]);

const [dmUnavailableGraceDone, setDmUnavailableGraceDone] = useState(false);

const [replyingToMessage, setReplyingToMessage] =
  useState<GroupDmMessageDoc | null>(null);

const [editingMessage, setEditingMessage] =
  useState<GroupDmMessageDoc | null>(null);

const [actionMessage, setActionMessage] =
  useState<GroupDmMessageDoc | null>(null);



  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageMedia, setMessageMedia] = useState<PendingCommentMedia[]>([]);
  const [messageUploadStatus, setMessageUploadStatus] = useState<string | null>(null);
  const messageAttemptRef = useRef<MediaUploadAttempt | null>(null);
  const messageUploadHandleRef = useRef<MediaUploadBatchHandle | null>(null);
  const [viewerState, setViewerState] = useState<{
    attachments: MediaAttachmentDoc[];
    initialIndex: number;
  } | null>(null);

  const [typingItems, setTypingItems] = useState<GroupDmTypingDoc[]>([]);

  const [messageReactions, setMessageReactions] = useState<
  Record<string, GroupDmReactionDoc[]>
>({});
const lastTypingUpdateRef = useRef(0);

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const currentUid = auth.currentUser?.uid ?? "";

  useEffect(() => () => {
    if (messageAttemptRef.current) cancelMediaUploadAttempt(messageAttemptRef.current);
    messageUploadHandleRef.current?.cancel();
  }, []);

  const latestMessageAtMs = useMemo(() => {
  return messages.reduce((latest, message) => {
    return Math.max(latest, message.createdAtMs ?? 0);
  }, 0);
}, [messages]);

  useEffect(() => {
  const showSub = Keyboard.addListener("keyboardDidShow", (event) => {
    setKeyboardHeight(event.endCoordinates.height);
  });

  const hideSub = Keyboard.addListener("keyboardDidHide", () => {
    setKeyboardHeight(0);
  });

  return () => {
    showSub.remove();
    hideSub.remove();
  };
}, []);

useEffect(() => {
  if (!currentUid || !dmId || !dm || loadingMessages) return;
  if (messagesError) return;

  const alreadyReadAtMs = dm.lastReadByUid?.[currentUid] ?? 0;

  if (latestMessageAtMs > 0 && alreadyReadAtMs >= latestMessageAtMs) {
    return;
  }

  markGroupDmRead({
    dmId,
    uid: currentUid,
  }).catch((err) => {
    console.log("[GroupDmThread] mark DM read failed", err);
  });
}, [
  currentUid,
  dmId,
  dm,
  loadingMessages,
  messagesError,
  latestMessageAtMs,
]);

useEffect(() => {
  if (!dmId || !currentUid || !dm) {
    setTypingItems([]);
    return;
  }

  const unsub = subscribeGroupDmTyping(
    dmId,
    currentUid,
    setTypingItems,
    (err) => {
      console.log("[GroupDmThread] typing subscription failed", err);
    }
  );

  return unsub;
}, [dmId, currentUid, dm?.id]);

useEffect(() => {
  if (!currentUid || !dmId) {
    setDm(null);
    setDmMetadataLoaded(true);
    setDmUnavailableGraceDone(true);
    return;
  }

  setDmMetadataLoaded(false);
  setDmUnavailableGraceDone(false);

  const graceTimer = setTimeout(() => {
    setDmUnavailableGraceDone(true);
  }, 900);

  const unsub = subscribeMyGroupDms(
    currentUid,
    (items) => {
      setDm(items.find((item) => item.id === dmId) ?? null);
      setDmMetadataLoaded(true);
    },
    (err) => {
      console.log("[GroupDmThread] DM metadata subscription failed", err);
      setDm(null);
      setDmMetadataLoaded(true);
    }
  );

  return () => {
    clearTimeout(graceTimer);
    unsub();
  };
}, [currentUid, dmId]);

useEffect(() => {
  if (!dmMetadataLoaded || dm) {
    setDmUnavailableGraceDone(false);
    return;
  }

  const timer = setTimeout(() => {
    setDmUnavailableGraceDone(true);
  }, 900);

  return () => clearTimeout(timer);
}, [dmMetadataLoaded, dm]);

const dmIsOpening =
  !dmMetadataLoaded || (dmMetadataLoaded && !dm && !dmUnavailableGraceDone);

const dmUnavailable =
  dmMetadataLoaded && !dm && dmUnavailableGraceDone;

const otherParticipantLabel = useMemo(() => {
  if (!dm) {
  return loadingMessages
    ? "Loading conversation..."
    : "Private conversation";
}

  const otherUid =
    dm.participantUids.find((uid) => uid !== currentUid) ?? "";

  return (
    dm.participantNames?.[otherUid] ??
    dm.participantEmails?.[otherUid] ??
    "Group member"
  );
}, [dm, currentUid]);

const canReplyToMessage = (message: GroupDmMessageDoc) => {
  return (
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const canDeleteMessage = (message: GroupDmMessageDoc) => {
  return (
    message.senderUid === currentUid &&
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const canEditMessage = (message: GroupDmMessageDoc) => {
  return (
    message.senderUid === currentUid &&
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const handleStartEditMessage = (message: GroupDmMessageDoc) => {
  setEditingMessage(message);
  setReplyingToMessage(null);
  setMessageInput(message.body);
};

const handleDeleteMessage = (message: GroupDmMessageDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !dmId) return;

  Alert.alert(
    "Delete message?",
    "This will remove the message text for everyone in this conversation.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteGroupDmMessageForAuthor({
              dmId,
              messageId: message.id,
              uid: currentUser.uid,
            });
          } catch (err: any) {
            console.log("[GroupDmThread] delete message failed", err);
            Alert.alert("Delete failed", err?.message ?? "Please try again.");
          }
        },
      },
    ]
  );
};

const canCopyMessage = (message: {
  hiddenByModeration?: boolean;
  deletedByAuthor?: boolean;
}) => {
  return (
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const getReplyBodyPreview = (message: GroupDmMessageDoc) => {
const body = message.deletedByAuthor
  ? "Message deleted"
  : message.hiddenByModeration
  ? "Message removed by moderators"
  : message.body;

  return getSafeMessagePreview(body, message.attachments, 120);
};

const handleJumpToMessage = (messageId?: string | null) => {
  if (!messageId) return;

  const y = messageYByIdRef.current[messageId];

  if (typeof y !== "number") {
    Alert.alert(
      "Original message not loaded",
      "This reply points to an older message that is not currently loaded."
    );
    return;
  }

  scrollViewRef.current?.scrollTo({
    y: Math.max(0, y - 90),
    animated: true,
  });

  setHighlightedMessageId(messageId);

  setTimeout(() => {
    setHighlightedMessageId((current) =>
      current === messageId ? null : current
    );
  }, 1400);
};

const handleReportMessage = (message: GroupDmMessageDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !groupId || !dmId) {
    return;
  }

  if (message.hiddenByModeration || message.deletedByAuthor) {
  Alert.alert("Unavailable", "This message is no longer available.");
  return;
}

  if (message.senderUid === currentUser.uid) {
    Alert.alert("Cannot report", "You cannot report your own message.");
    return;
  }

  Alert.alert(
    "Report message?",
    "Moderators will be able to review this message.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          try {
            await createGroupReport({
              groupId,
              targetType: "dm_message",
              targetId: message.id,
              dmId,
              reason: "other",
              note: null,
              reporterUid: currentUser.uid,
              reporterName: currentUser.displayName ?? currentUser.email ?? null,
              reporterEmail: currentUser.email ?? null,
              targetAuthorUid: message.senderUid,
              targetAuthorName:
                message.senderName ?? message.senderEmail ?? null,
              targetPreviewTitle: `DM from ${
                message.senderName ?? message.senderEmail ?? "member"
              }`,
              targetPreviewBody: getSafeMessagePreview(
                message.body,
                message.attachments,
                200
              ),
            });

            Alert.alert("Report sent", "Thanks — moderators can review it.");
          } catch (err: any) {
            console.log("[GroupDmThread] report DM message failed", err);
            Alert.alert("Report failed", err?.message ?? "Please try again.");
          }
        },
      },
    ]
  );
};

const handleCopyMessage = async (message: GroupDmMessageDoc) => {
  if (!canCopyMessage(message)) {
    Alert.alert("Unavailable", "Removed messages cannot be copied.");
    return;
  }

  try {
    await Clipboard.setStringAsync(message.body);
    Alert.alert("Copied", "Message text copied.");
  } catch (err) {
    console.log("[GroupDmThread] copy message failed", err);
    Alert.alert("Copy failed", "Please try again.");
  }
};

const handleMessageLongPress = (
  message: GroupDmMessageDoc
) => {
  const currentUser = auth.currentUser;

if (!currentUser?.uid) return;

if (message.hiddenByModeration || message.deletedByAuthor) {
  Alert.alert("Message unavailable", "This message is no longer available.");
  return;
}

const react = async (
    emoji: "👍" | "❤️" | "🎉" | "👀"
  ) => {
    try {
      await toggleGroupDmReaction({
        dmId,
        messageId: message.id,
        uid: currentUser.uid,
        emoji,
        displayName:
          currentUser.displayName ?? null,
        email:
          currentUser.email ?? null,
      });
    } catch (err) {
      console.log(
        "[GroupDmThread] toggle reaction failed",
        err
      );
    }
  };

if (Platform.OS === "ios") {
  const options = [
    "Cancel",
    "👍 Like",
    "❤️ Love",
    "🎉 Celebrate",
    "👀 Seen",
    ...(canCopyMessage(message) ? ["Copy text"] : []),
    ...(canReplyToMessage(message) ? ["Reply"] : []),
    ...(canEditMessage(message) ? ["Edit"] : []),
    ...(canDeleteMessage(message) ? ["Delete"] : []),
    ...(message.senderUid !== currentUser.uid ? ["Report"] : []),
  ];

  ActionSheetIOS.showActionSheetWithOptions(
    {
      options,
      cancelButtonIndex: 0,
      destructiveButtonIndex: options.findIndex((option) => option === "Delete"),
    },
    (index) => {
      const selected = options[index];

      if (selected === "👍 Like") react("👍");
      if (selected === "❤️ Love") react("❤️");
      if (selected === "🎉 Celebrate") react("🎉");
      if (selected === "👀 Seen") react("👀");
      if (selected === "Copy text") handleCopyMessage(message);
      if (selected === "Reply") setReplyingToMessage(message);
      if (selected === "Edit") handleStartEditMessage(message);
      if (selected === "Delete") handleDeleteMessage(message);
      if (selected === "Report") handleReportMessage(message);
    }
  );
} else {
  setActionMessage(message);
}
};



const handleSendMessage = async () => {
  const currentUser = auth.currentUser;
  const body = messageInput.trim();

  if (!currentUser?.uid || !groupId || !dmId || !dm || sendingMessage) {
    return;
  }

  if ((!body && messageMedia.length === 0) || body.length > DM_MESSAGE_MAX_LENGTH) return;

  if (editingMessage) {
    if (!body) return;
    try {
      setSendingMessage(true);
      await editGroupDmMessageForAuthor({
        dmId,
        messageId: editingMessage.id,
        uid: currentUser.uid,
        body,
      });
      setEditingMessage(null);
      setMessageInput("");
    } catch (err: any) {
      Alert.alert("Message failed", err?.message ?? "Please try again.");
    } finally {
      setSendingMessage(false);
    }
    return;
  }

  const messageId = reserveGroupDmMessageId(dmId);
  const context = { type: "group_dm_message" as const, groupId, dmId, messageId };
  const attempt = createMediaUploadAttempt();
  messageAttemptRef.current = attempt;
  let sessionId: string | null = null;
  let uploaded: MediaAttachmentDoc[] = [];
  try {
    setSendingMessage(true);
    setMessageUploadStatus(messageMedia.length ? "Preparing attachments…" : null);
    if (messageMedia.length) {
      const session = await createMediaUploadSession({
        uploaderUid: currentUser.uid,
        context,
      });
      sessionId = session.id;
      const progressById = new Map<string, number>();
      const batch = uploadContextMediaAttachmentBatch({
        items: messageMedia.map((item) => ({
          attachmentId: item.id,
          candidate: item.candidate,
        })),
        uploaderUid: currentUser.uid,
        context,
        uploadSessionId: session.id,
        onItemProgress: (attachmentId, progress) => {
          if (!isCurrentMediaUploadAttempt(attempt, messageAttemptRef.current)) return;
          progressById.set(attachmentId, progress);
          const aggregate =
            [...progressById.values()].reduce((sum, value) => sum + value, 0) /
            messageMedia.length;
          setMessageUploadStatus(`Uploading attachments… ${Math.round(aggregate * 100)}%`);
        },
      });
      messageUploadHandleRef.current = batch;
      uploaded = (await batch.promise).attachments;
      if (!isCurrentMediaUploadAttempt(attempt, messageAttemptRef.current)) {
        throw new Error("cancelled");
      }
    }

    await sendGroupDmMessage({
      dmId,
      groupId,
      body,
      senderUid: currentUser.uid,
      senderName: currentUser.displayName ?? currentUser.email ?? null,
      senderEmail: currentUser.email ?? null,
      messageId,
      attachments: uploaded,
      replyTo: replyingToMessage
        ? {
            messageId: replyingToMessage.id,
            senderUid: replyingToMessage.senderUid,
            senderName:
              replyingToMessage.senderName ??
              replyingToMessage.senderEmail ??
              null,
            bodyPreview: getReplyBodyPreview(replyingToMessage),
          }
        : null,
    });

    setMessageInput("");
    setReplyingToMessage(null);
    setMessageMedia([]);
    setMessageUploadStatus(null);
    if (sessionId) {
      await finalizeMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }

    await clearGroupDmTyping({ dmId, groupId, uid: currentUser.uid }).catch(
      (err) => console.log("[GroupDmThread] clear typing after send failed", err)
    );

    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  } catch (err: any) {
    console.log("[GroupDmThread] send/edit message failed", err);
    if (uploaded.length) await deleteMediaAttachmentObjects(uploaded, context);
    if (sessionId) {
      await cancelMediaUploadSession(sessionId, currentUser.uid).catch(() => undefined);
    }
    const cancelled = attempt.cancelled;
    setMessageUploadStatus(cancelled ? "Upload cancelled." : "Message not sent.");
    Alert.alert(cancelled ? "Upload cancelled" : "Message failed", err?.message ?? "Please try again.");
  } finally {
    if (messageAttemptRef.current?.id === attempt.id) {
      messageAttemptRef.current = null;
      messageUploadHandleRef.current = null;
      setSendingMessage(false);
    }
  }
};

const handlePickMessageMedia = async () => {
  try {
    const selected = await pickComposerMediaCandidates({
      contextType: "group_dm_message",
      remaining: getMediaAttachmentPolicy("group_dm_message").maxAttachments - messageMedia.length,
      existingVideoCount: messageMedia.filter((item) => item.candidate.type === "video").length,
    });
    setMessageMedia((current) => [...current, ...selected]);
  } catch (error: any) {
    Alert.alert("Media not added", error?.message ?? "This media is not supported.");
  }
};

const cancelMessageUpload = () => {
  const attempt = messageAttemptRef.current;
  if (!attempt) return;
  cancelMediaUploadAttempt(attempt);
  messageUploadHandleRef.current?.cancel();
  setMessageUploadStatus("Cancelling upload…");
};

useEffect(() => {
  if (!dmId || !dm?.id) {
    setMessages([]);
    setLoadingMessages(false);
    return;
  }

  setLoadingMessages(true);
  setMessagesError(null);

  const unsub = subscribeGroupDmMessages(
    dmId,
    (items) => {
      setMessages(items);
      setLoadingMessages(false);

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    },
    (err) => {
      console.log("[GroupDmThread] messages subscription failed", err);
      setMessages([]);
      setMessagesError("Could not load messages.");
      setLoadingMessages(false);
    }
  );

  return unsub;
}, [dmId, dm?.id]);

useEffect(() => {
  if (!dmId || messages.length === 0) {
    setMessageReactions({});
    return;
  }

  const unsubs = messages.map((message) =>
    subscribeGroupDmReactions(
      dmId,
      message.id,
      (items) => {
        setMessageReactions((prev) => ({
          ...prev,
          [message.id]: items,
        }));
      },
      (err) => {
        console.log(
          "[GroupDmThread] reaction subscription failed",
          err
        );
      }
    )
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
  };
}, [dmId, messages]);

  useEffect(() => {
  return () => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || !dmId) {
      return;
    }

    clearGroupDmTyping({
      dmId,
      groupId,
      uid: currentUser.uid,
    }).catch((err) => {
      console.log("[GroupDmThread] clear typing on leave failed", err);
    });
  };
}, [groupId, dmId]);

useEffect(() => {
  if (!replyingToMessage) return;

  const stillExists = messages.some(
    (message) =>
      message.id === replyingToMessage.id &&
      message.hiddenByModeration !== true &&
      message.deletedByAuthor !== true
  );

  if (!stillExists) {
    setReplyingToMessage(null);
  }
}, [messages, replyingToMessage]);

useEffect(() => {
  if (!editingMessage) return;

  const stillEditable = messages.some(
    (message) =>
      message.id === editingMessage.id &&
      message.hiddenByModeration !== true &&
      message.deletedByAuthor !== true
  );

  if (!stillEditable) {
    setEditingMessage(null);
    setMessageInput("");
  }
}, [messages, editingMessage]);

  return (
<View style={styles.keyboardRoot}>
<ScrollView
  ref={scrollViewRef}
  style={styles.scrollArea}
  contentContainerStyle={styles.container}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="handled"
>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons
            name="chevron-back"
            size={18}
            color={theme.colors.primary}
          />
          <Text style={styles.backButtonText}>Messages</Text>
        </Pressable>

        <View style={styles.header}>
<Text style={styles.title}>{otherParticipantLabel}</Text>
<Text style={styles.subtitle}>
  Private group message · only participants can read this conversation. Long
  press a message for options.
</Text>
        </View>

        {dmIsOpening ? (
          <View style={styles.card}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading conversation...</Text>
          </View>
) : !dm && !dmUnavailableGraceDone ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Opening conversation...</Text>
  </View>
) : dmUnavailable ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>Conversation unavailable</Text>
            <Text style={styles.helperText}>
              You no longer have access to this private group conversation.
            </Text>
          </View>
        ) : loadingMessages ? (
          <View style={styles.card}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        ) : messagesError ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{messagesError}</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.helperText}>
              Start the private conversation below.
            </Text>
          </View>
        ) : (
          <View style={styles.messageList}>
{messages.map((message, index) => {
  const mine = message.senderUid === currentUid;

  const previousMessage = index > 0 ? messages[index - 1] : null;
const sameSenderAsPrevious =
  previousMessage?.senderUid === message.senderUid;

const withinFiveMinutes =
  previousMessage &&
  Math.abs(
    (message.createdAtMs ?? 0) -
      (previousMessage.createdAtMs ?? 0)
  ) <
    5 * 60 * 1000;

const groupedMessage =
  sameSenderAsPrevious && withinFiveMinutes;


  const showDateSeparator =
    !previousMessage ||
    getDayKey(previousMessage.createdAtMs) !== getDayKey(message.createdAtMs);

  return (
    <React.Fragment key={message.id}>
      {showDateSeparator ? (
        <View style={styles.dateSeparator}>
          <Text style={styles.dateSeparatorText}>
            {formatDateSeparator(message.createdAtMs)}
          </Text>
        </View>
      ) : null}
<Pressable
  style={[
    styles.messageBubble,
    mine ? styles.myMessageBubble : styles.theirMessageBubble,
    highlightedMessageId === message.id && styles.messageBubbleHighlighted,
  ]}
  onLayout={(event) => {
    messageYByIdRef.current[message.id] = event.nativeEvent.layout.y;
  }}
  onLongPress={() => handleMessageLongPress(message)}
  delayLongPress={350}
>
{!mine && !groupedMessage ? (
  <Text style={styles.messageAuthor}>
                      {message.senderName ?? message.senderEmail ?? "Member"}
                    </Text>
                  ) : null}

                  {message.replyTo ? (
<Pressable
  style={styles.replyPreviewBox}
  onPress={() => handleJumpToMessage(message.replyTo?.messageId)}
>
    <Text style={styles.replyPreviewTitle} numberOfLines={1}>
      Replying to {message.replyTo.senderName ?? "message"}
    </Text>
    <Text style={styles.replyPreviewBody} numberOfLines={2}>
      {message.replyTo.bodyPreview}
    </Text>
  </Pressable>
) : null}

                  {(message.body || message.deletedByAuthor || message.hiddenByModeration) ? <Text
  style={[
    styles.messageBody,
    mine && styles.myMessageBody,
    (message.hiddenByModeration || message.deletedByAuthor) &&
  styles.hiddenMessageBody,
  ]}
>
{message.deletedByAuthor
  ? "Message deleted"
  : message.hiddenByModeration
  ? "Message removed by moderators"
  : message.body}
</Text>
                  : null}
                  {!message.deletedByAuthor && !message.hiddenByModeration ? (
                    <MediaAttachmentGrid
                      attachments={message.attachments}
                      theme={theme}
                      onAttachmentPress={(_, index) =>
                        setViewerState({ attachments: message.attachments, initialIndex: index })
                      }
                    />
                  ) : null}

                  <Text
                    style={[
                      styles.messageMeta,
                      mine && styles.myMessageMeta,
                    ]}
                  >
                    {formatMessageTime(message.createdAtMs)}
{message.editedAtMs && !message.deletedByAuthor && !message.hiddenByModeration
  ? " · Edited"
  : ""}
                  </Text>
{messageReactions[message.id]?.length ? (
  <View style={styles.reactionRow}>
    {["👍", "❤️", "🎉", "👀"].map((emoji) => {
      const count =
        messageReactions[message.id].filter(
          (reaction) => reaction.emoji === emoji
        ).length;

      if (!count) return null;

      return (
        <View
          key={emoji}
          style={styles.reactionChip}
        >
          <Text style={styles.reactionChipText}>
            {emoji} {count}
          </Text>
        </View>
      );
    })}
  </View>
) : null}

                </Pressable>
                 </React.Fragment>
              );
            })}
          </View>
        )}
        {typingItems.length > 0 ? (
  <Text style={styles.typingIndicator}>
    {typingItems[0].displayName ?? typingItems[0].email ?? "Someone"} is typing...
  </Text>
) : null}
      </ScrollView>
{actionMessage ? (
  <Modal
    visible
    transparent
    animationType="fade"
    onRequestClose={() => setActionMessage(null)}
  >
    <Pressable
      style={styles.actionModalBackdrop}
      onPress={() => setActionMessage(null)}
    >
      <Pressable style={styles.actionModalCard} onPress={() => {}}>
        <Text style={styles.actionModalTitle}>Message actions</Text>

        <View style={styles.actionGrid}>
          <Pressable
            style={styles.actionButton}
            onPress={() => {
              toggleGroupDmReaction({
                dmId,
                messageId: actionMessage.id,
                uid: currentUid,
                emoji: "👍",
                displayName: auth.currentUser?.displayName ?? null,
                email: auth.currentUser?.email ?? null,
              });
              setActionMessage(null);
            }}
          >
            <Text style={styles.actionButtonText}>👍 Like</Text>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={() => {
              toggleGroupDmReaction({
                dmId,
                messageId: actionMessage.id,
                uid: currentUid,
                emoji: "❤️",
                displayName: auth.currentUser?.displayName ?? null,
                email: auth.currentUser?.email ?? null,
              });
              setActionMessage(null);
            }}
          >
            <Text style={styles.actionButtonText}>❤️ Love</Text>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={() => {
              handleCopyMessage(actionMessage);
              setActionMessage(null);
            }}
          >
            <Text style={styles.actionButtonText}>Copy text</Text>
          </Pressable>

          <Pressable
            style={styles.actionButton}
            onPress={() => {
              setReplyingToMessage(actionMessage);
              setActionMessage(null);
            }}
          >
            <Text style={styles.actionButtonText}>Reply</Text>
          </Pressable>

          {canEditMessage(actionMessage) ? (
            <Pressable
              style={styles.actionButton}
              onPress={() => {
                handleStartEditMessage(actionMessage);
                setActionMessage(null);
              }}
            >
              <Text style={styles.actionButtonText}>Edit</Text>
            </Pressable>
          ) : null}

          {canDeleteMessage(actionMessage) ? (
            <Pressable
              style={styles.actionButtonDanger}
              onPress={() => {
                const message = actionMessage;
                setActionMessage(null);
                handleDeleteMessage(message);
              }}
            >
              <Text style={styles.actionButtonDangerText}>Delete</Text>
            </Pressable>
          ) : null}

          {actionMessage.senderUid !== currentUid ? (
            <Pressable
              style={styles.actionButtonDanger}
              onPress={() => {
                const message = actionMessage;
                setActionMessage(null);
                handleReportMessage(message);
              }}
            >
              <Text style={styles.actionButtonDangerText}>Report</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={styles.actionCancelButton}
          onPress={() => setActionMessage(null)}
        >
          <Text style={styles.actionCancelButtonText}>Cancel</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>
) : null}

{dm ? (
<View style={[styles.composer, { bottom: keyboardHeight }]}>
        <Text style={styles.composerHint}>
  Private to this conversation.
</Text>
<Text style={styles.messageActionsHint}>
  Long press a message for more actions.
</Text>
{editingMessage ? (
  <View style={styles.composerReplyBox}>
    <View style={{ flex: 1 }}>
      <Text style={styles.composerReplyTitle}>Editing message</Text>
      <Text style={styles.composerReplyBody} numberOfLines={2}>
        {editingMessage.body}
      </Text>
    </View>

    <Pressable
      onPress={() => {
        setEditingMessage(null);
        setMessageInput("");
      }}
    >
      <Text style={styles.composerReplyCancel}>Cancel</Text>
    </Pressable>
  </View>
) : null}
{replyingToMessage ? (
  <View style={styles.composerReplyBox}>
    <View style={{ flex: 1 }}>
      <Text style={styles.composerReplyTitle} numberOfLines={1}>
        Replying to{" "}
        {replyingToMessage.senderUid === currentUid
          ? "your message"
          : replyingToMessage.senderName ??
            replyingToMessage.senderEmail ??
            "message"}
      </Text>

      <Text style={styles.composerReplyBody} numberOfLines={2}>
        {getReplyBodyPreview(replyingToMessage)}
      </Text>
    </View>

    <Pressable onPress={() => setReplyingToMessage(null)}>
      <Text style={styles.composerReplyCancel}>Cancel</Text>
    </Pressable>
  </View>
) : null}
        {!editingMessage ? (
          <>
            <MediaCandidateTray
              items={messageMedia}
              theme={theme}
              disabled={sendingMessage}
              onRemove={(attachmentId) =>
                setMessageMedia((current) => current.filter((item) => item.id !== attachmentId))
              }
            />
            <Pressable
              accessibilityRole="button"
              disabled={sendingMessage || messageMedia.length >= 4}
              onPress={handlePickMessageMedia}
              style={styles.mediaButton}
            >
              <Ionicons name="image-outline" size={18} color={theme.colors.primary} />
              <Text style={styles.mediaButtonText}>Add media</Text>
            </Pressable>
            {messageUploadStatus ? (
              <View style={styles.uploadStatusRow}>
                <Text style={styles.lengthText}>{messageUploadStatus}</Text>
                {sendingMessage && messageMedia.length ? (
                  <Pressable onPress={cancelMessageUpload}>
                    <Text style={styles.composerReplyCancel}>Cancel upload</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
        <TextInput
          value={messageInput}
          onChangeText={async (text) => {
  setMessageInput(text);

  const currentUser = auth.currentUser;
 if (!currentUser?.uid || !groupId || !dmId || !dm) return;

  try {
    if (!text.trim()) {
      await clearGroupDmTyping({
        dmId,
        groupId,
        uid: currentUser.uid,
      });
      return;
    }

    const nowMs = Date.now();

    if (nowMs - lastTypingUpdateRef.current < 2500) {
      return;
    }

    lastTypingUpdateRef.current = nowMs;

    await upsertGroupDmTyping({
      dmId,
      groupId,
      uid: currentUser.uid,
      displayName: currentUser.displayName ?? currentUser.email ?? null,
      email: currentUser.email ?? null,
    });
  } catch (err) {
    console.log("[GroupDmThread] update typing failed", err);
  }
}}
          placeholder="Write a private message..."
          placeholderTextColor={theme.colors.textMuted}
          style={styles.messageInput}
          multiline
          maxLength={DM_MESSAGE_MAX_LENGTH}
          editable={!sendingMessage}
        />

        <View style={styles.composerFooter}>
          <Text style={styles.lengthText}>
            {messageInput.length}/{DM_MESSAGE_MAX_LENGTH}
          </Text>

<Pressable
  style={[
    styles.sendButton,
    ((!messageInput.trim() && messageMedia.length === 0) || sendingMessage) &&
      styles.buttonDisabled,
  ]}
  onPress={handleSendMessage}
  disabled={(!messageInput.trim() && messageMedia.length === 0) || sendingMessage}
>
<Text style={styles.sendButtonText}>
  {sendingMessage
    ? "Sending..."
    : editingMessage
    ? "Save"
    : "Send"}
</Text>
          </Pressable>
        </View>
      </View>
      ) : null}
      <MediaAttachmentViewer
        visible={viewerState !== null}
        attachments={viewerState?.attachments ?? []}
        initialIndex={viewerState?.initialIndex ?? 0}
        onRequestClose={() => setViewerState(null)}
        presentationTitle="Message media"
      />
    </View>
  );
};

const makeStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    keyboardRoot: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },

    scrollArea: {
  flex: 1,
  backgroundColor: theme.colors.background,
},

    container: {
      flexGrow: 1,
      padding: 20,
      paddingTop: 70,
      paddingBottom: 180,
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
      fontSize: 30,
      fontWeight: "900",
    },

    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
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

    errorText: {
      color: theme.colors.danger,
      fontWeight: "800",
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

    messageList: {
      gap: 12,
    },

    messageBubble: {
      maxWidth: "82%",
      paddingHorizontal: 14,
paddingVertical: 10,
      borderRadius: 18,
      borderWidth: 1,
    },

    myMessageBubble: {
      alignSelf: "flex-end",
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
      borderBottomRightRadius: 6,
    },

    theirMessageBubble: {
      alignSelf: "flex-start",
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderBottomLeftRadius: 6,
    },

    messageAuthor: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "900",
      marginBottom: 4,
    },

    messageBody: {
      color: theme.colors.text,
      fontSize: 14,
      lineHeight: 20,
    },

    myMessageBody: {
      color: theme.colors.primaryText,
    },

    messageMeta: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
    marginTop: 8,
    },

    myMessageMeta: {
      color: theme.colors.primaryText,
      opacity: 0.8,
    },

    threadMetaCard: {
      marginTop: 18,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },

    threadMetaText: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
      marginTop: 4,
    },

composer: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: 14,
  paddingBottom: Platform.OS === "ios" ? 28 : 14,
  backgroundColor: theme.colors.surface,
  borderTopColor: theme.colors.border,
  borderTopWidth: 1,
},

    messageInput: {
      minHeight: 44,
      maxHeight: 120,
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

    composerFooter: {
      marginTop: 8,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },

    lengthText: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
    },

    sendButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 9,
    },

    sendButtonText: {
      color: theme.colors.primaryText,
      fontWeight: "900",
      fontSize: 13,
    },

    buttonDisabled: {
      opacity: 0.55,
    },
    composerHint: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "800",
  marginBottom: 8,
},

hiddenMessageBody: {
  fontStyle: "italic",
  opacity: 0.75,
  color: theme.colors.textMuted,
},
dateSeparator: {
  alignSelf: "center",
  marginVertical: 8,
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

dateSeparatorText: {
  color: theme.colors.textMuted,
  fontSize: 11,
  fontWeight: "900",
},
typingIndicator: {
  fontStyle: "italic",
  alignSelf: "flex-start",
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
  marginTop: 8,
  marginLeft: 4,
  marginBottom: 8,
},
messageActionsHint: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "700",
  marginBottom: 8,
},
reactionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
},

reactionChip: {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  marginRight: 6,
  marginTop: 4,
},

reactionChipText: {
  color: theme.colors.text,
  fontSize: 11,
  fontWeight: "800",
},
replyPreviewBox: {
  marginBottom: 8,
  padding: 8,
  borderRadius: 12,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

replyPreviewTitle: {
  color: theme.colors.textMuted,
  fontSize: 10,
  fontWeight: "900",
},

replyPreviewBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 16,
  marginTop: 3,
},

composerReplyBox: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
  padding: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

composerReplyTitle: {
  color: theme.colors.text,
  fontSize: 12,
  fontWeight: "900",
},

composerReplyBody: {
  color: theme.colors.textMuted,
  fontSize: 12,
  lineHeight: 16,
  marginTop: 2,
},

composerReplyCancel: {
  color: theme.colors.primary,
  fontSize: 12,
  fontWeight: "900",
},
mediaButton: {
  alignSelf: "flex-start",
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingVertical: 8,
},
mediaButtonText: {
  color: theme.colors.primary,
  fontWeight: "700",
},
uploadStatusRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},
messageBubbleHighlighted: {
  borderWidth: 2,
  borderColor: theme.colors.primary,
},
actionModalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  justifyContent: "flex-end",
  padding: 16,
},

actionModalCard: {
  borderRadius: 24,
  padding: 16,
  paddingBottom: 20,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

actionModalTitle: {
  color: theme.colors.text,
  fontSize: 18,
  fontWeight: "900",
  marginBottom: 12,
},

actionGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

actionButton: {
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

actionButtonText: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

actionButtonDanger: {
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderRadius: 14,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.danger,
  borderWidth: 1,
},

actionButtonDangerText: {
  color: theme.colors.danger,
  fontSize: 13,
  fontWeight: "900",
},

actionCancelButton: {
  marginTop: 12,
  paddingVertical: 11,
  borderRadius: 14,
  alignItems: "center",
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

actionCancelButtonText: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
},
  });
