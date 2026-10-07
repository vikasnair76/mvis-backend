import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { HomeTaskItem, NowDecision } from "../../../services/nowDecision";
import type { HomeStyles } from "../styles/home.styles";
import type { QuickPlanOption } from "../types/home.types";
import { getDecisionMeta, taskKey } from "../utils";

interface NowDecisionCardProps {
  styles: HomeStyles;
  decision: NowDecision;
  pendingCompleteKey: string | null;
  onComplete: (item: HomeTaskItem) => void;
  onOpenGoal: (item: HomeTaskItem) => void;
  onQuickPlan: (item: HomeTaskItem, option: QuickPlanOption) => void;
}

function getNowCardStyle(decision: NowDecision, styles: HomeStyles) {
  switch (decision.type) {
    case "overdue":
      return styles.cardOverdue;
    case "now":
      return styles.cardNow;
    case "next":
      return styles.cardNext;
    case "needs_time":
      return styles.cardNeedsTime;
    case "all_clear":
      return styles.cardAllClear;
  }
}

/** The headline "what should I do right now" card. */
export function NowDecisionCard({
  styles,
  decision,
  pendingCompleteKey,
  onComplete,
  onOpenGoal,
  onQuickPlan,
}: NowDecisionCardProps) {
  const meta = getDecisionMeta(decision);

  if (decision.type === "all_clear") {
    return (
      <View style={[styles.card, getNowCardStyle(decision, styles)]}>
        <Text style={styles.decisionEyebrow}>{meta.label}</Text>
        <Text style={styles.decisionTitle}>You’re all clear 🎉</Text>
        <Text style={styles.decisionSub}>
          Nothing needs your attention right now. You can review goals, plan
          later tasks, or enjoy the breathing room.
        </Text>

        <Pressable
          onPress={() => router.push("/(tabs)/goals")}
          style={styles.secondaryActionBtn}
        >
          <Text style={styles.secondaryActionText}>Review goals</Text>
        </Pressable>
      </View>
    );
  }

  const item = decision.item;
  const isPending = pendingCompleteKey === taskKey(item);

  const dueLabel = item.dueAtMs
    ? `${meta.helper} • ${new Date(item.dueAtMs).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : meta.helper;

  return (
    <View style={[styles.card, getNowCardStyle(decision, styles)]}>
      <Text style={styles.decisionEyebrow}>{meta.label}</Text>
      <Text style={styles.decisionGoal}>{item.goalTitle}</Text>
      <Text style={styles.decisionTitle}>{item.title}</Text>
      <Text style={styles.decisionSub}>{dueLabel}</Text>

      {decision.type === "needs_time" ? (
        <View style={styles.quickPlanBox}>
          <Text style={styles.quickPlanTitle}>Quick plan</Text>
          <View style={styles.quickPlanRow}>
            <Pressable
              onPress={() => onQuickPlan(item, "today_evening")}
              style={({ pressed }) => [styles.quickPlanPill, pressed && styles.pillPressed]}
            >
              <Text style={styles.quickPlanPillText}>Today evening</Text>
            </Pressable>
            <Pressable
              onPress={() => onQuickPlan(item, "tomorrow_morning")}
              style={({ pressed }) => [styles.quickPlanPill, pressed && styles.pillPressed]}
            >
              <Text style={styles.quickPlanPillText}>Tomorrow morning</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {decision.type === "overdue" || decision.type === "now" ? (
          <Pressable
            disabled={isPending}
            onPress={() => onComplete(item)}
            style={({ pressed }) => [
              styles.primaryActionBtn,
              pressed && styles.buttonPressed,
              isPending && styles.primaryActionBtnDisabled,
            ]}
          >
            <Text style={styles.primaryActionText}>
              {isPending ? "Completing..." : "Complete"}
            </Text>
          </Pressable>
        ) : null}

        {decision.type === "next" || decision.type === "needs_time" ? (
          <Pressable onPress={() => onOpenGoal(item)} style={styles.primaryActionBtn}>
            <Text style={styles.primaryActionText}>
              {decision.type === "needs_time" ? "Open planner" : "View task"}
            </Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => onOpenGoal(item)} style={styles.secondaryActionBtn}>
          <Text style={styles.secondaryActionText}>Open goal</Text>
        </Pressable>
      </View>
    </View>
  );
}
