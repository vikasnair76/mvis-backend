import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CalendarRuleRecord } from "../../../services/calendarRules";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { ApplyActionMenuTarget, Goal } from "../types/calendar.types";
import type { ApplyEventTarget } from "../hooks/useApplyFlow";
import type { SuggestedTaskMatch } from "../hooks/useCalendarSuggestions";
import {
  formatCalendarSuggestionReasonLabel,
  getApplyPanelHint,
  getApplyPanelTitle,
  hasAutoApplyDurationRuleForEvent,
  hasAutoLinkRuleForEvent,
} from "../utils";

export interface ApplyEventPanelProps {
  eventTarget: ApplyEventTarget;
  step: "goal" | "subtask";
  goals: Goal[];
  selectedGoalId: string | null;
  subtasksByGoal: Record<string, any[]>;
  calendarRules: CalendarRuleRecord[];
  actionPending: boolean;
  openedViaQuickSuggestion: boolean;
  savedRuleSuggestion: { subtaskId: string; subtaskTitle: string } | null;
  suggestedTaskMatch: SuggestedTaskMatch | null;
  onSelectGoal: (goalId: string) => void;
  onSelectSubtask: (target: ApplyActionMenuTarget) => void;
  onCancel: () => void;
}

function isLinkedOneTime(subtask: any) {
  const linked =
    typeof subtask?.linkedCalendarEventId === "string" &&
    subtask.linkedCalendarEventId.trim().length > 0;
  const oneTime =
    subtask?.scheduleType === "oneTime" || subtask?.frequency === "once";
  return linked && oneTime;
}

