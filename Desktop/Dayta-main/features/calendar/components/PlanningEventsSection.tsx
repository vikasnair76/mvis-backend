import React, { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PlanningCalendarEventDoc } from "../../../services/planningCalendar";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import {
  formatPlanningEventDateLabel,
  formatPlanningEventTimeRange,
  parsePlanningDateTime,
} from "../utils";

export interface PlanningEventsSectionProps {
  events: PlanningCalendarEventDoc[];
  onAddEvent: (event: {
    title: string;
    description?: string | null;
    startAtMs: number;
    endAtMs: number;
  }) => Promise<any>;
  onArchiveEvent: (event: PlanningCalendarEventDoc) => Promise<any>;
}

export function PlanningEventsSection({
  events,
  onAddEvent,
  onArchiveEvent,
}: PlanningEventsSectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [startTimeInput, setStartTimeInput] = useState("");
  const [endTimeInput, setEndTimeInput] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert("Title required", "Please enter a title for the event.");
      return;
    }

    const startMs = parsePlanningDateTime(dateInput, startTimeInput);
    const endMs = parsePlanningDateTime(dateInput, endTimeInput);

    if (startMs == null || endMs == null) {
      Alert.alert(
        "Invalid date/time",
        "Please enter a valid date (YYYY-MM-DD) and times (HH:mm)."
      );
      return;
    }

    if (endMs <= startMs) {
      Alert.alert("Invalid time range", "End time must be after start time.");
      return;
    }

    try {
      setSaving(true);
      await onAddEvent({
        title: trimmedTitle,
        description: description.trim() || null,
        startAtMs: startMs,
        endAtMs: endMs,
      });

      setTitle("");
      setDescription("");
      setDateInput("");
      setStartTimeInput("");
      setEndTimeInput("");
      setShowCreate(false);
    } catch (err: any) {
      Alert.alert("Failed to create event", err?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = (event: PlanningCalendarEventDoc) => {
    Alert.alert(
      "Archive event?",
      `Archive "${event.title}"? It will no longer appear on your calendar.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            try {
              await onArchiveEvent(event);
            } catch (err: any) {
              Alert.alert(
                "Could not archive event",
                err?.message ?? "Please try again."
              );
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Planning events</Text>
        <Pressable
          style={styles.toggleBtn}
          onPress={() => setShowCreate((prev) => !prev)}
        >
          <Text style={styles.toggleBtnText}>
            {showCreate ? "Hide" : "+ New event"}
          </Text>
        </Pressable>
      </View>

      {showCreate && (
        <View style={styles.form}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Event title"
            placeholderTextColor={theme.colors.secondaryText}
            style={styles.input}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optional description"
            placeholderTextColor={theme.colors.secondaryText}
            style={[styles.input, styles.multilineInput]}
            multiline
          />

          <Text style={styles.label}>Date</Text>
          <TextInput
            value={dateInput}
            onChangeText={setDateInput}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.secondaryText}
            style={styles.input}
            autoCapitalize="none"
          />

          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.label}>Start time</Text>
              <TextInput
                value={startTimeInput}
                onChangeText={setStartTimeInput}
                placeholder="HH:mm"
                placeholderTextColor={theme.colors.secondaryText}
                style={styles.input}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.timeField}>
              <Text style={styles.label}>End time</Text>
              <TextInput
                value={endTimeInput}
                onChangeText={setEndTimeInput}
                placeholder="HH:mm"
                placeholderTextColor={theme.colors.secondaryText}
                style={styles.input}
                autoCapitalize="none"
              />
            </View>
          </View>

          <Text style={styles.hint}>
            Use YYYY-MM-DD and 24-hour time, e.g. 2026-07-15 and 14:30.
          </Text>

          <Pressable
            style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
            onPress={handleCreate}
            disabled={saving}
          >
            <Text style={styles.submitBtnText}>
              {saving ? "Saving..." : "Create event"}
            </Text>
          </Pressable>
        </View>
      )}

      {events.length === 0 ? (
        <Text style={styles.emptyText}>
          No planning events yet. Add appointments, workouts, or time blocks here.
        </Text>
      ) : (
        events.map((event) => (
          <View key={event.id} style={styles.eventRow}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.eventMeta}>
              {formatPlanningEventDateLabel(event)} ·{" "}
              {formatPlanningEventTimeRange(event)}
            </Text>
            {event.description ? (
              <Text style={styles.eventDescription}>{event.description}</Text>
            ) : null}

            <Pressable
              style={styles.archiveBtn}
              onPress={() => handleArchive(event)}
            >
              <Text style={styles.archiveBtnText}>Archive</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
      padding: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    toggleBtn: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      backgroundColor: theme.colors.badge,
      borderRadius: 8,
    },
    toggleBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    form: {
      marginBottom: 16,
      padding: 12,
      backgroundColor: theme.colors.secondaryBackground,
      borderRadius: 10,
      gap: 6,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.secondaryText,
      marginTop: 4,
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      color: theme.colors.text,
    },
    multilineInput: {
      minHeight: 60,
      textAlignVertical: "top",
    },
    timeRow: {
      flexDirection: "row",
      gap: 10,
    },
    timeField: {
      flex: 1,
    },
    hint: {
      fontSize: 11,
      color: theme.colors.secondaryText,
      marginTop: 4,
    },
    submitBtn: {
      marginTop: 8,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
    },
    submitBtnDisabled: {
      opacity: 0.6,
    },
    submitBtnText: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "700",
    },
    emptyText: {
      fontSize: 13,
      color: theme.colors.secondaryText,
      marginTop: 4,
    },
    eventRow: {
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      gap: 4,
    },
    eventTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.text,
    },
    eventMeta: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    eventDescription: {
      fontSize: 12,
      color: theme.colors.secondaryText,
      fontStyle: "italic",
    },
    archiveBtn: {
      alignSelf: "flex-start",
      marginTop: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.secondaryBackground,
      borderRadius: 6,
    },
    archiveBtnText: {
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
  });
}
