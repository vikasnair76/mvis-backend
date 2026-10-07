import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { DateTime } from "luxon";
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
  View,
} from "react-native";
import { auth } from "../../../../services/firebase";
import {
  completeMyRoutineOccurrenceParticipation,
  completeRoutineOccurrence,
  excuseRoutineOccurrenceParticipant,
  reopenMyRoutineOccurrenceParticipation,
  reopenRoutineOccurrence,
  setRoutineOccurrenceParticipantStatus,
  skipMyRoutineOccurrenceParticipation,
  skipRoutineOccurrence,
  getRoutineCompletionMetrics,
  subscribeRecentGroupRoutineOccurrences,
  subscribeGroupRoutineOccurrence,
  subscribeGroupRoutineOccurrenceParticipants,
  updateMyRoutineOccurrenceParticipationNote,
  type GroupRoutineOccurrenceDoc,
  type GroupRoutineOccurrenceParticipantDoc,
  type GroupRoutineParticipantStatus,
} from "../../../../services/groupRoutineOccurrences";
import { canManageGroupRoutineUi } from "../../../../services/groupRoutineUi";
import {
  subscribeGroupMembers,
  type GroupMemberDoc,
} from "../../../../services/groups";
import { UI_SIZES, type AppThemeTokens } from "../../../../services/theme";
import { useCurrentAppTheme } from "../../../../services/useCurrentAppTheme";

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cancelled")) return "This occurrence was cancelled.";
  if (message.includes("permission")) {
    return "You no longer have permission to update this occurrence.";
  }
  return "Your check-in could not be saved. The occurrence may have changed; please try again.";
}

const statusLabel = (status: string) =>
  status === "in_progress"
    ? "In progress"
    : status.charAt(0).toUpperCase() + status.slice(1);

