import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { DateTime } from "luxon";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { auth, db } from "../../../services/firebase";
import {
  archiveGroupRoutine,
  createGroupRoutine,
  pauseGroupRoutine,
  resumeGroupRoutine,
  subscribeActiveGroupRoutines,
  subscribeArchivedGroupRoutines,
  subscribePausedGroupRoutines,
  updateGroupRoutine,
  type GroupRoutineDoc,
} from "../../../services/groupRoutines";
import {
  subscribeGroupRoutineOccurrencesForRange,
  type GroupRoutineOccurrenceDoc,
} from "../../../services/groupRoutineOccurrences";
import {
  GROUP_ROUTINE_WEEKDAYS,
  canCreateGroupRoutineUi,
  canManageGroupRoutineUi,
  createGroupRoutineFormDefaults,
  createGroupRoutineFormFromDoc,
  formatGroupRoutineDateBounds,
  formatGroupRoutineDuration,
  formatGroupRoutineNextOccurrence,
  formatGroupRoutineRecurrenceSummary,
  getGroupRoutineCreatorLabel,
  getGroupRoutineStatusLabel,
  groupRoutineFormToUpdate,
  normalizeGroupRoutineForm,
  type GroupRoutineFormState,
} from "../../../services/groupRoutineUi";
import {
  subscribeGroupMembers,
  type GroupDoc,
  type GroupMemberDoc,
} from "../../../services/groups";
import { UI_SIZES, type AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

type PickerField = "time" | "startDate" | "endDate";
type RoutineEditor = { routine: GroupRoutineDoc | null; form: GroupRoutineFormState };

function pickerDate(dayKey: string) {
  const parsed = DateTime.fromISO(dayKey, { zone: "UTC" });
  return DateTime.local(parsed.year, parsed.month, parsed.day, 12).toJSDate();
}

function pickerTime(localTime: string) {
  const parsed = DateTime.fromFormat(localTime, "HH:mm", { zone: "UTC" });
  return DateTime.local().set({ hour: parsed.hour, minute: parsed.minute }).toJSDate();
}

function friendlyRoutineError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("permission") || message.includes("PERMISSION_DENIED")) {
    return "You no longer have permission to manage this routine.";
  }
  if (message.includes("future occurrence")) {
    return "This routine has no future occurrence. Update its dates before continuing.";
  }
  return message || "Routines are unavailable right now.";
}

