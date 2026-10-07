import { useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  archivePlanningBoard,
  createPlanningBoard,
  subscribePersonalPlanningBoards,
  type PlanningBoardDoc,
} from "../../../services/boards";

export function usePersonalPlanningBoards(uid: string | null, authReady: boolean) {
  const [planningBoards, setPlanningBoards] = useState<PlanningBoardDoc[]>([]);
  const [showCreateBoardForm, setShowCreateBoardForm] = useState(false);
  const [boardTitleInput, setBoardTitleInput] = useState("");
  const [savingBoard, setSavingBoard] = useState(false);

  useEffect(() => {
    if (!authReady) return;

    if (!uid) {
      setPlanningBoards([]);
      return;
    }

    return subscribePersonalPlanningBoards(
      uid,
      setPlanningBoards,
      (err) => {
        console.log("[Goals] planning boards subscription failed", err);
        setPlanningBoards([]);
      }
    );
  }, [authReady, uid]);

  const handleCreatePersonalBoard = async () => {
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in on the Settings tab first.");
      return;
    }

    const title = boardTitleInput.trim();
    if (!title) {
      Alert.alert("Board title required", "Please enter a board title.");
      return;
    }

    setSavingBoard(true);
    try {
      await createPlanningBoard({
        title,
        scope: "personal",
        createdByUid: uid,
        ownerUid: uid,
      });

      setBoardTitleInput("");
      setShowCreateBoardForm(false);
      Alert.alert("Board created", "Your planning board was created.");
    } catch (e: any) {
      Alert.alert("Create board failed", e?.message ?? "Please try again.");
    } finally {
      setSavingBoard(false);
    }
  };

  const handleArchivePersonalBoard = (board: PlanningBoardDoc) => {
    if (!uid || board.ownerUid !== uid) return;

    Alert.alert(
      "Archive board?",
      `Archive "${board.title}"? It will no longer appear on this tab.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            setSavingBoard(true);
            try {
              await archivePlanningBoard({ boardId: board.id });
            } catch (e: any) {
              Alert.alert(
                "Archive board failed",
                e?.message ?? "Please try again."
              );
            } finally {
              setSavingBoard(false);
            }
          },
        },
      ]
    );
  };

  return {
    planningBoards,
    showCreateBoardForm,
    setShowCreateBoardForm,
    boardTitleInput,
    setBoardTitleInput,
    savingBoard,
    handleCreatePersonalBoard,
    handleArchivePersonalBoard,
  };
}
