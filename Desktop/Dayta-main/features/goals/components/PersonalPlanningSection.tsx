import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import type { GoalsStyles } from "../styles/goals.styles";
import type { PlanningBoardDoc } from "../types/goals.types";

interface PersonalPlanningSectionProps {
  styles: GoalsStyles;
  uid: string | null;
  planningBoards: PlanningBoardDoc[];
  showCreateBoardForm: boolean;
  setShowCreateBoardForm: React.Dispatch<React.SetStateAction<boolean>>;
  boardTitleInput: string;
  setBoardTitleInput: (val: string) => void;
  savingBoard: boolean;
  handleCreatePersonalBoard: () => void;
  handleArchivePersonalBoard: (board: PlanningBoardDoc) => void;
}

export function PersonalPlanningSection({
  styles,
  uid,
  planningBoards,
  showCreateBoardForm,
  setShowCreateBoardForm,
  boardTitleInput,
  setBoardTitleInput,
  savingBoard,
  handleCreatePersonalBoard,
  handleArchivePersonalBoard,
}: PersonalPlanningSectionProps) {
  return (
    <View style={[styles.card, styles.boardsCard]}>
      <View style={styles.createGoalHeader}>
        <View style={styles.createGoalHeaderTextWrap}>
          <Text style={styles.cardTitle}>Personal Planning</Text>
          <Text style={styles.muted}>
            Boards for your goals, milestones, ideas, and next steps.
          </Text>
        </View>

        {uid ? (
          <Pressable
            style={styles.boardCreateToggle}
            onPress={() => setShowCreateBoardForm((prev) => !prev)}
          >
            <Text style={styles.boardCreateToggleText}>
              {showCreateBoardForm ? "Hide" : "+ New board"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {showCreateBoardForm ? (
        <View style={styles.boardForm}>
          <Text style={styles.label}>Board title *</Text>
          <TextInput
            value={boardTitleInput}
            onChangeText={setBoardTitleInput}
            placeholder="e.g., Personal planning"
            style={styles.input}
          />

          <View style={styles.boardFormActions}>
            <Pressable
              style={[styles.boardCreateToggle, styles.boardArchiveButton]}
              onPress={() => {
                setBoardTitleInput("");
                setShowCreateBoardForm(false);
              }}
              disabled={savingBoard}
            >
              <Text style={styles.boardArchiveButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[styles.button, savingBoard && styles.buttonDisabled]}
              onPress={handleCreatePersonalBoard}
              disabled={savingBoard}
            >
              <Text style={styles.buttonText}>
                {savingBoard ? "Saving..." : "Save board"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {planningBoards.length === 0 ? (
        <View>
          <Text style={styles.muted}>
            No boards yet. Boards will help organize goals, milestones, and
            ideas.
          </Text>
          <Text style={styles.muted}>
            Create a board to organize ideas, next steps, active work, and
            completed plans.
          </Text>
        </View>
      ) : (
        planningBoards.map((board) => (
          <View key={board.id} style={styles.boardPreviewCard}>
            <Text style={styles.boardPreviewTitle}>{board.title}</Text>
            <Text style={styles.boardPreviewMeta}>Personal board</Text>

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
                accessibilityLabel={`Open ${board.title} personal planning board`}
              >
                <Text style={styles.boardOpenButtonText}>Open board</Text>
              </Pressable>
            </Link>

            {board.ownerUid === uid ? (
              <Pressable
                style={styles.boardArchiveButton}
                onPress={() => handleArchivePersonalBoard(board)}
                disabled={savingBoard}
              >
                <Text style={styles.boardArchiveButtonText}>Archive</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
