import {Stack} from "expo-router";
import {Image} from "expo-image";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import {onAuthStateChanged, type User} from "firebase/auth";
import React, {useEffect, useMemo, useRef, useState} from "react";
import {Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View} from "react-native";
import {auth} from "../../services/firebase";
import {FEEDBACK_MAX_MESSAGE_LENGTH, FEEDBACK_MAX_REPLY_EMAIL_LENGTH,
  FEEDBACK_MAX_SUBJECT_LENGTH, FEEDBACK_SUBMISSION_READY, FEEDBACK_TYPES,
  clearFeedbackFormDraft, createInitialFeedbackFormDraft,
  getFeedbackTypeLabel, isFeedbackDraftMeaningful,
  restoreFeedbackFormDraft, saveFeedbackFormDraft,
  validateFeedbackFormDraft, type FeedbackFormDraft,
  type FeedbackFormErrors} from "../../services/feedback";
import {useAppTheme} from "../../services/useAppTheme";
import {useCurrentAppTheme} from "../../services/useCurrentAppTheme";
import {
  FEEDBACK_UPLOAD_CONCURRENCY,
  applyFeedbackUploadUpdate,
  cleanupFeedbackAttachment,
  clearFeedbackAttachmentDraft,
  createEmptyFeedbackAttachmentDraft,
  createFeedbackMediaId,
  ensureFeedbackId,
  getFeedbackAttachmentErrorMessage,
  restoreFeedbackAttachmentDraft,
  saveFeedbackAttachmentDraft,
  uploadFeedbackAttachment,
  validateFeedbackPickerCandidate,
  type FeedbackAttachmentDraft,
  type FeedbackAttachmentDraftItem,
  toFeedbackAttachmentClaims,
} from "../../services/feedbackAttachments";
import {submitFeedbackRequest} from "../../services/feedbackSubmission";

