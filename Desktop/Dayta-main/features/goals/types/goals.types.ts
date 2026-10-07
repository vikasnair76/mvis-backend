import type { Goal, GoalFormInput, MetricType } from "../../../services/goalTypes";
import type { GroupMemberDoc } from "../../../services/groups";
import type { PlanningBoardDoc } from "../../../services/boards";

export type { Goal, GoalFormInput, MetricType, GroupMemberDoc, PlanningBoardDoc };

export type ActiveGroupMembership = GroupMemberDoc & {
  groupId: string;
};

export type GroupPlanningBoard = PlanningBoardDoc & {
  groupName: string;
};
