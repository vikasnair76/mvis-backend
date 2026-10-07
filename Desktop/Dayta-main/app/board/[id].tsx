import { router, useLocalSearchParams } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import {
  archivePlanningBoardCard,
  assignPlanningBoardCard,
  createPlanningBoardCard,
  mapPlanningBoardDoc,
  movePlanningBoardCard,
  restorePlanningBoardCard,
  subscribeArchivedPlanningBoardCards,
  subscribePlanningBoardCards,
  unassignPlanningBoardCard,
  type PlanningBoardCardDoc,
  type PlanningBoardColumnId,
  type PlanningBoardDoc,
} from "../../services/boards";
import { auth, db } from "../../services/firebase";
import { hapticError, hapticSuccess } from "../../services/haptics";
import type { Goal, Subtask } from "../../services/goalTypes";
import {
  createGroupActivity,
  createPlanningBoardCardAssignmentNotification,
  subscribeGroupMembers,
  type GroupMemberDoc,
  type GroupRole,
} from "../../services/groups";
import {
  subscribeGoalMilestones,
  type GoalMilestoneDoc,
} from "../../services/milestones";
import { UI_SIZES, type AppThemeTokens } from "../../services/theme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

function getRouteId(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getScopeLabel(board: PlanningBoardDoc): string {
  return board.scope === "group" ? "Group board" : "Personal board";
}

function formatCardMeta(card: PlanningBoardCardDoc): string | null {
  const parts: string[] = [];

  if (card.status) {
    parts.push(card.status.replace(/_/g, " "));
  }
  if (card.priority) {
    parts.push(`${card.priority} priority`);
  }
  if (typeof card.dueAtMs === "number") {
    parts.push(`Due ${new Date(card.dueAtMs).toLocaleDateString()}`);
  }

  return parts.length > 0 ? parts.join(" • ") : null;
}

function getMilestoneKey(milestone: Pick<GoalMilestoneDoc, "goalId" | "id">) {
  return `${milestone.goalId}:${milestone.id}`;
}

function getSubtaskKey(subtask: Pick<Subtask, "goalId" | "id">) {
  return `${subtask.goalId}:${subtask.id}`;
}

function isValidGroupRole(value: unknown): value is GroupRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "moderator" ||
    value === "member" ||
    value === "viewer"
  );
}

function getGroupRoleLabel(role: GroupRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "moderator":
      return "Moderator";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
  }
}

type LinkedWorkFilter = "all" | "goal" | "milestone" | "subtask";
type BoardCardViewFilter = "all" | "assigned_to_me";
type CardMutationKind = "move" | "archive" | "restore" | "assign";

type CardMutation = {
  kind: CardMutationKind;
  targetColumnId?: PlanningBoardColumnId;
};

