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
  View,
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
  archiveGroupConversation,
  clearGroupConversationTyping,
  createGroupReport,
  deleteGroupConversationMessageForAuthor,
  editGroupConversationMessageForAuthor,
  leaveGroupConversation,
  markGroupConversationRead,
  getSafeMessagePreview,
  reserveGroupConversationMessageId,
  restoreGroupConversationForUser,
  sendGroupConversationMessage,
  setGroupConversationMuted,
  subscribeGroupConversationMessages,
  subscribeGroupConversationMute,
  subscribeGroupConversationReactions,
  subscribeGroupConversationTyping,
  subscribeGroupMembers,
  subscribeMyArchivedGroupConversations,
  subscribeMyGroupConversations,
  toggleGroupConversationReaction,
  updateGroupConversationDetails,
  updateGroupConversationMembers,
  upsertGroupConversationTyping,
  type GroupConversationDoc,
  type GroupConversationMessageDoc,
  type GroupConversationMuteDoc,
  type GroupConversationReactionDoc,
  type GroupConversationTypingDoc,
  type GroupMemberDoc,
} from "../../../../services/groups";
import { useAppTheme } from "../../../../services/useAppTheme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

const CONVERSATION_MESSAGE_MAX_LENGTH = 2000;

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
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function getDayKey(ms?: number | null): string {
  if (!ms) return "recent";

  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export default function GroupConversationThreadScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    conversationId?: string;
  }>();

  const groupId = typeof params.id === "string" ? params.id : "";
  const conversationId =
    typeof params.conversationId === "string" ? params.conversationId : "";

  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const scrollViewRef = useRef<ScrollView | null>(null);

  const messageYByIdRef = useRef<Record<string, number>>({});
const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
  null
);

  const currentUid = auth.currentUser?.uid ?? "";

  useEffect(() => () => {
    if (messageAttemptRef.current) cancelMediaUploadAttempt(messageAttemptRef.current);
    messageUploadHandleRef.current?.cancel();
  }, []);

  

const [conversation, setConversation] =
  useState<GroupConversationDoc | null>(null);
const [conversationMetadataLoaded, setConversationMetadataLoaded] =
  useState(false);
const [messages, setMessages] = useState<GroupConversationMessageDoc[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);

const [replyingToMessage, setReplyingToMessage] =
  useState<GroupConversationMessageDoc | null>(null);

const [editingMessage, setEditingMessage] =
  useState<GroupConversationMessageDoc | null>(null);

const [actionMessage, setActionMessage] =
  useState<GroupConversationMessageDoc | null>(null);
  
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);

    const [typingItems, setTypingItems] = useState<GroupConversationTypingDoc[]>(
    []
  );
  const lastTypingUpdateRef = useRef(0);

const conversationUnavailable =
  conversationMetadataLoaded && !conversation;
const latestMessageAtMs = useMemo(() => {
  return messages.reduce((latest, message) => {
    return Math.max(latest, message.createdAtMs ?? 0);
  }, 0);
}, [messages]);