export default function GroupRoutinesScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const groupId = Array.isArray(id) ? id[0] ?? "" : id ?? "";
  const { width } = useWindowDimensions();
  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const wide = width >= 820;
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [groupReady, setGroupReady] = useState(false);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [membershipReady, setMembershipReady] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [active, setActive] = useState<GroupRoutineDoc[]>([]);
  const [paused, setPaused] = useState<GroupRoutineDoc[]>([]);
  const [archived, setArchived] = useState<GroupRoutineDoc[]>([]);
  const [loadingStates, setLoadingStates] = useState({ active: true, paused: true, archived: false });
  const [listError, setListError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<RoutineEditor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [currentOccurrences, setCurrentOccurrences] = useState<
    GroupRoutineOccurrenceDoc[]
  >([]);

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    setGroup(null);
    setGroupReady(false);
    setAccessError(false);
    if (!groupId || !user) {
      setGroupReady(true);
      return;
    }
    return onSnapshot(doc(db, "groups", groupId), (snapshot) => {
      if (!snapshot.exists()) setGroup(null);
      else setGroup({ id: snapshot.id, ...snapshot.data() } as GroupDoc);
      setGroupReady(true);
    }, () => {
      console.log("[GroupRoutinesScreen] group subscription failed", { groupId });
      setAccessError(true);
      setGroupReady(true);
    });
  }, [groupId, user]);

  useEffect(() => {
    setMembers([]);
    setMembershipReady(false);
    if (!groupId || !user) {
      setMembershipReady(true);
      return;
    }
    return subscribeGroupMembers(groupId, (items) => {
      setMembers(items);
      setMembershipReady(true);
    }, () => {
      console.log("[GroupRoutinesScreen] membership subscription failed", { groupId });
      setAccessError(true);
      setMembershipReady(true);
    });
  }, [groupId, user]);

  const currentMember = useMemo(
    () => members.find((member) => member.uid === user?.uid) ?? null,
    [members, user?.uid]
  );
  const role = currentMember?.status === "active" ? currentMember.role : null;
  const accessReady = authReady && groupReady && membershipReady;
  const hasAccess = !!user && !!group && !!role && !accessError;
  const canCreate = canCreateGroupRoutineUi(role, currentMember?.status ?? null);

  useEffect(() => {
    setActive([]);
    setPaused([]);
    setListError(false);
    setLoadingStates({ active: !!hasAccess, paused: !!hasAccess, archived: false });
    if (!hasAccess) return;
    const fail = () => {
      setListError(true);
      setLoadingStates((current) => ({ ...current, active: false, paused: false }));
    };
    const stopActive = subscribeActiveGroupRoutines(groupId, { limit: 100 }, (items) => {
      setActive(items);
      setListError(false);
      setLoadingStates((current) => ({ ...current, active: false }));
    }, fail);
    const stopPaused = subscribePausedGroupRoutines(groupId, { limit: 100 }, (items) => {
      setPaused(items);
      setListError(false);
      setLoadingStates((current) => ({ ...current, paused: false }));
    }, fail);
    return () => {
      stopActive();
      stopPaused();
    };
  }, [groupId, hasAccess]);

  useEffect(() => {
    if (!hasAccess) {
      setCurrentOccurrences([]);
      return;
    }
    const start = DateTime.local().startOf("day").toMillis();
    const end = DateTime.local().plus({ days: 1 }).startOf("day").toMillis();
    return subscribeGroupRoutineOccurrencesForRange(
      groupId,
      start,
      end,
      setCurrentOccurrences,
      () => setCurrentOccurrences([]),
      { limit: 100 }
    );
  }, [groupId, hasAccess]);
  const occurrenceByRoutine = useMemo(
    () =>
      new Map(
        currentOccurrences.map((occurrence) => [
          occurrence.routineId,
          occurrence,
        ])
      ),
    [currentOccurrences]
  );

  useEffect(() => {
    setArchived([]);
    setLoadingStates((current) => ({ ...current, archived: showArchived && hasAccess }));
    if (!showArchived || !hasAccess) return;
    return subscribeArchivedGroupRoutines(groupId, { limit: 100 }, (items) => {
      setArchived(items);
      setListError(false);
      setLoadingStates((current) => ({ ...current, archived: false }));
    }, () => {
      setListError(true);
      setLoadingStates((current) => ({ ...current, archived: false }));
    });
  }, [groupId, hasAccess, showArchived]);

  const openCreate = () => {
    setEditor({ routine: null, form: createGroupRoutineFormDefaults() });
    setEditorError(null);
    setPickerField(null);
  };
  const openEdit = (routine: GroupRoutineDoc) => {
    setEditor({ routine, form: createGroupRoutineFormFromDoc(routine) });
    setEditorError(null);
    setPickerField(null);
  };
  const updateForm = (patch: Partial<GroupRoutineFormState>) => {
    setEditor((current) => current ? { ...current, form: { ...current.form, ...patch } } : current);
    setEditorError(null);
  };

  const submitEditor = async () => {
    if (!editor || !user || !group) return;
    setSaving(true);
    setEditorError(null);
    try {
      if (editor.routine) {
        await updateGroupRoutine(groupRoutineFormToUpdate(editor.form, editor.routine.id));
      } else {
        const input = normalizeGroupRoutineForm(editor.form);
        await createGroupRoutine({
          groupId,
          ...input,
          createdByUid: user.uid,
          createdByName: user.displayName,
          createdByEmail: user.email,
        });
      }
      setEditor(null);
      setPickerField(null);
    } catch (error) {
      console.log("[GroupRoutinesScreen] routine save failed", {
        groupId,
        routineId: editor.routine?.id ?? null,
      });
      setEditorError(friendlyRoutineError(error));
    } finally {
      setSaving(false);
    }
  };

  const runLifecycle = async (
    routine: GroupRoutineDoc,
    action: "pause" | "resume" | "archive"
  ) => {
    if (!user || pendingId) return;
    setPendingId(routine.id);
    try {
      if (action === "pause") await pauseGroupRoutine({ routineId: routine.id, actorUid: user.uid });
      else if (action === "resume") await resumeGroupRoutine({ routineId: routine.id, actorUid: user.uid });
      else await archiveGroupRoutine({ routineId: routine.id, actorUid: user.uid });
    } catch (error) {
      console.log("[GroupRoutinesScreen] lifecycle action failed", {
        groupId,
        routineId: routine.id,
        action,
      });
      Alert.alert("Couldn’t update routine", friendlyRoutineError(error));
    } finally {
      setPendingId(null);
    }
  };

  const requestPause = (routine: GroupRoutineDoc) => Alert.alert(
    "Pause routine?",
    "It will remain available in the Paused section.",
    [{ text: "Keep active", style: "cancel" }, { text: "Pause", onPress: () => void runLifecycle(routine, "pause") }]
  );
  const requestArchive = (routine: GroupRoutineDoc) => Alert.alert(
    "Archive routine?",
    "Archived routines are read-only and cannot be restored.",
    [{ text: "Cancel", style: "cancel" }, { text: "Archive", style: "destructive", onPress: () => void runLifecycle(routine, "archive") }]
  );

  if (!accessReady) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.stateText}>Loading routines…</Text></View>;
  }
  if (!hasAccess) {
    return (
      <View style={styles.centered}>
        <Text style={styles.stateTitle}>Routines unavailable</Text>
        <Text style={styles.stateText}>You need an active group membership to view routines.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Go back</Text></Pressable>
      </View>
    );
  }

  const sectionProps = {
    role,
    memberStatus: currentMember?.status ?? null,
    currentUid: user.uid,
    pendingId,
    styles,
    theme,
    onEdit: openEdit,
    onPause: requestPause,
    onResume: (routine: GroupRoutineDoc) => void runLifecycle(routine, "resume"),
    onArchive: requestArchive,
    occurrenceByRoutine,
  };

  return (
    <View style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to group" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
            <Text style={styles.backText}>Group</Text>
          </Pressable>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>{group.name}</Text>
              <Text style={styles.title}>Routines</Text>
              <Text style={styles.subtitle}>Build recurring rhythms for your group without creating calendar events.</Text>
            </View>
            {canCreate ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Create group routine" onPress={openCreate} style={styles.primaryButton}>
                <Ionicons name="add" size={18} color={theme.colors.primaryText} />
                <Text style={styles.primaryButtonText}>New routine</Text>
              </Pressable>
            ) : null}
          </View>
          {listError ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Text style={styles.errorText}>Routines are unavailable right now. Existing listeners will retry automatically.</Text>
            </View>
          ) : null}
          <View style={[styles.columns, wide && styles.columnsWide]}>
            <RoutineSection
              title="Active"
              subtitle={`${active.length} active`}
              routines={active}
              loading={loadingStates.active}
              emptyText={canCreate ? "Create your first group routine." : "No active routines yet."}
              {...sectionProps}
            />
            <RoutineSection
              title="Paused"
              subtitle={`${paused.length} paused`}
              routines={paused}
              loading={loadingStates.paused}
              emptyText="No paused routines."
              {...sectionProps}
            />
          </View>
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${showArchived ? "Hide" : "Show"} archived routines`}
              accessibilityState={{ expanded: showArchived }}
              onPress={() => setShowArchived((current) => !current)}
              style={styles.sectionHeader}
            >
              <View>
                <Text style={styles.sectionTitle}>Archived</Text>
                <Text style={styles.sectionSubtitle}>{showArchived ? `${archived.length} archived` : "Read-only history"}</Text>
              </View>
              <Ionicons name={showArchived ? "chevron-up" : "chevron-down"} size={20} color={theme.colors.textMuted} />
            </Pressable>
            {showArchived ? (
              loadingStates.archived ? <ActivityIndicator color={theme.colors.primary} /> :
              archived.length ? archived.map((routine) => <RoutineCard key={routine.id} routine={routine} {...sectionProps} />) :
              <Text style={styles.emptyText}>No archived routines.</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <RoutineEditorModal
        editor={editor}
        saving={saving}
        error={editorError}
        pickerField={pickerField}
        styles={styles}
        theme={theme}
        members={members.filter((member) => member.role !== "viewer")}
        onChange={updateForm}
        onSetPicker={setPickerField}
        onClose={() => !saving && setEditor(null)}
        onSubmit={() => void submitEditor()}
      />
    </View>
  );
}

function RoutineSection({
  title, subtitle, routines, loading, emptyText, ...cardProps
}: {
  title: string;
  subtitle: string;
  routines: GroupRoutineDoc[];
  loading: boolean;
  emptyText: string;
} & RoutineCardProps) {
  return (
    <View style={cardProps.styles.section}>
      <View style={cardProps.styles.sectionHeader}>
        <View><Text style={cardProps.styles.sectionTitle}>{title}</Text><Text style={cardProps.styles.sectionSubtitle}>{subtitle}</Text></View>
      </View>
      {loading ? <ActivityIndicator color={cardProps.theme.colors.primary} /> :
        routines.length ? routines.map((routine) => <RoutineCard key={routine.id} routine={routine} {...cardProps} />) :
        <Text style={cardProps.styles.emptyText}>{emptyText}</Text>}
    </View>
  );
}

type RoutineCardProps = {
  role: GroupMemberDoc["role"] | null;
  memberStatus: GroupMemberDoc["status"] | null;
  currentUid: string | null;
  pendingId: string | null;
  styles: ReturnType<typeof createStyles>;
  theme: AppThemeTokens;
  onEdit: (routine: GroupRoutineDoc) => void;
  onPause: (routine: GroupRoutineDoc) => void;
  onResume: (routine: GroupRoutineDoc) => void;
  onArchive: (routine: GroupRoutineDoc) => void;
  occurrenceByRoutine: Map<string, GroupRoutineOccurrenceDoc>;
};

function RoutineCard({ routine, role, memberStatus, currentUid, pendingId, styles, onEdit, onPause, onResume, onArchive, occurrenceByRoutine }: RoutineCardProps & { routine: GroupRoutineDoc }) {
  const manageable = canManageGroupRoutineUi(role, memberStatus, currentUid, routine);
  const pending = pendingId === routine.id;
  const duration = formatGroupRoutineDuration(routine.durationMinutes);
  const occurrence = occurrenceByRoutine.get(routine.id);
  return (
    <View style={styles.routineCard}>
      <View style={styles.cardHeader}>
        <Text numberOfLines={2} style={styles.cardTitle}>{routine.title}</Text>
        <View style={[styles.badge, routine.status === "paused" && styles.pausedBadge, routine.status === "archived" && styles.archivedBadge]}>
          <Text style={styles.badgeText}>{getGroupRoutineStatusLabel(routine.status)}</Text>
        </View>
      </View>
      <Text style={styles.recurrence}>{formatGroupRoutineRecurrenceSummary(routine)}</Text>
      <Text style={styles.next}>{formatGroupRoutineNextOccurrence(routine)}</Text>
      {occurrence ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open today’s occurrence for ${routine.title}`}
          onPress={() =>
            router.push({
              pathname:
                "/group/[id]/routine-occurrence/[occurrenceId]",
              params: { id: routine.groupId, occurrenceId: occurrence.id },
            } as any)
          }
          style={styles.currentOccurrence}
        >
          <Text style={styles.currentOccurrenceText}>
            {occurrence.executionStatus === "completed"
              ? "Completed"
              : occurrence.executionStatus === "skipped"
                ? "Skipped"
                : currentUid &&
                    occurrence.participantUids.includes(currentUid)
                  ? `Awaiting your check-in · ${occurrence.completedParticipantCount} of ${occurrence.participantCount} completed`
                  : `${occurrence.completedParticipantCount} of ${occurrence.participantCount} completed`}
          </Text>
        </Pressable>
      ) : null}
      <Text style={styles.meta}>{routine.timezone} · {formatGroupRoutineDateBounds(routine)}</Text>
      {duration || routine.location ? <Text style={styles.meta}>{[routine.location, duration && `Duration: ${duration}`].filter(Boolean).join(" · ")}</Text> : null}
      {routine.description ? <Text numberOfLines={3} style={styles.description}>{routine.description}</Text> : null}
      <Text style={styles.creator}>Created by {getGroupRoutineCreatorLabel(routine)}</Text>
      {manageable ? (
        <View style={styles.cardActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${routine.title}`} disabled={pending} onPress={() => onEdit(routine)} style={styles.smallButton}><Text style={styles.smallButtonText}>Edit</Text></Pressable>
          {routine.status === "active" ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Pause ${routine.title}`} disabled={pending} onPress={() => onPause(routine)} style={styles.smallButton}><Text style={styles.smallButtonText}>Pause</Text></Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Resume ${routine.title}`} disabled={pending} onPress={() => onResume(routine)} style={styles.smallButton}><Text style={styles.smallButtonText}>{pending ? "Working…" : "Resume"}</Text></Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`Archive ${routine.title}`} disabled={pending} onPress={() => onArchive(routine)} style={styles.smallDangerButton}><Text style={styles.smallDangerText}>Archive</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

function RoutineEditorModal({
  editor, saving, error, pickerField, styles, theme, members, onChange, onSetPicker, onClose, onSubmit,
}: {
  editor: RoutineEditor | null;
  saving: boolean;
  error: string | null;
  pickerField: PickerField | null;
  styles: ReturnType<typeof createStyles>;
  theme: AppThemeTokens;
  members: GroupMemberDoc[];
  onChange: (patch: Partial<GroupRoutineFormState>) => void;
  onSetPicker: (field: PickerField | null) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const form = editor?.form;
  const summary = useMemo(() => {
    if (!form) return "";
    try {
      const normalized = normalizeGroupRoutineForm({ ...form, title: form.title || "Routine" });
      return formatGroupRoutineRecurrenceSummary(normalized as GroupRoutineDoc);
    } catch {
      return "Complete the schedule to preview its recurrence.";
    }
  }, [form]);
  if (!form) return null;
  const pickerValue = pickerField === "time"
    ? pickerTime(form.localStartTime)
    : pickerDate(pickerField === "endDate" ? form.endDate : form.startDate);
  const handlePicker = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS !== "ios") onSetPicker(null);
    if (event.type === "dismissed" || !value || !pickerField) return;
    if (pickerField === "time") onChange({ localStartTime: DateTime.fromJSDate(value).toFormat("HH:mm") });
    else onChange({ [pickerField]: DateTime.fromJSDate(value).toFormat("yyyy-LL-dd") });
  };
  const toggleWeekday = (weekday: number) => {
    const next = form.weekdays.includes(weekday)
      ? form.weekdays.filter((value) => value !== weekday)
      : [...form.weekdays, weekday].sort((a, b) => a - b);
    onChange({ weekdays: next });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View accessibilityViewIsModal style={styles.editorModal}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editor?.routine ? "Edit routine" : "New routine"}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close routine editor" disabled={saving} onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={theme.colors.text} /></Pressable>
            </View>
            <FormInput label="Title" value={form.title} onChangeText={(title) => onChange({ title })} maxLength={120} styles={styles} />
            <FormInput label="Description" value={form.description} onChangeText={(description) => onChange({ description })} maxLength={2000} multiline styles={styles} />
            <FormInput label="Location" value={form.location} onChangeText={(location) => onChange({ location })} maxLength={240} styles={styles} />
            <Text style={styles.inputLabel}>Frequency</Text>
            <View style={styles.chipRow}>
              {(["daily", "weekly", "monthly"] as const).map((frequency) => <ChoiceChip key={frequency} label={frequency[0].toUpperCase() + frequency.slice(1)} selected={form.frequency === frequency} onPress={() => onChange({ frequency })} styles={styles} />)}
            </View>
            <FormInput label="Repeat interval" value={form.intervalText} onChangeText={(intervalText) => onChange({ intervalText })} keyboardType="number-pad" styles={styles} />
            {form.frequency === "weekly" ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Weekdays</Text>
                <View style={styles.chipRow}>{GROUP_ROUTINE_WEEKDAYS.map((day) => <ChoiceChip key={day.value} label={day.short} selected={form.weekdays.includes(day.value)} onPress={() => toggleWeekday(day.value)} styles={styles} />)}</View>
              </View>
            ) : null}
            {form.frequency === "monthly" ? (
              <>
                <Text style={styles.inputLabel}>Monthly pattern</Text>
                <View style={styles.chipRow}>
                  <ChoiceChip label="Day of month" selected={form.monthlyMode === "day_of_month"} onPress={() => onChange({ monthlyMode: "day_of_month" })} styles={styles} />
                  <ChoiceChip label="Weekday pattern" selected={form.monthlyMode === "nth_weekday"} onPress={() => onChange({ monthlyMode: "nth_weekday" })} styles={styles} />
                </View>
                {form.monthlyMode === "day_of_month" ? (
                  <FormInput label="Day of month" value={form.dayOfMonthText} onChangeText={(dayOfMonthText) => onChange({ dayOfMonthText })} keyboardType="number-pad" styles={styles} />
                ) : (
                  <>
                    <Text style={styles.inputLabel}>Week</Text>
                    <View style={styles.chipRow}>{([1, 2, 3, 4, -1] as const).map((week) => <ChoiceChip key={week} label={week === -1 ? "Last" : ["First", "Second", "Third", "Fourth"][week - 1]} selected={form.weekOfMonth === week} onPress={() => onChange({ weekOfMonth: week })} styles={styles} />)}</View>
                    <Text style={styles.inputLabel}>Weekday</Text>
                    <View style={styles.chipRow}>{GROUP_ROUTINE_WEEKDAYS.map((day) => <ChoiceChip key={day.value} label={day.short} selected={form.weekdayOfMonth === day.value} onPress={() => onChange({ weekdayOfMonth: day.value })} styles={styles} />)}</View>
                  </>
                )}
              </>
            ) : null}
            <View style={styles.pickerGrid}>
              <PickerButton label="Start time" value={DateTime.fromFormat(form.localStartTime, "HH:mm").toFormat("t")} onPress={() => onSetPicker("time")} styles={styles} />
              <PickerButton label="Start date" value={DateTime.fromISO(form.startDate).toFormat("DDD")} onPress={() => onSetPicker("startDate")} styles={styles} />
            </View>
            <FormInput label="Timezone" value={form.timezone} onChangeText={(timezone) => onChange({ timezone })} autoCapitalize="none" autoCorrect={false} styles={styles} />
            <Text style={styles.hint}>Use an IANA timezone such as America/New_York.</Text>
            <ToggleRow label="End date" checked={form.hasEndDate} onPress={() => onChange({ hasEndDate: !form.hasEndDate })} styles={styles} />
            {form.hasEndDate ? <PickerButton label="Inclusive end date" value={DateTime.fromISO(form.endDate).toFormat("DDD")} onPress={() => onSetPicker("endDate")} styles={styles} /> : null}
            <ToggleRow label="Duration" checked={form.hasDuration} onPress={() => onChange({ hasDuration: !form.hasDuration })} styles={styles} />
            {form.hasDuration ? (
              <View style={styles.pickerGrid}>
                <FormInput label="Hours" value={form.durationHoursText} onChangeText={(durationHoursText) => onChange({ durationHoursText })} keyboardType="number-pad" styles={styles} compact />
                <FormInput label="Minutes" value={form.durationMinutesText} onChangeText={(durationMinutesText) => onChange({ durationMinutesText })} keyboardType="number-pad" styles={styles} compact />
              </View>
            ) : null}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Participants</Text>
              <Text style={styles.hint}>
                Assigned members can check in for each occurrence. Leave empty
                for manager-controlled completion.
              </Text>
              <View style={styles.chipRow}>
                {members.map((member) => {
                  const selected = form.participantUids.includes(member.uid);
                  const label =
                    member.displayName?.trim() ||
                    member.email?.trim() ||
                    "Group member";
                  return (
                    <ChoiceChip
                      key={member.uid}
                      label={label}
                      selected={selected}
                      onPress={() =>
                        onChange({
                          participantUids: selected
                            ? form.participantUids.filter(
                                (uid) => uid !== member.uid
                              )
                            : [...form.participantUids, member.uid].sort(),
                        })
                      }
                      styles={styles}
                    />
                  );
                })}
              </View>
            </View>
            {pickerField ? (
              <View style={styles.inlinePicker}>
                <DateTimePicker value={pickerValue} mode={pickerField === "time" ? "time" : "date"} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={handlePicker} />
                {Platform.OS === "ios" ? <Pressable accessibilityRole="button" onPress={() => onSetPicker(null)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Done</Text></Pressable> : null}
              </View>
            ) : null}
            <View style={styles.preview}><Text style={styles.inputLabel}>Schedule preview</Text><Text style={styles.previewText}>{summary}</Text></View>
            {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" disabled={saving} onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={onSubmit} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{saving ? "Saving…" : editor?.routine ? "Save changes" : "Create routine"}</Text></Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FormInput({ label, styles, multiline, compact, ...props }: React.ComponentProps<typeof TextInput> & { label: string; styles: ReturnType<typeof createStyles>; compact?: boolean }) {
  return <View style={[styles.inputGroup, compact && styles.compactInput]}><Text style={styles.inputLabel}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={styles.placeholder.color} multiline={multiline} style={[styles.input, multiline && styles.multilineInput]} {...props} /></View>;
}
function ChoiceChip({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}
function ToggleRow({ label, checked, onPress, styles }: { label: string; checked: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked }} onPress={onPress} style={styles.toggleRow}><View style={[styles.switchTrack, checked && styles.switchTrackOn]}><View style={[styles.switchThumb, checked && styles.switchThumbOn]} /></View><Text style={styles.toggleLabel}>{label}</Text></Pressable>;
}
function PickerButton({ label, value, onPress, styles }: { label: string; value: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} onPress={onPress} style={styles.pickerButton}><Text style={styles.inputLabel}>{label}</Text><Text style={styles.pickerValue}>{value}</Text></Pressable>;
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { padding: UI_SIZES.spacing.lg, alignItems: "center" },
    content: { width: "100%", maxWidth: 1080, gap: UI_SIZES.spacing.lg },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: UI_SIZES.spacing.md, padding: UI_SIZES.spacing.xl, backgroundColor: theme.colors.background },
    stateTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
    stateText: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
    backButton: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
    backText: { color: theme.colors.primary, fontWeight: "900" },
    header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: UI_SIZES.spacing.md },
    headerText: { flex: 1, minWidth: 220 },
    eyebrow: { color: theme.colors.primary, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
    title: { color: theme.colors.text, fontSize: 30, fontWeight: "900" },
    subtitle: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
    columns: { gap: UI_SIZES.spacing.lg },
    columnsWide: { flexDirection: "row", alignItems: "flex-start" },
    section: { flex: 1, minWidth: 0, gap: UI_SIZES.spacing.sm, padding: UI_SIZES.cardPadding.md, borderRadius: UI_SIZES.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sectionHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
    sectionSubtitle: { color: theme.colors.textMuted, fontSize: 12 },
    emptyText: { paddingVertical: UI_SIZES.spacing.lg, color: theme.colors.textMuted, textAlign: "center" },
    errorCard: { padding: UI_SIZES.spacing.md, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.dangerBorder, backgroundColor: theme.colors.dangerBackground },
    errorText: { color: theme.colors.dangerText, fontSize: 13, lineHeight: 19, fontWeight: "800" },
    routineCard: { gap: 6, padding: UI_SIZES.cardPadding.md, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: UI_SIZES.spacing.sm },
    cardTitle: { flex: 1, color: theme.colors.text, fontSize: 16, lineHeight: 21, fontWeight: "900" },
    badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: UI_SIZES.radius.xl, backgroundColor: theme.colors.successBackground },
    pausedBadge: { backgroundColor: theme.colors.warningBackground },
    archivedBadge: { backgroundColor: theme.colors.surface },
    badgeText: { color: theme.colors.text, fontSize: 10, fontWeight: "900" },
    recurrence: { color: theme.colors.text, fontSize: 13, lineHeight: 19, fontWeight: "800" },
    next: { color: theme.colors.primary, fontSize: 13, fontWeight: "900" },
    currentOccurrence: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.secondaryBackground },
    currentOccurrenceText: { color: theme.colors.secondaryText, fontSize: 12, fontWeight: "900" },
    meta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
    description: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
    creator: { color: theme.colors.textMuted, fontSize: 10 },
    cardActions: { flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm, marginTop: UI_SIZES.spacing.sm },
    smallButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.secondaryBorder, backgroundColor: theme.colors.secondaryBackground },
    smallButtonText: { color: theme.colors.secondaryText, fontSize: 12, fontWeight: "900" },
    smallDangerButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.dangerBorder, backgroundColor: theme.colors.dangerBackground },
    smallDangerText: { color: theme.colors.dangerText, fontSize: 12, fontWeight: "900" },
    primaryButton: { minHeight: UI_SIZES.buttonHeight.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 16, borderRadius: UI_SIZES.radius.xl, backgroundColor: theme.colors.primary },
    primaryButtonText: { color: theme.colors.primaryText, fontSize: 13, fontWeight: "900" },
    secondaryButton: { minHeight: UI_SIZES.buttonHeight.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.secondaryBorder, backgroundColor: theme.colors.secondaryBackground },
    secondaryButtonText: { color: theme.colors.secondaryText, fontSize: 13, fontWeight: "900" },
    disabled: { opacity: 0.55 },
    modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: UI_SIZES.spacing.md, backgroundColor: theme.colors.overlay },
    editorModal: { width: "100%", maxWidth: 700, maxHeight: "94%", borderRadius: UI_SIZES.radius.lg, backgroundColor: theme.colors.background, overflow: "hidden" },
    modalContent: { padding: UI_SIZES.cardPadding.lg, gap: UI_SIZES.spacing.md },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modalTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
    closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: theme.colors.surfaceMuted },
    inputGroup: { gap: 6 },
    compactInput: { flex: 1, minWidth: 120 },
    inputLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "900" },
    input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground, color: theme.colors.text },
    multilineInput: { minHeight: 96, textAlignVertical: "top" },
    placeholder: { color: theme.colors.textMuted },
    hint: { marginTop: -8, color: theme.colors.textMuted, fontSize: 11 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm },
    chip: { minHeight: 38, justifyContent: "center", paddingHorizontal: 13, borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    chipSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.badge },
    chipText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800" },
    chipTextSelected: { color: theme.colors.badgeText },
    pickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm },
    pickerButton: { flex: 1, minWidth: 150, minHeight: 64, justifyContent: "center", gap: 4, padding: 12, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    pickerValue: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    toggleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: UI_SIZES.spacing.sm },
    switchTrack: { width: 46, height: 28, padding: 3, justifyContent: "center", borderRadius: 14, backgroundColor: theme.colors.surfaceMuted },
    switchTrackOn: { backgroundColor: theme.colors.primary },
    switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface },
    switchThumbOn: { alignSelf: "flex-end" },
    toggleLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    inlinePicker: { gap: UI_SIZES.spacing.sm, padding: UI_SIZES.spacing.sm, borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.surfaceMuted },
    preview: { gap: 5, padding: UI_SIZES.spacing.md, borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.surfaceMuted },
    previewText: { color: theme.colors.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
    modalActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: UI_SIZES.spacing.sm },
  });
}
