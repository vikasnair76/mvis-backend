import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase";
import { subscribeMyGroupMemberships } from "../../../services/groups";
import type { ActiveGroupMembership, Goal } from "../types/goals.types";

export function useGoals(uid: string | null, authReady: boolean) {
  const [ownedGoals, setOwnedGoals] = useState<Goal[]>([]);
  const [assignedSharedGoals, setAssignedSharedGoals] = useState<Goal[]>([]);
  const [activeGroupMemberships, setActiveGroupMemberships] = useState<
    ActiveGroupMembership[]
  >([]);
  const [loadingGroupMemberships, setLoadingGroupMemberships] = useState(true);
  const [groupMembershipsError, setGroupMembershipsError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Subscribe to owned goals
  useEffect(() => {
    if (!authReady) return;

    if (!uid) {
      setOwnedGoals([]);
      setLoading(false);
      return;
    }

    const goalsRef = collection(db, "goals");

    const q = query(
      goalsRef,
      where("userId", "==", uid),
      orderBy("createdAtMs", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Goal[] = snap.docs.map((d) => {
          const data = d.data() as Omit<Goal, "id">;
          return { id: d.id, ...data };
        });
        setOwnedGoals(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        Alert.alert("Error loading goals", err.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [authReady, uid]);

  // Subscribe to group memberships
  useEffect(() => {
    if (!authReady) return;

    if (!uid) {
      setActiveGroupMemberships([]);
      setLoadingGroupMemberships(false);
      setGroupMembershipsError(false);
      return;
    }

    setLoadingGroupMemberships(true);
    setGroupMembershipsError(false);

    return subscribeMyGroupMemberships(
      uid,
      (memberships) => {
        setActiveGroupMemberships(
          memberships.filter((membership) => membership.status === "active")
        );
        setLoadingGroupMemberships(false);
        setGroupMembershipsError(false);
      },
      (err) => {
        console.log("[Goals] group memberships subscription failed", err);
        setActiveGroupMemberships([]);
        setLoadingGroupMemberships(false);
        setGroupMembershipsError(true);
      }
    );
  }, [authReady, uid]);

  // Subscribe to assigned shared goals
  useEffect(() => {
    if (!authReady) return;

    if (!uid) {
      setAssignedSharedGoals([]);
      return;
    }

    const assignedById = new Map<string, Goal>();
    let childUnsubs: (() => void)[] = [];

    const emit = () => {
      setAssignedSharedGoals(Array.from(assignedById.values()));
    };

    const cleanupChildren = () => {
      childUnsubs.forEach((unsub) => unsub());
      childUnsubs = [];
      assignedById.clear();
      emit();
    };

    activeGroupMemberships.forEach((membership) => {
      const groupId = membership.groupId;
      const groupName = membership.groupName ?? null;

      const sharedGoalsQuery = query(
        collection(db, "groups", groupId, "sharedGoals"),
        where("status", "==", "active")
      );

      const unsubSharedGoals = onSnapshot(sharedGoalsQuery, (snap) => {
        snap.docs.forEach((sharedGoalDoc) => {
          const sharedData = sharedGoalDoc.data();
          const goalId = sharedGoalDoc.id;

          if (sharedData.ownerUserId === uid) {
            return;
          }

          const assignedSubtasksQuery = query(
            collection(db, "goals", goalId, "subtasks"),
            where("assignedToUid", "==", uid),
            limit(1)
          );

          const unsubAssignedSubtasks = onSnapshot(
            assignedSubtasksQuery,
            (assignedSnap) => {
              if (assignedSnap.empty) {
                assignedById.delete(goalId);
                emit();
                return;
              }

              const goalStatus =
                sharedData.goalStatus === "paused" ||
                sharedData.goalStatus === "completed"
                  ? sharedData.goalStatus
                  : "active";

              assignedById.set(goalId, {
                id: goalId,
                userId: sharedData.ownerUserId ?? "",
                title: sharedData.goalTitle ?? "Shared goal",
                description: sharedData.goalDescription ?? null,
                metricType: sharedData.metricType ?? "none",
                metricUnit: sharedData.metricUnit ?? null,
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
                status: goalStatus,
                completedAtMs:
                  typeof sharedData.completedAtMs === "number"
                    ? sharedData.completedAtMs
                    : null,
                createdAtMs:
                  typeof sharedData.sharedAtMs === "number"
                    ? sharedData.sharedAtMs
                    : 0,
                visibility: "group_shared",
                sharedGroupIds: [groupId],
                sharedGroupId: groupId,
                sharedGroupName: groupName,
                sharedAccessRole: "assigned_member",
              });

              emit();
            }
          );

          childUnsubs.push(unsubAssignedSubtasks);
        });
      });

      childUnsubs.push(unsubSharedGoals);
    });

    return () => {
      cleanupChildren();
    };
  }, [activeGroupMemberships, authReady, uid]);

  // Combined and sorted goals
  const goals = useMemo(() => {
    const byId = new Map<string, Goal>();

    ownedGoals.forEach((goal) => byId.set(goal.id, goal));
    assignedSharedGoals.forEach((goal) => {
      if (!byId.has(goal.id)) byId.set(goal.id, goal);
    });

    return Array.from(byId.values()).sort(
      (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)
    );
  }, [ownedGoals, assignedSharedGoals]);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status !== "completed"),
    [goals]
  );

  const completedGoals = useMemo(
    () =>
      goals
        .filter((g) => g.status === "completed")
        .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0)),
    [goals]
  );

  return {
    goals,
    activeGoals,
    completedGoals,
    loading,
    ownedGoals,
    assignedSharedGoals,
    activeGroupMemberships,
    loadingGroupMemberships,
    groupMembershipsError,
  };
}