export default function RoutineOccurrenceScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    occurrenceId?: string | string[];
  }>();
  const groupId = Array.isArray(params.id) ? params.id[0] ?? "" : params.id ?? "";
  const occurrenceId = Array.isArray(params.occurrenceId)
    ? params.occurrenceId[0] ?? ""
    : params.occurrenceId ?? "";
  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [membersReady, setMembersReady] = useState(false);
  const [occurrence, setOccurrence] =
    useState<GroupRoutineOccurrenceDoc | null>(null);
  const [occurrenceReady, setOccurrenceReady] = useState(false);
  const [participants, setParticipants] = useState<
    GroupRoutineOccurrenceParticipantDoc[]
  >([]);
  const [participantsReady, setParticipantsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [history, setHistory] = useState<GroupRoutineOccurrenceDoc[]>([]);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        setAuthReady(true);
      }),
    []
  );
  useEffect(() => {
    if (!groupId || !user) {
      setMembersReady(true);
      return;
    }
    return subscribeGroupMembers(
      groupId,
      (items) => {
        setMembers(items);
        setMembersReady(true);
      },
      () => {
        setLoadError(true);
        setMembersReady(true);
      }
    );
  }, [groupId, user]);
  useEffect(() => {
    setOccurrenceReady(false);
    if (!occurrenceId || !user) {
      setOccurrenceReady(true);
      return;
    }
    return subscribeGroupRoutineOccurrence(
      occurrenceId,
      (item) => {
        setOccurrence(item?.groupId === groupId ? item : null);
        setOccurrenceReady(true);
      },
      () => {
        setLoadError(true);
        setOccurrenceReady(true);
      }
    );
  }, [groupId, occurrenceId, user]);
  useEffect(() => {
    setParticipantsReady(false);
    if (!occurrenceId || !user) {
      setParticipantsReady(true);
      return;
    }
    return subscribeGroupRoutineOccurrenceParticipants(
      occurrenceId,
      (items) => {
        setParticipants(items);
        setParticipantsReady(true);
      },
      () => {
        setLoadError(true);
        setParticipantsReady(true);
      }
    );
  }, [occurrenceId, user]);
  useEffect(() => {
    if (!occurrence?.routineId) {
      setHistory([]);
      return;
    }
    return subscribeRecentGroupRoutineOccurrences(
      occurrence.routineId,
      setHistory,
      () => setHistory([]),
      { limit: 10 }
    );
  }, [occurrence?.routineId]);

  const currentMember = members.find((item) => item.uid === user?.uid) ?? null;
  const myParticipant =
    participants.find((item) => item.uid === user?.uid) ?? null;
  useEffect(() => {
    if (!noteDirty) setNote(myParticipant?.note ?? "");
  }, [myParticipant?.note, noteDirty]);
  const manager =
    !!occurrence &&
    canManageGroupRoutineUi(
      currentMember?.role ?? null,
      currentMember?.status ?? null,
      user?.uid ?? null,
      {
        createdByUid: occurrence.routineCreatedByUid,
        status: "active",
      }
    );
  const memberByUid = useMemo(
    () => new Map(members.map((member) => [member.uid, member])),
    [members]
  );
  const ready =
    authReady && membersReady && occurrenceReady && participantsReady;
  const readOnly =
    occurrence?.status === "cancelled" || currentMember?.status !== "active";

  const mutate = async (key: string, action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(key);
    try {
      await action();
      setNoteDirty(false);
    } catch (error) {
      Alert.alert("Couldn’t save check-in", safeError(error));
    } finally {
      setPending(null);
    }
  };
  const changeMine = (status: "completed" | "skipped" | "pending") => {
    if (!user) return;
    void mutate(`mine:${status}`, () =>
      status === "completed"
        ? completeMyRoutineOccurrenceParticipation({
            occurrenceId,
            uid: user.uid,
            note,
          })
        : status === "skipped"
          ? skipMyRoutineOccurrenceParticipation({
              occurrenceId,
              uid: user.uid,
              note,
            })
          : reopenMyRoutineOccurrenceParticipation({
              occurrenceId,
              uid: user.uid,
            })
    );
  };
  const correct = (
    participant: GroupRoutineOccurrenceParticipantDoc,
    status: GroupRoutineParticipantStatus
  ) => {
    if (!user) return;
    const label =
      memberByUid.get(participant.uid)?.displayName ?? "this participant";
    Alert.alert(
      status === "excused" ? "Excuse participant?" : "Correct check-in?",
      `${label} will be marked ${status}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: () =>
            void mutate(`participant:${participant.uid}`, () =>
              status === "excused"
                ? excuseRoutineOccurrenceParticipant({
                    occurrenceId,
                    actorUid: user.uid,
                    participantUid: participant.uid,
                  })
                : setRoutineOccurrenceParticipantStatus({
                    occurrenceId,
                    actorUid: user.uid,
                    participantUid: participant.uid,
                    status,
                  })
            ),
        },
      ]
    );
  };

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.muted}>Loading occurrence…</Text>
      </View>
    );
  }
  if (
    !user ||
    !currentMember ||
    currentMember.status !== "active" ||
    !occurrence
  ) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Occurrence unavailable</Text>
        <Text style={styles.muted}>
          {loadError
            ? "This routine occurrence is unavailable right now."
            : "You no longer have access to this group, or the occurrence no longer exists."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const progress = `${occurrence.completedParticipantCount} completed, ${occurrence.skippedParticipantCount} skipped, ${occurrence.excusedParticipantCount} excused, ${occurrence.pendingParticipantCount} pending`;
  const metrics = getRoutineCompletionMetrics(history);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Routine occurrence</Text>
          <Text style={styles.title}>{occurrence.routineTitleSnapshot}</Text>
          <Text style={styles.date}>
            {DateTime.fromMillis(occurrence.startAtMs, {
              zone: occurrence.timezone,
            }).toFormat("cccc, LLLL d, yyyy 'at' h:mm a")}
          </Text>
          <View
            accessibilityLabel={`Occurrence status, ${statusLabel(
              occurrence.executionStatus
            )}`}
            style={styles.status}
          >
            <Text style={styles.statusText}>
              {statusLabel(occurrence.executionStatus)}
            </Text>
          </View>
          {occurrence.status === "cancelled" ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              This occurrence was cancelled by routine reconciliation and is
              read-only.
            </Text>
          ) : null}
          {occurrence.routineDescriptionSnapshot ? (
            <Text style={styles.body}>
              {occurrence.routineDescriptionSnapshot}
            </Text>
          ) : null}
          {occurrence.routineLocationSnapshot ? (
            <Text style={styles.muted}>
              Location: {occurrence.routineLocationSnapshot}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Participation</Text>
          <Text accessibilityLabel={`Progress summary, ${progress}`} style={styles.muted}>
            {occurrence.participantCount
              ? progress
              : "No participants assigned. Managers control this outcome."}
          </Text>
          {participants.map((participant) => {
            const member = memberByUid.get(participant.uid);
            const label =
              member?.displayName?.trim() ||
              member?.email?.trim() ||
              "Former group member";
            return (
              <View
                key={participant.uid}
                accessibilityLabel={`${label}, ${participant.status}`}
                style={styles.participant}
              >
                <View style={styles.participantText}>
                  <Text style={styles.participantName}>
                    {label}
                    {participant.uid === user.uid ? " (you)" : ""}
                  </Text>
                  <Text style={styles.muted}>
                    {statusLabel(participant.status)}
                  </Text>
                </View>
                {manager && !readOnly ? (
                  <View style={styles.row}>
                    {(["pending", "completed", "skipped", "excused"] as const).map(
                      (status) => (
                        <Pressable
                          key={status}
                          accessibilityRole="button"
                          accessibilityLabel={`${statusLabel(status)} ${label}`}
                          disabled={!!pending || participant.status === status}
                          onPress={() => correct(participant, status)}
                          style={styles.miniButton}
                        >
                          <Text style={styles.miniText}>
                            {statusLabel(status)}
                          </Text>
                        </Pressable>
                      )
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {myParticipant && !readOnly ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your check-in</Text>
            <TextInput
              accessibilityLabel="Edit check-in note"
              multiline
              maxLength={500}
              placeholder="Optional note"
              placeholderTextColor={theme.colors.textMuted}
              value={note}
              onChangeText={(value) => {
                setNote(value);
                setNoteDirty(true);
              }}
              style={styles.input}
            />
            <Text style={styles.counter}>{note.length}/500</Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark your check-in complete"
                disabled={!!pending}
                onPress={() => changeMine("completed")}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryText}>Mark complete</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark your check-in skipped"
                disabled={!!pending}
                onPress={() => changeMine("skipped")}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Mark skipped</Text>
              </Pressable>
              {myParticipant.status !== "pending" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reopen your check-in"
                  disabled={!!pending}
                  onPress={() => changeMine("pending")}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>Reopen</Text>
                </Pressable>
              ) : noteDirty ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save check-in note"
                  disabled={!!pending}
                  onPress={() =>
                    void mutate("note", () =>
                      updateMyRoutineOccurrenceParticipationNote({
                        occurrenceId,
                        uid: user.uid,
                        note,
                      })
                    )
                  }
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>Save note</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {manager && occurrence.participantCount === 0 && !readOnly ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Manager outcome</Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Complete routine occurrence"
                disabled={!!pending}
                onPress={() =>
                  void mutate("complete", () =>
                    completeRoutineOccurrence({
                      occurrenceId,
                      actorUid: user.uid,
                    })
                  )
                }
                style={styles.primaryButton}
              >
                <Text style={styles.primaryText}>Complete</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Skip routine occurrence"
                disabled={!!pending}
                onPress={() =>
                  void mutate("skip", () =>
                    skipRoutineOccurrence({
                      occurrenceId,
                      actorUid: user.uid,
                    })
                  )
                }
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Skip</Text>
              </Pressable>
              {["completed", "skipped"].includes(occurrence.executionStatus) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reopen routine occurrence"
                  disabled={!!pending}
                  onPress={() =>
                    void mutate("reopen", () =>
                      reopenRoutineOccurrence({
                        occurrenceId,
                        actorUid: user.uid,
                      })
                    )
                  }
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>Reopen</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent history</Text>
          <Text style={styles.muted}>
            {metrics.resolved
              ? `${metrics.completed} completed · ${metrics.skipped} skipped · ${Math.round(
                  (metrics.completionRate ?? 0) * 100
                )}% completion`
              : "No completed or skipped occurrences yet."}
          </Text>
          {history
            .filter((item) =>
              ["completed", "skipped", "cancelled"].includes(
                item.executionStatus
              )
            )
            .slice(0, 5)
            .map((item) => (
              <View key={item.id} style={styles.participant}>
                <Text style={styles.participantName}>
                  {DateTime.fromMillis(item.startAtMs, {
                    zone: item.timezone,
                  }).toFormat("LLL d, yyyy")}
                </Text>
                <Text style={styles.muted}>
                  {statusLabel(item.executionStatus)} ·{" "}
                  {item.completedParticipantCount} of {item.participantCount} completed
                </Text>
              </View>
            ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      width: "100%",
      maxWidth: 820,
      alignSelf: "center",
      gap: UI_SIZES.spacing.md,
      padding: UI_SIZES.spacing.lg,
      paddingBottom: 80,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: UI_SIZES.spacing.md,
      padding: UI_SIZES.spacing.xl,
      backgroundColor: theme.colors.background,
    },
    back: { minHeight: 44, flexDirection: "row", alignItems: "center" },
    backText: { color: theme.colors.primary, fontWeight: "900" },
    card: {
      gap: UI_SIZES.spacing.sm,
      padding: UI_SIZES.cardPadding.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: UI_SIZES.radius.lg,
      backgroundColor: theme.colors.surface,
    },
    eyebrow: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    title: { color: theme.colors.text, fontSize: 26, fontWeight: "900" },
    sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
    date: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    body: { color: theme.colors.text, fontSize: 14, lineHeight: 21 },
    muted: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
    status: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: UI_SIZES.radius.xl,
      backgroundColor: theme.colors.secondaryBackground,
    },
    statusText: { color: theme.colors.secondaryText, fontWeight: "900" },
    warning: {
      color: theme.colors.warningText,
      backgroundColor: theme.colors.warningBackground,
      padding: UI_SIZES.spacing.sm,
      borderRadius: UI_SIZES.radius.md,
    },
    participant: {
      gap: UI_SIZES.spacing.sm,
      paddingVertical: UI_SIZES.spacing.sm,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
    },
    participantText: { flex: 1 },
    participantName: { color: theme.colors.text, fontWeight: "800" },
    row: { flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm },
    input: {
      minHeight: 110,
      color: theme.colors.text,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: UI_SIZES.radius.md,
      padding: UI_SIZES.spacing.md,
      textAlignVertical: "top",
      backgroundColor: theme.colors.surfaceMuted,
    },
    counter: { color: theme.colors.textMuted, fontSize: 11, textAlign: "right" },
    primaryButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: UI_SIZES.radius.xl,
      backgroundColor: theme.colors.primary,
    },
    primaryText: { color: theme.colors.primaryText, fontWeight: "900" },
    secondaryButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: theme.colors.secondaryBorder,
      borderRadius: UI_SIZES.radius.xl,
      backgroundColor: theme.colors.secondaryBackground,
    },
    secondaryText: { color: theme.colors.secondaryText, fontWeight: "900" },
    miniButton: {
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: UI_SIZES.radius.xl,
    },
    miniText: { color: theme.colors.text, fontSize: 11, fontWeight: "800" },
  });
}
