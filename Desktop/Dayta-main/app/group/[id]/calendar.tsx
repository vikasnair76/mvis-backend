import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { DateTime } from "luxon";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import {
  GroupCalendarEventCard,
  formatGroupCalendarDateSpan,
  sortGroupCalendarEventsForDisplay,
} from "../../../components/groupCalendar/GroupCalendarEventCard";
import {
  GROUP_CALENDAR_DESCRIPTION_MAX_LENGTH,
  GROUP_CALENDAR_LOCATION_MAX_LENGTH,
  GROUP_CALENDAR_TITLE_MAX_LENGTH,
  canCreateGroupCalendarEvent,
  canManageGroupCalendarEvent,
  cancelGroupCalendarEvent,
  createGroupCalendarEvent,
  normalizeGroupCalendarEventInput,
  subscribeGroupCalendarEvent,
  subscribeGroupCalendarEventsForRange,
  subscribeUpcomingGroupCalendarEvents,
  updateGroupCalendarEvent,
  type GroupCalendarEventDoc,
} from "../../../services/groupCalendar";
import { auth, db } from "../../../services/firebase";
import {
  subscribeGroupMembers,
  type GroupDoc,
  type GroupMemberDoc,
} from "../../../services/groups";
import { UI_SIZES, type AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";

type EditorField =
  | "timedStartDate"
  | "timedStartTime"
  | "timedEndDate"
  | "timedEndTime"
  | "allDayStart"
  | "allDayLast";

type EditorState = {
  eventId: string | null;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  timedStart: Date;
  timedEnd: Date;
  allDayStart: Date;
  allDayLast: Date;
  timezone: string;
  attendeeUids: string[];
};

function nextReasonableHour(): Date {
  return DateTime.local()
    .plus({ hours: 1 })
    .startOf("hour")
    .toJSDate();
}

function dateKeyToPickerDate(dayKey: string): Date {
  const parsed = DateTime.fromISO(dayKey, { zone: "UTC" });
  return DateTime.local(parsed.year, parsed.month, parsed.day, 12).toJSDate();
}

function pickerDateToDayKey(value: Date): string {
  return DateTime.fromJSDate(value).toFormat("yyyy-LL-dd");
}

function createInitialEditor(
  timezone: string,
  selectedDayKey: string,
  event?: GroupCalendarEventDoc | null
): EditorState {
  if (event) {
    const timedStart = DateTime.fromMillis(
      event.startAtMs ?? Date.now(),
      { zone: timezone }
    ).toJSDate();
    const timedEnd = DateTime.fromMillis(
      event.endAtMs ?? Date.now() + 60 * 60 * 1000,
      { zone: timezone }
    ).toJSDate();
    const allDayStart = dateKeyToPickerDate(
      event.startDate ?? selectedDayKey
    );
    const allDayLast = dateKeyToPickerDate(
      event.endDate
        ? DateTime.fromISO(event.endDate)
            .minus({ days: 1 })
            .toFormat("yyyy-LL-dd")
        : selectedDayKey
    );
    return {
      eventId: event.id,
      title: event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      allDay: event.allDay,
      timedStart,
      timedEnd,
      allDayStart,
      allDayLast,
      timezone: event.timezone,
      attendeeUids: event.attendeeUids,
    };
  }

  const selectedDay = DateTime.fromISO(selectedDayKey, { zone: timezone });
  const reasonableStart = nextReasonableHour();
  const start =
    selectedDay.hasSame(DateTime.local().setZone(timezone), "day")
      ? reasonableStart
      : selectedDay.set({ hour: 9 }).toJSDate();
  return {
    eventId: null,
    title: "",
    description: "",
    location: "",
    allDay: false,
    timedStart: start,
    timedEnd: DateTime.fromJSDate(start).plus({ hours: 1 }).toJSDate(),
    allDayStart: dateKeyToPickerDate(selectedDayKey),
    allDayLast: dateKeyToPickerDate(selectedDayKey),
    timezone,
    attendeeUids: [],
  };
}

function formatSelectedDate(dayKey: string, timezone: string): string {
  const selected = DateTime.fromISO(dayKey, { zone: timezone });
  const today = DateTime.local().setZone(timezone).startOf("day");
  const delta = Math.round(selected.startOf("day").diff(today, "days").days);
  if (delta === 0) return `Today · ${selected.toFormat("cccc, MMMM d")}`;
  if (delta === 1) return `Tomorrow · ${selected.toFormat("cccc, MMMM d")}`;
  if (delta === -1) return `Yesterday · ${selected.toFormat("cccc, MMMM d")}`;
  return selected.toFormat("cccc, MMMM d, yyyy");
}

function mergePickerValue(
  current: Date,
  selected: Date,
  mode: "date" | "time"
): Date {
  const base = DateTime.fromJSDate(current);
  const picked = DateTime.fromJSDate(selected);
  return mode === "date"
    ? base
        .set({ year: picked.year, month: picked.month, day: picked.day })
        .toJSDate()
    : base
        .set({
          hour: picked.hour,
          minute: picked.minute,
          second: 0,
          millisecond: 0,
        })
        .toJSDate();
}

function friendlyCalendarError(operation: "load" | "save" | "cancel"): string {
  if (operation === "load") return "Couldn’t load this group calendar.";
  if (operation === "cancel") return "Couldn’t cancel the event.";
  return "Couldn’t save the event. Check the fields and try again.";
}

export default function GroupCalendarScreen() {
  const params = useLocalSearchParams<{ id?: string; eventId?: string }>();
  const groupId = typeof params.id === "string" ? params.id.trim() : "";
  const deepLinkedEventId =
    typeof params.eventId === "string" ? params.eventId.trim() : "";
  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const displayTimezone = DateTime.local().zoneName;
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [groupReady, setGroupReady] = useState(false);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [membershipReady, setMembershipReady] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(
    DateTime.local().setZone(displayTimezone).toFormat("yyyy-LL-dd")
  );
  const [dayEvents, setDayEvents] = useState<GroupCalendarEventDoc[]>([]);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState(false);
  const [dayRetryKey, setDayRetryKey] = useState(0);
  const [upcomingEvents, setUpcomingEvents] = useState<
    GroupCalendarEventDoc[]
  >([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingError, setUpcomingError] = useState(false);
  const [upcomingRetryKey, setUpcomingRetryKey] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const handledDeepLinkRef = useRef("");
  const [detailEvent, setDetailEvent] =
    useState<GroupCalendarEventDoc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [cancellingEvent, setCancellingEvent] = useState(false);
  const [pickerField, setPickerField] = useState<EditorField | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    setGroup(null);
    setGroupReady(false);
    if (!groupId || !user) {
      setGroupReady(true);
      return;
    }
    return onSnapshot(
      doc(db, "groups", groupId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setGroup(null);
        } else {
          const data = snapshot.data();
          setGroup({
            id: snapshot.id,
            name: data.name ?? "Untitled group",
            description: data.description ?? null,
            ownerUserId: data.ownerUserId ?? "",
            visibility: data.visibility ?? "invite_only",
            memberCount: data.memberCount ?? 0,
            createdAtMs: data.createdAtMs ?? 0,
            updatedAtMs: data.updatedAtMs ?? 0,
          });
        }
        setGroupReady(true);
      },
      () => {
        console.log("[GroupCalendarScreen] group subscription failed", {
          groupId,
        });
        setAccessError(true);
        setGroupReady(true);
      }
    );
  }, [groupId, user]);

  useEffect(() => {
    setMembers([]);
    setMembershipReady(false);
    if (!groupId || !user) {
      setMembershipReady(true);
      return;
    }
    return subscribeGroupMembers(
      groupId,
      (nextMembers) => {
        setMembers(nextMembers);
        setMembershipReady(true);
      },
      () => {
        console.log("[GroupCalendarScreen] membership subscription failed", {
          groupId,
        });
        setAccessError(true);
        setMembershipReady(true);
      }
    );
  }, [groupId, user]);

  const currentMember = useMemo(
    () => members.find((member) => member.uid === user?.uid) ?? null,
    [members, user?.uid]
  );
  const activeRole = currentMember?.status === "active"
    ? currentMember.role
    : null;
  const accessReady = authReady && groupReady && membershipReady;
  const hasAccess = !!user && !!group && !!activeRole && !accessError;
  const canCreate = canCreateGroupCalendarEvent(
    activeRole,
    currentMember?.status ?? "removed"
  );

  useEffect(() => {
    if (
      !hasAccess ||
      !deepLinkedEventId ||
      handledDeepLinkRef.current === deepLinkedEventId
    ) {
      return;
    }
    handledDeepLinkRef.current = deepLinkedEventId;
    setSelectedEventId(deepLinkedEventId);
  }, [deepLinkedEventId, hasAccess]);

  useEffect(() => {
    if (!hasAccess) {
      setDayEvents([]);
      setDayLoading(false);
      return;
    }
    const selected = DateTime.fromISO(selectedDayKey, {
      zone: displayTimezone,
    }).startOf("day");
    setDayLoading(true);
    setDayError(false);
    return subscribeGroupCalendarEventsForRange(
      groupId,
      selected.toMillis(),
      selected.plus({ days: 1 }).toMillis(),
      { limit: 100 },
      (events) => {
        setDayEvents(events);
        setDayLoading(false);
      },
      () => {
        console.log("[GroupCalendarScreen] day subscription failed", {
          groupId,
        });
        setDayError(true);
        setDayLoading(false);
      }
    );
  }, [
    dayRetryKey,
    displayTimezone,
    groupId,
    hasAccess,
    selectedDayKey,
  ]);

  useEffect(() => {
    if (!hasAccess) {
      setUpcomingEvents([]);
      setUpcomingLoading(false);
      return;
    }
    setUpcomingLoading(true);
    setUpcomingError(false);
    return subscribeUpcomingGroupCalendarEvents(
      groupId,
      { lowerBoundMs: Date.now(), limit: 20 },
      (events) => {
        setUpcomingEvents(events);
        setUpcomingLoading(false);
      },
      () => {
        console.log("[GroupCalendarScreen] upcoming subscription failed", {
          groupId,
        });
        setUpcomingError(true);
        setUpcomingLoading(false);
      }
    );
  }, [groupId, hasAccess, upcomingRetryKey]);

  useEffect(() => {
    if (!selectedEventId || !hasAccess) {
      setDetailEvent(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    return subscribeGroupCalendarEvent(
      selectedEventId,
      (event) => {
        setDetailEvent(event?.groupId === groupId ? event : null);
        setDetailLoading(false);
      },
      () => {
        console.log("[GroupCalendarScreen] detail subscription failed", {
          eventId: selectedEventId,
        });
        setDetailLoading(false);
      }
    );
  }, [groupId, hasAccess, selectedEventId]);

  const sortedDayEvents = useMemo(
    () => sortGroupCalendarEventsForDisplay(dayEvents),
    [dayEvents]
  );
  const sortedUpcomingEvents = useMemo(
    () => sortGroupCalendarEventsForDisplay(upcomingEvents),
    [upcomingEvents]
  );
  const canManageDetail =
    !!detailEvent &&
    detailEvent.status === "scheduled" &&
    canManageGroupCalendarEvent({
      role: activeRole,
      status: currentMember?.status ?? "removed",
      currentUid: user?.uid,
      createdByUid: detailEvent.createdByUid,
      sourceType: detailEvent.sourceType,
    });

  const changeSelectedDay = (days: number) => {
    setSelectedDayKey((current) =>
      DateTime.fromISO(current, { zone: displayTimezone })
        .plus({ days })
        .toFormat("yyyy-LL-dd")
    );
  };

  const openCreateEditor = () => {
    if (!canCreate || savingEvent) return;
    setEditor(
      createInitialEditor(displayTimezone, selectedDayKey)
    );
    setEditorError(null);
  };

  const openEditEditor = () => {
    if (!detailEvent || !canManageDetail) return;
    setEditor(
      createInitialEditor(displayTimezone, selectedDayKey, detailEvent)
    );
    setEditorError(null);
  };

  const toggleEditorAllDay = () => {
    setEditor((current) => {
      if (!current) return current;
      if (!current.allDay) {
        const start = DateTime.fromJSDate(current.timedStart);
        const end = DateTime.fromJSDate(current.timedEnd);
        return {
          ...current,
          allDay: true,
          allDayStart: start.startOf("day").toJSDate(),
          allDayLast: (end > start ? end : start).startOf("day").toJSDate(),
        };
      }
      const start = DateTime.fromJSDate(current.allDayStart).set({
        hour: 9,
        minute: 0,
      });
      return {
        ...current,
        allDay: false,
        timedStart: start.toJSDate(),
        timedEnd: start.plus({ hours: 1 }).toJSDate(),
      };
    });
    setEditorError(null);
  };

  const pickerValue = useMemo(() => {
    if (!editor || !pickerField) return new Date();
    if (pickerField.startsWith("timedStart")) return editor.timedStart;
    if (pickerField.startsWith("timedEnd")) return editor.timedEnd;
    return pickerField === "allDayStart"
      ? editor.allDayStart
      : editor.allDayLast;
  }, [editor, pickerField]);

  const handlePickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    const field = pickerField;
    if (Platform.OS === "android") setPickerField(null);
    if (event.type === "dismissed" || !selected || !field) return;
    setEditor((current) => {
      if (!current) return current;
      if (field === "timedStartDate") {
        return {
          ...current,
          timedStart: mergePickerValue(current.timedStart, selected, "date"),
        };
      }
      if (field === "timedStartTime") {
        return {
          ...current,
          timedStart: mergePickerValue(current.timedStart, selected, "time"),
        };
      }
      if (field === "timedEndDate") {
        return {
          ...current,
          timedEnd: mergePickerValue(current.timedEnd, selected, "date"),
        };
      }
      if (field === "timedEndTime") {
        return {
          ...current,
          timedEnd: mergePickerValue(current.timedEnd, selected, "time"),
        };
      }
      return {
        ...current,
        [field === "allDayStart" ? "allDayStart" : "allDayLast"]: selected,
      };
    });
    setEditorError(null);
  };

  const submitEditor = async () => {
    if (!editor || !user || !groupId || savingEvent) return;
    if (editor.eventId) {
      if (
        !detailEvent ||
        detailEvent.status !== "scheduled" ||
        !canManageDetail
      ) {
        setEditorError("This event can no longer be edited.");
        return;
      }
    } else if (!canCreate) {
      setEditorError("You do not have permission to create group events.");
      return;
    }

    const startDate = pickerDateToDayKey(editor.allDayStart);
    const visibleLastDate = DateTime.fromISO(
      pickerDateToDayKey(editor.allDayLast)
    );
    const endDate = visibleLastDate.plus({ days: 1 }).toFormat("yyyy-LL-dd");
    const timing = editor.allDay
      ? {
          allDay: true,
          startAtMs: null,
          endAtMs: null,
          startDate,
          endDate,
          timezone: editor.timezone,
        }
      : {
          allDay: false,
          startAtMs: editor.timedStart.getTime(),
          endAtMs: editor.timedEnd.getTime(),
          startDate: null,
          endDate: null,
          timezone: editor.timezone,
        };
    try {
      normalizeGroupCalendarEventInput({
        groupId,
        title: editor.title,
        description: editor.description,
        location: editor.location,
        createdByUid: user.uid,
        attendeeUids: editor.attendeeUids,
        ...timing,
      });
    } catch (error) {
      setEditorError(
        error instanceof Error
          ? error.message
          : friendlyCalendarError("save")
      );
      return;
    }

    setSavingEvent(true);
    setEditorError(null);
    try {
      if (editor.eventId) {
        await updateGroupCalendarEvent({
          eventId: editor.eventId,
          title: editor.title,
          description: editor.description,
          location: editor.location,
          attendeeUids: editor.attendeeUids,
          ...timing,
        });
      } else {
        await createGroupCalendarEvent({
          groupId,
          title: editor.title,
          description: editor.description,
          location: editor.location,
          createdByUid: user.uid,
          createdByName: user.displayName ?? user.email ?? null,
          createdByEmail: user.email ?? null,
          attendeeUids: [],
          ...timing,
        });
      }
      setEditor(null);
      setPickerField(null);
    } catch {
      console.log("[GroupCalendarScreen] event save failed", {
        groupId,
        eventId: editor.eventId,
      });
      setEditorError(friendlyCalendarError("save"));
    } finally {
      setSavingEvent(false);
    }
  };

  const requestCancelEvent = () => {
    if (!detailEvent || !user || !canManageDetail || cancellingEvent) return;
    Alert.alert(
      `Cancel “${detailEvent.title}”?`,
      "This removes it from the active group calendar but preserves the event record. This cannot be undone yet.",
      [
        { text: "Keep event", style: "cancel" },
        {
          text: "Cancel event",
          style: "destructive",
          onPress: async () => {
            setCancellingEvent(true);
            try {
              await cancelGroupCalendarEvent({
                eventId: detailEvent.id,
                cancelledByUid: user.uid,
              });
              setSelectedEventId(null);
              setDetailEvent(null);
            } catch {
              console.log("[GroupCalendarScreen] event cancellation failed", {
                eventId: detailEvent.id,
              });
              Alert.alert("Couldn’t cancel event", friendlyCalendarError("cancel"));
            } finally {
              setCancellingEvent(false);
            }
          },
        },
      ]
    );
  };

  if (!accessReady) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.stateText}>Loading group calendar...</Text>
      </View>
    );
  }
  if (!groupId) {
    return <AccessState styles={styles} title="Invalid group" body="This calendar link is incomplete." />;
  }
  if (!user) {
    return <AccessState styles={styles} title="Sign in required" body="Sign in to open this group calendar." />;
  }
  if (!group && !accessError) {
    return <AccessState styles={styles} title="Group not found" body="This group may no longer be available." />;
  }
  if (!hasAccess) {
    return <AccessState styles={styles} title="Calendar unavailable" body="You need an active group membership to view this calendar." />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to group"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
            <Text style={styles.backText}>Group</Text>
          </Pressable>

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>{group.name}</Text>
              <Text style={styles.title}>Group Calendar</Text>
              <Text style={styles.subtitle}>
                Scheduled plans shared with active group members.
              </Text>
            </View>
            {canCreate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create group calendar event"
                onPress={openCreateEditor}
                style={styles.primaryButton}
              >
                <Ionicons name="add" size={18} color={theme.colors.primaryText} />
                <Text style={styles.primaryButtonText}>Add event</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.dateBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              onPress={() => changeSelectedDay(-1)}
              style={styles.dateButton}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
            </Pressable>
            <View style={styles.dateLabelWrap}>
              <Text accessibilityRole="header" style={styles.dateLabel}>
                {formatSelectedDate(selectedDayKey, displayTimezone)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go to today"
                onPress={() =>
                  setSelectedDayKey(
                    DateTime.local()
                      .setZone(displayTimezone)
                      .toFormat("yyyy-LL-dd")
                  )
                }
              >
                <Text style={styles.todayLink}>Today</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next day"
              onPress={() => changeSelectedDay(1)}
              style={styles.dateButton}
            >
              <Ionicons name="chevron-forward" size={20} color={theme.colors.text} />
            </Pressable>
          </View>

          <View style={[styles.columns, width >= 800 && styles.columnsWide]}>
            <CalendarSection
              title="Selected day"
              subtitle="Events overlapping this local calendar day."
              loading={dayLoading}
              error={dayError}
              emptyText="No group events scheduled for this day."
              canCreate={canCreate}
              onRetry={() => setDayRetryKey((current) => current + 1)}
              onCreate={openCreateEditor}
              events={sortedDayEvents}
              displayTimezone={displayTimezone}
              theme={theme}
              styles={styles}
              onSelect={setSelectedEventId}
            />
            <CalendarSection
              title="Upcoming"
              subtitle="Future starts only; already-started events are not included."
              loading={upcomingLoading}
              error={upcomingError}
              emptyText="No upcoming group events."
              canCreate={false}
              onRetry={() => setUpcomingRetryKey((current) => current + 1)}
              onCreate={openCreateEditor}
              events={sortedUpcomingEvents}
              displayTimezone={displayTimezone}
              theme={theme}
              styles={styles}
              onSelect={setSelectedEventId}
            />
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedEventId}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedEventId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            accessibilityViewIsModal
            style={styles.detailModal}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Event details</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close event details"
                  onPress={() => setSelectedEventId(null)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={theme.colors.text} />
                </Pressable>
              </View>
              {detailLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : !detailEvent ? (
                <Text style={styles.stateText}>This event is no longer available.</Text>
              ) : (
                <>
                  <Text style={styles.detailTitle}>{detailEvent.title}</Text>
                  {detailEvent.sourceType === "group_routine" ? (
                    <Text style={styles.detailMeta}>
                      Generated from a group routine · Read-only
                    </Text>
                  ) : null}
                  <Text style={styles.detailTime}>
                    {formatGroupCalendarDateSpan(
                      detailEvent,
                      displayTimezone,
                      true
                    )}
                  </Text>
                  {detailEvent.timezone !== displayTimezone ? (
                    <Text style={styles.detailMeta}>
                      Created in {detailEvent.timezone}; timed values are shown in {displayTimezone}.
                    </Text>
                  ) : null}
                  {detailEvent.location ? (
                    <DetailField label="Location" value={detailEvent.location} styles={styles} />
                  ) : null}
                  {detailEvent.description ? (
                    <DetailField label="Description" value={detailEvent.description} styles={styles} selectable />
                  ) : null}
                  <DetailField
                    label="Creator"
                    value={detailEvent.createdByName ?? "Group member"}
                    styles={styles}
                  />
                  {detailEvent.attendeeUids.length > 0 ? (
                    <DetailField
                      label="Attendees"
                      value={`${detailEvent.attendeeUids.length}`}
                      styles={styles}
                    />
                  ) : null}
                  <DetailField
                    label="Status"
                    value={detailEvent.status === "cancelled" ? "Cancelled" : "Scheduled"}
                    styles={styles}
                  />
                  {canManageDetail ? (
                    <View style={styles.modalActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit group calendar event"
                        onPress={openEditEditor}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel ${detailEvent.title}`}
                        accessibilityState={{ disabled: cancellingEvent }}
                        disabled={cancellingEvent}
                        onPress={requestCancelEvent}
                        style={styles.dangerButton}
                      >
                        <Text style={styles.dangerButtonText}>
                          {cancellingEvent ? "Cancelling..." : "Cancel event"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : detailEvent.sourceOccurrenceId ? (
                    <View style={styles.modalActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open routine occurrence check-in"
                        onPress={() => {
                          setSelectedEventId(null);
                          router.push({
                            pathname:
                              "/group/[id]/routine-occurrence/[occurrenceId]",
                            params: {
                              id: groupId,
                              occurrenceId: detailEvent.sourceOccurrenceId,
                            },
                          } as any);
                        }}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Open Check-in</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editor}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!savingEvent) setEditor(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View accessibilityViewIsModal style={styles.editorModal}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editor?.eventId ? "Edit event" : "New event"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close event editor"
                  disabled={savingEvent}
                  onPress={() => setEditor(null)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={theme.colors.text} />
                </Pressable>
              </View>
              {editor ? (
                <>
                  <EditorInput
                    label="Title"
                    value={editor.title}
                    onChangeText={(title) =>
                      setEditor((current) => current ? { ...current, title } : current)
                    }
                    maxLength={GROUP_CALENDAR_TITLE_MAX_LENGTH}
                    styles={styles}
                  />
                  <Text style={styles.characterCount}>
                    {editor.title.length}/{GROUP_CALENDAR_TITLE_MAX_LENGTH}
                  </Text>
                  <EditorInput
                    label="Description"
                    value={editor.description}
                    onChangeText={(description) =>
                      setEditor((current) => current ? { ...current, description } : current)
                    }
                    maxLength={GROUP_CALENDAR_DESCRIPTION_MAX_LENGTH}
                    multiline
                    styles={styles}
                  />
                  <EditorInput
                    label="Location"
                    value={editor.location}
                    onChangeText={(location) =>
                      setEditor((current) => current ? { ...current, location } : current)
                    }
                    maxLength={GROUP_CALENDAR_LOCATION_MAX_LENGTH}
                    styles={styles}
                  />
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel="All-day event"
                    accessibilityState={{ checked: editor.allDay }}
                    onPress={toggleEditorAllDay}
                    style={styles.switchRow}
                  >
                    <View style={[styles.switchTrack, editor.allDay && styles.switchTrackOn]}>
                      <View style={[styles.switchThumb, editor.allDay && styles.switchThumbOn]} />
                    </View>
                    <Text style={styles.switchLabel}>All-day event</Text>
                  </Pressable>

                  {editor.allDay ? (
                    <>
                      <Text style={styles.formHint}>
                        Choose the first and visible last day. The stored end remains exclusive.
                      </Text>
                      <PickerButton
                        label="Start date"
                        value={DateTime.fromJSDate(editor.allDayStart).toFormat("DDD")}
                        onPress={() => setPickerField("allDayStart")}
                        styles={styles}
                      />
                      <PickerButton
                        label="Last day"
                        value={DateTime.fromJSDate(editor.allDayLast).toFormat("DDD")}
                        onPress={() => setPickerField("allDayLast")}
                        styles={styles}
                      />
                    </>
                  ) : (
                    <>
                      <View style={styles.pickerGrid}>
                        <PickerButton
                          label="Start date"
                          value={DateTime.fromJSDate(editor.timedStart).toFormat("DDD")}
                          onPress={() => setPickerField("timedStartDate")}
                          styles={styles}
                        />
                        <PickerButton
                          label="Start time"
                          value={DateTime.fromJSDate(editor.timedStart).toFormat("t")}
                          onPress={() => setPickerField("timedStartTime")}
                          styles={styles}
                        />
                        <PickerButton
                          label="End date"
                          value={DateTime.fromJSDate(editor.timedEnd).toFormat("DDD")}
                          onPress={() => setPickerField("timedEndDate")}
                          styles={styles}
                        />
                        <PickerButton
                          label="End time"
                          value={DateTime.fromJSDate(editor.timedEnd).toFormat("t")}
                          onPress={() => setPickerField("timedEndTime")}
                          styles={styles}
                        />
                      </View>
                    </>
                  )}

                  <View style={styles.readOnlyField}>
                    <Text style={styles.inputLabel}>Timezone</Text>
                    <Text style={styles.readOnlyValue}>{editor.timezone}</Text>
                    <Text style={styles.formHint}>
                      New events use your device timezone. Arbitrary timezone selection is deferred.
                    </Text>
                  </View>
                  {pickerField ? (
                    <View style={styles.inlinePicker}>
                      <DateTimePicker
                        value={pickerValue}
                        mode={pickerField.endsWith("Time") ? "time" : "date"}
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        onChange={handlePickerChange}
                      />
                      {Platform.OS === "ios" ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Done choosing date or time"
                          onPress={() => setPickerField(null)}
                          style={styles.secondaryButton}
                        >
                          <Text style={styles.secondaryButtonText}>Done</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {editorError ? (
                    <Text accessibilityRole="alert" style={styles.errorText}>
                      {editorError}
                    </Text>
                  ) : null}
                  <View style={styles.modalActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={savingEvent}
                      onPress={() => setEditor(null)}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Close</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={editor.eventId ? "Save group calendar event" : "Create group calendar event"}
                      accessibilityState={{ disabled: savingEvent, busy: savingEvent }}
                      disabled={savingEvent}
                      onPress={submitEditor}
                      style={[styles.primaryButton, savingEvent && styles.disabled]}
                    >
                      <Text style={styles.primaryButtonText}>
                        {savingEvent ? "Saving..." : editor.eventId ? "Save changes" : "Create event"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

function AccessState({
  styles,
  title,
  body,
}: {
  styles: ReturnType<typeof createStyles>;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{body}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Go back</Text>
      </Pressable>
    </View>
  );
}

function CalendarSection({
  title,
  subtitle,
  loading,
  error,
  emptyText,
  canCreate,
  onRetry,
  onCreate,
  events,
  displayTimezone,
  theme,
  styles,
  onSelect,
}: {
  title: string;
  subtitle: string;
  loading: boolean;
  error: boolean;
  emptyText: string;
  canCreate: boolean;
  onRetry: () => void;
  onCreate: () => void;
  events: GroupCalendarEventDoc[];
  displayTimezone: string;
  theme: AppThemeTokens;
  styles: ReturnType<typeof createStyles>;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      {loading ? (
        <View style={styles.inlineState}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.stateText}>Loading events...</Text>
        </View>
      ) : error ? (
        <View style={styles.inlineState}>
          <Text style={styles.errorText}>Couldn’t load events.</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.inlineState}>
          <Text style={styles.stateText}>{emptyText}</Text>
          {canCreate ? (
            <>
              <Text style={styles.formHint}>Add an event to coordinate plans with the group.</Text>
              <Pressable accessibilityRole="button" onPress={onCreate} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Add event</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : (
        <View style={styles.eventList}>
          {events.map((event) => (
            <GroupCalendarEventCard
              key={event.id}
              event={event}
              displayTimezone={displayTimezone}
              theme={theme}
              onPress={() => onSelect(event.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function DetailField({
  label,
  value,
  styles,
  selectable = false,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  selectable?: boolean;
}) {
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable={selectable} style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function EditorInput({
  label,
  styles,
  multiline = false,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={styles.placeholder.color}
        multiline={multiline}
        style={[styles.input, multiline && styles.multilineInput]}
        {...props}
      />
    </View>
  );
}

function PickerButton({
  label,
  value,
  onPress,
  styles,
}: {
  label: string;
  value: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} onPress={onPress} style={styles.pickerButton}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Text style={styles.pickerValue}>{value}</Text>
    </Pressable>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { padding: UI_SIZES.spacing.lg, alignItems: "center" },
    content: { width: "100%", maxWidth: 1080, gap: UI_SIZES.spacing.lg },
    backButton: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4 },
    backText: { color: theme.colors.primary, fontSize: 14, fontWeight: "800" },
    header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: UI_SIZES.spacing.md },
    headerText: { flex: 1, minWidth: 220 },
    eyebrow: { color: theme.colors.primary, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
    title: { color: theme.colors.text, fontSize: 28, lineHeight: 34, fontWeight: "900" },
    subtitle: { marginTop: 4, color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
    dateBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: UI_SIZES.spacing.md, padding: UI_SIZES.cardPadding.md, borderRadius: UI_SIZES.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    dateButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: UI_SIZES.radius.xl, backgroundColor: theme.colors.surfaceMuted },
    dateLabelWrap: { flex: 1, alignItems: "center", gap: 3 },
    dateLabel: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: "900", textAlign: "center" },
    todayLink: { color: theme.colors.primary, fontSize: 12, fontWeight: "900" },
    columns: { gap: UI_SIZES.spacing.lg },
    columnsWide: { flexDirection: "row", alignItems: "flex-start" },
    section: { flex: 1, minWidth: 0, gap: UI_SIZES.spacing.sm, padding: UI_SIZES.cardPadding.md, borderRadius: UI_SIZES.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
    sectionSubtitle: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
    eventList: { gap: UI_SIZES.spacing.sm },
    centeredState: { flex: 1, alignItems: "center", justifyContent: "center", gap: UI_SIZES.spacing.md, padding: UI_SIZES.spacing.xl, backgroundColor: theme.colors.background },
    inlineState: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: UI_SIZES.spacing.sm, padding: UI_SIZES.spacing.md },
    stateTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
    stateText: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
    primaryButton: { minHeight: UI_SIZES.buttonHeight.md, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: UI_SIZES.radius.xl, backgroundColor: theme.colors.primary },
    primaryButtonText: { color: theme.colors.primaryText, fontSize: 13, fontWeight: "900" },
    secondaryButton: { minHeight: UI_SIZES.buttonHeight.md, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.secondaryBorder, backgroundColor: theme.colors.secondaryBackground },
    secondaryButtonText: { color: theme.colors.secondaryText, fontSize: 13, fontWeight: "900" },
    dangerButton: { minHeight: UI_SIZES.buttonHeight.md, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: UI_SIZES.radius.xl, borderWidth: 1, borderColor: theme.colors.dangerBorder, backgroundColor: theme.colors.dangerBackground },
    dangerButtonText: { color: theme.colors.dangerText, fontSize: 13, fontWeight: "900" },
    disabled: { opacity: 0.55 },
    modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: UI_SIZES.spacing.lg, backgroundColor: theme.colors.overlay },
    detailModal: { width: "100%", maxWidth: 620, maxHeight: "86%", borderRadius: UI_SIZES.radius.lg, backgroundColor: theme.colors.background, overflow: "hidden" },
    editorModal: { width: "100%", maxWidth: 680, maxHeight: "94%", borderRadius: UI_SIZES.radius.lg, backgroundColor: theme.colors.background, overflow: "hidden" },
    modalContent: { padding: UI_SIZES.cardPadding.lg, gap: UI_SIZES.spacing.md },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: UI_SIZES.spacing.md },
    modalTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
    closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: UI_SIZES.radius.xl, backgroundColor: theme.colors.surfaceMuted },
    detailTitle: { color: theme.colors.text, fontSize: 24, lineHeight: 30, fontWeight: "900" },
    detailTime: { color: theme.colors.primary, fontSize: 14, lineHeight: 20, fontWeight: "900" },
    detailMeta: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
    detailField: { gap: 3, paddingTop: UI_SIZES.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border },
    detailLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
    detailValue: { color: theme.colors.text, fontSize: 14, lineHeight: 21 },
    modalActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: UI_SIZES.spacing.sm, marginTop: UI_SIZES.spacing.sm },
    inputGroup: { gap: 6 },
    inputLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "900" },
    input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground, color: theme.colors.text, fontSize: 14 },
    multilineInput: { minHeight: 112, textAlignVertical: "top" },
    characterCount: { marginTop: -8, alignSelf: "flex-end", color: theme.colors.textMuted, fontSize: 11 },
    switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: UI_SIZES.spacing.sm },
    switchTrack: { width: 46, height: 28, padding: 3, justifyContent: "center", borderRadius: 14, backgroundColor: theme.colors.surfaceMuted },
    switchTrackOn: { backgroundColor: theme.colors.primary },
    switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface },
    switchThumbOn: { alignSelf: "flex-end" },
    switchLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    pickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: UI_SIZES.spacing.sm },
    pickerButton: { flexGrow: 1, minWidth: 130, minHeight: 64, justifyContent: "center", gap: 4, padding: 12, borderRadius: UI_SIZES.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    pickerValue: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    readOnlyField: { gap: 5, padding: 12, borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.surfaceMuted },
    readOnlyValue: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    inlinePicker: { gap: UI_SIZES.spacing.sm, padding: UI_SIZES.spacing.sm, borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.surfaceMuted },
    formHint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
    errorText: { color: theme.colors.dangerText, fontSize: 13, lineHeight: 19, fontWeight: "800", textAlign: "center" },
    placeholder: { color: theme.colors.textMuted },
  });
}
