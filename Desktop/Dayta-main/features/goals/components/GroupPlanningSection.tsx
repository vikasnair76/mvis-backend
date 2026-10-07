import React from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { GoalsStyles } from "../styles/goals.styles";
import type { GroupPlanningBoard } from "../types/goals.types";

interface GroupPlanningSectionProps {
  styles: GoalsStyles;
  loadingGroupPlanning: boolean;
  groupPlanningError: string | null;
  groupPlanningBoards: GroupPlanningBoard[];
}

export function GroupPlanningSection({
  styles,
  loadingGroupPlanning,
  groupPlanningError,
  groupPlanningBoards,
}: GroupPlanningSectionProps) {
  return (
    <View style={[styles.card, styles.boardsCard]}>
      <View style={styles.planningSectionHeader}>
        <View style={styles.createGoalHeaderTextWrap}>
          <Text style={styles.cardTitle}>Group Planning</Text>
          <Text style={styles.muted}>
            Boards shared through your active groups.
          </Text>
        </View>
        <Text style={styles.boardScopeBadge}>Group boards</Text>
      </View>

      {loadingGroupPlanning ? (
        <Text style={styles.muted}>Loading group boards…</Text>
      ) : null}

      {groupPlanningError ? (
        <Text style={styles.groupPlanningError}>{groupPlanningError}</Text>
      ) : null}

      {!loadingGroupPlanning &&
      !groupPlanningError &&
      groupPlanningBoards.length === 0 ? (
        <View>
          <Text style={styles.muted}>No group planning boards yet.</Text>
          <Text style={styles.muted}>
            Boards created in your groups will appear here.
          </Text>
        </View>
      ) : (
        groupPlanningBoards.map((board) => (
          <View key={board.id} style={styles.groupBoardPreviewCard}>
            <Text style={styles.boardPreviewTitle}>{board.title}</Text>
            <Text style={styles.boardPreviewMeta}>{board.groupName}</Text>

            <View style={styles.boardColumnRow}>
              {board.columns.map((column) => (
                <View key={column.id} style={styles.boardColumnChip}>
                  <Text style={styles.boardColumnChipText}>
                    {column.title}
                  </Text>
                </View>
              ))}
            </View>

            <Link href={`/board/${board.id}` as any} asChild>
              <Pressable
                style={styles.boardOpenButton}
                accessibilityRole="button"
                accessibilityLabel={`Open ${board.title} board in ${board.groupName}`}
              >
                <Text style={styles.boardOpenButtonText}>Open board</Text>
              </Pressable>
            </Link>
          </View>
        ))
      )}
    </View>
  );
}
