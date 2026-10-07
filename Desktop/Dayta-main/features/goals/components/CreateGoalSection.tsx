import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { GoalsStyles } from "../styles/goals.styles";
import type { MetricType } from "../types/goals.types";

interface CreateGoalSectionProps {
  styles: GoalsStyles;
  showCreateGoal: boolean;
  setShowCreateGoal: React.Dispatch<React.SetStateAction<boolean>>;
  title: string;
  setTitle: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  metricType: MetricType;
  setMetricType: (val: MetricType) => void;
  metricUnitInput: string;
  setMetricUnitInput: (val: string) => void;
  metricTargetValueInput: string;
  setMetricTargetValueInput: (val: string) => void;
  submitting: boolean;
  isMetricEnabled: boolean;
  isWeightMetric: boolean;
  isCustomMetric: boolean;
  lockedMetricUnitLabel: string | null;
  createGoal: () => void;
}

export function CreateGoalSection({
  styles,
  showCreateGoal,
  setShowCreateGoal,
  title,
  setTitle,
  description,
  setDescription,
  metricType,
  setMetricType,
  metricUnitInput,
  setMetricUnitInput,
  metricTargetValueInput,
  setMetricTargetValueInput,
  submitting,
  isMetricEnabled,
  isWeightMetric,
  isCustomMetric,
  lockedMetricUnitLabel,
  createGoal,
}: CreateGoalSectionProps) {
  return (
    <View style={[styles.card, styles.createGoalCard]}>
      <Pressable
        onPress={() => setShowCreateGoal((prev) => !prev)}
        style={styles.createGoalHeader}
      >
        <View style={styles.createGoalHeaderTextWrap}>
          <Text style={styles.cardTitle}>Create a goal</Text>
          <Text style={styles.createGoalSubtitle}>
            Add a new outcome, habit, or project to track.
          </Text>
        </View>

        <Text style={styles.createGoalToggle}>
          {showCreateGoal ? "Hide" : "+ New"}
        </Text>
      </Pressable>

      {showCreateGoal && (
        <View style={styles.createGoalBody}>
          <Text style={styles.label}>Title *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g., Read more books"
            style={styles.input}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optional"
            style={[styles.input, styles.multiline]}
            multiline
          />

          <Text style={styles.label}>Metric type</Text>
          <View style={styles.rowWrap}>
            {(
              [
                "none",
                "hours",
                "weight",
                "pages",
                "reps",
                "custom",
              ] as MetricType[]
            ).map((t) => (
              <Pressable
                key={t}
                onPress={() => setMetricType(t)}
                style={[
                  styles.pill,
                  metricType === t && styles.pillActive,
                ]}
              >
                <Text style={styles.pillText}>{t}</Text>
              </Pressable>
            ))}
          </View>

          {isMetricEnabled && (
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>
                  {isWeightMetric
                    ? "Weight unit"
                    : isCustomMetric
                    ? "Custom unit"
                    : "Unit"}
                </Text>

                {lockedMetricUnitLabel ? (
                  <View style={[styles.input, styles.readOnlyInput]}>
                    <Text style={styles.readOnlyInputText}>
                      {lockedMetricUnitLabel}
                    </Text>
                  </View>
                ) : isWeightMetric ? (
                  <View style={styles.rowWrap}>
                    {(["lb", "lbs", "kg"] as const).map((unit) => (
                      <Pressable
                        key={unit}
                        onPress={() => setMetricUnitInput(unit)}
                        style={[
                          styles.pill,
                          metricUnitInput === unit && styles.pillActive,
                        ]}
                      >
                        <Text style={styles.pillText}>{unit}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <TextInput
                    value={metricUnitInput}
                    onChangeText={setMetricUnitInput}
                    placeholder="e.g., chapters, miles"
                    style={styles.input}
                  />
                )}
              </View>

              <View style={styles.half}>
                <Text style={styles.label}>Target</Text>
                <TextInput
                  value={metricTargetValueInput}
                  onChangeText={setMetricTargetValueInput}
                  placeholder="e.g., 50"
                  style={styles.input}
                  keyboardType="numeric"
                />
              </View>
            </View>
          )}

          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={createGoal}
            disabled={submitting}
          >
            <Text style={styles.buttonText}>
              {submitting ? "Creating..." : "Create goal"}
            </Text>
          </Pressable>

          <Text style={styles.helper}>
            Tip: targets unlock automatic progress tracking.
          </Text>
        </View>
      )}
    </View>
  );
}
