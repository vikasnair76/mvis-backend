import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { CalendarRuleRecord } from "../../../services/calendarRules";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { ApplyActionMenuTarget } from "../types/calendar.types";
import type { ApplyEventTarget } from "../hooks/useApplyFlow";
import {
  convertEventDurationToMetricValue,
  formatEventDurationLabel,
  getApplyBlockedFlags,
  getApplyCompletionBlockedReason,
  getApplyDurationBlockedReason,
  getDurationApplyLabel,
  hasAutoApplyDurationRuleForEvent,
  hasAutoLinkRuleForEvent,
  isTimeBasedMetricSubtask,
} from "../utils";

export interface ApplyActionSheetProps {
  target: ApplyActionMenuTarget;
  eventTarget: ApplyEventTarget;
  subtask: any | null;
  isAlreadyCompletedForEventDay: boolean;
  calendarRules: CalendarRuleRecord[];
  actionPending: boolean;
  onLinkOnly: () => void;
  onLinkAndUseTime: () => void;
  onApplyDuration: () => void;
  onMarkComplete: () => void;
  onEnableAutoLink: () => void;
  onEnableAutoApplyDuration: () => void;
  onClose: () => void;
}

export function ApplyActionSheet({
  target,
  eventTarget,
  subtask,
  isAlreadyCompletedForEventDay,
  calendarRules,
  actionPending,
  onLinkOnly,
  onLinkAndUseTime,
  onApplyDuration,
  onMarkComplete,
  onEnableAutoLink,
  onEnableAutoApplyDuration,
  onClose,
}: ApplyActionSheetProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  const isLinked = target.mode === "linked";

  const durationLabel = formatEventDurationLabel({
    startMs: eventTarget.startMs,
    endMs: eventTarget.endMs,
  });

  // ---- Duration / completion eligibility --------------------------------
  const blocked = getApplyBlockedFlags({
    subtask,
    eventId: eventTarget.eventId,
    isAlreadyCompletedForEventDay,
  });

  const durationMetricValue = subtask
    ? convertEventDurationToMetricValue(subtask, eventTarget)
    : null;

  const canApplyDuration =
    !!subtask && isTimeBasedMetricSubtask(subtask) && durationMetricValue != null;

  const isActionBlocked =
    blocked.isAlreadyCompletedForEventDay ||
    blocked.isOnceSubtaskAlreadyCompleted ||
    blocked.isLinkedToDifferentEvent;

  const durationBlockedReason = getApplyDurationBlockedReason(blocked);
  const completionBlockedReason = getApplyCompletionBlockedReason(blocked);

  // ---- Rule shortcuts -----------------------------------------------------
  const ruleArgs = {
    eventTitle: eventTarget.eventTitle,
    goalId: target.goalId,
    subtaskId: target.subtaskId,
    calendarRules,
  };
  const hasAutoLink = hasAutoLinkRuleForEvent(ruleArgs);
  const hasAutoApply = hasAutoApplyDurationRuleForEvent(ruleArgs);

  const canEnableAutoApply =
    !!subtask && isTimeBasedMetricSubtask(subtask);

  const completionLabel = blocked.isOnceSubtaskAlreadyCompleted
    ? "Already completed (one-time task)"
    : blocked.isAlreadyCompletedForEventDay
    ? "Already completed for this event day"
    : "Mark subtask complete";

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />

        <View style={styles.sheet}>
          <Text style={styles.title}>
            {isLinked
              ? "Apply event to linked subtask"
              : "Apply event to subtask"}
          </Text>

          <Text style={styles.subtitle}>{target.subtaskTitle}</Text>

          <Text style={styles.meta}>
            Event: {target.nextEventTitle ?? "Selected event"}
          </Text>

          {durationLabel ? (
            <Text style={styles.meta}>Duration: {durationLabel}</Text>
          ) : null}

          {isLinked && target.existingLinkedTitle ? (
            <Text style={styles.meta}>
              Current link: {target.existingLinkedTitle}
            </Text>
          ) : null}

          {/* Primary: duration -> progress, when the subtask supports it */}
          {canApplyDuration ? (
            <>
              <Pressable
                disabled={actionPending || isActionBlocked}
                onPress={onApplyDuration}
                style={[
                  styles.option,
                  styles.optionPrimary,
                  (actionPending || isActionBlocked) && styles.optionDisabled,
                ]}
              >
                <Text style={[styles.optionText, styles.optionPrimaryText]}>
                  {actionPending
                    ? "Applying..."
                    : `⏱  ${getDurationApplyLabel(durationMetricValue!, subtask)}`}
                </Text>
                {!isActionBlocked ? (
                  <Text style={styles.optionSubtext}>
                    Uses event length to update progress
                  </Text>
                ) : null}
              </Pressable>

              {isActionBlocked && durationBlockedReason ? (
                <Text style={styles.blockedHint}>{durationBlockedReason}</Text>
              ) : null}
            </>
          ) : null}

          <Pressable
            disabled={actionPending}
            onPress={onLinkOnly}
            style={[styles.option, actionPending && styles.optionDisabled]}
          >
            <Text style={styles.optionText}>
              {isLinked ? "Replace link only" : "Link only"}
            </Text>
          </Pressable>

          <Pressable
            disabled={actionPending}
            onPress={onLinkAndUseTime}
            style={[styles.option, actionPending && styles.optionDisabled]}
          >
            <Text style={styles.optionText}>
              {isLinked
                ? "Replace link + use new event time"
                : "Link + use event time"}
            </Text>
          </Pressable>

          <Pressable
            disabled={actionPending || isActionBlocked}
            onPress={onMarkComplete}
            style={[
              styles.option,
              (actionPending || isActionBlocked) && styles.optionDisabled,
            ]}
          >
            <Text style={styles.optionText}>{completionLabel}</Text>
          </Pressable>

          {isActionBlocked && completionBlockedReason && !canApplyDuration ? (
            <Text style={styles.blockedHint}>{completionBlockedReason}</Text>
          ) : null}

          {/* Rule shortcuts */}
          {!hasAutoLink ? (
            <Pressable
              disabled={actionPending}
              onPress={onEnableAutoLink}
              style={[styles.secondaryBtn, actionPending && styles.optionDisabled]}
            >
              <Text style={styles.secondaryBtnText}>Enable auto-link</Text>
            </Pressable>
          ) : null}

          {canEnableAutoApply && !hasAutoApply ? (
            <Pressable
              disabled={actionPending}
              onPress={onEnableAutoApplyDuration}
              style={[styles.secondaryBtn, actionPending && styles.optionDisabled]}
            >
              <Text style={styles.secondaryBtnText}>
                Enable auto-apply duration
              </Text>
            </Pressable>
          ) : null}

          {!!subtask?.contributesToMetric && !canEnableAutoApply ? (
            <Text style={styles.infoText}>
              Auto-apply duration is only available for time-based metric
              subtasks.
            </Text>
          ) : null}

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    sheet: {
      padding: 16,
      paddingBottom: 32,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      backgroundColor: theme.colors.background,
      gap: 4,
    },
    title: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.colors.text,
    },
    subtitle: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    meta: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    option: {
      marginTop: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    optionPrimary: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    optionDisabled: {
      opacity: 0.5,
    },
    optionText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.text,
    },
    optionPrimaryText: {
      color: theme.colors.primary,
    },
    optionSubtext: {
      marginTop: 2,
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
    blockedHint: {
      marginTop: 4,
      fontSize: 11,
      color: theme.colors.dangerText,
    },
    infoText: {
      marginTop: 6,
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
    secondaryBtn: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
    cancelBtn: {
      marginTop: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    cancelBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
  });
}
