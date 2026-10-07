import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatPlannerAction,
  formatPlannerEvidence,
  getPlannerOpenLabel,
  getPlannerSuggestionDocPresentation,
} from "../../services/plannerPresentation";
import type { PlannerSuggestionDoc } from "../../services/plannerSuggestions";
import type { AppThemeTokens } from "../../services/theme";

type Props = {
  suggestion: PlannerSuggestionDoc;
  theme: AppThemeTokens;
  timeZone: string;
  pending?: boolean;
  onViewed?: () => void;
  onOpen?: () => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  onArchive?: () => void;
  onApply?: () => void;
};
function PlannerSuggestionCardView({
  suggestion, theme, timeZone, pending, onViewed, onOpen, onDismiss, onSnooze,
  onArchive, onApply,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const presentation = getPlannerSuggestionDocPresentation(suggestion);
  const evidence = suggestion.evidence
    .map((item) => formatPlannerEvidence(item, timeZone)).filter(Boolean);
  const active = suggestion.status === "active";
  const terminal = ["accepted", "dismissed", "expired", "invalidated", "archived"]
    .includes(suggestion.status);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !terminal && !suggestion.viewedAtMs) onViewed?.();
  };
  return (
    <View style={styles.card} accessibilityLabel={`${presentation.label}. ${suggestion.title}`}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text style={styles.category}>{presentation.category.toUpperCase()}</Text>
          {!suggestion.viewedAtMs && !terminal ? (
            <Text style={styles.newBadge} accessibilityLabel="New suggestion">New</Text>
          ) : null}
        </View>
        <Text style={styles.status}>{suggestion.status.replace("_", " ")}</Text>
      </View>
      <Text style={styles.title}>{suggestion.title}</Text>
      <Text style={styles.summary}>{suggestion.summary}</Text>
      {suggestion.scope === "group" ? <Text style={styles.group}>Shared group suggestion</Text> : null}
      {suggestion.status === "snoozed" && suggestion.snoozedUntilMs ? (
        <Text style={styles.lifecycle}>Returns {new Date(suggestion.snoozedUntilMs).toLocaleString()}</Text>
      ) : null}
      {suggestion.status === "accepted" && suggestion.acceptedAtMs ? (
        <Text style={styles.lifecycle}>
          Applied {new Date(suggestion.acceptedAtMs).toLocaleString()}
        </Text>
      ) : null}
      <Pressable
        onPress={toggle}
        style={styles.expand}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} evidence for ${suggestion.title}`}
        accessibilityState={{expanded}}
      >
        <Text style={styles.expandText}>{expanded ? "Hide why" : "Why this appeared"}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.primary} />
      </Pressable>
      {expanded ? (
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>Why Dayta surfaced this</Text>
          {evidence.length ? evidence.map((item, index) => (
            <Text key={`${suggestion.id}-evidence-${index}`} style={styles.evidence}>• {item}</Text>
          )) : <Text style={styles.evidence}>Dayta found a planning conflict or opportunity in your current planning data.</Text>}
          <Text style={styles.detailTitle}>Suggested next step</Text>
          <Text style={styles.action}>{formatPlannerAction(suggestion.proposedAction, timeZone)}</Text>
          <Text style={styles.advisory}>Viewing this suggestion does not change your work.</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {active && onApply ? (
          <Pressable style={styles.applyAction} onPress={onApply}
            disabled={pending} accessibilityRole="button"
            accessibilityLabel={`Review and apply ${suggestion.title}`}>
            <Text style={styles.applyActionText}>
              {pending ? "Applying¦" : "Review & apply"}
            </Text>
          </Pressable>
        ) : null}
        {onOpen ? <Pressable style={styles.primaryAction} onPress={onOpen} disabled={pending}
          accessibilityRole="button" accessibilityLabel={`${getPlannerOpenLabel(suggestion.target.primary)} for ${suggestion.title}`}>
          <Text style={styles.primaryActionText}>{getPlannerOpenLabel(suggestion.target.primary)}</Text>
        </Pressable> : null}
        {(active || suggestion.status === "snoozed") && onSnooze ? (
          <Pressable style={styles.secondaryAction} onPress={onSnooze} disabled={pending}
            accessibilityRole="button" accessibilityLabel={`Snooze ${suggestion.title}`}>
            <Text style={styles.secondaryActionText}>Snooze</Text>
          </Pressable>
        ) : null}
        {(active || suggestion.status === "snoozed") && onDismiss ? (
          <Pressable style={styles.secondaryAction} onPress={onDismiss} disabled={pending}
            accessibilityRole="button" accessibilityLabel={`Dismiss ${suggestion.title}`}>
            <Text style={styles.secondaryActionText}>{pending ? "Working…" : "Dismiss"}</Text>
          </Pressable>
        ) : null}
        {terminal && suggestion.status !== "archived" && onArchive ? (
          <Pressable style={styles.secondaryAction} onPress={onArchive} disabled={pending}
            accessibilityRole="button" accessibilityLabel={`Archive ${suggestion.title}`}>
            <Text style={styles.secondaryActionText}>Archive</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
export const PlannerSuggestionCard = memo(PlannerSuggestionCardView);
const makeStyles = (theme: AppThemeTokens) => StyleSheet.create({
  card: {backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    borderWidth: 1, borderRadius: 18, padding: 16, gap: 9, shadowColor: theme.colors.cardShadow,
    shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: {width: 0, height: 4}, elevation: 2},
  header: {flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10},
  labelRow: {flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1},
  category: {color: theme.colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8},
  newBadge: {color: theme.colors.badgeText, backgroundColor: theme.colors.badge,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: "800"},
  status: {color: theme.colors.textMuted, fontSize: 11, textTransform: "capitalize"},
  title: {color: theme.colors.text, fontSize: 18, lineHeight: 24, fontWeight: "900"},
  summary: {color: theme.colors.textMuted, fontSize: 14, lineHeight: 20},
  group: {color: theme.colors.secondaryText, fontSize: 12, fontWeight: "700"},
  lifecycle: {color: theme.colors.warningText, fontSize: 12, fontWeight: "700"},
  expand: {minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between"},
  expandText: {color: theme.colors.primary, fontSize: 14, fontWeight: "800"},
  detail: {backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 12, gap: 7},
  detailTitle: {color: theme.colors.text, fontSize: 13, fontWeight: "900", marginTop: 2},
  evidence: {color: theme.colors.textMuted, fontSize: 13, lineHeight: 19},
  action: {color: theme.colors.text, fontSize: 14, lineHeight: 20},
  advisory: {color: theme.colors.textMuted, fontSize: 11, lineHeight: 16},
  actions: {flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 2},
  primaryAction: {minHeight: 44, justifyContent: "center", borderRadius: 12,
    backgroundColor: theme.colors.primary, paddingHorizontal: 14},
  primaryActionText: {color: theme.colors.primaryText, fontWeight: "900", fontSize: 13},
  applyAction: {minHeight: 44, justifyContent: "center", borderRadius: 12,
    backgroundColor: theme.colors.successBackground,
    borderColor: theme.colors.successBorder, borderWidth: 1, paddingHorizontal: 14},
  applyActionText: {color: theme.colors.successText, fontWeight: "900", fontSize: 13},
  secondaryAction: {minHeight: 44, justifyContent: "center", borderRadius: 12,
    backgroundColor: theme.colors.secondaryBackground, borderColor: theme.colors.secondaryBorder,
    borderWidth: 1, paddingHorizontal: 14},
  secondaryActionText: {color: theme.colors.secondaryText, fontWeight: "800", fontSize: 13},
});
