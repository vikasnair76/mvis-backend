import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SubtaskProgressEventDoc } from "../services/subtasks";
import type { MediaAttachmentDoc } from "../services/mediaAttachments";
import type { AppThemeTokens } from "../services/theme";
import { formatProgressValue } from "./ProgressMeter";
import { MediaAttachmentGrid } from "./MediaAttachmentGrid";

export type ProgressEventCardProps = {
  event: SubtaskProgressEventDoc;
  theme: AppThemeTokens;
  currentUserUid?: string | null;
  memberLabel?: string | null;
  reverterLabel?: string | null;
  onAttachmentPress?: (
    attachment: MediaAttachmentDoc,
    index: number
  ) => void;
};

function formatEventTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Time unavailable";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startEvent = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDifference = Math.round(
    (startToday.getTime() - startEvent.getTime()) / 86_400_000
  );
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (dayDifference === 0) return `Today at ${time}`;
  if (dayDifference === 1) return `Yesterday at ${time}`;
  const dateLabel = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });
  return `${dateLabel} at ${time}`;
}

function formatOccurrenceDay(dayKey?: string | null): string | null {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    ...(year === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });
}

function ProgressEventCardComponent({
  event,
  theme,
  currentUserUid,
  memberLabel,
  reverterLabel,
  onAttachmentPress,
}: ProgressEventCardProps) {
  const author =
    event.authorUid && event.authorUid === currentUserUid
      ? "You"
      : event.authorName || event.authorEmail || memberLabel || "Unknown member";
  const title =
    event.kind === "completion"
      ? `${author} completed this subtask`
      : event.kind === "increment"
      ? `${author} added progress`
      : `${author} recorded a progress update`;
  const hasValues =
    event.previousValue != null && event.resultingValue != null;
  const hasMetricSnapshot =
    event.metricContributionBefore != null &&
    event.metricContributionAfter != null &&
    event.metricContributionDelta != null &&
    event.metricContributionTarget != null;
  const occurrenceLabel = formatOccurrenceDay(event.dayKey);
  const createdDayKey =
    event.createdAtMs > 0
      ? `${new Date(event.createdAtMs).getFullYear()}-${String(
          new Date(event.createdAtMs).getMonth() + 1
        ).padStart(2, "0")}-${String(
          new Date(event.createdAtMs).getDate()
        ).padStart(2, "0")}`
      : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: event.reverted
            ? theme.colors.surfaceMuted
            : theme.colors.surface,
          borderColor: event.reverted
            ? theme.colors.warningBorder
            : theme.colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          accessible
          accessibilityLabel={`${author} profile initial`}
          style={[styles.avatar, { backgroundColor: theme.colors.badge }]}
        >
          <Text style={[styles.avatarText, { color: theme.colors.badgeText }]}>
            {author.slice(0, 1).toUpperCase() || "?"}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.timestamp, { color: theme.colors.textMuted }]}>
            {formatEventTime(event.createdAtMs)}
          </Text>
        </View>
        {event.reverted ? (
          <View
            style={[
              styles.revertedBadge,
              {
                backgroundColor: theme.colors.warningBackground,
                borderColor: theme.colors.warningBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.revertedBadgeText,
                { color: theme.colors.warningText },
              ]}
            >
              Reverted
            </Text>
          </View>
        ) : null}
      </View>

      {event.kind === "increment" && hasValues ? (
        <View style={styles.values}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
            Count
          </Text>
          <Text
            style={[
              styles.valueLine,
              { color: theme.colors.text },
              event.reverted && styles.revertedValue,
            ]}
          >
            {formatProgressValue(event.previousValue!)} →{" "}
            {formatProgressValue(event.resultingValue!)}
            {event.targetValue != null
              ? ` of ${formatProgressValue(event.targetValue)}`
              : ""}
            {event.unit ? ` ${event.unit}` : ""}
          </Text>
          {event.delta != null ? (
            <Text style={[styles.delta, { color: theme.colors.primary }]}>
              +{formatProgressValue(event.delta)}
              {event.unit ? ` ${event.unit}` : ""}
            </Text>
          ) : null}
          {event.completed ? (
            <Text style={[styles.targetReached, { color: theme.colors.successText }]}>
              Target reached
            </Text>
          ) : null}
        </View>
      ) : null}

      {hasMetricSnapshot ? (
        <View style={styles.values}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
            Metric contribution
          </Text>
          <Text
            style={[
              styles.valueLine,
              { color: theme.colors.text },
              event.reverted && styles.revertedValue,
            ]}
          >
            {formatProgressValue(event.metricContributionBefore!)} →{" "}
            {formatProgressValue(event.metricContributionAfter!)} of{" "}
            {formatProgressValue(event.metricContributionTarget!)}
            {event.metricUnitSnapshot
              ? ` ${event.metricUnitSnapshot}`
              : ""}
          </Text>
          <Text style={[styles.delta, { color: theme.colors.primary }]}>
            +{formatProgressValue(event.metricContributionDelta!)}
            {event.metricUnitSnapshot
              ? ` ${event.metricUnitSnapshot}`
              : ""}
          </Text>
        </View>
      ) : null}

      {event.comment ? (
        <Text style={[styles.note, { color: theme.colors.text }]}>
          {event.comment}
        </Text>
      ) : null}

      {event.attachments.length > 0 ? (
        <MediaAttachmentGrid
          attachments={event.attachments}
          onAttachmentPress={onAttachmentPress}
          theme={theme}
        />
      ) : null}

      {occurrenceLabel && event.dayKey !== createdDayKey ? (
        <Text style={[styles.occurrence, { color: theme.colors.textMuted }]}>
          Applied to {occurrenceLabel}
        </Text>
      ) : null}

      {event.reverted ? (
        <Text style={[styles.revertedMeta, { color: theme.colors.warningText }]}>
          {event.revertedByUid
            ? `Reverted by ${reverterLabel || "another member"}`
            : "Reverted later"}
          {event.revertedAtMs
            ? ` · ${formatEventTime(event.revertedAtMs)}`
            : ""}
        </Text>
      ) : null}
    </View>
  );
}

export const ProgressEventCard = memo(ProgressEventCardComponent);

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "900" },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: "900" },
  timestamp: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  revertedBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  revertedBadgeText: { fontSize: 10, lineHeight: 14, fontWeight: "900" },
  values: { gap: 3 },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  valueLine: { fontSize: 16, lineHeight: 22, fontWeight: "900" },
  revertedValue: { textDecorationLine: "line-through" },
  delta: { fontSize: 13, lineHeight: 18, fontWeight: "900" },
  targetReached: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  note: { fontSize: 14, lineHeight: 21 },
  occurrence: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  revertedMeta: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
});
