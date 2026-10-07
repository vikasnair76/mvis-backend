import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../services/theme";

export type ProgressMeterState = {
  current: number;
  target: number;
  clampedCurrent: number;
  ratio: number;
  percentage: number;
  remaining: number;
  isComplete: boolean;
  isOverTarget: boolean;
  isValid: boolean;
};

export type ProgressMeterProps = {
  current: number;
  target: number;
  unit?: string | null;
  completed?: boolean;
  label?: string;
  showValues?: boolean;
  showPercentage?: boolean;
  showRemaining?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
  theme: AppThemeTokens;
};

const DISPLAY_PRECISION = 3;

export function getProgressMeterState(
  current: number,
  target: number
): ProgressMeterState {
  const hasValidTarget = Number.isFinite(target) && target > 0;
  const normalizedCurrent =
    Number.isFinite(current) && current > 0 ? current : 0;
  const normalizedTarget = hasValidTarget ? target : 0;
  const ratio = hasValidTarget
    ? Math.max(0, Math.min(1, normalizedCurrent / normalizedTarget))
    : 0;

  return {
    current: normalizedCurrent,
    target: normalizedTarget,
    clampedCurrent: hasValidTarget
      ? Math.min(normalizedCurrent, normalizedTarget)
      : 0,
    ratio,
    percentage: Math.round(ratio * 100),
    remaining: hasValidTarget
      ? Math.max(0, normalizedTarget - normalizedCurrent)
      : 0,
    isComplete: hasValidTarget && normalizedCurrent >= normalizedTarget,
    isOverTarget: hasValidTarget && normalizedCurrent > normalizedTarget,
    isValid: hasValidTarget,
  };
}

export function formatProgressValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const normalized = Math.abs(value) < 1 / 10 ** DISPLAY_PRECISION ? 0 : value;
  const rounded =
    Math.round((normalized + Number.EPSILON) * 10 ** DISPLAY_PRECISION) /
    10 ** DISPLAY_PRECISION;

  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: DISPLAY_PRECISION,
  });
}

function withUnit(value: number, unit?: string | null): string {
  const safeUnit = unit?.trim();
  return `${formatProgressValue(value)}${safeUnit ? ` ${safeUnit}` : ""}`;
}

export function ProgressMeter({
  current,
  target,
  unit,
  completed = false,
  label,
  showValues = true,
  showPercentage = true,
  showRemaining = true,
  compact = false,
  accessibilityLabel,
  theme,
}: ProgressMeterProps) {
  const state = getProgressMeterState(current, target);
  if (!state.isValid) return null;

  const isComplete = completed || state.isComplete;
  const valueText = `${formatProgressValue(state.current)} / ${withUnit(
    state.target,
    unit
  )}`;
  const statusText = state.isOverTarget
    ? `${withUnit(state.current - state.target, unit)} over target`
    : isComplete
    ? "Complete"
    : `${withUnit(state.remaining, unit)} remaining`;
  const spokenLabel =
    accessibilityLabel ??
    [
      label ? `${label} progress` : "Progress",
      `${withUnit(state.current, unit)} of ${withUnit(state.target, unit)}`,
      `${state.percentage} percent complete`,
      statusText,
    ].join(", ");

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={spokenLabel}
      accessibilityValue={{
        min: 0,
        max: state.target,
        now: state.clampedCurrent,
        text: `${state.percentage} percent, ${statusText}`,
      }}
      style={[styles.container, compact && styles.containerCompact]}
    >
      {(label || showValues || showPercentage) && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryTextWrap}>
            {label ? (
              <Text
                style={[styles.label, { color: theme.colors.textMuted }]}
              >
                {label}
              </Text>
            ) : null}
            {showValues ? (
              <Text
                style={[
                  styles.value,
                  { color: isComplete ? theme.colors.successText : theme.colors.text },
                ]}
              >
                {valueText}
              </Text>
            ) : null}
          </View>
          {showPercentage ? (
            <Text
              style={[
                styles.percentage,
                { color: isComplete ? theme.colors.successText : theme.colors.text },
              ]}
            >
              {state.percentage}%
            </Text>
          ) : null}
        </View>
      )}

      <View
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.track,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${state.percentage}%`,
              backgroundColor: isComplete
                ? theme.colors.success
                : theme.colors.primary,
            },
          ]}
        />
      </View>

      {showRemaining ? (
        <Text
          style={[
            styles.status,
            { color: isComplete ? theme.colors.successText : theme.colors.textMuted },
          ]}
        >
          {statusText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 6,
  },
  containerCompact: {
    gap: 4,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
  },
  summaryTextWrap: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 120,
  },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  value: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },
  percentage: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "900",
  },
  track: {
    width: "100%",
    height: 10,
    borderWidth: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  status: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
});
