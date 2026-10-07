import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { GoalsStyles } from "../styles/goals.styles";
import type { Goal } from "../types/goals.types";
import { formatCompletedDate, getSharedGoalLabel } from "../utils/goals.utils";

interface GoalsListSectionProps {
  styles: GoalsStyles;
  goals: Goal[];
  activeGoals: Goal[];
  completedGoals: Goal[];
  loading: boolean;
}

export function GoalsListSection({
  styles,
  goals,
  activeGoals,
  completedGoals,
  loading,
}: GoalsListSectionProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const router = useRouter();

  // Goal cards navigate via router.push instead of <Link asChild>. Link's
  // asChild merges props through @radix-ui/react-slot, whose style merge is
  // `{ ...slotStyle, ...childStyle }` — spreading Pressable's function-style
  // (`({ pressed }) => [...]`) yields `{}` and silently drops the whole card
  // style. See expo/expo#31352.
  const openGoal = (goalId: string) =>
    router.push({ pathname: "/goal/[id]", params: { id: goalId } });

  return (
    <>
      {/* Goals List Header */}
      <View style={styles.listHeader}>
        <Text style={styles.cardTitle}>Your goals</Text>
        <Text style={styles.muted}>
          {loading ? "Loading..." : `${goals.length} total`}
        </Text>
      </View>

      {!loading && activeGoals.length === 0 && completedGoals.length === 0 && (
        <Text style={styles.muted}>
          No goals yet — create your first one above.
        </Text>
      )}

      {/* Active Goals */}
      {activeGoals.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Active</Text>
          {activeGoals.map((g) => {
            const metricLine =
              g.metricTargetValue != null
                ? `${g.currentMetricValue ?? 0}/${g.metricTargetValue} ${g.metricUnit ?? ""}`.trim()
                : "No metric target set";

            return (
              <Pressable
                key={g.id}
                onPress={() => openGoal(g.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${g.title} goal, ${g.progressPercentage} percent complete`}
                style={({ pressed }) => [
                  styles.goalCard,
                  pressed && styles.interactivePressed,
                ]}
              >
                <View style={styles.goalTopRow}>
                  <Text style={styles.goalTitle}>{g.title}</Text>
                  <Text style={styles.badge}>{g.status}</Text>
                </View>

                {!!g.description && (
                  <Text style={styles.goalDesc}>{g.description}</Text>
                )}
                {getSharedGoalLabel(g) ? (
                  <Text style={styles.sharedGoalPill}>
                    {getSharedGoalLabel(g)}
                  </Text>
                ) : null}

                <Text style={styles.goalMeta}>
                  Metric: {g.metricType} • {metricLine}
                </Text>

                <View style={styles.progressRow}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${g.progressPercentage}%` },
                      ]}
                    />
                  </View>

                  <Text style={styles.progressText}>
                    {g.progressPercentage}%
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      )}

      {/* Completed Goals */}
      {completedGoals.length > 0 && (
        <>
          <Pressable
            onPress={() => setShowCompleted((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={`${showCompleted ? "Hide" : "Show"} completed goals`}
            accessibilityState={{ expanded: showCompleted }}
            style={({ pressed }) => [
              styles.sectionHeaderRow,
              pressed && styles.interactivePressed,
            ]}
          >
            <Text style={styles.sectionHeader}>Completed</Text>
            <Text style={styles.sectionToggleText}>
              {showCompleted ? "Hide" : `Show (${completedGoals.length})`}
            </Text>
          </Pressable>

          {showCompleted &&
            completedGoals.map((g) => {
              const metricLine =
                g.metricTargetValue != null
                  ? `${g.currentMetricValue ?? 0}/${g.metricTargetValue} ${g.metricUnit ?? ""}`.trim()
                  : "No metric target set";

              const completedDate = formatCompletedDate(g.completedAtMs);

              return (
                <Pressable
                  key={g.id}
                  onPress={() => openGoal(g.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open completed ${g.title} goal, ${g.progressPercentage} percent complete`}
                  style={({ pressed }) => [
                    styles.completedGoalCardSingle,
                    pressed && styles.interactivePressed,
                  ]}
                >
                  <View style={styles.goalTopRow}>
                    <Text style={styles.completedGoalTitleSingle}>
                      {g.title}
                    </Text>
                    <Text style={styles.completedBadgeSingle}>completed</Text>
                  </View>

                  {!!g.description && (
                    <Text style={styles.completedGoalDescSingle}>
                      {g.description}
                    </Text>
                  )}
                  {getSharedGoalLabel(g) ? (
                    <Text style={styles.sharedGoalPill}>
                      {getSharedGoalLabel(g)}
                    </Text>
                  ) : null}

                  {completedDate && (
                    <Text style={styles.completedDateText}>
                      Completed on {completedDate}
                    </Text>
                  )}

                  <Text style={styles.completedGoalMetaSingle}>
                    Metric: {g.metricType ?? "none"} • {metricLine}
                  </Text>

                  <View style={styles.progressRow}>
                    <View style={styles.completedProgressTrackSingle}>
                      <View
                        style={[
                          styles.completedProgressFillSingle,
                          { width: `${g.progressPercentage}%` },
                        ]}
                      />
                    </View>

                    <Text style={styles.completedProgressTextSingle}>
                      {g.progressPercentage}%
                    </Text>
                  </View>
                </Pressable>
              );
            })}
        </>
      )}
    </>
  );
}