export default function FeedbackSupportScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [draft, setDraft] = useState<FeedbackFormDraft | null>(null);
  const [initial, setInitial] = useState<FeedbackFormDraft | null>(null);
  const [errors, setErrors] = useState<FeedbackFormErrors>({});
  const [attachmentDraft, setAttachmentDraft] =
    useState<FeedbackAttachmentDraft>(createEmptyFeedbackAttachmentDraft);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const tasks = useRef(new Map<string, {cancel: () => boolean}>());
  const invalidatedAttachmentIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const messageRef = useRef<TextInput>(null);
  const {themeId} = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(auth, setUser);
    const activeTasks = tasks.current;
    return () => {
      mounted.current = false;
      activeTasks.forEach((task) => task.cancel());
      activeTasks.clear();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    tasks.current.forEach((task) => task.cancel());
    tasks.current.clear();
    setAttachmentError(null);
    setErrors({});
    if (!user?.uid) {
      setDraft(null);
      setInitial(null);
      setAttachmentDraft(createEmptyFeedbackAttachmentDraft());
      return;
    }
    const next = createInitialFeedbackFormDraft(
      auth.currentUser?.email ?? null);
    setInitial(next);
    setDraft(restoreFeedbackFormDraft(user.uid) ?? next);
    setAttachmentDraft(restoreFeedbackAttachmentDraft(user.uid) ??
      createEmptyFeedbackAttachmentDraft());
  }, [user?.uid]);
  useEffect(() => {
    if (user?.uid && draft && initial) {
      saveFeedbackFormDraft(user.uid, draft, initial);
    }
  }, [draft, initial, user?.uid]);
  useEffect(() => {
    if (user?.uid) saveFeedbackAttachmentDraft(user.uid, attachmentDraft);
  }, [attachmentDraft, user?.uid]);

  const patchAttachment = (
    id: string,
    patch: (item: FeedbackAttachmentDraftItem) =>
      FeedbackAttachmentDraftItem
  ) => setAttachmentDraft((value) => ({
    ...value,
    items: value.items.map((item) => item.id === id ? patch(item) : item),
  }));

  const startUpload = (
    item: FeedbackAttachmentDraftItem,
    uid: string,
    feedbackId: string
  ) => {
    if (tasks.current.has(item.id)) return;
    const attemptId = createFeedbackMediaId();
    patchAttachment(item.id, (current) => ({
      ...current, status: "uploading", attemptId, progress: 0, errorCode: null,
    }));
    const handle = uploadFeedbackAttachment({uid, feedbackId,
      item: {...item, status: "uploading", attemptId},
      attemptId, onProgress: (progress) => {
        if (!mounted.current || auth.currentUser?.uid !== uid) return;
        patchAttachment(item.id, (current) =>
          applyFeedbackUploadUpdate(current, attemptId,
            {type: "progress", progress}));
      }});
    tasks.current.set(item.id, handle);
    void handle.promise.then((claim) => {
      if (!mounted.current || auth.currentUser?.uid !== uid ||
        invalidatedAttachmentIds.current.has(item.id)) {
        void cleanupFeedbackAttachment({uid, feedbackId,
          attachmentId: item.id});
        return;
      }
      patchAttachment(item.id, (current) =>
        applyFeedbackUploadUpdate(current, attemptId,
          {type: "success", claim}));
    }).catch((error: unknown) => {
      if (!mounted.current || auth.currentUser?.uid !== uid) return;
      const message = error instanceof Error ? error.message : "";
      const code = message === "cancelled" ? "cancelled" :
        message === "read_failed" ? "read_failed" :
          message === "invalid_metadata" ? "invalid_metadata" :
            "upload_failed";
      patchAttachment(item.id, (current) =>
        applyFeedbackUploadUpdate(current, attemptId,
          {type: "failure", code}));
    }).finally(() => tasks.current.delete(item.id));
  };

  useEffect(() => {
    const uid = user?.uid;
    const feedbackId = attachmentDraft.feedbackId;
    if (!uid || !feedbackId) return;
    const slots = FEEDBACK_UPLOAD_CONCURRENCY - tasks.current.size;
    attachmentDraft.items.filter((item) => item.status === "ready")
      .slice(0, Math.max(0, slots))
      .forEach((item) => startUpload(item, uid, feedbackId));
    // startUpload intentionally reads the current task registry and state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentDraft, user?.uid]);

  const update = (patch: Partial<FeedbackFormDraft>) =>
    setDraft((value) => value ? {...value, ...patch} : value);
  const validateField = (field: keyof FeedbackFormErrors) => {
    if (!draft) return;
    const result = validateFeedbackFormDraft(draft);
    setErrors((value) => ({
      ...value, [field]: result.ok ? undefined : result.errors[field],
    }));
  };
  const reset = () => {
    if (!user?.uid) return;
    const next = createInitialFeedbackFormDraft(
      auth.currentUser?.email ?? null);
    clearFeedbackFormDraft(user.uid);
    attachmentDraft.items.forEach((item) =>
      invalidatedAttachmentIds.current.add(item.id));
    tasks.current.forEach((task) => task.cancel());
    tasks.current.clear();
    const cleanup = attachmentDraft.items.filter((item) => item.storagePath);
    const feedbackId = attachmentDraft.feedbackId;
    if (feedbackId) cleanup.forEach((item) => {
      void cleanupFeedbackAttachment({uid: user.uid, feedbackId,
        attachmentId: item.id});
    });
    clearFeedbackAttachmentDraft(user.uid);
    setAttachmentDraft(createEmptyFeedbackAttachmentDraft());
    setAttachmentError(null);
    setInitial(next);
    setDraft(next);
    setErrors({});
    Keyboard.dismiss();
  };

  const pickAttachments = async (kind: "image" | "video") => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed",
        "Photo access is needed to attach images or videos. You can enable " +
        "access in your device settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "image" ? ImagePicker.MediaTypeOptions.Images :
        ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: kind === "image",
      selectionLimit: kind === "image" ?
        Math.max(1, 4 - attachmentDraft.items.length) : 1,
    });
    if (result.canceled) return;
    let items = [...attachmentDraft.items];
    let lastError: string | null = null;
    for (const asset of result.assets) {
      const source = (asset.fileName || asset.uri).split("?")[0].toLowerCase();
      const contentType = asset.mimeType ??
        (source.endsWith(".mp4") ? "video/mp4" :
          source.endsWith(".png") ? "image/png" :
            source.endsWith(".webp") ? "image/webp" :
              source.endsWith(".jpg") || source.endsWith(".jpeg") ?
                "image/jpeg" : null);
      const validated = validateFeedbackPickerCandidate({
        kind, localUri: asset.uri, contentType,
        sizeBytes: asset.fileSize ?? null, width: asset.width,
        height: asset.height, durationMs: asset.duration ?? null,
      }, items);
      if (validated.ok) items.push(validated.item);
      else lastError = getFeedbackAttachmentErrorMessage(validated.code);
    }
    setAttachmentError(lastError);
    if (items.length !== attachmentDraft.items.length) {
      setAttachmentDraft((value) => ({
        feedbackId: ensureFeedbackId(value.feedbackId), items,
      }));
    }
  };

  const addAttachment = () => Alert.alert("Add Attachment", undefined, [
    {text: "Choose Image", onPress: () => void pickAttachments("image")},
    {text: "Choose Video", onPress: () => void pickAttachments("video")},
    {text: "Cancel", style: "cancel"},
  ]);

  const removeAttachment = (item: FeedbackAttachmentDraftItem) => {
    invalidatedAttachmentIds.current.add(item.id);
    tasks.current.get(item.id)?.cancel();
    tasks.current.delete(item.id);
    setAttachmentDraft((value) => {
      const items = value.items.filter((candidate) => candidate.id !== item.id);
      return {feedbackId: items.length ? value.feedbackId : null, items};
    });
    if (user?.uid && attachmentDraft.feedbackId && item.storagePath) {
      void cleanupFeedbackAttachment({uid: user.uid,
        feedbackId: attachmentDraft.feedbackId, attachmentId: item.id});
    }
  };

  const retryAttachment = (item: FeedbackAttachmentDraftItem) => {
    if (!user?.uid || !attachmentDraft.feedbackId) return;
    void cleanupFeedbackAttachment({uid: user.uid,
      feedbackId: attachmentDraft.feedbackId, attachmentId: item.id})
      .finally(() => {
        invalidatedAttachmentIds.current.delete(item.id);
        patchAttachment(item.id, (current) => ({
          ...current, status: "ready", progress: 0, attemptId: null,
          errorCode: null, storagePath: null, uploadedAtMs: null,
        }));
      });
  };

  const submit = async () => {
    if (!user?.uid || !draft || submissionBusy) return;
    const validated = validateFeedbackFormDraft(draft);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    if (attachmentDraft.items.some((item) => item.status !== "uploaded")) {
      setAttachmentError("Wait for every attachment to finish uploading.");
      return;
    }
    const feedbackId = ensureFeedbackId(attachmentDraft.feedbackId);
    setAttachmentDraft((value) => ({...value, feedbackId}));
    const claims = toFeedbackAttachmentClaims(attachmentDraft.items,
      {uid: user.uid, feedbackId});
    if (claims.length !== attachmentDraft.items.length) {
      setAttachmentError("One attachment is not ready. Remove it or retry.");
      return;
    }
    setSubmissionBusy(true);
    try {
      await submitFeedbackRequest({
        schemaVersion: 1, feedbackId, ...validated.value,
        attachments: claims,
        appMetadata: {
          appVersion: Constants.expoConfig?.version ?? null,
          buildVersion: Platform.OS === "ios" ?
            Constants.expoConfig?.ios?.buildNumber ?? null :
            String(Constants.expoConfig?.android?.versionCode ?? "") || null,
          platform: Platform.OS === "ios" || Platform.OS === "android" ||
            Platform.OS === "web" ? Platform.OS : "unknown",
          osVersion: String(Platform.Version),
          locale: Intl.DateTimeFormat().resolvedOptions().locale ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
          themeId,
        },
      });
      clearFeedbackFormDraft(user.uid);
      clearFeedbackAttachmentDraft(user.uid);
      const next = createInitialFeedbackFormDraft(auth.currentUser?.email ??
        null);
      setInitial(next);
      setDraft(next);
      setAttachmentDraft(createEmptyFeedbackAttachmentDraft());
      setErrors({});
      setAttachmentError(null);
      Alert.alert("Feedback received",
        "Your feedback was securely received by the Dayta team.");
    } catch (error) {
      Alert.alert("Feedback not sent", error instanceof Error ? error.message :
        "Feedback could not be sent right now. Please try again.");
    } finally {
      setSubmissionBusy(false);
    }
  };
  const discard = () => {
    if (!draft) return;
    if (!draft.subject.trim() && !draft.message.trim()) {
      reset();
      return;
    }
    Alert.alert("Discard feedback draft?",
      "Your unsent feedback will be cleared.", [
        {text: "Keep Editing", style: "cancel"},
        {text: "Discard", style: "destructive", onPress: reset},
      ]);
  };

  if (!user || !draft || !initial) {
    return <View style={styles.gate}>
      <Stack.Screen options={{title: "Feedback & Support"}} />
      <Text accessibilityRole="header" style={styles.gateTitle}>
        Sign in required
      </Text>
      <Text style={styles.intro}>
        Sign in from Settings to open the Feedback & Support form.
      </Text>
    </View>;
  }

  const meaningful = isFeedbackDraftMeaningful(draft, initial) ||
    attachmentDraft.items.length > 0;
  const validation = validateFeedbackFormDraft(draft);
  const attachmentsReady = attachmentDraft.items.every(
    (item) => item.status === "uploaded");
  const canSubmit = FEEDBACK_SUBMISSION_READY && validation.ok &&
    attachmentsReady && !submissionBusy;
  const readyReason = !FEEDBACK_SUBMISSION_READY ?
    "Feedback sending is not enabled in this app environment yet." :
    !validation.ok ?
    "Complete the required fields before sending." :
    !attachmentsReady ? "Wait for every attachment to finish uploading." :
      submissionBusy ? "Feedback submission is in progress." :
        "Securely send this feedback to the Dayta team.";

  return <KeyboardAvoidingView style={styles.screen}
    behavior={Platform.OS === "ios" ? "padding" : undefined}
    keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}>
    <Stack.Screen options={{title: "Feedback & Support"}} />
    <ScrollView contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={styles.title}>
        Feedback & Support
      </Text>
      <Text style={styles.intro}>
        Share a bug, request a feature, ask for help, or tell us what you think.
      </Text>
      <Text style={styles.safety}>
        Please avoid including passwords or other sensitive account information.
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>Feedback type</Text>
        <View accessibilityRole="radiogroup" style={styles.chips}>
          {FEEDBACK_TYPES.map((type) => {
            const selected = draft.type === type;
            return <Pressable key={type} accessibilityRole="radio"
              accessibilityLabel={getFeedbackTypeLabel(type)}
              accessibilityState={{selected}}
              onPress={() => update({type})}
              style={({pressed}) => [styles.chip,
                selected && styles.chipSelected, pressed && styles.pressed]}>
              <Text style={[styles.chipText,
                selected && styles.chipTextSelected]}>
                {getFeedbackTypeLabel(type)}
              </Text>
            </Pressable>;
          })}
        </View>
        {draft.type === "bug" && <Text style={styles.helper}>
          Include what you were doing, what happened, and what you expected.
        </Text>}
        {draft.type === "feature_request" && <Text style={styles.helper}>
          Describe the problem the feature would solve.
        </Text>}
      </View>

      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Subject</Text>
          <Text style={styles.optional}>Optional</Text>
        </View>
        <TextInput accessibilityLabel="Subject, optional"
          accessibilityHint={errors.subject}
          maxLength={FEEDBACK_MAX_SUBJECT_LENGTH}
          onBlur={() => validateField("subject")}
          onChangeText={(subject) => {
            update({subject});
            setErrors((value) => ({...value, subject: undefined}));
          }}
          onSubmitEditing={() => messageRef.current?.focus()}
          placeholder="Briefly describe your feedback"
          placeholderTextColor={theme.colors.textMuted} returnKeyType="next"
          style={[styles.input, errors.subject && styles.inputError]}
          value={draft.subject} />
        <Text style={styles.counter}>
          {draft.subject.length} / {FEEDBACK_MAX_SUBJECT_LENGTH}
        </Text>
        {!!errors.subject && <Text accessibilityLiveRegion="polite"
          style={styles.error}>{errors.subject}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Message</Text>
        <TextInput ref={messageRef} accessibilityLabel="Message, required"
          accessibilityHint={errors.message}
          maxLength={FEEDBACK_MAX_MESSAGE_LENGTH} multiline
          onBlur={() => validateField("message")}
          onChangeText={(message) => {
            update({message});
            setErrors((value) => ({...value, message: undefined}));
          }}
          placeholder={"Tell us what happened, what you expected, or what " +
            "you would like to see."}
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, styles.message,
            errors.message && styles.inputError]}
          textAlignVertical="top" value={draft.message} />
        <Text style={styles.counter}>
          {draft.message.length} / {FEEDBACK_MAX_MESSAGE_LENGTH}
        </Text>
        {!!errors.message && <Text accessibilityLiveRegion="polite"
          style={styles.error}>{errors.message}</Text>}
      </View>

      <View style={styles.section}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>
              Allow Dayta to contact me about this feedback
            </Text>
            <Text style={styles.helper}>
              Your reply email will only be used to follow up about this
              submission.
            </Text>
          </View>
          <Switch accessibilityLabel="Allow Dayta to contact me"
            accessibilityState={{checked: draft.allowContact}}
            onValueChange={(allowContact) => {
              update({allowContact});
              if (!allowContact) setErrors((value) => ({
                ...value, replyEmail: undefined,
              }));
            }}
            thumbColor={theme.colors.surface}
            trackColor={{false: theme.colors.surfaceMuted,
              true: theme.colors.primary}}
            value={draft.allowContact} />
        </View>
        <Text style={[styles.label,
          !draft.allowContact && styles.disabledText]}>Reply Email</Text>
        <TextInput accessibilityLabel="Reply Email"
          accessibilityHint={draft.allowContact ?
            (errors.replyEmail ?? "Replies will be sent to this address.") :
            "Turn on contact permission to edit a reply email."}
          accessibilityState={{disabled: !draft.allowContact}}
          autoCapitalize="none" autoComplete="email" autoCorrect={false}
          editable={draft.allowContact} keyboardType="email-address"
          maxLength={FEEDBACK_MAX_REPLY_EMAIL_LENGTH}
          onBlur={() => validateField("replyEmail")}
          onChangeText={(replyEmail) => {
            update({replyEmail, replyEmailTouched: true});
            setErrors((value) => ({...value, replyEmail: undefined}));
          }}
          placeholder="you@example.com"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, !draft.allowContact && styles.inputDisabled,
            errors.replyEmail && styles.inputError]}
          textContentType="emailAddress" value={draft.replyEmail} />
        <Text style={styles.helper}>{draft.allowContact ?
          "Replies will be sent to this address." :
          "Turn on contact permission and enter an email if you would like a reply."}
        </Text>
        {!!errors.replyEmail && draft.allowContact &&
          <Text accessibilityLiveRegion="polite"
            style={styles.error}>{errors.replyEmail}</Text>}
      </View>

      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Attachments</Text>
          <Text style={styles.optional}>
            {attachmentDraft.items.length} / 4
          </Text>
        </View>
        <Text style={styles.helper}>
          Add up to 4 images or one video up to 30 seconds.
        </Text>
        <Pressable accessibilityRole="button"
          accessibilityLabel="Add Attachment"
          accessibilityHint="Choose an image or short video from your library"
          disabled={attachmentDraft.items.length >= 4}
          onPress={addAttachment}
          style={({pressed}) => [styles.addAttachment,
            attachmentDraft.items.length >= 4 && styles.submitDisabled,
            pressed && styles.pressed]}>
          <Text style={styles.addAttachmentText}>Add Attachment</Text>
        </Pressable>
        {!!attachmentError && <Text accessibilityLiveRegion="polite"
          style={styles.error}>{attachmentError}</Text>}
        {attachmentDraft.items.map((item) =>
          <View key={item.id} style={styles.attachmentCard}
            accessible accessibilityLabel={`${item.kind} attachment, ${
              item.status}, ${Math.round(item.progress * 100)} percent`}>
            {item.kind === "image" && item.previewUri ?
              <Image source={{uri: item.previewUri}} style={styles.preview}
                contentFit="cover" accessibilityLabel="Selected image preview" /> :
              <View style={styles.videoFallback}>
                <Text style={styles.videoFallbackText}>Video</Text>
              </View>}
            <View style={styles.attachmentInfo}>
              <Text style={styles.attachmentTitle}>
                {item.kind === "image" ? "Image" : "Short video"}
              </Text>
              <Text style={styles.helper}>
                {item.sizeBytes ?
                  `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · ` : ""}
                {item.status === "uploading" ?
                  `Uploading ${Math.round(item.progress * 100)}%` :
                  item.status === "uploaded" ? "Uploaded privately" :
                    item.status === "failed" ?
                      getFeedbackAttachmentErrorMessage(
                        item.errorCode ?? "upload_failed") :
                      "Waiting to upload"}
              </Text>
              {item.status === "uploading" &&
                <View accessibilityRole="progressbar"
                  accessibilityValue={{min: 0, max: 100,
                    now: Math.round(item.progress * 100)}}
                  style={styles.progressTrack}>
                  <View style={[styles.progressFill,
                    {width: `${Math.round(item.progress * 100)}%`}]} />
                </View>}
              <View style={styles.attachmentActions}>
                {item.status === "uploading" &&
                  <Pressable accessibilityRole="button"
                    accessibilityLabel="Cancel attachment upload"
                    onPress={() => {
                      tasks.current.get(item.id)?.cancel();
                      tasks.current.delete(item.id);
                      patchAttachment(item.id, (current) => ({
                        ...current, status: "failed", attemptId: null,
                        errorCode: "cancelled",
                      }));
                    }}>
                    <Text style={styles.actionText}>Cancel</Text>
                  </Pressable>}
                {item.status === "failed" &&
                  <Pressable accessibilityRole="button"
                    accessibilityLabel="Retry attachment upload"
                    onPress={() => retryAttachment(item)}>
                    <Text style={styles.actionText}>Retry</Text>
                  </Pressable>}
                <Pressable accessibilityRole="button"
                  accessibilityLabel="Remove attachment"
                  onPress={() => removeAttachment(item)}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>)}
      </View>

      <View style={styles.readiness}>
        <Text style={styles.readinessTitle}>Secure feedback delivery</Text>
        <Text style={styles.readinessText}>
          {FEEDBACK_SUBMISSION_READY ?
            "Feedback is accepted by trusted Dayta server infrastructure. " +
            "The app cannot choose the recipient or send email directly." :
            "Feedback sending is disabled for this app environment. Your " +
            "draft stays on this device until an approved environment enables it."}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Send feedback"
        accessibilityHint={readyReason}
        accessibilityState={{disabled: !canSubmit}}
        disabled={!canSubmit}
        onPress={() => void submit()}
        style={[styles.submit, !canSubmit && styles.submitDisabled]}>
        <Text style={styles.submitText}>
          {submissionBusy ? "Sending…" : "Send feedback"}
        </Text>
      </Pressable>
      <Text style={styles.disabledReason}>{readyReason}</Text>
      {meaningful && <Pressable accessibilityRole="button"
        accessibilityLabel="Discard feedback draft"
        accessibilityHint="Clears this unsent feedback form" onPress={discard}
        style={({pressed}) => [styles.discard, pressed && styles.pressed]}>
        <Text style={styles.discardText}>Discard draft</Text>
      </Pressable>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    screen: {flex: 1, backgroundColor: theme.colors.background},
    content: {padding: 20, paddingBottom: 48, gap: 20},
    gate: {flex: 1, padding: 24, alignItems: "center",
      justifyContent: "center", backgroundColor: theme.colors.background},
    gateTitle: {color: theme.colors.text, fontSize: 22, fontWeight: "800",
      marginBottom: 8},
    title: {color: theme.colors.text, fontSize: 28, fontWeight: "800"},
    intro: {color: theme.colors.text, fontSize: 16, lineHeight: 23,
      textAlign: "center"},
    safety: {color: theme.colors.textMuted, fontSize: 13, lineHeight: 19},
    section: {gap: 8},
    labelRow: {flexDirection: "row", alignItems: "baseline",
      justifyContent: "space-between", gap: 12},
    label: {color: theme.colors.text, fontSize: 15, fontWeight: "700"},
    optional: {color: theme.colors.textMuted, fontSize: 13},
    helper: {color: theme.colors.textMuted, fontSize: 13, lineHeight: 19},
    chips: {flexDirection: "row", flexWrap: "wrap", gap: 8},
    chip: {minHeight: 44, justifyContent: "center", borderRadius: 999,
      borderWidth: 1, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted, paddingHorizontal: 14,
      paddingVertical: 9},
    chipSelected: {borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge},
    chipText: {color: theme.colors.textMuted, fontSize: 14,
      fontWeight: "700"},
    chipTextSelected: {color: theme.colors.badgeText},
    pressed: {opacity: 0.72},
    input: {minHeight: 48, borderWidth: 1, borderColor: theme.colors.border,
      borderRadius: 12, backgroundColor: theme.colors.inputBackground,
      color: theme.colors.text, fontSize: 16, paddingHorizontal: 14,
      paddingVertical: 12},
    message: {minHeight: 150},
    inputError: {borderColor: theme.colors.danger},
    inputDisabled: {backgroundColor: theme.colors.surfaceMuted, opacity: 0.68},
    disabledText: {color: theme.colors.textMuted},
    counter: {color: theme.colors.textMuted, fontSize: 12,
      textAlign: "right"},
    error: {color: theme.colors.dangerText, fontSize: 13, lineHeight: 18},
    switchRow: {minHeight: 56, flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", gap: 14},
    switchCopy: {flex: 1, gap: 4},
    addAttachment: {minHeight: 46, alignItems: "center",
      justifyContent: "center", borderRadius: 12, borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.secondaryBackground},
    addAttachmentText: {color: theme.colors.primary, fontSize: 15,
      fontWeight: "800"},
    attachmentCard: {flexDirection: "row", gap: 12, padding: 12,
      borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface},
    preview: {width: 84, height: 84, borderRadius: 10,
      backgroundColor: theme.colors.surfaceMuted},
    videoFallback: {width: 84, minHeight: 84, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted},
    videoFallbackText: {color: theme.colors.textMuted, fontWeight: "800"},
    attachmentInfo: {flex: 1, minWidth: 0, gap: 5},
    attachmentTitle: {color: theme.colors.text, fontSize: 14,
      fontWeight: "800"},
    attachmentActions: {flexDirection: "row", flexWrap: "wrap", gap: 18,
      marginTop: 4},
    actionText: {color: theme.colors.primary, fontSize: 13,
      fontWeight: "800"},
    removeText: {color: theme.colors.dangerText, fontSize: 13,
      fontWeight: "800"},
    progressTrack: {height: 6, borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted, overflow: "hidden"},
    progressFill: {height: "100%", borderRadius: 999,
      backgroundColor: theme.colors.primary},
    readiness: {borderWidth: 1, borderColor: theme.colors.warningBorder,
      borderRadius: 14, backgroundColor: theme.colors.warningBackground,
      padding: 14, gap: 6},
    readinessTitle: {color: theme.colors.warningText, fontSize: 15,
      fontWeight: "800"},
    readinessText: {color: theme.colors.warningText, fontSize: 13,
      lineHeight: 19},
    submit: {minHeight: 52, alignItems: "center", justifyContent: "center",
      borderRadius: 12, backgroundColor: theme.colors.primary,
      paddingHorizontal: 18},
    submitDisabled: {opacity: 0.45},
    submitText: {color: theme.colors.primaryText, fontSize: 16,
      fontWeight: "800"},
    disabledReason: {color: theme.colors.textMuted, fontSize: 13,
      lineHeight: 18, textAlign: "center", marginTop: -12},
    discard: {minHeight: 48, alignItems: "center", justifyContent: "center",
      borderRadius: 12, borderWidth: 1, borderColor: theme.colors.dangerBorder,
      backgroundColor: theme.colors.dangerBackground, paddingHorizontal: 18},
    discardText: {color: theme.colors.dangerText, fontSize: 15,
      fontWeight: "800"},
  });
