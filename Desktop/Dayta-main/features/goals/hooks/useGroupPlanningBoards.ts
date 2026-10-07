import { useEffect, useState } from "react";
import {
  subscribeGroupPlanningBoards,
  type PlanningBoardDoc,
} from "../../../services/boards";
import type {
  ActiveGroupMembership,
  GroupPlanningBoard,
} from "../types/goals.types";

export function useGroupPlanningBoards(
  uid: string | null,
  authReady: boolean,
  activeGroupMemberships: ActiveGroupMembership[],
  loadingGroupMemberships: boolean,
  groupMembershipsError: boolean
) {
  const [groupPlanningBoards, setGroupPlanningBoards] = useState<
    GroupPlanningBoard[]
  >([]);
  const [loadingGroupPlanning, setLoadingGroupPlanning] = useState(false);
  const [groupPlanningError, setGroupPlanningError] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!authReady || !uid) {
      setGroupPlanningBoards([]);
      setLoadingGroupPlanning(false);
      setGroupPlanningError(null);
      return;
    }

    if (loadingGroupMemberships) {
      setGroupPlanningBoards([]);
      setLoadingGroupPlanning(true);
      setGroupPlanningError(null);
      return;
    }

    if (activeGroupMemberships.length === 0) {
      setGroupPlanningBoards([]);
      setLoadingGroupPlanning(false);
      setGroupPlanningError(
        groupMembershipsError ? "Unable to load group boards right now." : null
      );
      return;
    }

    const boardsByGroup = new Map<string, PlanningBoardDoc[]>();
    const failedGroupIds = new Set<string>();
    const pendingGroupIds = new Set(
      activeGroupMemberships.map((membership) => membership.groupId)
    );

    setGroupPlanningBoards([]);
    setLoadingGroupPlanning(true);
    setGroupPlanningError(null);

    const emit = () => {
      const deduped = new Map<string, GroupPlanningBoard>();

      activeGroupMemberships.forEach((membership) => {
        const groupName = membership.groupName?.trim() || "Group board";
        (boardsByGroup.get(membership.groupId) ?? []).forEach((board) => {
          deduped.set(board.id, { ...board, groupName });
        });
      });

      setGroupPlanningBoards(
        Array.from(deduped.values()).sort(
          (a, b) =>
            b.updatedAtMs - a.updatedAtMs ||
            a.groupName.localeCompare(b.groupName) ||
            a.title.localeCompare(b.title)
        )
      );
      setLoadingGroupPlanning(pendingGroupIds.size > 0);
      setGroupPlanningError(
        failedGroupIds.size > 0
          ? "Unable to load some group boards right now."
          : null
      );
    };

    const unsubs = activeGroupMemberships.map((membership) =>
      subscribeGroupPlanningBoards(
        membership.groupId,
        (boards) => {
          boardsByGroup.set(membership.groupId, boards);
          failedGroupIds.delete(membership.groupId);
          pendingGroupIds.delete(membership.groupId);
          emit();
        },
        (err) => {
          console.log("[Goals] group planning boards subscription failed", {
            groupId: membership.groupId,
            error: err,
          });
          boardsByGroup.delete(membership.groupId);
          failedGroupIds.add(membership.groupId);
          pendingGroupIds.delete(membership.groupId);
          emit();
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [
    activeGroupMemberships,
    authReady,
    groupMembershipsError,
    loadingGroupMemberships,
    uid,
  ]);

  return {
    groupPlanningBoards,
    loadingGroupPlanning,
    groupPlanningError,
  };
}