function configureBoardLayoutAnimation() {
  LayoutAnimation.configureNext({
    duration: 200,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

type LinkedWorkPickerResult = {
  key: string;
  type: Exclude<LinkedWorkFilter, "all">;
  title: string;
  meta: string;
  parentGoalTitle: string | null;
  sortRank: number;
};

export default function BoardDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const boardId = getRouteId(id);
  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { width: screenWidth } = useWindowDimensions();

  const [board, setBoard] = useState<PlanningBoardDoc | null>(null);
  const [cards, setCards] = useState<PlanningBoardCardDoc[]>([]);
  const [archivedCards, setArchivedCards] = useState<PlanningBoardCardDoc[]>([]);
  const [currentUid, setCurrentUid] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  const [linkableGoals, setLinkableGoals] = useState<Goal[]>([]);
  const [linkableMilestones, setLinkableMilestones] = useState<
    Array<GoalMilestoneDoc & { goalTitle?: string | null }>
  >([]);
  const [linkableSubtasks, setLinkableSubtasks] = useState<
    Array<Subtask & { goalTitle?: string | null }>
  >([]);
  const [boardGroupName, setBoardGroupName] = useState<string | null>(null);
  const [boardGroupMembers, setBoardGroupMembers] = useState<GroupMemberDoc[]>(
    []
  );
  const [loadingBoardGroupContext, setLoadingBoardGroupContext] =
    useState(false);
  const [loadingBoardGroupMembers, setLoadingBoardGroupMembers] =
    useState(false);
  const [boardGroupMembersError, setBoardGroupMembersError] =
    useState<string | null>(null);
  const [currentGroupRole, setCurrentGroupRole] =
    useState<GroupRole | null>(null);
  const [loadingBoardPermissions, setLoadingBoardPermissions] =
    useState(false);
  const [boardPermissionError, setBoardPermissionError] =
    useState<string | null>(null);
  const [groupSharedGoalsError, setGroupSharedGoalsError] =
    useState<string | null>(null);
  const [loadingLinkableWork, setLoadingLinkableWork] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLoadError, setBoardLoadError] = useState<string | null>(null);
  const [cardsLoadedOnce, setCardsLoadedOnce] = useState(false);
  const [cardsLoadError, setCardsLoadError] = useState<string | null>(null);
  const [archivedCardsLoadedOnce, setArchivedCardsLoadedOnce] = useState(false);
  const [archivedCardsLoadError, setArchivedCardsLoadError] = useState<
    string | null
  >(null);
  const [cardTitleInput, setCardTitleInput] = useState("");
  const [cardDescriptionInput, setCardDescriptionInput] = useState("");
  const [selectedLinkedGoalId, setSelectedLinkedGoalId] = useState<string | null>(null);
  const [selectedLinkedMilestoneKey, setSelectedLinkedMilestoneKey] =
    useState<string | null>(null);
  const [selectedLinkedSubtaskKey, setSelectedLinkedSubtaskKey] =
    useState<string | null>(null);
  const [showLinkedWorkPicker, setShowLinkedWorkPicker] = useState(false);
  const [linkedWorkSearchInput, setLinkedWorkSearchInput] = useState("");
  const [linkedWorkFilter, setLinkedWorkFilter] =
    useState<LinkedWorkFilter>("all");
  const [boardCardViewFilter, setBoardCardViewFilter] =
    useState<BoardCardViewFilter>("all");
  const [assignmentPickerCard, setAssignmentPickerCard] =
    useState<PlanningBoardCardDoc | null>(null);
  const [assignmentPickerSelectedUid, setAssignmentPickerSelectedUid] =
    useState<string | null>(null);
  const [assignmentPickerSaving, setAssignmentPickerSaving] = useState(false);
  const [selectedColumnId, setSelectedColumnId] =
    useState<PlanningBoardColumnId>("ideas");
  const [savingCard, setSavingCard] = useState(false);
  const [showArchivedCards, setShowArchivedCards] = useState(false);
  const [pendingCardMutations, setPendingCardMutations] = useState<
    Record<string, CardMutation>
  >({});
  const pendingCardMutationsRef = useRef(new Map<string, CardMutation>());

  const beginCardMutation = (
    cardId: string,
    mutation: CardMutation
  ): boolean => {
    if (pendingCardMutationsRef.current.has(cardId)) return false;
    pendingCardMutationsRef.current.set(cardId, mutation);
    setPendingCardMutations((current) => ({ ...current, [cardId]: mutation }));
    return true;
  };

  const endCardMutation = (cardId: string) => {
    pendingCardMutationsRef.current.delete(cardId);
    setPendingCardMutations((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
  };

  const sortedColumns = useMemo(() => {
    return [...(board?.columns ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  }, [board?.columns]);
  const isGroupBoard = board?.scope === "group";
  const boardGroupId =
    isGroupBoard && typeof board?.groupId === "string" ? board.groupId : null;
  const isPersonalBoardOwner =
    board?.scope === "personal" &&
    !!currentUid &&
    board.ownerUid === currentUid;
  const isGroupBoardAdmin =
    currentGroupRole === "owner" || currentGroupRole === "admin";
  const isGroupBoardModerator = currentGroupRole === "moderator";
  const isGroupBoardRegularMember = currentGroupRole === "member";
  const isGroupBoardViewer = currentGroupRole === "viewer";
  const boardPermissionsReady = !isGroupBoard || !loadingBoardPermissions;
  const canCreateBoardCards =
    boardPermissionsReady &&
    (
      isPersonalBoardOwner ||
      (
        isGroupBoard &&
        (
          isGroupBoardAdmin ||
          isGroupBoardModerator ||
          isGroupBoardRegularMember
        )
      )
    );
  const canManageCardAssignments =
    isGroupBoard &&
    !loadingBoardPermissions &&
    !boardPermissionError &&
    (isGroupBoardAdmin || isGroupBoardModerator);
  const readOnlyNoticeText = useMemo(() => {
    if (isGroupBoard) {
      if (isGroupBoardViewer) {
        return "You can view this board, but your group role does not allow adding cards.";
      }

      return "You can view this board, but card changes are unavailable.";
    }

    return "You do not have permission to add cards to this board.";
  }, [isGroupBoard, isGroupBoardViewer]);
  const boardGroupMembersByUid = useMemo(() => {
    return new Map(boardGroupMembers.map((member) => [member.uid, member]));
  }, [boardGroupMembers]);
  const assignmentPickerMembers = useMemo(() => {
    return [...boardGroupMembers].sort((a, b) => {
      const aLabel = a.displayName ?? a.email ?? a.uid;
      const bLabel = b.displayName ?? b.email ?? b.uid;
      return aLabel.localeCompare(bLabel);
    });
  }, [boardGroupMembers]);
  const assignmentPickerCurrentUid =
    assignmentPickerCard?.assignedToUid?.trim() || null;
  const assignmentPickerNormalizedSelectedUid =
    assignmentPickerSelectedUid?.trim() || null;
  const assignmentPickerSelectedMember =
    assignmentPickerNormalizedSelectedUid == null
      ? null
      : boardGroupMembersByUid.get(assignmentPickerNormalizedSelectedUid) ??
        null;
  const assignmentPickerHasChanges =
    assignmentPickerNormalizedSelectedUid !== assignmentPickerCurrentUid;
  const canSaveAssignmentPicker =
    !!assignmentPickerCard &&
    !!boardId &&
    !!boardGroupId &&
    isGroupBoard &&
    canManageCardAssignments &&
    !loadingBoardPermissions &&
    !boardPermissionError &&
    !assignmentPickerSaving &&
    assignmentPickerHasChanges &&
    (assignmentPickerNormalizedSelectedUid == null ||
      assignmentPickerSelectedMember != null);
  const totalCards = cards.length;
  const linkedGoalCount = cards.filter(
    (card) => card.linkedItemType === "goal"
  ).length;
  const linkedMilestoneCount = cards.filter(
    (card) => card.linkedItemType === "milestone"
  ).length;
  const linkedSubtaskCount = cards.filter(
    (card) => card.linkedItemType === "subtask"
  ).length;
  const standaloneCardCount =
    totalCards - linkedGoalCount - linkedMilestoneCount - linkedSubtaskCount;
  const assignedToMeCount =
    isGroupBoard && currentUid
      ? cards.filter((card) => card.assignedToUid === currentUid).length
      : 0;
  const unassignedCount = isGroupBoard
    ? cards.filter((card) => !card.assignedToUid).length
    : 0;
  const boardHorizontalPadding = 32;
  const columnGap = 12;
  const visibleColumnCount =
    screenWidth >= 1300 ? 4 : screenWidth >= 1000 ? 3 : screenWidth >= 700 ? 2 : 1;
  const availableKanbanWidth =
    screenWidth - boardHorizontalPadding - columnGap * (visibleColumnCount - 1);
  const kanbanColumnWidth = Math.min(
    screenWidth < 700 ? 340 : 380,
    Math.max(290, availableKanbanWidth / visibleColumnCount)
  );

  const selectedLinkedSummary = useMemo(() => {
    if (selectedLinkedGoalId) {
      const goal = linkableGoals.find((item) => item.id === selectedLinkedGoalId);
      return goal ? `Selected: Goal — ${goal.title}` : null;
    }

    if (selectedLinkedMilestoneKey) {
      const milestone = linkableMilestones.find(
        (item) => getMilestoneKey(item) === selectedLinkedMilestoneKey
      );
      return milestone ? `Selected: Milestone — ${milestone.title}` : null;
    }

    if (selectedLinkedSubtaskKey) {
      const subtask = linkableSubtasks.find(
        (item) => getSubtaskKey(item) === selectedLinkedSubtaskKey
      );
      return subtask ? `Selected: Subtask — ${subtask.title}` : null;
    }

    return null;
  }, [
    linkableGoals,
    linkableMilestones,
    linkableSubtasks,
    selectedLinkedGoalId,
    selectedLinkedMilestoneKey,
    selectedLinkedSubtaskKey,
  ]);

  const selectedLinkedSummaryMeta = useMemo(() => {
    if (selectedLinkedMilestoneKey) {
      const milestone = linkableMilestones.find(
        (item) => getMilestoneKey(item) === selectedLinkedMilestoneKey
      );
      return milestone?.goalTitle ? `Goal: ${milestone.goalTitle}` : null;
    }

    if (selectedLinkedSubtaskKey) {
      const subtask = linkableSubtasks.find(
        (item) => getSubtaskKey(item) === selectedLinkedSubtaskKey
      );
      return subtask?.goalTitle ? `Goal: ${subtask.goalTitle}` : null;
    }

    return null;
  }, [
    linkableMilestones,
    linkableSubtasks,
    selectedLinkedMilestoneKey,
    selectedLinkedSubtaskKey,
  ]);

  const filteredLinkedWorkResults = useMemo(() => {
    const normalizedSearch = linkedWorkSearchInput.trim().toLowerCase();
    const results: LinkedWorkPickerResult[] = [
      ...linkableGoals.map((goal) => ({
        key: goal.id,
        type: "goal" as const,
        title: goal.title,
        meta: "Goal",
        parentGoalTitle: null,
        sortRank: 0,
      })),
      ...linkableMilestones.map((milestone) => ({
        key: getMilestoneKey(milestone),
        type: "milestone" as const,
        title: milestone.title,
        meta: `Milestone • ${milestone.goalTitle ?? "Untitled goal"}`,
        parentGoalTitle: milestone.goalTitle ?? null,
        sortRank: 1,
      })),
      ...linkableSubtasks.map((subtask) => ({
        key: getSubtaskKey(subtask),
        type: "subtask" as const,
        title: subtask.title,
        meta: `Subtask • ${subtask.goalTitle ?? "Untitled goal"}`,
        parentGoalTitle: subtask.goalTitle ?? null,
        sortRank: 2,
      })),
    ];

    return results
      .filter((item) => linkedWorkFilter === "all" || item.type === linkedWorkFilter)
      .filter((item) => {
        if (!normalizedSearch) return true;

        return [
          item.title,
          item.parentGoalTitle ?? "",
          item.type,
          item.meta,
        ].some((value) => value.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => {
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        return a.title.localeCompare(b.title);
      });
  }, [
    linkableGoals,
    linkableMilestones,
    linkableSubtasks,
    linkedWorkFilter,
    linkedWorkSearchInput,
  ]);

  const clearLinkedWorkSelection = () => {
    setSelectedLinkedGoalId(null);
    setSelectedLinkedMilestoneKey(null);
    setSelectedLinkedSubtaskKey(null);
  };

  const handleSelectLinkedWorkResult = (item: LinkedWorkPickerResult) => {
    if (item.type === "goal") {
      setSelectedLinkedGoalId(item.key);
      setSelectedLinkedMilestoneKey(null);
      setSelectedLinkedSubtaskKey(null);
    } else if (item.type === "milestone") {
      setSelectedLinkedMilestoneKey(item.key);
      setSelectedLinkedGoalId(null);
      setSelectedLinkedSubtaskKey(null);
    } else {
      setSelectedLinkedSubtaskKey(item.key);
      setSelectedLinkedGoalId(null);
      setSelectedLinkedMilestoneKey(null);
    }

    setShowLinkedWorkPicker(false);
    setLinkedWorkSearchInput("");
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!boardId) {
      setBoard(null);
      setBoardLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setBoard(null);
    setBoardLoadError(null);
    pendingCardMutationsRef.current.clear();
    setPendingCardMutations({});
    const boardRef = doc(db, "planningBoards", boardId);
    const unsub = onSnapshot(
      boardRef,
      (snap) => {
        if (!snap.exists()) {
          setBoard(null);
          setBoardLoadError(null);
          setLoading(false);
          return;
        }

        const nextBoard = mapPlanningBoardDoc(snap.id, snap.data());
        setBoard(nextBoard);
        setBoardLoadError(null);
        setLoading(false);
      },
      (err) => {
        console.log("[BoardDetail] board subscription failed", err);
        setBoardLoadError("The board couldn’t be refreshed. Check your connection and try again.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [boardId]);

  useEffect(() => {
    if (!boardId) {
      setCards([]);
      setCardsLoadedOnce(false);
      setCardsLoadError(null);
      return;
    }

    setCards([]);
    setCardsLoadedOnce(false);
    setCardsLoadError(null);

    return subscribePlanningBoardCards(
      boardId,
      (nextCards) => {
        if (
          Array.from(pendingCardMutationsRef.current.values()).some(
            (mutation) => mutation.kind !== "assign"
          )
        ) {
          configureBoardLayoutAnimation();
        }
        setCards(nextCards);
        setCardsLoadedOnce(true);
        setCardsLoadError(null);
      },
      (err) => {
        console.log("[BoardDetail] card subscription failed", err);
        setCardsLoadError("Cards couldn’t be refreshed.");
      }
    );
  }, [boardId]);

  useEffect(() => {
    if (!boardId) {
      setArchivedCards([]);
      setArchivedCardsLoadedOnce(false);
      setArchivedCardsLoadError(null);
      return;
    }

    setArchivedCards([]);
    setArchivedCardsLoadedOnce(false);
    setArchivedCardsLoadError(null);

    return subscribeArchivedPlanningBoardCards(
      boardId,
      (nextCards) => {
        if (
          Array.from(pendingCardMutationsRef.current.values()).some(
            (mutation) => mutation.kind === "archive" || mutation.kind === "restore"
          )
        ) {
          configureBoardLayoutAnimation();
        }
        setArchivedCards(nextCards);
        setArchivedCardsLoadedOnce(true);
        setArchivedCardsLoadError(null);
      },
      (err) => {
        console.log("[BoardDetail] archived card subscription failed", err);
        setArchivedCardsLoadError("Archived cards couldn’t be refreshed.");
      }
    );
  }, [boardId]);

  useEffect(() => {
    if (
      Platform.OS === "android" &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    if (!board || !boardGroupId) {
      setBoardGroupName(null);
      setLoadingBoardGroupContext(false);
      return;
    }

    setLoadingBoardGroupContext(true);

    return onSnapshot(
      doc(db, "groups", boardGroupId),
      (snap) => {
        if (!snap.exists()) {
          setBoardGroupName(null);
          setLoadingBoardGroupContext(false);
          return;
        }

        const data = snap.data();
        setBoardGroupName(
          typeof data.name === "string" && data.name.trim()
            ? data.name.trim()
            : "Group"
        );
        setLoadingBoardGroupContext(false);
      },
      (err) => {
        console.log("[BoardDetail] group context load failed", err);
        setBoardGroupName(null);
        setLoadingBoardGroupContext(false);
      }
    );
  }, [board, boardGroupId]);

  useEffect(() => {
    if (!isGroupBoard || !boardGroupId) {
      setBoardGroupMembers([]);
      setLoadingBoardGroupMembers(false);
      setBoardGroupMembersError(null);
      return;
    }

    setLoadingBoardGroupMembers(true);
    setBoardGroupMembersError(null);

    return subscribeGroupMembers(
      boardGroupId,
      (members) => {
        setBoardGroupMembers(
          members.filter((member) => member.status === "active")
        );
        setBoardGroupMembersError(null);
        setLoadingBoardGroupMembers(false);
      },
      (err) => {
        console.log("[BoardDetail] group members subscription failed", err);
        setBoardGroupMembers([]);
        setBoardGroupMembersError(
          "Group members could not be loaded. You can still close this picker."
        );
        setLoadingBoardGroupMembers(false);
      }
    );
  }, [isGroupBoard, boardGroupId]);

  useEffect(() => {
    if (!isGroupBoard && boardCardViewFilter !== "all") {
      setBoardCardViewFilter("all");
    }
  }, [isGroupBoard, boardCardViewFilter]);

  useEffect(() => {
    if (!isGroupBoard) {
      setCurrentGroupRole(null);
      setLoadingBoardPermissions(false);
      setBoardPermissionError(null);
      return;
    }

    if (!boardGroupId || !currentUid) {
      setCurrentGroupRole(null);
      setLoadingBoardPermissions(false);
      setBoardPermissionError(null);
      return;
    }

    setLoadingBoardPermissions(true);
    setBoardPermissionError(null);

    return onSnapshot(
      doc(db, "groups", boardGroupId, "members", currentUid),
      (snap) => {
        if (!snap.exists()) {
          setCurrentGroupRole(null);
          setLoadingBoardPermissions(false);
          return;
        }

        const data = snap.data();
        const nextRole =
          data.status === "active" && isValidGroupRole(data.role)
            ? data.role
            : null;

        setCurrentGroupRole(nextRole);
        setLoadingBoardPermissions(false);
      },
      (err) => {
        console.log(
          "[BoardDetail] group permission subscription failed",
          err
        );
        setCurrentGroupRole(null);
        setBoardPermissionError("Board actions are temporarily read-only.");
        setLoadingBoardPermissions(false);
      }
    );
  }, [isGroupBoard, boardGroupId, currentUid]);

  useEffect(() => {
    if (!canCreateBoardCards && showLinkedWorkPicker) {
      setShowLinkedWorkPicker(false);
    }
  }, [canCreateBoardCards, showLinkedWorkPicker]);

  useEffect(() => {
    if (!canManageCardAssignments && assignmentPickerCard) {
      setAssignmentPickerCard(null);
      setAssignmentPickerSelectedUid(null);
      setAssignmentPickerSaving(false);
    }
  }, [assignmentPickerCard, canManageCardAssignments]);

  useEffect(() => {
    const uid = currentUid;

    setLinkableGoals([]);
    setLinkableMilestones([]);
    setLinkableSubtasks([]);
    clearLinkedWorkSelection();
    setGroupSharedGoalsError(null);

    if (!board) {
      setLoadingLinkableWork(false);
      return;
    }

    if (isGroupBoard) {
      if (!boardGroupId) {
        setLoadingLinkableWork(false);
        return;
      }

      setLoadingLinkableWork(true);

      return onSnapshot(
        collection(db, "groups", boardGroupId, "sharedGoals"),
        (snap) => {
          const goals = snap.docs
            .filter((sharedGoalDoc) => {
              const sharedData = sharedGoalDoc.data();
              return (
                (sharedData.status == null || sharedData.status === "active") &&
                sharedData.archived !== true &&
                sharedData.hiddenByModeration !== true
              );
            })
            .map((sharedGoalDoc) => {
              const sharedData = sharedGoalDoc.data();

              return {
                id: sharedGoalDoc.id,
                userId:
                  typeof sharedData.ownerUserId === "string"
                    ? sharedData.ownerUserId
                    : "",
                title:
                  typeof sharedData.goalTitle === "string" &&
                  sharedData.goalTitle.trim()
                    ? sharedData.goalTitle
                    : "Shared goal",
                description:
                  typeof sharedData.goalDescription === "string"
                    ? sharedData.goalDescription
                    : null,
                metricType: sharedData.metricType ?? "none",
                metricUnit:
                  typeof sharedData.metricUnit === "string"
                    ? sharedData.metricUnit
                    : null,
                metricTargetValue:
                  typeof sharedData.metricTargetValue === "number"
                    ? sharedData.metricTargetValue
                    : null,
                currentMetricValue:
                  typeof sharedData.currentMetricValue === "number"
                    ? sharedData.currentMetricValue
                    : null,
                progressPercentage:
                  typeof sharedData.progressPercentage === "number"
                    ? sharedData.progressPercentage
                    : 0,
                status:
                  sharedData.goalStatus === "paused" ||
                  sharedData.goalStatus === "completed"
                    ? sharedData.goalStatus
                    : "active",
                completedAtMs:
                  typeof sharedData.completedAtMs === "number"
                    ? sharedData.completedAtMs
                    : null,
                createdAtMs:
                  typeof sharedData.sharedAtMs === "number"
                    ? sharedData.sharedAtMs
                    : 0,
                visibility: "group_shared",
                sharedGroupIds: [boardGroupId],
                sharedGroupId: boardGroupId,
                sharedGroupName: boardGroupName,
              } satisfies Goal;
            });

          setLinkableGoals(goals);
          setGroupSharedGoalsError(null);
          setLoadingLinkableWork(false);
        },
        (err) => {
          console.log(
            "[BoardDetail] group shared goals subscription failed",
            err
          );
          setLinkableGoals([]);
          setGroupSharedGoalsError("Could not load this group's shared work.");
          setLoadingLinkableWork(false);
        }
      );
    }

    if (!uid) {
      setLoadingLinkableWork(false);
      return;
    }

    setLoadingLinkableWork(true);

    const qy = query(
      collection(db, "goals"),
      where("userId", "==", uid),
      orderBy("createdAtMs", "desc")
    );

    return onSnapshot(
      qy,
      (snap) => {
        const goals = snap.docs.map((goalDoc) => {
          const data = goalDoc.data() as Omit<Goal, "id">;
          return { id: goalDoc.id, ...data };
        });
        setLinkableGoals(goals);
        setLoadingLinkableWork(false);
      },
      (err) => {
        console.log("[BoardDetail] linkable goals subscription failed", err);
        setLinkableGoals([]);
        setLoadingLinkableWork(false);
      }
    );
  }, [board, isGroupBoard, boardGroupId, boardGroupName, currentUid]);

  useEffect(() => {
    if (linkableGoals.length === 0) {
      setLinkableMilestones([]);
      setSelectedLinkedMilestoneKey(null);
      return;
    }

    const milestonesByGoalId = new Map<
      string,
      Array<GoalMilestoneDoc & { goalTitle?: string | null }>
    >();

    const emit = () => {
      const next = linkableGoals.flatMap(
        (goal) => milestonesByGoalId.get(goal.id) ?? []
      );
      setLinkableMilestones(next);
      setSelectedLinkedMilestoneKey((current) =>
        current && next.some((milestone) => getMilestoneKey(milestone) === current)
          ? current
          : null
      );
    };

    const unsubs = linkableGoals.map((goal) =>
      subscribeGoalMilestones(
        goal.id,
        (milestones) => {
          milestonesByGoalId.set(
            goal.id,
            milestones.map((milestone) => ({
              ...milestone,
              goalTitle: goal.title ?? null,
            }))
          );
          emit();
        },
        (err) => {
          console.log("[BoardDetail] milestone subscription failed", err);
          milestonesByGoalId.set(goal.id, []);
          emit();
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [linkableGoals]);

  useEffect(() => {
    if (linkableGoals.length === 0) {
      setLinkableSubtasks([]);
      setSelectedLinkedSubtaskKey(null);
      return;
    }

    const subtasksByGoalId = new Map<
      string,
      Array<Subtask & { goalTitle?: string | null }>
    >();

    const emit = () => {
      const next = linkableGoals.flatMap(
        (goal) => subtasksByGoalId.get(goal.id) ?? []
      );
      setLinkableSubtasks(next);
      setSelectedLinkedSubtaskKey((current) =>
        current && next.some((subtask) => getSubtaskKey(subtask) === current)
          ? current
          : null
      );
    };

    const unsubs = linkableGoals.map((goal) => {
      const qy = query(
        collection(db, "goals", goal.id, "subtasks"),
        orderBy("createdAtMs", "desc")
      );

      return onSnapshot(
        qy,
        (snap) => {
          subtasksByGoalId.set(
            goal.id,
            snap.docs.map((subtaskDoc) => {
              const data = subtaskDoc.data() as Partial<Subtask>;
              return {
                ...(data as Subtask),
                id: subtaskDoc.id,
                goalId:
                  typeof data.goalId === "string" ? data.goalId : goal.id,
                goalTitle: goal.title ?? null,
              };
            })
          );
          emit();
        },
        (err) => {
          console.log("[BoardDetail] subtask subscription failed", err);
          subtasksByGoalId.set(goal.id, []);
          emit();
        }
      );
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [linkableGoals]);

  useEffect(() => {
    setSelectedLinkedGoalId((current) =>
      current && linkableGoals.some((goal) => goal.id === current)
        ? current
        : null
    );
    setSelectedLinkedMilestoneKey((current) =>
      current &&
      linkableMilestones.some(
        (milestone) => getMilestoneKey(milestone) === current
      )
        ? current
        : null
    );
    setSelectedLinkedSubtaskKey((current) =>
      current &&
      linkableSubtasks.some((subtask) => getSubtaskKey(subtask) === current)
        ? current
        : null
    );
  }, [
    board?.scope,
    boardGroupId,
    linkableGoals,
    linkableMilestones,
    linkableSubtasks,
  ]);

  useEffect(() => {
    if (sortedColumns.length === 0) return;
    if (sortedColumns.some((column) => column.id === selectedColumnId)) return;
    setSelectedColumnId(sortedColumns[0].id);
  }, [selectedColumnId, sortedColumns]);

  const visibleBoardCards = useMemo(() => {
    if (!isGroupBoard || boardCardViewFilter === "all") {
      return cards;
    }

    return cards.filter((card) => card.assignedToUid === currentUid);
  }, [boardCardViewFilter, cards, currentUid, isGroupBoard]);

  const cardsByColumn = useMemo(() => {
    const byColumn: Record<string, PlanningBoardCardDoc[]> = {};

    sortedColumns.forEach((column) => {
      byColumn[column.id] = [];
    });

    visibleBoardCards.forEach((card) => {
      const columnCards = byColumn[card.columnId] ?? [];
      columnCards.push(card);
      byColumn[card.columnId] = columnCards;
    });

    Object.keys(byColumn).forEach((columnId) => {
      byColumn[columnId].sort((a, b) => a.sortOrder - b.sortOrder);
    });

    return byColumn;
  }, [sortedColumns, visibleBoardCards]);

  const isActiveBoardGroupMember = useCallback(
    (uid: string): boolean => boardGroupMembersByUid.has(uid),
    [boardGroupMembersByUid]
  );

  const getBoardMemberLabel = useCallback(
    (uid?: string | null): string => {
      if (!uid) return "Unassigned";

      const member = boardGroupMembersByUid.get(uid);
      if (member) {
        return member.displayName ?? member.email ?? uid;
      }

      if (uid === currentUid) {
        return (
          auth.currentUser?.displayName ??
          auth.currentUser?.email ??
          "Group member"
        );
      }

      return "Group member";
    },
    [boardGroupMembersByUid, currentUid]
  );

  const isBoardCardCreatedByCurrentUser = useCallback(
    (card: PlanningBoardCardDoc): boolean =>
      !!currentUid && card.createdByUid === currentUid,
    [currentUid]
  );

  const isBoardCardAssignedToCurrentUser = useCallback(
    (card: PlanningBoardCardDoc): boolean =>
      !!currentUid && card.assignedToUid === currentUid,
    [currentUid]
  );

  const getBoardCardCreatorLabel = useCallback(
    (card: PlanningBoardCardDoc): string => {
      if (isBoardCardCreatedByCurrentUser(card)) return "you";
      if (
        isGroupBoard &&
        card.createdByUid &&
        !isActiveBoardGroupMember(card.createdByUid)
      ) {
        return "Former member";
      }

      return getBoardMemberLabel(card.createdByUid);
    },
    [
      getBoardMemberLabel,
      isActiveBoardGroupMember,
      isBoardCardCreatedByCurrentUser,
      isGroupBoard,
    ]
  );

  const getBoardCardAssigneeLabel = useCallback(
    (card: PlanningBoardCardDoc): string => {
      if (!card.assignedToUid) return "Unassigned";
      if (isBoardCardAssignedToCurrentUser(card)) return "you";
      if (card.assignedToName) return card.assignedToName;
      if (card.assignedToEmail) return card.assignedToEmail;
      if (isActiveBoardGroupMember(card.assignedToUid)) {
        return getBoardMemberLabel(card.assignedToUid);
      }

      return isGroupBoard ? "Former member" : "Group member";
    },
    [
      getBoardMemberLabel,
      isActiveBoardGroupMember,
      isBoardCardAssignedToCurrentUser,
      isGroupBoard,
    ]
  );

  const getBoardCardPermissionReason = useCallback(
    (card: PlanningBoardCardDoc): string | null => {
      if (!isGroupBoard) return null;
      if (isGroupBoardAdmin || isGroupBoardModerator) return null;
      if (isGroupBoardRegularMember) {
        const createdByCurrentUser = isBoardCardCreatedByCurrentUser(card);
        const assignedToCurrentUser = isBoardCardAssignedToCurrentUser(card);

        if (createdByCurrentUser && assignedToCurrentUser) {
          return "You created this card and it is assigned to you.";
        }
        if (createdByCurrentUser) return "You created this card.";
        if (assignedToCurrentUser) return "This card is assigned to you.";

        return "You can view this card, but it is not assigned to you and you did not create it.";
      }
      if (isGroupBoardViewer) return "Your viewer role is read-only.";

      return "Board actions are temporarily read-only.";
    },
    [
      isBoardCardAssignedToCurrentUser,
      isBoardCardCreatedByCurrentUser,
      isGroupBoard,
      isGroupBoardAdmin,
      isGroupBoardModerator,
      isGroupBoardRegularMember,
      isGroupBoardViewer,
    ]
  );

  const canMoveBoardCard = useCallback(
    (card: PlanningBoardCardDoc): boolean => {
      if (!boardPermissionsReady) return false;
      if (isPersonalBoardOwner) return true;
      if (!isGroupBoard || !currentUid) return false;
      if (isGroupBoardAdmin || isGroupBoardModerator) return true;
      if (isGroupBoardRegularMember) {
        return (
          card.createdByUid === currentUid ||
          card.assignedToUid === currentUid
        );
      }
      return false;
    },
    [
      boardPermissionsReady,
      currentUid,
      isGroupBoard,
      isGroupBoardAdmin,
      isGroupBoardModerator,
      isGroupBoardRegularMember,
      isPersonalBoardOwner,
    ]
  );

  const canArchiveBoardCard = useCallback(
    (card: PlanningBoardCardDoc): boolean => {
      if (!boardPermissionsReady) return false;
      if (isPersonalBoardOwner) return true;
      if (!isGroupBoard || !currentUid) return false;
      if (isGroupBoardAdmin || isGroupBoardModerator) return true;
      if (isGroupBoardRegularMember) {
        return card.createdByUid === currentUid;
      }
      return false;
    },
    [
      boardPermissionsReady,
      currentUid,
      isGroupBoard,
      isGroupBoardAdmin,
      isGroupBoardModerator,
      isGroupBoardRegularMember,
      isPersonalBoardOwner,
    ]
  );

  const canRestoreBoardCard = useCallback(
    (card: PlanningBoardCardDoc): boolean => canArchiveBoardCard(card),
    [canArchiveBoardCard]
  );

  const canEditBoardCard = useCallback(
    (card: PlanningBoardCardDoc): boolean => canMoveBoardCard(card),
    [canMoveBoardCard]
  );

  const closeAssignmentPicker = useCallback(() => {
    setAssignmentPickerCard(null);
    setAssignmentPickerSelectedUid(null);
    setAssignmentPickerSaving(false);
  }, []);

  const openAssignmentPicker = useCallback(
    (card: PlanningBoardCardDoc) => {
      if (!canManageCardAssignments || !isGroupBoard) {
        return;
      }
      if (pendingCardMutationsRef.current.has(card.id)) return;

      setAssignmentPickerSelectedUid(card.assignedToUid ?? null);
      setAssignmentPickerSaving(false);
      setAssignmentPickerCard(card);
    },
    [canManageCardAssignments, isGroupBoard]
  );

  const handleSaveCardAssignment = async () => {
    if (assignmentPickerSaving) return;

    const card = assignmentPickerCard;
    const safeBoardId = boardId?.trim() ?? "";
    const safeGroupId = boardGroupId?.trim() ?? "";
    const safeCardId = card?.id.trim() ?? "";
    const actorUid = currentUid?.trim() ?? "";

    if (
      !card ||
      !safeBoardId ||
      !safeGroupId ||
      !safeCardId ||
      !actorUid ||
      !isGroupBoard
    ) {
      return;
    }

    if (
      !canManageCardAssignments ||
      loadingBoardPermissions ||
      boardPermissionError
    ) {
      Alert.alert(
        "Permission changed",
        "You no longer have permission to manage card assignments."
      );
      closeAssignmentPicker();
      return;
    }

    const previousUid = card.assignedToUid?.trim() || null;
    const selectedUid = assignmentPickerSelectedUid?.trim() || null;

    if (previousUid === selectedUid) {
      closeAssignmentPicker();
      return;
    }

    const selectedMember =
      selectedUid == null
        ? null
        : boardGroupMembersByUid.get(selectedUid) ?? null;

    if (selectedUid && !selectedMember) {
      Alert.alert(
        "Member unavailable",
        "That member is no longer available for assignment. Choose another member or leave the card unassigned."
      );
      return;
    }

    const previousMember = previousUid
      ? boardGroupMembersByUid.get(previousUid) ?? null
      : null;
    const previousAssignedToName =
      previousMember?.displayName ?? card.assignedToName ?? null;
    const previousAssignedToEmail =
      previousMember?.email ?? card.assignedToEmail ?? null;
    const previousAssigneeLabel =
      previousMember?.displayName ??
      previousMember?.email ??
      (previousMember ? "a group member" : null) ??
      card.assignedToName ??
      card.assignedToEmail ??
      (previousUid ? "a former member" : "Unassigned");
    const assignedToName = selectedMember?.displayName ?? null;
    const assignedToEmail = selectedMember?.email ?? null;
    const nextAssigneeLabel =
      selectedMember?.displayName ??
      selectedMember?.email ??
      (selectedMember ? "a group member" : null) ??
      "Unassigned";
    const actorMember = boardGroupMembersByUid.get(actorUid) ?? null;
    const actorName =
      actorMember?.displayName ??
      auth.currentUser?.displayName ??
      actorMember?.email ??
      auth.currentUser?.email ??
      null;
    const actorEmail =
      actorMember?.email ?? auth.currentUser?.email ?? null;
    const notificationEventId = String(Date.now());

    if (!beginCardMutation(safeCardId, { kind: "assign" })) return;
    setAssignmentPickerSaving(true);

    try {
      if (selectedUid == null) {
        await unassignPlanningBoardCard({
          boardId: safeBoardId,
          cardId: safeCardId,
        });
      } else {
        await assignPlanningBoardCard({
          boardId: safeBoardId,
          cardId: safeCardId,
          assignedToUid: selectedUid,
          assignedToName,
          assignedToEmail,
        });
      }

      const activityType =
        selectedUid == null
          ? "planning_board_card_unassigned"
          : previousUid == null
          ? "planning_board_card_assigned"
          : "planning_board_card_reassigned";
      const activityMessage =
        selectedUid == null
          ? `removed ${previousAssigneeLabel} from “${card.title}”.`
          : previousUid == null
          ? `assigned “${card.title}” to ${nextAssigneeLabel}.`
          : `reassigned “${card.title}” from ${previousAssigneeLabel} to ${nextAssigneeLabel}.`;

      try {
        await createGroupActivity({
          groupId: safeGroupId,
          type: activityType,
          actorUid,
          actorName,
          actorEmail,
          message: activityMessage,
          targetUid: selectedUid,
          targetEmail: assignedToEmail,
          boardId: safeBoardId,
          boardTitle: board?.title ?? null,
          cardId: safeCardId,
          cardTitle: card.title,
          previousAssignedToUid: previousUid,
          previousAssignedToName,
          previousAssignedToEmail,
          assignedToUid: selectedUid,
          assignedToName,
          assignedToEmail,
        });
      } catch (activityError) {
        console.log(
          "[BoardDetail] assignment activity write failed",
          activityError
        );
      }

      if (selectedUid != null && selectedUid !== actorUid) {
        try {
          await createPlanningBoardCardAssignmentNotification({
            groupId: safeGroupId,
            boardId: safeBoardId,
            boardTitle: board?.title ?? null,
            cardId: safeCardId,
            cardTitle: card.title,
            assignedToUid: selectedUid,
            assignedToName,
            actorUid,
            actorName,
            eventId: notificationEventId,
          });
        } catch (notificationError) {
          console.log(
            "[BoardDetail] assignment notification failed",
            notificationError
          );
        }
      }

      closeAssignmentPicker();
      void hapticSuccess();
    } catch (error) {
      console.log("[BoardDetail] assignment update failed", error);
      setAssignmentPickerSaving(false);
      void hapticError();
      Alert.alert(
        "Could not update assignment",
        "Unable to update this card’s assignment. Check your connection and permissions, then try again."
      );
    } finally {
      endCardMutation(safeCardId);
    }
  };

  const handleCreateCard = async () => {
    const uid = currentUid;
    const selectedLinkedGoal = selectedLinkedGoalId
      ? linkableGoals.find((goal) => goal.id === selectedLinkedGoalId) ?? null
      : null;
    const selectedLinkedMilestone = selectedLinkedMilestoneKey
      ? linkableMilestones.find(
          (milestone) => getMilestoneKey(milestone) === selectedLinkedMilestoneKey
        ) ?? null
      : null;
    const selectedLinkedSubtask = selectedLinkedSubtaskKey
      ? linkableSubtasks.find(
          (subtask) => getSubtaskKey(subtask) === selectedLinkedSubtaskKey
        ) ?? null
      : null;
    const linkedItemType = selectedLinkedGoal
      ? "goal"
      : selectedLinkedMilestone
      ? "milestone"
      : selectedLinkedSubtask
      ? "subtask"
      : null;
    const linkedItemId =
      selectedLinkedGoal?.id ??
      selectedLinkedMilestone?.id ??
      selectedLinkedSubtask?.id ??
      null;
    const title =
      cardTitleInput.trim() ||
      selectedLinkedGoal?.title?.trim() ||
      selectedLinkedMilestone?.title?.trim() ||
      selectedLinkedSubtask?.title?.trim() ||
      "";

    if (!canCreateBoardCards) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to add cards to this board."
      );
      return;
    }
    if (!board || !boardId || sortedColumns.length === 0) {
      Alert.alert("Board not found", "This board is not available.");
      return;
    }
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in to add cards.");
      return;
    }
    if (
      !title &&
      !selectedLinkedGoalId &&
      !selectedLinkedMilestoneKey &&
      !selectedLinkedSubtaskKey
    ) {
      Alert.alert("Card title required", "Please enter a card title.");
      return;
    }
    if (selectedLinkedGoalId && !selectedLinkedGoal) {
      Alert.alert("Goal not found", "Please choose a goal again.");
      return;
    }
    if (selectedLinkedMilestoneKey && !selectedLinkedMilestone) {
      Alert.alert("Milestone not found", "Please choose a milestone again.");
      return;
    }
    if (selectedLinkedSubtaskKey && !selectedLinkedSubtask) {
      Alert.alert("Subtask not found", "Please choose a subtask again.");
      return;
    }

    setSavingCard(true);
    try {
      await createPlanningBoardCard({
        boardId,
        title,
        description: cardDescriptionInput,
        columnId:
  sortedColumns.some((column) => column.id === selectedColumnId)
    ? selectedColumnId
    : sortedColumns[0].id,
        createdByUid: uid,
        ownerUid: board.scope === "personal" ? board.ownerUid ?? uid : null,
        groupId: board.scope === "group" ? board.groupId ?? null : null,
        linkedItemType,
        linkedItemId,
      });

      setCardTitleInput("");
      setCardDescriptionInput("");
      setSelectedLinkedGoalId(null);
      setSelectedLinkedMilestoneKey(null);
      setSelectedLinkedSubtaskKey(null);
    } catch (e: any) {
      Alert.alert("Could not add card", e?.message ?? "Please try again.");
    } finally {
      setSavingCard(false);
    }
  };

  const handleMoveCard = async (
    card: PlanningBoardCardDoc,
    columnId: PlanningBoardColumnId
  ) => {
    if (!boardId) return;
    if (!canMoveBoardCard(card)) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to move this card."
      );
      return;
    }
    if (!beginCardMutation(card.id, { kind: "move", targetColumnId: columnId })) {
      return;
    }

    try {
      await movePlanningBoardCard({
        boardId,
        cardId: card.id,
        columnId,
      });
      void hapticSuccess();
    } catch (e: any) {
      void hapticError();
      Alert.alert("Could not move card", e?.message ?? "Please try again.");
    } finally {
      endCardMutation(card.id);
    }
  };

  const handleArchiveCard = (card: PlanningBoardCardDoc) => {
    if (!boardId) return;
    if (!canArchiveBoardCard(card)) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to archive this card."
      );
      return;
    }

    Alert.alert(
      "Archive card?",
      `Archive "${card.title}"? It will no longer appear on this board.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            if (!beginCardMutation(card.id, { kind: "archive" })) return;
            try {
              await archivePlanningBoardCard({
                boardId,
                cardId: card.id,
              });
              void hapticSuccess();
            } catch (e: any) {
              void hapticError();
              Alert.alert(
                "Could not archive card",
                e?.message ?? "Please try again."
              );
            } finally {
              endCardMutation(card.id);
            }
          },
        },
      ]
    );
  };

  const handleRestoreCard = async (card: PlanningBoardCardDoc) => {
    if (!boardId) return;
    if (!canRestoreBoardCard(card)) {
      Alert.alert(
        "Not allowed",
        "You do not have permission to restore this card."
      );
      return;
    }
    if (!beginCardMutation(card.id, { kind: "restore" })) return;

    try {
      await restorePlanningBoardCard({
        boardId,
        cardId: card.id,
      });
      void hapticSuccess();
    } catch (e: any) {
      void hapticError();
      Alert.alert("Could not restore card", e?.message ?? "Please try again.");
    } finally {
      endCardMutation(card.id);
    }
  };

  if (!boardId) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Board not found.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Loading board…</Text>
      </View>
    );
  }

  if (!board) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>
          {boardLoadError ? "Board unavailable" : "Board not found."}
        </Text>
        {boardLoadError ? (
          <Text accessibilityRole="alert" style={styles.listenerErrorText}>
            {boardLoadError}
          </Text>
        ) : null}
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.title}>{board.title}</Text>
        <Text style={styles.boardContextMeta}>
          {isGroupBoard
            ? boardGroupName
              ? `Group board -> ${boardGroupName}`
              : "Group board"
            : "Personal board"}
        </Text>
        <Text style={styles.helper}>
          {isGroupBoard
            ? "Coordinate shared goals, milestones, subtasks, and standalone work for this group."
            : "Organize ideas, next steps, active work, and completed plans."}
        </Text>
        {isGroupBoard && !boardGroupId ? (
          <Text style={styles.boardContextWarning}>
            This group board is missing its group connection.
          </Text>
        ) : null}
        {isGroupBoard && boardPermissionsReady && currentGroupRole ? (
          <Text style={styles.boardPermissionMeta}>
            Your role: {getGroupRoleLabel(currentGroupRole)}
          </Text>
        ) : null}
        {isGroupBoard && boardPermissionError ? (
          <Text style={styles.boardPermissionWarning}>
            {boardPermissionError}
          </Text>
        ) : null}
        <Text style={styles.muted}>
          {totalCards} cards • {linkedGoalCount} goals • {linkedMilestoneCount}{" "}
          milestones • {linkedSubtaskCount} subtasks
          {isGroupBoard && assignedToMeCount > 0
            ? ` • ${assignedToMeCount} assigned to me`
            : ""}
          {isGroupBoard ? ` • ${unassignedCount} unassigned` : ""}
        </Text>
      </View>

      {boardLoadError ? (
        <View accessibilityRole="alert" style={styles.listenerErrorCard}>
          <Text style={styles.listenerErrorTitle}>Board couldn’t be refreshed</Text>
          <Text style={styles.listenerErrorText}>
            The last available board details are still shown.
          </Text>
        </View>
      ) : null}

      {cardsLoadError ? (
        <View accessibilityRole="alert" style={styles.listenerErrorCard}>
          <Text style={styles.listenerErrorTitle}>
            {cardsLoadedOnce ? "Cards couldn’t be refreshed" : "Cards unavailable"}
          </Text>
          <Text style={styles.listenerErrorText}>
            {cardsLoadedOnce
              ? "The last available cards are still shown."
              : "Card data could not be loaded. Check your connection and try again later."}
          </Text>
        </View>
      ) : !cardsLoadedOnce ? (
        <View style={styles.card}>
          <Text style={styles.helper}>Loading cards…</Text>
        </View>
      ) : null}

      {isGroupBoard ? (
        <View>
          <View style={styles.boardCardFilterRow}>
            {[
              ["all", "All cards"],
              ["assigned_to_me", "Assigned to me"],
            ].map(([filter, label]) => {
              const selected = boardCardViewFilter === filter;

              return (
                <Pressable
                  key={filter}
                  style={[
                    styles.boardCardFilterPill,
                    selected && styles.boardCardFilterPillActive,
                  ]}
                  onPress={() =>
                    setBoardCardViewFilter(filter as BoardCardViewFilter)
                  }
                >
                  <Text
                    style={[
                      styles.boardCardFilterText,
                      selected && styles.boardCardFilterTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {boardCardViewFilter === "assigned_to_me" &&
          visibleBoardCards.length === 0 ? (
            <Text style={styles.boardCardFilterEmptyText}>
              No cards are currently assigned to you.
            </Text>
          ) : null}
        </View>
      ) : null}

      {cardsLoadedOnce && totalCards === 0 ? (
        <View style={styles.card}>
          <Text style={styles.helper}>
            This board is empty. Add your first card to start organizing work.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add card</Text>
        {canCreateBoardCards ? (
          <>
        <Text style={styles.helper}>
          Cards are lightweight planning notes. Later they can link to goals,
          milestones, and tasks.
        </Text>

        <Text style={styles.label}>Title *</Text>
        <TextInput
          value={cardTitleInput}
          onChangeText={setCardTitleInput}
          placeholder="Card title"
          style={styles.input}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          value={cardDescriptionInput}
          onChangeText={setCardDescriptionInput}
          placeholder="Optional details"
          style={[styles.input, styles.multiline]}
          multiline
        />

        <Text style={styles.label}>Link to existing work</Text>
        <Text style={styles.helper}>
          {isGroupBoard
            ? "Choose work shared with this group, or keep this as a standalone card."
            : "Choose an existing goal, milestone, or subtask, or keep this as a standalone card."}
        </Text>
        {loadingLinkableWork ? (
          <Text style={styles.linkedWorkLoadingText}>
            {isGroupBoard ? "Loading shared work..." : "Loading linked work..."}
          </Text>
        ) : null}
        {isGroupBoard && groupSharedGoalsError ? (
          <Text style={styles.linkedWorkErrorText}>
            {groupSharedGoalsError}
          </Text>
        ) : null}
        {selectedLinkedSummary ? (
          <View style={styles.selectedLinkedWorkCard}>
            <Text style={styles.selectedLinkedWorkText}>
              {selectedLinkedSummary}
            </Text>
            {selectedLinkedSummaryMeta ? (
              <Text style={styles.selectedLinkedWorkMeta}>
                {selectedLinkedSummaryMeta}
              </Text>
            ) : null}
            <Pressable
              style={styles.clearLinkedWorkButton}
              onPress={clearLinkedWorkSelection}
            >
              <Text style={styles.clearLinkedWorkButtonText}>
                Clear selection
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.pillRow}>
          <Pressable
            style={[
              styles.pill,
              selectedLinkedGoalId == null &&
                selectedLinkedMilestoneKey == null &&
                selectedLinkedSubtaskKey == null &&
                styles.pillActive,
            ]}
            onPress={clearLinkedWorkSelection}
          >
            <Text style={styles.pillText}>Standalone card</Text>
          </Pressable>

          <Pressable
            style={styles.linkedPickerButton}
            onPress={() => setShowLinkedWorkPicker(true)}
          >
            <Text style={styles.linkedPickerButtonText}>
              Choose existing work
            </Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Column</Text>
        <View style={styles.pillRow}>
          {sortedColumns.map((column) => (
            <Pressable
              key={column.id}
              style={[
                styles.pill,
                selectedColumnId === column.id && styles.pillActive,
              ]}
              onPress={() => setSelectedColumnId(column.id)}
            >
              <Text style={styles.pillText}>{column.title}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.button, savingCard && styles.buttonDisabled]}
          onPress={handleCreateCard}
          disabled={savingCard}
        >
          <Text style={styles.buttonText}>
            {savingCard ? "Adding..." : "Add card"}
          </Text>
        </Pressable>
          </>
        ) : (
          <View style={styles.boardReadOnlyNotice}>
            <Text style={styles.boardReadOnlyNoticeText}>
              {readOnlyNoticeText}
            </Text>
          </View>
        )}
      </View>

      <Modal
        visible={assignmentPickerCard !== null && canManageCardAssignments}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!assignmentPickerSaving) closeAssignmentPicker();
        }}
      >
        <View style={styles.linkedPickerBackdrop}>
          <View style={styles.assignmentPickerModal}>
            <View style={styles.linkedPickerHeader}>
              <View style={styles.assignmentPickerHeading}>
                <Text style={styles.linkedPickerTitle}>Assign card</Text>
                {assignmentPickerCard ? (
                  <Text style={styles.assignmentPickerCardTitle}>
                    {assignmentPickerCard.title}
                  </Text>
                ) : null}
              </View>
              <Pressable
                style={[
                  styles.linkedPickerCloseButton,
                  assignmentPickerSaving && styles.buttonDisabled,
                ]}
                onPress={closeAssignmentPicker}
                disabled={assignmentPickerSaving}
                accessibilityRole="button"
                accessibilityLabel="Close assignment picker"
                accessibilityState={{ disabled: assignmentPickerSaving }}
              >
                <Text style={styles.linkedPickerCloseButtonText}>Close</Text>
              </Pressable>
            </View>

            {assignmentPickerCard ? (
              <>
                <Text style={styles.assignmentPickerCurrentText}>
                  {assignmentPickerCard.assignedToUid
                    ? `Currently assigned to ${getBoardCardAssigneeLabel(
                        assignmentPickerCard
                      )}`
                    : "Currently unassigned"}
                </Text>

                {assignmentPickerCard.assignedToUid &&
                !isActiveBoardGroupMember(
                  assignmentPickerCard.assignedToUid
                ) ? (
                  <View style={styles.assignmentPickerFormerRow}>
                    <Text style={styles.assignmentPickerOptionTitle}>
                      {getBoardCardAssigneeLabel(assignmentPickerCard)}
                    </Text>
                    <Text style={styles.assignmentPickerOptionMeta}>
                      Former member — current assignment
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={styles.assignmentPickerHelpText}>
              Choose an active group member or leave the card unassigned.
            </Text>

            <ScrollView style={styles.assignmentPickerResults}>
              <Pressable
                style={[
                  styles.assignmentPickerOption,
                  assignmentPickerSelectedUid === null &&
                    styles.assignmentPickerOptionSelected,
                ]}
                onPress={() => setAssignmentPickerSelectedUid(null)}
                disabled={assignmentPickerSaving}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: assignmentPickerSelectedUid === null,
                }}
                accessibilityLabel="Unassigned"
              >
                <Text style={styles.assignmentPickerOptionTitle}>
                  Unassigned
                </Text>
                <Text style={styles.assignmentPickerSelectionText}>
                  {assignmentPickerSelectedUid === null ? "✓ Selected" : ""}
                </Text>
              </Pressable>

              {loadingBoardGroupMembers ? (
                <Text style={styles.assignmentPickerStatusText}>
                  Loading members…
                </Text>
              ) : boardGroupMembersError ? (
                <Text style={styles.assignmentPickerStatusText}>
                  {boardGroupMembersError}
                </Text>
              ) : assignmentPickerMembers.length === 0 ? (
                <Text style={styles.assignmentPickerStatusText}>
                  No active group members are available.
                </Text>
              ) : (
                assignmentPickerMembers.map((member) => {
                  const memberLabel = getBoardMemberLabel(member.uid);
                  const isSelected =
                    assignmentPickerSelectedUid === member.uid;
                  const showEmail =
                    !!member.email && member.email !== memberLabel;

                  return (
                    <Pressable
                      key={member.uid}
                      style={[
                        styles.assignmentPickerOption,
                        isSelected && styles.assignmentPickerOptionSelected,
                      ]}
                      onPress={() =>
                        setAssignmentPickerSelectedUid(member.uid)
                      }
                      disabled={assignmentPickerSaving}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Assign to ${memberLabel}`}
                    >
                      <View style={styles.assignmentPickerOptionIdentity}>
                        <Text style={styles.assignmentPickerOptionTitle}>
                          {memberLabel}
                        </Text>
                        <Text style={styles.assignmentPickerOptionMeta}>
                          {[showEmail ? member.email : null, getGroupRoleLabel(member.role)]
                            .filter(Boolean)
                            .join(" • ")}
                        </Text>
                      </View>
                      <Text style={styles.assignmentPickerSelectionText}>
                        {isSelected ? "✓ Selected" : ""}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.assignmentPickerFooter}>
              <Pressable
                style={styles.secondaryButton}
                onPress={closeAssignmentPicker}
                disabled={assignmentPickerSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel assignment selection"
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  !canSaveAssignmentPicker && styles.buttonDisabled,
                ]}
                onPress={handleSaveCardAssignment}
                disabled={!canSaveAssignmentPicker}
                accessibilityRole="button"
                accessibilityLabel="Save card assignment"
                accessibilityState={{ disabled: !canSaveAssignmentPicker }}
              >
                <Text style={styles.buttonText}>
                  {assignmentPickerSaving ? "Saving…" : "Save assignment"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {canCreateBoardCards ? (
      <Modal
        visible={showLinkedWorkPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLinkedWorkPicker(false)}
      >
        <View style={styles.linkedPickerBackdrop}>
          <View style={styles.linkedPickerModal}>
            <View style={styles.linkedPickerHeader}>
              <Text style={styles.linkedPickerTitle}>Choose existing work</Text>
              <Pressable
                style={styles.linkedPickerCloseButton}
                onPress={() => setShowLinkedWorkPicker(false)}
              >
                <Text style={styles.linkedPickerCloseButtonText}>Close</Text>
              </Pressable>
            </View>
            {isGroupBoard ? (
              <Text style={styles.linkedWorkEmptyText}>
                Showing goals, milestones, and subtasks shared with{" "}
                {boardGroupName ?? "this group"}.
              </Text>
            ) : null}

            <TextInput
              value={linkedWorkSearchInput}
              onChangeText={setLinkedWorkSearchInput}
              placeholder="Search goals, milestones, and subtasks"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.linkedPickerSearchInput}
            />

            <View style={styles.linkedPickerFilterRow}>
              {[
                ["all", "All"],
                ["goal", "Goals"],
                ["milestone", "Milestones"],
                ["subtask", "Subtasks"],
              ].map(([filter, label]) => (
                <Pressable
                  key={filter}
                  style={[
                    styles.linkedPickerFilterPill,
                    linkedWorkFilter === filter &&
                      styles.linkedPickerFilterPillActive,
                  ]}
                  onPress={() => setLinkedWorkFilter(filter as LinkedWorkFilter)}
                >
                  <Text style={styles.linkedPickerFilterText}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <ScrollView style={styles.linkedPickerResults}>
              {filteredLinkedWorkResults.length > 0 ? (
                filteredLinkedWorkResults.map((item) => (
                  <Pressable
                    key={`${item.type}:${item.key}`}
                    style={styles.linkedPickerResultRow}
                    onPress={() => handleSelectLinkedWorkResult(item)}
                  >
                    <Text style={styles.linkedPickerResultTitle}>
                      {item.title}
                    </Text>
                    <Text style={styles.linkedPickerResultMeta}>
                      {item.meta}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.linkedPickerEmptyText}>
                  {isGroupBoard && linkableGoals.length === 0
                    ? "No shared goals, milestones, or subtasks are available for this group yet."
                    : "No matching work found."}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      ) : null}

      {cardsLoadedOnce ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={styles.kanbanScroll}
        contentContainerStyle={styles.kanbanContent}
      >
        {sortedColumns.map((column) => {
          const columnCards = cardsByColumn[column.id] ?? [];

          return (
            <View
              key={column.id}
              style={[styles.kanbanColumn, { width: kanbanColumnWidth }]}
            >
              <View style={styles.kanbanColumnHeader}>
                <Text style={styles.kanbanColumnTitle}>{column.title}</Text>
                <Text style={styles.kanbanColumnCount}>
                  {columnCards.length}
                </Text>
              </View>
            {columnCards.length === 0 ? (
              <Text style={styles.muted}>No cards here yet.</Text>
            ) : (
              columnCards.map((card) => {
                const meta = formatCardMeta(card);
                const linkedGoal =
                  card.linkedItemType === "goal" && card.linkedItemId
                    ? linkableGoals.find(
                        (goal) => goal.id === card.linkedItemId
                      ) ?? null
                    : null;
                const linkedMilestone =
                  card.linkedItemType === "milestone" && card.linkedItemId
                    ? linkableMilestones.find(
                        (milestone) => milestone.id === card.linkedItemId
                      ) ?? null
                    : null;
                const linkedSubtask =
                  card.linkedItemType === "subtask" && card.linkedItemId
                    ? linkableSubtasks.find(
                        (subtask) => subtask.id === card.linkedItemId
                      ) ?? null
                    : null;
                const hasUnresolvedLinkedParent =
                  (card.linkedItemType === "goal" &&
                    !!card.linkedItemId &&
                    !linkedGoal) ||
                  (card.linkedItemType === "milestone" &&
                    !!card.linkedItemId &&
                    !linkedMilestone) ||
                  (card.linkedItemType === "subtask" &&
                    !!card.linkedItemId &&
                    !linkedSubtask);
                 const canMoveThisCard = canMoveBoardCard(card);
                 const canArchiveThisCard = canArchiveBoardCard(card);
                 const canAssignThisCard = canManageCardAssignments;
                 const pendingMutation = pendingCardMutations[card.id] ?? null;
                 const cardMutationPending = pendingMutation != null;
                const hasLinkedGoalAction =
                  card.linkedItemType === "goal" && !!linkedGoal;
                const hasLinkedMilestoneAction =
                  card.linkedItemType === "milestone" && !!linkedMilestone;
                const hasLinkedSubtaskAction =
                  card.linkedItemType === "subtask" && !!linkedSubtask;
                const hasVisibleCardActions =
                  canMoveThisCard ||
                  canArchiveThisCard ||
                  canAssignThisCard ||
                  hasLinkedGoalAction ||
                  hasLinkedMilestoneAction ||
                  hasLinkedSubtaskAction;
                const createdByLabel = getBoardCardCreatorLabel(card);
                const assigneeLabel = getBoardCardAssigneeLabel(card);
                const permissionReason = getBoardCardPermissionReason(card);
                const assignedToCurrentUser =
                  isBoardCardAssignedToCurrentUser(card);
                const showCardContext = isGroupBoard || !!card.assignedToUid;

                return (
                  <View key={card.id} style={styles.boardCard}>
                    <Text style={styles.boardCardTitle}>{card.title}</Text>
                    <View style={styles.linkedBadge}>
                      <Text style={styles.linkedBadgeText}>
                        {card.linkedItemType === "subtask"
                          ? "Linked subtask"
                          : card.linkedItemType === "milestone"
                          ? "Linked milestone"
                          : card.linkedItemType === "goal"
                          ? "Linked goal"
                          : "Standalone"}
                      </Text>
                    </View>
                    {isGroupBoard && assignedToCurrentUser ? (
                      <View style={styles.boardCardAssignmentBadge}>
                        <Text style={styles.boardCardAssignmentBadgeText}>
                          Assigned to me
                        </Text>
                      </View>
                    ) : null}
                    {card.description ? (
                      <Text style={styles.boardCardDescription}>
                        {card.description}
                      </Text>
                    ) : null}
                    {meta ? (
                      <Text style={styles.boardCardMeta}>{meta}</Text>
                    ) : null}
                    {hasUnresolvedLinkedParent ? (
                      <Text style={styles.helper}>
                        Linked item exists, but parent goal is not loaded.
                      </Text>
                    ) : null}
                    {showCardContext ? (
                      <View style={styles.boardCardContext}>
                        {isGroupBoard ? (
                          <Text style={styles.boardCardContextText}>
                            Created by {createdByLabel}
                          </Text>
                        ) : null}
                        <Text style={styles.boardCardContextText}>
                          Assigned to {assigneeLabel}
                        </Text>
                        {permissionReason ? (
                          <Text style={styles.boardCardPermissionReason}>
                            {permissionReason}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {hasVisibleCardActions ? (
                    <View style={styles.cardActionRow}>
                      {canAssignThisCard ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.chipButton,
                            pressed && styles.actionPressed,
                            cardMutationPending && styles.buttonDisabled,
                          ]}
                          onPress={() => openAssignmentPicker(card)}
                          disabled={cardMutationPending}
                          accessibilityRole="button"
                          accessibilityLabel={
                            card.assignedToUid
                              ? `Change assignment for ${card.title}`
                              : `Assign ${card.title}`
                          }
                          accessibilityState={{
                            disabled: cardMutationPending,
                            busy: pendingMutation?.kind === "assign",
                          }}
                        >
                          <Text style={styles.chipButtonText}>
                            {pendingMutation?.kind === "assign"
                              ? "Saving assignment…"
                              : card.assignedToUid
                              ? "Change assignment"
                              : "Assign card"}
                          </Text>
                        </Pressable>
                      ) : null}

                      {canMoveThisCard ? sortedColumns
                        .filter((targetColumn) => targetColumn.id !== column.id)
                        .map((targetColumn) => (
                          <Pressable
                            key={targetColumn.id}
                            style={({ pressed }) => [
                              styles.chipButton,
                              pressed && styles.actionPressed,
                              cardMutationPending && styles.buttonDisabled,
                            ]}
                            onPress={() =>
                              handleMoveCard(card, targetColumn.id)
                            }
                            disabled={cardMutationPending}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${card.title} to ${targetColumn.title}`}
                            accessibilityState={{
                              disabled: cardMutationPending,
                              busy:
                                pendingMutation?.kind === "move" &&
                                pendingMutation.targetColumnId === targetColumn.id,
                            }}
                          >
                            <Text style={styles.chipButtonText}>
                              {pendingMutation?.kind === "move" &&
                              pendingMutation.targetColumnId === targetColumn.id
                                ? "Moving…"
                                : `→ ${targetColumn.title}`}
                            </Text>
                          </Pressable>
                        )) : null}

                      {hasLinkedGoalAction ? (
                        <Pressable
                          style={styles.chipButton}
                          onPress={() =>
                            router.push({
                              pathname: "/goal/[id]",
                              params: { id: linkedGoal!.id },
                            })
                          }
                        >
                          <Text style={styles.chipButtonText}>Open parent goal</Text>
                        </Pressable>
                      ) : null}

                      {hasLinkedMilestoneAction ? (
                        <Pressable
                          style={styles.chipButton}
                          onPress={() =>
                            router.push({
                              pathname: "/goal/[id]",
                              params: { id: linkedMilestone!.goalId },
                            })
                          }
                        >
                          <Text style={styles.chipButtonText}>Open parent goal</Text>
                        </Pressable>
                      ) : null}

                      {hasLinkedSubtaskAction ? (
                        <Pressable
                          style={styles.chipButton}
                          onPress={() =>
                            router.push({
                              pathname: "/goal/[id]",
                              params: { id: linkedSubtask!.goalId },
                            })
                          }
                        >
                          <Text style={styles.chipButtonText}>Open goal</Text>
                        </Pressable>
                      ) : null}

                      {canArchiveThisCard ? (
                      <Pressable
                        style={({ pressed }) => [
                          styles.archiveButton,
                          pressed && styles.actionPressed,
                          cardMutationPending && styles.buttonDisabled,
                        ]}
                        onPress={() => handleArchiveCard(card)}
                        disabled={cardMutationPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Archive ${card.title}`}
                        accessibilityState={{
                          disabled: cardMutationPending,
                          busy: pendingMutation?.kind === "archive",
                        }}
                      >
                        <Text style={styles.archiveButtonText}>
                          {pendingMutation?.kind === "archive"
                            ? "Archiving…"
                            : "Archive"}
                        </Text>
                      </Pressable>
                      ) : null}
                    </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        );
        })}
      </ScrollView>
      ) : null}

      <View style={styles.archivedSection}>
        <Pressable
          style={({ pressed }) => [
            styles.archivedToggle,
            pressed && styles.actionPressed,
          ]}
          onPress={() => {
            configureBoardLayoutAnimation();
            setShowArchivedCards((prev) => !prev);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${showArchivedCards ? "Hide" : "Show"} archived cards`}
          accessibilityState={{ expanded: showArchivedCards }}
        >
          <Text style={styles.archivedToggleText}>
            Archived cards ({archivedCards.length})
          </Text>
        </Pressable>

        {showArchivedCards ? (
          <>
          {archivedCardsLoadError ? (
            <View accessibilityRole="alert" style={styles.listenerErrorCard}>
              <Text style={styles.listenerErrorTitle}>
                Archived cards couldn’t be refreshed
              </Text>
              <Text style={styles.listenerErrorText}>
                {archivedCardsLoadedOnce
                  ? "The last available archived cards are still shown below."
                  : "Archived card data could not be loaded."}
              </Text>
            </View>
          ) : null}
          {!archivedCardsLoadedOnce ? (
            archivedCardsLoadError ? null : (
              <Text style={styles.muted}>Loading archived cards…</Text>
            )
          ) : archivedCards.length === 0 ? (
            archivedCardsLoadError ? null : (
              <Text style={styles.muted}>No archived cards.</Text>
            )
          ) : (
            archivedCards.map((card) => {
              const canRestoreThisCard = canRestoreBoardCard(card);
              const createdByLabel = getBoardCardCreatorLabel(card);
              const assigneeLabel = getBoardCardAssigneeLabel(card);
              const assignedToCurrentUser =
                isBoardCardAssignedToCurrentUser(card);
              const showCardContext = isGroupBoard || !!card.assignedToUid;
              const pendingMutation = pendingCardMutations[card.id] ?? null;
              const cardMutationPending = pendingMutation != null;

              return (
              <View key={card.id} style={styles.archivedCard}>
                <Text style={styles.boardCardTitle}>{card.title}</Text>
                <View style={styles.linkedBadge}>
                  <Text style={styles.linkedBadgeText}>
                    {card.linkedItemType === "subtask"
                      ? "Linked subtask"
                      : card.linkedItemType === "milestone"
                      ? "Linked milestone"
                      : card.linkedItemType === "goal"
                      ? "Linked goal"
                      : "Standalone"}
                  </Text>
                </View>
                {isGroupBoard && assignedToCurrentUser ? (
                  <View style={styles.boardCardAssignmentBadge}>
                    <Text style={styles.boardCardAssignmentBadgeText}>
                      Assigned to me
                    </Text>
                  </View>
                ) : null}

                {card.description ? (
                  <Text style={styles.boardCardDescription}>
                    {card.description}
                  </Text>
                ) : null}
                {showCardContext ? (
                  <View style={styles.boardCardContext}>
                    {isGroupBoard ? (
                      <Text style={styles.boardCardContextText}>
                        Created by {createdByLabel}
                      </Text>
                    ) : null}
                    <Text style={styles.boardCardContextText}>
                      Assigned to {assigneeLabel}
                    </Text>
                  </View>
                ) : null}

                {canRestoreThisCard ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.restoreButton,
                    pressed && styles.actionPressed,
                    cardMutationPending && styles.buttonDisabled,
                  ]}
                  onPress={() => handleRestoreCard(card)}
                  disabled={cardMutationPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Restore ${card.title}`}
                  accessibilityState={{
                    disabled: cardMutationPending,
                    busy: pendingMutation?.kind === "restore",
                  }}
                >
                  <Text style={styles.restoreButtonText}>
                    {pendingMutation?.kind === "restore" ? "Restoring…" : "Restore"}
                  </Text>
                </Pressable>
                ) : (
                  <Text style={styles.archivedCardReadOnlyText}>Read only</Text>
                )}
              </View>
              );
            })
          )}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const makeStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
    container: {
      padding: 16,
      gap: 12,
      paddingBottom: 120,
      backgroundColor: theme.colors.background,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      backgroundColor: theme.colors.background,
    },

    title: {
      fontSize: 26,
      lineHeight: 31,
      fontWeight: "900",
      color: theme.colors.text,
    },

    muted: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textMuted,
    },

    helper: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.colors.textMuted,
    },

    boardContextMeta: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    boardContextWarning: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    boardPermissionMeta: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    boardPermissionWarning: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    boardReadOnlyNotice: {
      padding: 10,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    boardReadOnlyNoticeText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    boardCardFilterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    boardCardFilterPill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },

    boardCardFilterPillActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    boardCardFilterText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.textMuted,
    },

    boardCardFilterTextActive: {
      color: theme.colors.badgeText,
    },

    boardCardFilterEmptyText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    card: {
      padding: 14,
      borderRadius: UI_SIZES.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },

    cardTitle: {
      fontSize: 16,
      fontWeight: "900",
      color: theme.colors.text,
    },

    label: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    input: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.inputBackground,
      color: theme.colors.text,
    },

    multiline: {
      minHeight: 72,
      textAlignVertical: "top",
    },

    button: {
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: UI_SIZES.radius.xl,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.primaryStrong,
      backgroundColor: theme.colors.primary,
    },

    buttonDisabled: {
      opacity: 0.6,
    },

    actionPressed: {
      opacity: 0.82,
    },

    listenerErrorCard: {
      padding: UI_SIZES.cardPadding.sm,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.warningBorder,
      backgroundColor: theme.colors.warningBackground,
      gap: UI_SIZES.spacing.xs,
    },

    listenerErrorTitle: {
      color: theme.colors.warningText,
      fontSize: 13,
      fontWeight: "900",
    },

    listenerErrorText: {
      color: theme.colors.warningText,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
    },

    buttonText: {
      fontSize: 14,
      fontWeight: "900",
      color: theme.colors.primaryText,
    },

    secondaryButton: {
      alignSelf: "flex-start",
      minHeight: 38,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: UI_SIZES.radius.xl,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },

    secondaryButtonText: {
      fontSize: 13,
      fontWeight: "900",
      color: theme.colors.text,
    },

    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    pill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    pillActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    pillText: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.colors.text,
    },

    linkedPickerButton: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    linkedPickerButtonText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    linkedWorkLoadingText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    linkedWorkErrorText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    linkedWorkEmptyText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    selectedLinkedWorkCard: {
      padding: 10,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      gap: 5,
    },

    selectedLinkedWorkText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "900",
      color: theme.colors.text,
    },

    selectedLinkedWorkMeta: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    clearLinkedWorkButton: {
      alignSelf: "flex-start",
      paddingVertical: 4,
    },

    clearLinkedWorkButtonText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    linkedPickerBackdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },

    linkedPickerModal: {
      width: "100%",
      maxWidth: 640,
      maxHeight: "80%",
      padding: 14,
      borderRadius: UI_SIZES.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 12,
    },

    assignmentPickerModal: {
      width: "100%",
      maxWidth: 560,
      maxHeight: "80%",
      padding: 14,
      borderRadius: UI_SIZES.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 12,
    },

    assignmentPickerHeading: {
      flex: 1,
      gap: 3,
    },

    assignmentPickerCardTitle: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    assignmentPickerCurrentText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "900",
      color: theme.colors.text,
    },

    assignmentPickerHelpText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    assignmentPickerFormerRow: {
      padding: 10,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      gap: 3,
    },

    assignmentPickerResults: {
      width: "100%",
    },

    assignmentPickerOption: {
      minHeight: 52,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },

    assignmentPickerOptionSelected: {
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    assignmentPickerOptionIdentity: {
      flex: 1,
      gap: 3,
    },

    assignmentPickerOptionTitle: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "900",
      color: theme.colors.text,
    },

    assignmentPickerOptionMeta: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    assignmentPickerSelectionText: {
      minWidth: 72,
      textAlign: "right",
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    assignmentPickerStatusText: {
      paddingVertical: 24,
      textAlign: "center",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    assignmentPickerFooter: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 8,
    },

    linkedPickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },

    linkedPickerTitle: {
      flex: 1,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "900",
      color: theme.colors.text,
    },

    linkedPickerSearchInput: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.inputBackground,
      color: theme.colors.text,
    },

    linkedPickerFilterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },

    linkedPickerFilterPill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    linkedPickerFilterPillActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    linkedPickerFilterText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.text,
    },

    linkedPickerResults: {
      width: "100%",
    },

    linkedPickerResultRow: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: 3,
    },

    linkedPickerResultTitle: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "900",
      color: theme.colors.text,
    },

    linkedPickerResultMeta: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    linkedPickerEmptyText: {
      paddingVertical: 24,
      textAlign: "center",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    linkedPickerCloseButton: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    linkedPickerCloseButtonText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    kanbanScroll: {
      width: "100%",
    },

    kanbanContent: {
      gap: 12,
      paddingBottom: 8,
    },

    kanbanColumn: {
      padding: 14,
      borderRadius: UI_SIZES.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      gap: 10,
      paddingBottom: 18,
    },

    kanbanColumnHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },

    kanbanColumnTitle: {
      flex: 1,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "900",
      color: theme.colors.text,
    },

    kanbanColumnCount: {
      minWidth: 28,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: UI_SIZES.radius.xl,
      overflow: "hidden",
      textAlign: "center",
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.badgeText,
      backgroundColor: theme.colors.badge,
    },

    boardCard: {
      width: "100%",
      padding: 12,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 6,
    },

    boardCardTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "900",
      color: theme.colors.text,
    },

    linkedBadge: {
      alignSelf: "flex-start",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    linkedBadgeText: {
      fontSize: 11,
      fontWeight: "900",
      color: theme.colors.badgeText,
    },

    boardCardAssignmentBadge: {
      alignSelf: "flex-start",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    boardCardAssignmentBadgeText: {
      fontSize: 11,
      fontWeight: "900",
      color: theme.colors.text,
    },

    boardCardDescription: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textMuted,
    },

    boardCardMeta: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textTransform: "capitalize",
    },

    boardCardContext: {
      gap: 2,
      paddingTop: 2,
    },

    boardCardContextText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    boardCardPermissionReason: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },

    cardActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },

    chipButton: {
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    chipButtonText: {
      fontSize: 11,
      fontWeight: "900",
      color: theme.colors.primary,
    },

    archiveButton: {
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },

    archiveButtonText: {
      fontSize: 11,
      fontWeight: "900",
      color: theme.colors.textMuted,
    },

    archivedSection: {
      padding: 14,
      borderRadius: UI_SIZES.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 10,
    },

    archivedToggle: {
      alignSelf: "flex-start",
      minHeight: 38,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: UI_SIZES.radius.xl,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },

    archivedToggleText: {
      fontSize: 13,
      fontWeight: "900",
      color: theme.colors.text,
    },

    archivedCard: {
      padding: 12,
      borderRadius: UI_SIZES.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      gap: 6,
    },

    restoreButton: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: UI_SIZES.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.badge,
    },

    restoreButtonText: {
      fontSize: 12,
      fontWeight: "900",
      color: theme.colors.badgeText,
    },

    archivedCardReadOnlyText: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },
  });