export function ApplyEventPanel({
  eventTarget,
  step,
  goals,
  selectedGoalId,
  subtasksByGoal,
  calendarRules,
  actionPending,
  openedViaQuickSuggestion,
  savedRuleSuggestion,
  suggestedTaskMatch,
  onSelectGoal,
  onSelectSubtask,
  onCancel,
}: ApplyEventPanelProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  const { goalSubtasks, unlinked, linked } = useMemo(() => {
    const all = selectedGoalId ? subtasksByGoal[selectedGoalId] ?? [] : [];
    const unlinkedList: any[] = [];
    const linkedList: any[] = [];

    for (const s of all) {
      if (isLinkedOneTime(s)) linkedList.push(s);
      else unlinkedList.push(s);
    }

    return { goalSubtasks: all, unlinked: unlinkedList, linked: linkedList };
  }, [selectedGoalId, subtasksByGoal]);

  // A saved rule wins over a heuristic match for which subtask to highlight.
  const suggestedSubtaskId =
    savedRuleSuggestion?.subtaskId ??
    (suggestedTaskMatch?.mode === "single" &&
    suggestedTaskMatch.topMatch.item.goalId === selectedGoalId
      ? suggestedTaskMatch.topMatch.item.subtaskId
      : null);

  const suggestedReasonLabel =
    !savedRuleSuggestion && suggestedTaskMatch?.mode === "single"
      ? formatCalendarSuggestionReasonLabel(suggestedTaskMatch.topMatch.reasons)
      : null;

  const suggestedSubtaskTitle =
    savedRuleSuggestion?.subtaskTitle ??
    (suggestedTaskMatch?.mode === "single"
      ? suggestedTaskMatch.topMatch.item.title
      : null);

  const isAmbiguous = suggestedTaskMatch?.mode === "ambiguous";

  const renderSubtask = (s: any, goalId: string) => {
    const isSuggested = s.id === suggestedSubtaskId;

    const hasAutoLink = hasAutoLinkRuleForEvent({
      eventTitle: eventTarget.eventTitle,
      goalId,
      subtaskId: s.id,
      calendarRules,
    });

    const hasAutoApply = hasAutoApplyDurationRuleForEvent({
      eventTitle: eventTarget.eventTitle,
      goalId,
      subtaskId: s.id,
      calendarRules,
    });

    return (
      <Pressable
        key={s.id}
        disabled={actionPending}
        onPress={() => {
          onSelectSubtask({
            goalId,
            subtaskId: s.id,
            subtaskTitle: s.title,
            mode: isLinkedOneTime(s) ? "linked" : "unlinked",
            existingLinkedTitle: s.linkedCalendarEventTitle ?? null,
            nextEventTitle: eventTarget.eventTitle,
          });
        }}
        style={[
          styles.option,
          isSuggested && styles.optionSuggested,
          actionPending && styles.optionDisabled,
        ]}
      >
        <Text style={styles.optionText}>{s.title}</Text>

        <View style={styles.badgeRow}>
          {isSuggested ? (
            <Text style={styles.suggestedBadge}>
              {savedRuleSuggestion ? "Saved preference" : "Suggested"}
            </Text>
          ) : null}

          {hasAutoLink ? (
            <Text style={styles.autoBadge}>⚡ Auto-link enabled</Text>
          ) : null}

          {hasAutoApply ? (
            <Text style={styles.autoBadge}>⏱ Auto-apply enabled</Text>
          ) : null}
        </View>

        {isSuggested && suggestedReasonLabel ? (
          <Text style={styles.reasonText}>
            Why suggested: {suggestedReasonLabel}
          </Text>
        ) : null}

        {isLinkedOneTime(s) ? (
          <Text style={styles.linkedBadge}>Already linked</Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{getApplyPanelTitle(step)}</Text>

        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>{eventTarget.eventTitle}</Text>

      {openedViaQuickSuggestion ? (
        <Text style={styles.quickBanner}>
          Suggested task preselected for faster apply
        </Text>
      ) : null}

      <Text style={styles.hint}>{getApplyPanelHint(step)}</Text>

      {suggestedSubtaskTitle ? (
        <Text style={styles.suggestedHint}>
          {savedRuleSuggestion
            ? `Suggested from saved preference: ${suggestedSubtaskTitle}`
            : `Suggested subtask: ${suggestedSubtaskTitle}`}
        </Text>
      ) : null}

      {isAmbiguous ? (
        <View style={styles.ambiguousBox}>
          <Text style={styles.ambiguousHint}>
            We found multiple likely subtasks for this event.
          </Text>
          <Text style={styles.ambiguousCandidate}>
            Top match: {suggestedTaskMatch!.topMatch.item.title}
          </Text>
          {suggestedTaskMatch!.secondMatch ? (
            <Text style={styles.ambiguousCandidate}>
              Also likely: {suggestedTaskMatch!.secondMatch!.item.title}
            </Text>
          ) : null}
        </View>
      ) : null}

      {step === "goal"
        ? goals
            .filter((g) => g.status !== "completed")
            .map((g) => (
              <Pressable
                key={g.id}
                onPress={() => onSelectGoal(g.id)}
                style={styles.option}
              >
                <Text style={styles.optionText}>{g.title}</Text>
              </Pressable>
            ))
        : null}

      {step === "subtask" && selectedGoalId ? (
        <>
          {unlinked.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Ready to link</Text>
              {unlinked.map((s) => renderSubtask(s, selectedGoalId))}
            </>
          ) : null}

          {linked.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Linked one-time subtasks</Text>
              {linked.map((s) => renderSubtask(s, selectedGoalId))}
            </>
          ) : null}

          {goalSubtasks.length === 0 ? (
            <Text style={styles.emptyText}>
              This goal has no subtasks to link yet.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    panel: {
      marginTop: 16,
      padding: 14,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      gap: 4,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.colors.text,
    },
    cancelBtn: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.secondaryBackground,
    },
    cancelBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
    subtitle: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    quickBanner: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    hint: {
      marginTop: 4,
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    suggestedHint: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.primary,
    },
    ambiguousBox: {
      marginTop: 8,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.secondaryBackground,
      gap: 2,
    },
    ambiguousHint: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.text,
    },
    ambiguousCandidate: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    sectionTitle: {
      marginTop: 12,
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.secondaryText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    option: {
      marginTop: 8,
      padding: 10,
      borderRadius: 10,
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 2,
    },
    optionSuggested: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },
    optionDisabled: {
      opacity: 0.5,
    },
    optionText: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.text,
    },
    badgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    suggestedBadge: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.primary,
    },
    autoBadge: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
    reasonText: {
      fontSize: 11,
      color: theme.colors.secondaryText,
    },
    linkedBadge: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.secondaryText,
    },
    emptyText: {
      marginTop: 8,
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
  });
}
