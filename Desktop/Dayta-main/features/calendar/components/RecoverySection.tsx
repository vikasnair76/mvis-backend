import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppThemeTokens } from "../../../services/theme";
import { useCurrentAppTheme } from "../../../services/useCurrentAppTheme";
import type { DatedItem, RecoveryItem } from "../types/calendar.types";
import { getRecoveryTypeLabel, sameDay, type TimeSlot } from "../utils";

export interface RecoverySectionProps {
  items: RecoveryItem[];
  isPending: (key: string) => boolean;
  onUseSuggestedTime: (item: DatedItem, slot: TimeSlot) => void;
  onReassignLaterToday: (item: DatedItem) => void;
  onReassignTomorrowMorning: (item: DatedItem) => void;
  onMarkUnscheduled: (item: DatedItem) => void;
  onSkipForDay: (item: DatedItem) => void;
  onClearOverride: (item: DatedItem) => void;
}

export function RecoverySection({
  items,
  isPending,
  onUseSuggestedTime,
  onReassignLaterToday,
  onReassignTomorrowMorning,
  onMarkUnscheduled,
  onSkipForDay,
  onClearOverride,
}: RecoverySectionProps) {
  const { theme } = useCurrentAppTheme();
  const styles = createStyles(theme);

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Agenda / Recovery</Text>

      {items.map((entry) => {
        const pending = isPending(entry.key);
        const isToday = sameDay(entry.item.date, new Date());

        return (
          <View key={`${entry.type}:${entry.key}`} style={styles.card}>
            <Text
              style={[
                styles.badge,
                entry.type === "unscheduled" && styles.badgeUnscheduled,
              ]}
            >
              {getRecoveryTypeLabel(entry.type)}
            </Text>

            <Text style={styles.goalTitle}>{entry.goalTitle}</Text>
            <Text style={styles.title}>{entry.title}</Text>
            <Text style={styles.detail}>{entry.detail}</Text>

            {entry.type === "conflict" ? (
              <>
                {entry.suggestedSlot ? (
                  <Action
                    label="Use suggested time"
                    pendingLabel="Updating..."
                    pending={pending}
                    variant="primary"
                    styles={styles}
                    onPress={() =>
                      onUseSuggestedTime(entry.item, entry.suggestedSlot!)
                    }
                  />
                ) : null}

                {!entry.suggestedSlot && isToday ? (
                  <Action
                    label="Reassign tomorrow morning"
                    pendingLabel="Reassigning..."
                    pending={pending}
                    variant="secondary"
                    styles={styles}
                    onPress={() => onReassignTomorrowMorning(entry.item)}
                  />
                ) : null}

                <Action
                  label="Mark unscheduled"
                  pendingLabel="Updating..."
                  pending={pending}
                  variant="secondary"
                  styles={styles}
                  onPress={() => onMarkUnscheduled(entry.item)}
                />

                <Action
                  label="Skip for this day"
                  pendingLabel="Skipping..."
                  pending={pending}
                  variant="danger"
                  styles={styles}
                  onPress={() => onSkipForDay(entry.item)}
                />
              </>
            ) : (
              <>
                {entry.suggestedSlot ? (
                  <Action
                    label="Reassign later today"
                    pendingLabel="Reassigning..."
                    pending={pending}
                    variant="primary"
                    styles={styles}
                    onPress={() => onReassignLaterToday(entry.item)}
                  />
                ) : null}

                <Action
                  label="Reassign tomorrow morning"
                  pendingLabel="Reassigning..."
                  pending={pending}
                  variant="secondary"
                  styles={styles}
                  onPress={() => onReassignTomorrowMorning(entry.item)}
                />

                <Action
                  label="Restore schedule"
                  pendingLabel="Restoring..."
                  pending={pending}
                  variant="secondary"
                  styles={styles}
                  onPress={() => onClearOverride(entry.item)}
                />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Action({
  label,
  pendingLabel,
  pending,
  variant,
  styles,
  onPress,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  variant: "primary" | "secondary" | "danger";
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      style={[
        styles.actionBtn,
        variant === "primary" && styles.actionBtnPrimary,
        variant === "danger" && styles.actionBtnDanger,
        pending && styles.actionBtnDisabled,
      ]}
    >
      <Text
        style={[
          styles.actionBtnText,
          variant === "primary" && styles.actionBtnTextPrimary,
          variant === "danger" && styles.actionBtnTextDanger,
        ]}
      >
        {pending ? pendingLabel : label}
      </Text>
    </Pressable>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    section: {
      marginTop: 16,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.colors.text,
    },
    card: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 4,
    },
    badge: {
      alignSelf: "flex-start",
      fontSize: 11,
      fontWeight: "700",
      color: theme.colors.dangerText,
      backgroundColor: theme.colors.dangerBackground,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
    },
    badgeUnscheduled: {
      color: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },
    goalTitle: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.secondaryText,
    },
    title: {
      fontSize: 15,
      fontWeight: "600",
      color: theme.colors.text,
    },
    detail: {
      fontSize: 12,
      color: theme.colors.secondaryText,
    },
    actionBtn: {
      marginTop: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      alignItems: "center",
      backgroundColor: theme.colors.secondaryBackground,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    actionBtnPrimary: {
      backgroundColor: theme.colors.badge,
      borderColor: theme.colors.primary,
    },
    actionBtnDanger: {
      backgroundColor: theme.colors.dangerBackground,
      borderColor: theme.colors.dangerBorder,
    },
    actionBtnDisabled: {
      opacity: 0.5,
    },
    actionBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.text,
    },
    actionBtnTextPrimary: {
      color: theme.colors.primary,
    },
    actionBtnTextDanger: {
      color: theme.colors.dangerText,
    },
  });
}