const canReplyToMessage = (message: GroupConversationMessageDoc) => {
  return (
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};
const canDeleteMessage = (message: GroupConversationMessageDoc) => {
  return (
    message.senderUid === currentUid &&
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const canEditMessage = (message: GroupConversationMessageDoc) => {
  return (
    message.senderUid === currentUid &&
    message.hiddenByModeration !== true &&
    message.deletedByAuthor !== true
  );
};

const handleStartEditMessage = (message: GroupConversationMessageDoc) => {
  setEditingMessage(message);
  setReplyingToMessage(null);
  setMessageInput(message.body);
};

const handleDeleteMessage = (message: GroupConversationMessageDoc) => {
  const currentUser = auth.currentUser;

  if (!currentUser?.uid || !conversationId) return;

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
            await deleteGroupConversationMessageForAuthor({
              conversationId,
              messageId: message.id,
              uid: currentUser.uid,
            });
          } catch (err: any) {
            console.log("[GroupConversationThread] delete message failed", err);
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

const getReplyBodyPreview = (message: GroupConversationMessageDoc) => {
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


const conversationArchivedForMe =
  !!currentUid && conversation?.archivedByUid?.[currentUid] === true;

const canSendConversationMessage = !!conversation && !sendingMessage;

    const [messageReactions, setMessageReactions] = useState<
    Record<string, GroupConversationReactionDoc[]>
  >({});

    const [showEditConversationModal, setShowEditConversationModal] =
    useState(false);
  const [editConversationTitle, setEditConversationTitle] = useState("");
  const [editConversationSubject, setEditConversationSubject] = useState("");
  const [savingConversationDetails, setSavingConversationDetails] =
    useState(false);

      const [archivingConversation, setArchivingConversation] = useState(false);
const [restoringConversation, setRestoringConversation] = useState(false);
        const [leavingConversation, setLeavingConversation] = useState(false);

          const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);

    const [conversationMute, setConversationMute] =
    useState<GroupConversationMuteDoc | null>(null);
  const [updatingMute, setUpdatingMute] = useState(false);

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
  if (!currentUid || !conversationId || !conversation || loadingMessages) return;
  if (messagesError) return;

  const alreadyReadAtMs = conversation.lastReadByUid?.[currentUid] ?? 0;

  if (latestMessageAtMs > 0 && alreadyReadAtMs >= latestMessageAtMs) {
    return;
  }

  markGroupConversationRead({
    conversationId,
    uid: currentUid,
  }).catch((err) => {
    console.log("[GroupConversationThread] mark read failed", err);
  });
}, [
  currentUid,
  conversationId,
  conversation,
  loadingMessages,
  messagesError,
  latestMessageAtMs,
]);

useEffect(() => {
  if (!currentUid || !conversationId) {
    setConversation(null);
    setConversationMetadataLoaded(true);
    return;
  }

  setConversationMetadataLoaded(false);

let activeItems: GroupConversationDoc[] = [];
let archivedItems: GroupConversationDoc[] = [];

const syncConversation = () => {
  setConversation(
    [...activeItems, ...archivedItems].find(
      (item) => item.id === conversationId
    ) ?? null
  );
  setConversationMetadataLoaded(true);
};

const unsubActive = subscribeMyGroupConversations(
  currentUid,
  (items) => {
    activeItems = items;
    syncConversation();
  },
  (err) => {
    console.log("[GroupConversationThread] active metadata subscription failed", err);
  }
);

const unsubArchived = subscribeMyArchivedGroupConversations(
  currentUid,
  (items) => {
    archivedItems = items;
    syncConversation();
  },
  (err) => {
    console.log("[GroupConversationThread] archived metadata subscription failed", err);
  }
);

return () => {
  unsubActive();
  unsubArchived();
};

   
  }, [currentUid, conversationId]);

    useEffect(() => {
    if (!currentUid || !conversationId || !conversation) {
      setConversationMute(null);
      return;
    }

    const unsub = subscribeGroupConversationMute(
      currentUid,
      conversationId,
      setConversationMute,
      (err) => {
        console.log("[GroupConversationThread] mute subscription failed", err);
      }
    );

    return unsub;
  }, [currentUid, conversationId, conversation]);

    useEffect(() => {
  if (!conversationId || !currentUid || !conversation) {
      setTypingItems([]);
      return;
    }

    const unsub = subscribeGroupConversationTyping(
      conversationId,
      currentUid,
      setTypingItems,
      (err) => {
        console.log("[GroupConversationThread] typing subscription failed", err);
      }
    );

    return unsub;
  }, [conversationId, currentUid, conversation]);

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
        console.log("[GroupConversationThread] members subscription failed", err);
      }
    );

    return unsub;
  }, [groupId]);

    useEffect(() => {
    if (!conversationId || messages.length === 0) {
      setMessageReactions({});
      return;
    }

    const unsubs = messages.map((message) =>
      subscribeGroupConversationReactions(
        conversationId,
        message.id,
        (items) => {
          setMessageReactions((current) => ({
            ...current,
            [message.id]: items,
          }));
        },
        (err) => {
          console.log(
            "[GroupConversationThread] reaction subscription failed",
            err
          );
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [conversationId, messages]);

    useEffect(() => {
    return () => {
      const currentUser = auth.currentUser;

      if (!currentUser?.uid || !groupId || !conversationId) {
        return;
      }

      clearGroupConversationTyping({
        conversationId,
        groupId,
        uid: currentUser.uid,
      }).catch((err) => {
        console.log("[GroupConversationThread] clear typing on leave failed", err);
      });
    };
  }, [groupId, conversationId]);

useEffect(() => {
  if (!conversationId || !conversation) {
    setMessages([]);
    setLoadingMessages(false);
    return;
  }

    setLoadingMessages(true);
    setMessagesError(null);

    const unsub = subscribeGroupConversationMessages(
      conversationId,
      (items) => {
        setMessages(items);
        setLoadingMessages(false);

        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      (err) => {
        console.log(
          "[GroupConversationThread] messages subscription failed",
          err
        );
setMessages([]);
setMessagesError("Could not load messages.");
setLoadingMessages(false);
      }
    );

    return unsub;
  }, [conversationId, conversation]);

  useEffect(() => {
  if (!replyingToMessage) return;

  const stillExists = messages.some(
    (message) =>
      message.id === replyingToMessage.id &&
      message.hiddenByModeration !== true
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

    const handleToggleConversationMember = async (uid: string) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !conversation || savingMembers) return;

    if (uid === currentUser.uid) {
      Alert.alert("Cannot remove yourself", "Use Leave conversation instead.");
      return;
    }

    const currentMemberUids = conversation.memberUids;
    const isAlreadyMember = currentMemberUids.includes(uid);

    const nextMemberUids = isAlreadyMember
      ? currentMemberUids.filter((memberUid) => memberUid !== uid)
      : [...currentMemberUids, uid];

    try {
      setSavingMembers(true);

      await updateGroupConversationMembers({
        conversationId,
        groupId,
        actorUid: currentUser.uid,
        nextMemberUids,
      });
    } catch (err: any) {
      console.log("[GroupConversationThread] update members failed", err);
      Alert.alert("Update failed", err?.message ?? "Please try again.");
    } finally {
      setSavingMembers(false);
    }
  };

    const handleOpenEditConversation = () => {
    setEditConversationTitle(conversation?.title ?? "");
    setEditConversationSubject(conversation?.subject ?? "");
    setShowEditConversationModal(true);
  };

  const handleSaveConversationDetails = async () => {
    const currentUser = auth.currentUser;
    const title = editConversationTitle.trim();

    if (
      !currentUser?.uid ||
      !groupId ||
      !conversationId ||
      savingConversationDetails
    ) {
      return;
    }

    if (!title) {
      Alert.alert("Title required", "Add a conversation title first.");
      return;
    }

    try {
      setSavingConversationDetails(true);

      await updateGroupConversationDetails({
        conversationId,
        groupId,
        title,
        subject: editConversationSubject.trim() || null,
        actorUid: currentUser.uid,
      });

      setShowEditConversationModal(false);
    } catch (err: any) {
      console.log("[GroupConversationThread] update details failed", err);
      Alert.alert("Update failed", err?.message ?? "Please try again.");
    } finally {
      setSavingConversationDetails(false);
    }
  };

    const handleToggleConversationMute = async () => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || !conversationId || updatingMute) {
      return;
    }

    try {
      setUpdatingMute(true);

      await setGroupConversationMuted({
        conversationId,
        groupId,
        uid: currentUser.uid,
        muted: conversationMute?.muted !== true,
      });
    } catch (err: any) {
      console.log("[GroupConversationThread] toggle mute failed", err);
      Alert.alert("Mute failed", err?.message ?? "Please try again.");
    } finally {
      setUpdatingMute(false);
    }
  };

    const handleLeaveConversation = () => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || !conversationId || leavingConversation) {
      return;
    }

    Alert.alert(
      "Leave conversation?",
      "You will stop seeing this conversation and will not receive new messages from it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              setLeavingConversation(true);

              await leaveGroupConversation({
                conversationId,
                groupId,
                actorUid: currentUser.uid,
              });

              router.back();
            } catch (err: any) {
              console.log("[GroupConversationThread] leave failed", err);
              Alert.alert("Leave failed", err?.message ?? "Please try again.");
            } finally {
              setLeavingConversation(false);
            }
          },
        },
      ]
    );
  };

    const handleArchiveConversation = () => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || !conversationId || archivingConversation) {
      return;
    }

    Alert.alert(
      "Archive conversation?",
      "This will hide the conversation from active conversation lists and prevent new messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            try {
              setArchivingConversation(true);

              await archiveGroupConversation({
                conversationId,
                groupId,
                actorUid: currentUser.uid,
              });

              router.back();
            } catch (err: any) {
              console.log("[GroupConversationThread] archive failed", err);
              Alert.alert("Archive failed", err?.message ?? "Please try again.");
            } finally {
              setArchivingConversation(false);
            }
          },
        },
      ]
    );
  };

  const handleRestoreConversation = async () => {
  const currentUser = auth.currentUser;

  if (
    !currentUser?.uid ||
    !groupId ||
    !conversationId ||
    restoringConversation
  ) {
    return;
  }

  try {
    setRestoringConversation(true);

    await restoreGroupConversationForUser({
      conversationId,
      groupId,
      actorUid: currentUser.uid,
    });
  } catch (err: any) {
    console.log("[GroupConversationThread] restore failed", err);
    Alert.alert("Restore failed", err?.message ?? "Please try again.");
  } finally {
    setRestoringConversation(false);
  }
};

    const handleReportMessage = (message: GroupConversationMessageDoc) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !groupId || !conversationId) return;

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
      "Moderators will be able to review this conversation message.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            try {
              await createGroupReport({
                groupId,
                targetType: "conversation_message",
                targetId: message.id,
                conversationId,
                reason: "other",
                note: null,
                reporterUid: currentUser.uid,
                reporterName:
                  currentUser.displayName ?? currentUser.email ?? null,
                reporterEmail: currentUser.email ?? null,
                targetAuthorUid: message.senderUid,
                targetAuthorName:
                  message.senderName ?? message.senderEmail ?? null,
                targetPreviewTitle: `Conversation message from ${
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
              console.log(
                "[GroupConversationThread] report message failed",
                err
              );
              Alert.alert("Report failed", err?.message ?? "Please try again.");
            }
          },
        },
      ]
    );
  };

  const handleCopyMessage = async (message: GroupConversationMessageDoc) => {
  if (!canCopyMessage(message)) {
    Alert.alert("Unavailable", "Removed messages cannot be copied.");
    return;
  }

  try {
    await Clipboard.setStringAsync(message.body);
    Alert.alert("Copied", "Message text copied.");
  } catch (err) {
    console.log("[GroupConversationThread] copy message failed", err);
    Alert.alert("Copy failed", "Please try again.");
  }
};

    const handleMessageLongPress = (message: GroupConversationMessageDoc) => {
    const currentUser = auth.currentUser;

    if (!currentUser?.uid || !conversationId) return;

if (message.hiddenByModeration || message.deletedByAuthor) {
  Alert.alert("Message unavailable", "This message is no longer available.");
  return;
}

    const react = async (emoji: "👍" | "❤️" | "🎉" | "👀") => {
      try {
        await toggleGroupConversationReaction({
          conversationId,
          messageId: message.id,
          uid: currentUser.uid,
          emoji,
          displayName: currentUser.displayName ?? null,
          email: currentUser.email ?? null,
        });
      } catch (err) {
        console.log("[GroupConversationThread] toggle reaction failed", err);
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
    destructiveButtonIndex: options.findIndex(
      (option) => option === "Delete"
    ),
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
      return;
    }

    setActionMessage(message);
  };

  const handleSendMessage = async () => {
    const currentUser = auth.currentUser;
    const body = messageInput.trim();

   if (
  !currentUser?.uid ||
  !groupId ||
  !conversationId ||
  !conversation ||
  sendingMessage
) {
  return;
}
    if (!body && messageMedia.length === 0) return;
    if (body.length > CONVERSATION_MESSAGE_MAX_LENGTH) return;

    if (editingMessage) {
      if (!body) return;
      try {
        setSendingMessage(true);
        await editGroupConversationMessageForAuthor({
          conversationId,
          messageId: editingMessage.id,
          uid: currentUser.uid,
          body,
        });
        setMessageInput("");
        setEditingMessage(null);
      } catch (err: any) {
        Alert.alert("Message failed", err?.message ?? "Please try again.");
      } finally {
        setSendingMessage(false);
      }
      return;
    }

    const messageId = reserveGroupConversationMessageId(conversationId);
    const context = {
      type: "group_conversation_message" as const,
      groupId,
      conversationId,
      messageId,
    };
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

      await sendGroupConversationMessage({
        conversationId,
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

      await clearGroupConversationTyping({
        conversationId,
        groupId,
        uid: currentUser.uid,
      }).catch((err) => {
        console.log("[GroupConversationThread] clear typing after send failed", err);
      });

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err: any) {
      console.log("[GroupConversationThread] send message failed", err);
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
        contextType: "group_conversation_message",
        remaining:
          getMediaAttachmentPolicy("group_conversation_message").maxAttachments -
          messageMedia.length,
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
          <Text style={styles.backButtonText}>Conversations</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>
            {conversation?.title ?? "Group conversation"}
          </Text>

          <Text style={styles.subtitle}>
            {conversation?.subject
              ? conversation.subject
              : "Shared group conversation · members can read and reply here. Long press a message for reactions."}
          </Text>
          {conversationArchivedForMe ? (
  <View style={styles.archivedNotice}>
<Text style={styles.archivedNoticeTitle}>Archived for you</Text>
<Text style={styles.archivedNoticeText}>
  This conversation is hidden from your active messages list. You can still read
  and reply here.
</Text>
  </View>
) : null}
          {conversationMute?.muted === true ? (
            <Text style={styles.mutedNotice}>
              Muted · new messages will not create inbox notifications for you.
            </Text>
          ) : null}
          <View style={styles.conversationHeaderActions}>
            <Pressable
              style={[
  styles.editConversationButton,
]}
              onPress={handleOpenEditConversation}
              disabled={!conversation}
            >
              <Text style={styles.editConversationButtonText}>
                Edit conversation
              </Text>
            </Pressable>
            <Pressable
              style={[
  styles.editConversationButton,
  
]}
              onPress={() => setShowMembersModal(true)}
             disabled={!conversation}
            >
              <Text style={styles.editConversationButtonText}>
                Members
              </Text>
            </Pressable>
                        <Pressable
              style={[
                styles.editConversationButton,
                updatingMute && styles.buttonDisabled,
              ]}
              onPress={handleToggleConversationMute}
              disabled={!conversation || updatingMute}
            >
              <Text style={styles.editConversationButtonText}>
                {conversationMute?.muted === true ? "Unmute" : "Mute"}
              </Text>
            </Pressable>
{!conversationArchivedForMe ? (
  <Pressable
    style={[
      styles.archiveConversationButton,
      (!conversation || archivingConversation) && styles.buttonDisabled,
    ]}
    onPress={handleArchiveConversation}
    disabled={!conversation || archivingConversation}
  >
    <Text style={styles.archiveConversationButtonText}>
      {archivingConversation ? "Archiving..." : "Archive"}
    </Text>
  </Pressable>
) : null}
{conversationArchivedForMe ? (
  <Pressable
    style={[
      styles.editConversationButton,
      restoringConversation && styles.buttonDisabled,
    ]}
    onPress={handleRestoreConversation}
    disabled={!conversation || restoringConversation}
  >
    <Text style={styles.editConversationButtonText}>
      {restoringConversation ? "Moving..." : "Move to active"}
    </Text>
  </Pressable>
) : null}
                        <Pressable
              style={[
                styles.leaveConversationButton,
(!conversation || leavingConversation) && styles.buttonDisabled,
              ]}
              onPress={handleLeaveConversation}
              disabled={!conversation || leavingConversation}
            >
              <Text style={styles.leaveConversationButtonText}>
                {leavingConversation ? "Leaving..." : "Leave"}
              </Text>
            </Pressable>
          </View>
        </View>

{!conversationMetadataLoaded ? (
  <View style={styles.card}>
    <ActivityIndicator color={theme.colors.primary} />
    <Text style={styles.loadingText}>Loading conversation...</Text>
  </View>
) : conversationUnavailable ? (
  <View style={styles.card}>
    <Text style={styles.emptyTitle}>Conversation unavailable</Text>
    <Text style={styles.helperText}>
      This conversation may have been archived, removed, or you may no longer be
      a member.
    </Text>
  </View>
) : messagesError ? (
  <View style={styles.card}>
    <Text style={styles.errorText}>{messagesError}</Text>
  </View>
        ) : messages.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.helperText}>
              Start the group conversation below.
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

              const groupedMessage = sameSenderAsPrevious && withinFiveMinutes;

              const showDateSeparator =
                !previousMessage ||
                getDayKey(previousMessage.createdAtMs) !==
                  getDayKey(message.createdAtMs);

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
                    </Text> : null}
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
                          const count = messageReactions[message.id].filter(
                            (reaction) => reaction.emoji === emoji
                          ).length;

                          if (!count) return null;

                          return (
                            <View key={emoji} style={styles.reactionChip}>
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
            {typingItems[0].displayName ?? typingItems[0].email ?? "Someone"}{" "}
            is typing...
          </Text>
        ) : null}
      </ScrollView>
            <Modal
        visible={!!actionMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMessage(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setActionMessage(null)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Message actions</Text>

            <View style={styles.conversationHeaderActions}>
              {actionMessage ? (
                <>
                  <Pressable
                    style={styles.editConversationButton}
                    onPress={() => {
                      toggleGroupConversationReaction({
                        conversationId,
                        messageId: actionMessage.id,
                        uid: currentUid,
                        emoji: "👍",
                        displayName: auth.currentUser?.displayName ?? null,
                        email: auth.currentUser?.email ?? null,
                      });
                      setActionMessage(null);
                    }}
                  >
                    <Text style={styles.editConversationButtonText}>👍 Like</Text>
                  </Pressable>

                  <Pressable
                    style={styles.editConversationButton}
                    onPress={() => {
                      handleCopyMessage(actionMessage);
                      setActionMessage(null);
                    }}
                  >
                    <Text style={styles.editConversationButtonText}>Copy text</Text>
                  </Pressable>

                  <Pressable
                    style={styles.editConversationButton}
                    onPress={() => {
                      setReplyingToMessage(actionMessage);
                      setActionMessage(null);
                    }}
                  >
                    <Text style={styles.editConversationButtonText}>Reply</Text>
                  </Pressable>

                  {canEditMessage(actionMessage) ? (
                    <Pressable
                      style={styles.editConversationButton}
                      onPress={() => {
                        handleStartEditMessage(actionMessage);
                        setActionMessage(null);
                      }}
                    >
                      <Text style={styles.editConversationButtonText}>Edit</Text>
                    </Pressable>
                  ) : null}

                  {canDeleteMessage(actionMessage) ? (
                    <Pressable
                      style={styles.archiveConversationButton}
                      onPress={() => {
                        handleDeleteMessage(actionMessage);
                        setActionMessage(null);
                      }}
                    >
                      <Text style={styles.archiveConversationButtonText}>Delete</Text>
                    </Pressable>
                  ) : null}
                                   {actionMessage.senderUid !== currentUid ? (
                    <Pressable
                      style={styles.archiveConversationButton}
                      onPress={() => {
                        handleReportMessage(actionMessage);
                        setActionMessage(null);
                      }}
                    >
                      <Text style={styles.archiveConversationButtonText}>Report</Text>
                    </Pressable>
                  ) : null} 
                </>
              ) : null}
            </View>

            <Pressable
              style={styles.cancelConversationButton}
              onPress={() => setActionMessage(null)}
            >
              <Text style={styles.cancelConversationButtonText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={showMembersModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingMembers) setShowMembersModal(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (!savingMembers) setShowMembersModal(false);
          }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Conversation members</Text>

            <Text style={styles.helperText}>
              Add or remove active group members from this conversation.{" "}
              {conversation?.memberUids.length ?? 0} selected.
            </Text>

            <View style={styles.memberManageList}>
              {members.map((member) => {
                const isCurrentUser = member.uid === currentUid;
                const selected =
                  conversation?.memberUids.includes(member.uid) ?? false;

                return (
                  <Pressable
                    key={member.uid}
                    style={[
                      styles.memberManageRow,
                      selected && styles.memberManageRowSelected,
                    ]}
                    onPress={() => handleToggleConversationMember(member.uid)}
                    disabled={savingMembers || isCurrentUser}
                  >
                    <View style={styles.memberManageAvatar}>
                      <Text style={styles.memberManageAvatarText}>
                        {(member.displayName ?? member.email ?? "?")
                          .slice(0, 1)
                          .toUpperCase()}
                      </Text>
                    </View>

                    <View style={styles.memberManageInfo}>
                      <Text style={styles.memberManageName} numberOfLines={1}>
                        {member.displayName ?? member.email ?? member.uid}
                      </Text>

                      <Text style={styles.memberManageMeta} numberOfLines={1}>
                        {isCurrentUser
                          ? "You"
                          : member.email
                            ? `${member.email} · ${member.role}`
                            : member.role}
                      </Text>
                    </View>

                    <Text style={styles.memberManageActionText}>
                      {isCurrentUser ? "You" : selected ? "Remove" : "Add"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.cancelConversationButton}
              onPress={() => setShowMembersModal(false)}
              disabled={savingMembers}
            >
              <Text style={styles.cancelConversationButtonText}>
                {savingMembers ? "Updating..." : "Done"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
            <Modal
        visible={showEditConversationModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingConversationDetails) {
            setShowEditConversationModal(false);
          }
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (!savingConversationDetails) {
              setShowEditConversationModal(false);
            }
          }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Edit conversation</Text>

            <Text style={styles.helperText}>
              Update the title or purpose for this group conversation.
            </Text>

            <Text style={styles.inputLabel}>Title</Text>

            <TextInput
              value={editConversationTitle}
              onChangeText={setEditConversationTitle}
              maxLength={120}
              placeholder="Conversation title"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.modalInput}
              editable={!savingConversationDetails}
            />

            <Text style={styles.lengthText}>
              {editConversationTitle.length}/120
            </Text>

            <Text style={styles.inputLabel}>Subject</Text>

            <TextInput
              value={editConversationSubject}
              onChangeText={setEditConversationSubject}
              maxLength={240}
              placeholder="Optional purpose or context."
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.modalInput, styles.modalTextArea]}
              multiline
              editable={!savingConversationDetails}
            />

            <Text style={styles.lengthText}>
              {editConversationSubject.length}/240
            </Text>

            <Pressable
              style={[
                styles.saveConversationButton,
                (!editConversationTitle.trim() || savingConversationDetails) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleSaveConversationDetails}
              disabled={
                !editConversationTitle.trim() || savingConversationDetails
              }
            >
              <Text style={styles.saveConversationButtonText}>
                {savingConversationDetails ? "Saving..." : "Save changes"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.cancelConversationButton}
              onPress={() => setShowEditConversationModal(false)}
              disabled={savingConversationDetails}
            >
              <Text style={styles.cancelConversationButtonText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>


{conversation ? (
<View style={[styles.composer, { bottom: keyboardHeight }]}>
    <Text style={styles.composerHint}>Shared with this conversation.</Text>

    {editingMessage ? (
  <View style={styles.composerReplyBox}>
    <View style={{ flex: 1 }}>
      <Text style={styles.composerReplyTitle}>Editing message</Text>
      <Text style={styles.composerReplyBody} numberOfLines={2}>
        Save changes or cancel editing.
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
       if (!currentUser?.uid || !groupId || !conversationId || !conversation) return;

        try {
          if (!text.trim()) {
            await clearGroupConversationTyping({
              conversationId,
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

          await upsertGroupConversationTyping({
            conversationId,
            groupId,
            uid: currentUser.uid,
            displayName: currentUser.displayName ?? currentUser.email ?? null,
            email: currentUser.email ?? null,
          });
        } catch (err) {
          console.log("[GroupConversationThread] update typing failed", err);
        }
      }}
      placeholder="Write a group message..."
      placeholderTextColor={theme.colors.textMuted}
      style={styles.messageInput}
      multiline
      maxLength={CONVERSATION_MESSAGE_MAX_LENGTH}
      editable={!sendingMessage && !!conversation}
    />

    <View style={styles.composerFooter}>
      <Text style={styles.lengthText}>
        {messageInput.length}/{CONVERSATION_MESSAGE_MAX_LENGTH}
      </Text>

      <Pressable
        style={[
          styles.sendButton,
          ((!messageInput.trim() && messageMedia.length === 0) || !canSendConversationMessage) &&
            styles.buttonDisabled,
        ]}
        onPress={handleSendMessage}
disabled={(!messageInput.trim() && messageMedia.length === 0) || !canSendConversationMessage}
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
}

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
    hiddenMessageBody: {
      fontStyle: "italic",
      opacity: 0.75,
      color: theme.colors.textMuted,
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
    composerHint: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
      marginBottom: 8,
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
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 18,
    },
    modalCard: {
      borderRadius: 22,
      padding: 18,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    modalTitle: {
      color: theme.colors.text,
      fontSize: 20,
      fontWeight: "900",
      marginBottom: 8,
    },
    inputLabel: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "900",
      marginTop: 12,
      marginBottom: 6,
    },
    modalInput: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.text,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },
    modalTextArea: {
      minHeight: 86,
      textAlignVertical: "top",
    },
    saveConversationButton: {
      marginTop: 12,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: "center",
      backgroundColor: theme.colors.primary,
    },
    saveConversationButtonText: {
      color: theme.colors.primaryText,
      fontSize: 13,
      fontWeight: "900",
    },
    cancelConversationButton: {
      marginTop: 10,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    cancelConversationButtonText: {
      color: theme.colors.textMuted,
      fontSize: 13,
      fontWeight: "900",
    },
        editConversationButton: {
      alignSelf: "flex-start",
      marginTop: 10,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
      borderWidth: 1,
    },
    editConversationButtonText: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    conversationHeaderActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
        archiveConversationButton: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.danger,
      borderWidth: 1,
    },
    archiveConversationButtonText: {
      color: theme.colors.danger,
      fontSize: 12,
      fontWeight: "900",
    },
        leaveConversationButton: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    leaveConversationButtonText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "900",
    },
        memberManageList: {
      gap: 8,
      marginTop: 12,
    },
    memberManageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 10,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    memberManageRowSelected: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    memberManageAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.badge,
    },
    memberManageAvatarText: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    memberManageInfo: {
      flex: 1,
      minWidth: 0,
    },
    memberManageName: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "900",
    },
    memberManageMeta: {
      color: theme.colors.textMuted,
      marginTop: 2,
      fontSize: 11,
      fontWeight: "700",
    },
    memberManageActionText: {
      color: theme.colors.primary,
      fontSize: 12,
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
        mutedNotice: {
      color: theme.colors.textMuted,
      marginTop: 8,
      fontSize: 12,
      fontWeight: "900",
    },
    archivedNotice: {
  marginTop: 10,
  padding: 12,
  borderRadius: 16,
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

archivedNoticeTitle: {
  color: theme.colors.text,
  fontSize: 13,
  fontWeight: "900",
},

archivedNoticeText: {
  color: theme.colors.textMuted,
  marginTop: 4,
  fontSize: 12,
  lineHeight: 18,
  fontWeight: "700",
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
  });
