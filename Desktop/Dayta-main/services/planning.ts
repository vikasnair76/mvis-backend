import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export const PLANNING_ITEM_TYPES = [
  "goal",
  "milestone",
  "subtask",
  "board_card",
  "calendar_event",
  "routine",
  "planner_suggestion",
] as const;

export const PLANNING_STATUSES = [
  "idea",
  "backlog",
  "next",
  "active",
  "in_progress",
  "review",
  "completed",
  "archived",
] as const;

export const PLANNING_PRIORITIES = ["low", "medium", "high"] as const;

export const PLANNING_RELATIONS = [
  "belongs_to",
  "blocks",
  "depends_on",
  "related_to",
  "scheduled_for",
  "generated_from",
] as const;

export type PlanningItemType = (typeof PLANNING_ITEM_TYPES)[number];
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];
export type PlanningPriority = (typeof PLANNING_PRIORITIES)[number];
export type PlanningRelation = (typeof PLANNING_RELATIONS)[number];

export interface PlanningEntity {
  id: string;
  type: PlanningItemType;
  status: PlanningStatus;
  priority: PlanningPriority;
  createdAtMs: number;
  updatedAtMs: number;
  ownerUid?: string;
  groupId?: string;
  archived?: boolean;
}

export interface PlanningLink {
  id: string;
  sourceType: PlanningItemType;
  sourceId: string;
  targetType: PlanningItemType;
  targetId: string;
  relation: PlanningRelation;
  createdAtMs: number;
  updatedAtMs: number;
  createdByUid?: string | null;
  ownerUid?: string | null;
  groupId?: string | null;
  archived?: boolean;
}

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function labelFromValue(value: string): string {
  const label = value.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sanitizePlanningLinkPart(value: string): string {
  return value.trim().replace(/[\/\s]+/g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
}

function requireNonEmptyString(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return trimmed;
}

function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizePlanningItemType(
  value: unknown,
  fallback?: unknown
): PlanningItemType {
  if (isOneOf(PLANNING_ITEM_TYPES, value)) return value;
  if (isOneOf(PLANNING_ITEM_TYPES, fallback)) return fallback;
  return "goal";
}

export function normalizePlanningStatus(
  value: unknown,
  fallback?: unknown
): PlanningStatus {
  if (isOneOf(PLANNING_STATUSES, value)) return value;
  if (isOneOf(PLANNING_STATUSES, fallback)) return fallback;
  return "active";
}

export function normalizePlanningPriority(
  value: unknown,
  fallback?: unknown
): PlanningPriority {
  if (isOneOf(PLANNING_PRIORITIES, value)) return value;
  if (isOneOf(PLANNING_PRIORITIES, fallback)) return fallback;
  return "medium";
}

export function normalizePlanningRelation(
  value: unknown,
  fallback?: unknown
): PlanningRelation {
  if (isOneOf(PLANNING_RELATIONS, value)) return value;
  if (isOneOf(PLANNING_RELATIONS, fallback)) return fallback;
  return "related_to";
}

export function getPlanningItemTypeLabel(type: PlanningItemType): string {
  return labelFromValue(type);
}

export function getPlanningStatusLabel(status: PlanningStatus): string {
  return labelFromValue(status);
}

export function getPlanningPriorityLabel(priority: PlanningPriority): string {
  return labelFromValue(priority);
}

export function getPlanningRelationLabel(relation: PlanningRelation): string {
  return labelFromValue(relation);
}

export function isCompletedPlanningStatus(status: PlanningStatus): boolean {
  return status === "completed";
}

export function isActivePlanningStatus(status: PlanningStatus): boolean {
  return status === "active" || status === "in_progress";
}

export function isArchivedPlanningStatus(status: PlanningStatus): boolean {
  return status === "archived";
}

export function buildPlanningLinkId(
  sourceType: PlanningItemType,
  sourceId: string,
  relation: PlanningRelation,
  targetType: PlanningItemType,
  targetId: string
): string {
  return [
    sourceType,
    sourceId,
    relation,
    targetType,
    targetId,
  ]
    .map(sanitizePlanningLinkPart)
    .join("__");
}

export function mapPlanningLinkDoc(
  id: string,
  data: Record<string, any>
): PlanningLink {
  const createdAtMs =
    typeof data.createdAtMs === "number" ? data.createdAtMs : 0;
  const updatedAtMs =
    typeof data.updatedAtMs === "number" ? data.updatedAtMs : createdAtMs;

  return {
    id,
    sourceType: normalizePlanningItemType(data.sourceType),
    sourceId: typeof data.sourceId === "string" ? data.sourceId : "",
    targetType: normalizePlanningItemType(data.targetType),
    targetId: typeof data.targetId === "string" ? data.targetId : "",
    relation: normalizePlanningRelation(data.relation),
    createdAtMs,
    updatedAtMs,
    createdByUid: optionalStringOrNull(data.createdByUid),
    ownerUid: optionalStringOrNull(data.ownerUid),
    groupId: optionalStringOrNull(data.groupId),
    archived: data.archived === true,
  };
}

export async function createPlanningLink(params: {
  sourceType: PlanningItemType;
  sourceId: string;
  targetType: PlanningItemType;
  targetId: string;
  relation: PlanningRelation;
  createdByUid: string;
  ownerUid?: string | null;
  groupId?: string | null;
}): Promise<string> {
  const sourceId = requireNonEmptyString(params.sourceId, "Source ID");
  const targetId = requireNonEmptyString(params.targetId, "Target ID");
  const createdByUid = requireNonEmptyString(
    params.createdByUid,
    "Created by UID"
  );
  const ownerUid = optionalStringOrNull(params.ownerUid);
  const groupId = optionalStringOrNull(params.groupId);

  if (!ownerUid && !groupId) {
    throw new Error("Planning links require either an owner UID or group ID.");
  }

  const linkId = buildPlanningLinkId(
    params.sourceType,
    sourceId,
    params.relation,
    params.targetType,
    targetId
  );
  const nowMs = Date.now();

  await setDoc(
    doc(db, "planningLinks", linkId),
    {
      id: linkId,
      sourceType: params.sourceType,
      sourceId,
      targetType: params.targetType,
      targetId,
      relation: params.relation,
      createdByUid,
      ownerUid,
      groupId,
      archived: false,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return linkId;
}

export async function archivePlanningLink(linkId: string): Promise<void> {
  const safeLinkId = requireNonEmptyString(linkId, "Planning link ID");

  await updateDoc(doc(db, "planningLinks", safeLinkId), {
    archived: true,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function deletePlanningLink(linkId: string): Promise<void> {
  const safeLinkId = requireNonEmptyString(linkId, "Planning link ID");

  await deleteDoc(doc(db, "planningLinks", safeLinkId));
}

export function subscribePlanningLinksForOwner(
  ownerUid: string,
  onNext: (links: PlanningLink[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeOwnerUid = ownerUid.trim();
  if (!safeOwnerUid) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningLinks"),
    where("ownerUid", "==", safeOwnerUid),
    where("archived", "==", false),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningLinkDoc(d.id, d.data())));
    },
    onError
  );
}

export function subscribePlanningLinksForGroup(
  groupId: string,
  onNext: (links: PlanningLink[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGroupId = groupId.trim();
  if (!safeGroupId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningLinks"),
    where("groupId", "==", safeGroupId),
    where("archived", "==", false),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningLinkDoc(d.id, d.data())));
    },
    onError
  );
}
