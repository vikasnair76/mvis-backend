import {
  collection,
  deleteDoc,
  doc,
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
import {
  PlanningItemType,
  PlanningPriority,
  PlanningStatus,
  normalizePlanningItemType,
  normalizePlanningPriority,
  normalizePlanningStatus,
} from "./planning";

export type PlanningBoardScope = "personal" | "group";

export type PlanningBoardColumnId =
  | "ideas"
  | "next"
  | "active"
  | "completed"
  | "backlog"
  | "in_progress"
  | "review"
  | "done";

export type PlanningBoardColumn = {
  id: PlanningBoardColumnId;
  title: string;
  sortOrder: number;
};

export type PlanningBoardDoc = {
  id: string;
  title: string;
  scope: PlanningBoardScope;
  ownerUid?: string | null;
  groupId?: string | null;
  columns: PlanningBoardColumn[];
  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
  archived?: boolean;
};

export type PlanningBoardCardDoc = {
  id: string;
  boardId: string;
  title: string;
  description?: string | null;
  columnId: PlanningBoardColumnId;
  sortOrder: number;

  linkedItemType?: PlanningItemType | null;
  linkedItemId?: string | null;

  status?: PlanningStatus | null;
  priority?: PlanningPriority | null;
  dueAtMs?: number | null;

  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;

  ownerUid?: string | null;
  groupId?: string | null;

  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
  archived?: boolean;
};

export type AssignPlanningBoardCardInput = {
  boardId: string;
  cardId: string;
  assignedToUid: string;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
};

export type UnassignPlanningBoardCardInput = {
  boardId: string;
  cardId: string;
};

export const PERSONAL_BOARD_COLUMNS: PlanningBoardColumn[] = [
  { id: "ideas", title: "Ideas", sortOrder: 0 },
  { id: "next", title: "Next", sortOrder: 1 },
  { id: "active", title: "Active", sortOrder: 2 },
  { id: "completed", title: "Completed", sortOrder: 3 },
];

export const GROUP_BOARD_COLUMNS: PlanningBoardColumn[] = [
  { id: "backlog", title: "Backlog", sortOrder: 0 },
  { id: "in_progress", title: "In Progress", sortOrder: 1 },
  { id: "review", title: "Review", sortOrder: 2 },
  { id: "done", title: "Done", sortOrder: 3 },
];

const BOARD_COLUMN_IDS: PlanningBoardColumnId[] = [
  "ideas",
  "next",
  "active",
  "completed",
  "backlog",
  "in_progress",
  "review",
  "done",
];

function requireNonEmptyString(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return trimmed;
}

function normalizeBoardTitle(value: string): string {
  const title = requireNonEmptyString(value, "Board title");
  if (title.length > 120) {
    throw new Error("Board title must be 120 characters or fewer.");
  }
  return title;
}

function normalizeBoardCardTitle(value: string): string {
  const title = requireNonEmptyString(value, "Board card title");
  if (title.length > 160) {
    throw new Error("Board card title must be 160 characters or fewer.");
  }
  return title;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  fieldLabel: string
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldLabel} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) {
    throw new Error("Number fields must be finite.");
  }
  return value;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBoardColumnTitle(id: PlanningBoardColumnId): string {
  switch (id) {
    case "ideas":
      return "Ideas";
    case "next":
      return "Next";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "backlog":
      return "Backlog";
    case "in_progress":
      return "In Progress";
    case "review":
      return "Review";
    case "done":
      return "Done";
  }
}

function normalizeBoardColumn(column: unknown, fallbackSortOrder: number) {
  const raw =
    column && typeof column === "object"
      ? (column as Record<string, any>)
      : {};

  const id = normalizeBoardColumnId(raw.id);

  return {
    id,
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : getBoardColumnTitle(id),
    sortOrder: numberOrFallback(raw.sortOrder, fallbackSortOrder),
  };
}

export function normalizeBoardScope(value: unknown): PlanningBoardScope {
  return value === "group" ? "group" : "personal";
}

export function normalizeBoardColumnId(
  value: unknown,
  fallback?: unknown
): PlanningBoardColumnId {
  if (typeof value === "string" && BOARD_COLUMN_IDS.includes(value as PlanningBoardColumnId)) {
    return value as PlanningBoardColumnId;
  }
  if (typeof fallback === "string" && BOARD_COLUMN_IDS.includes(fallback as PlanningBoardColumnId)) {
    return fallback as PlanningBoardColumnId;
  }
  return "ideas";
}

export function getDefaultBoardColumns(
  scope: PlanningBoardScope
): PlanningBoardColumn[] {
  const columns = scope === "group" ? GROUP_BOARD_COLUMNS : PERSONAL_BOARD_COLUMNS;
  return columns.map((column) => ({ ...column }));
}

export function mapPlanningBoardDoc(
  id: string,
  data: Record<string, any>
): PlanningBoardDoc {
  const scope = normalizeBoardScope(data.scope);
  const createdAtMs = numberOrFallback(data.createdAtMs, 0);
  const updatedAtMs = numberOrFallback(data.updatedAtMs, createdAtMs);
  const columns = Array.isArray(data.columns) && data.columns.length > 0
    ? data.columns.map((column, index) => normalizeBoardColumn(column, index))
    : getDefaultBoardColumns(scope);

  return {
    id,
    title: typeof data.title === "string" ? data.title : "",
    scope,
    ownerUid: optionalStringOrNull(data.ownerUid),
    groupId: optionalStringOrNull(data.groupId),
    columns,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAtMs,
    updatedAtMs,
    archived: data.archived === true,
  };
}

export function mapPlanningBoardCardDoc(
  id: string,
  data: Record<string, any>
): PlanningBoardCardDoc {
  const createdAtMs = numberOrFallback(data.createdAtMs, 0);
  const updatedAtMs = numberOrFallback(data.updatedAtMs, createdAtMs);

  return {
    id,
    boardId: typeof data.boardId === "string" ? data.boardId : "",
    title: typeof data.title === "string" ? data.title : "",
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description
        : null,
    columnId: normalizeBoardColumnId(data.columnId),
    sortOrder: numberOrFallback(data.sortOrder, createdAtMs),
    linkedItemType:
      data.linkedItemType == null
        ? null
        : normalizePlanningItemType(data.linkedItemType),
    linkedItemId: optionalStringOrNull(data.linkedItemId),
    status: data.status == null ? null : normalizePlanningStatus(data.status),
    priority:
      data.priority == null ? null : normalizePlanningPriority(data.priority),
    dueAtMs: numberOrNull(data.dueAtMs),
    assignedToUid: optionalStringOrNull(data.assignedToUid),
    assignedToName: optionalStringOrNull(data.assignedToName),
    assignedToEmail: optionalStringOrNull(data.assignedToEmail),
    ownerUid: optionalStringOrNull(data.ownerUid),
    groupId: optionalStringOrNull(data.groupId),
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAtMs,
    updatedAtMs,
    archived: data.archived === true,
  };
}

export async function createPlanningBoard(params: {
  title: string;
  scope: PlanningBoardScope;
  createdByUid: string;
  ownerUid?: string | null;
  groupId?: string | null;
}): Promise<string> {
  const title = normalizeBoardTitle(params.title);
  const scope = normalizeBoardScope(params.scope);
  const createdByUid = requireNonEmptyString(
    params.createdByUid,
    "Created by UID"
  );
  const ownerUid = optionalStringOrNull(params.ownerUid);
  const groupId = optionalStringOrNull(params.groupId);

  if (scope === "personal" && !ownerUid) {
    throw new Error("Personal planning boards require an owner UID.");
  }
  if (scope === "group" && !groupId) {
    throw new Error("Group planning boards require a group ID.");
  }

  const boardRef = doc(collection(db, "planningBoards"));
  const nowMs = Date.now();

  await setDoc(boardRef, {
    id: boardRef.id,
    title,
    scope,
ownerUid: scope === "personal" ? ownerUid : null,
groupId: scope === "group" ? groupId : null,
    columns: getDefaultBoardColumns(scope),
    createdByUid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return boardRef.id;
}

export async function updatePlanningBoard(params: {
  boardId: string;
  title?: string;
  columns?: PlanningBoardColumn[];
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };

  if (params.title !== undefined) {
    patch.title = normalizeBoardTitle(params.title);
  }
  if (params.columns !== undefined) {
    patch.columns = params.columns.map((column, index) =>
      normalizeBoardColumn(column, index)
    );
  }

  await updateDoc(doc(db, "planningBoards", boardId), patch);
}

export async function archivePlanningBoard(params: {
  boardId: string;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");

  await updateDoc(doc(db, "planningBoards", boardId), {
    archived: true,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function deletePlanningBoard(params: {
  boardId: string;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");

  await deleteDoc(doc(db, "planningBoards", boardId));
}

export async function createPlanningBoardCard(params: {
  boardId: string;
  title: string;
  description?: string | null;
  columnId: PlanningBoardColumnId;
  createdByUid: string;
  ownerUid?: string | null;
  groupId?: string | null;
  linkedItemType?: PlanningItemType | null;
  linkedItemId?: string | null;
  status?: PlanningStatus | null;
  priority?: PlanningPriority | null;
  dueAtMs?: number | null;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
}): Promise<string> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const title = normalizeBoardCardTitle(params.title);
  const description = normalizeOptionalText(
    params.description,
    1000,
    "Board card description"
  );
  const createdByUid = requireNonEmptyString(
    params.createdByUid,
    "Created by UID"
  );
  const nowMs = Date.now();
  const cardRef = doc(collection(db, "planningBoards", boardId, "cards"));

  await setDoc(cardRef, {
    id: cardRef.id,
    boardId,
    title,
    description,
    columnId: normalizeBoardColumnId(params.columnId),
    sortOrder: nowMs,
    linkedItemType:
      params.linkedItemType == null
        ? null
        : normalizePlanningItemType(params.linkedItemType),
    linkedItemId: optionalStringOrNull(params.linkedItemId),
    status: params.status == null ? null : normalizePlanningStatus(params.status),
    priority:
      params.priority == null ? null : normalizePlanningPriority(params.priority),
    dueAtMs: nullableFiniteNumber(params.dueAtMs),
    assignedToUid: optionalStringOrNull(params.assignedToUid),
    assignedToName: optionalStringOrNull(params.assignedToName),
    assignedToEmail: optionalStringOrNull(params.assignedToEmail),
    ownerUid: optionalStringOrNull(params.ownerUid),
    groupId: optionalStringOrNull(params.groupId),
    createdByUid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return cardRef.id;
}

export async function updatePlanningBoardCard(params: {
  boardId: string;
  cardId: string;
  title?: string;
  description?: string | null;
  columnId?: PlanningBoardColumnId;
  sortOrder?: number;
  linkedItemType?: PlanningItemType | null;
  linkedItemId?: string | null;
  status?: PlanningStatus | null;
  priority?: PlanningPriority | null;
  dueAtMs?: number | null;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");
  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };

  if (params.title !== undefined) {
    patch.title = normalizeBoardCardTitle(params.title);
  }
  if (params.description !== undefined) {
    patch.description = normalizeOptionalText(
      params.description,
      1000,
      "Board card description"
    );
  }
  if (params.columnId !== undefined) {
    patch.columnId = normalizeBoardColumnId(params.columnId);
  }
  if (params.sortOrder !== undefined) {
    patch.sortOrder = numberOrFallback(params.sortOrder, Date.now());
  }
  if (params.linkedItemType !== undefined) {
    patch.linkedItemType =
      params.linkedItemType == null
        ? null
        : normalizePlanningItemType(params.linkedItemType);
  }
  if (params.linkedItemId !== undefined) {
    patch.linkedItemId = optionalStringOrNull(params.linkedItemId);
  }
  if (params.status !== undefined) {
    patch.status =
      params.status == null ? null : normalizePlanningStatus(params.status);
  }
  if (params.priority !== undefined) {
    patch.priority =
      params.priority == null
        ? null
        : normalizePlanningPriority(params.priority);
  }
  if (params.dueAtMs !== undefined) {
    patch.dueAtMs = nullableFiniteNumber(params.dueAtMs);
  }
  if (params.assignedToUid !== undefined) {
    patch.assignedToUid = optionalStringOrNull(params.assignedToUid);
  }
  if (params.assignedToName !== undefined) {
    patch.assignedToName = optionalStringOrNull(params.assignedToName);
  }
  if (params.assignedToEmail !== undefined) {
    patch.assignedToEmail = optionalStringOrNull(params.assignedToEmail);
  }

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), patch);
}

export async function assignPlanningBoardCard(
  params: AssignPlanningBoardCardInput
): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");
  const assignedToUid = requireNonEmptyString(
    params.assignedToUid,
    "Assignee UID"
  );

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), {
    assignedToUid,
    assignedToName: optionalStringOrNull(params.assignedToName),
    assignedToEmail: optionalStringOrNull(params.assignedToEmail),
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function unassignPlanningBoardCard(
  params: UnassignPlanningBoardCardInput
): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), {
    assignedToUid: null,
    assignedToName: null,
    assignedToEmail: null,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function movePlanningBoardCard(params: {
  boardId: string;
  cardId: string;
  columnId: PlanningBoardColumnId;
  sortOrder?: number;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");
  const nowMs = Date.now();

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), {
    columnId: normalizeBoardColumnId(params.columnId),
    sortOrder: numberOrFallback(params.sortOrder, nowMs),
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
}

export async function archivePlanningBoardCard(params: {
  boardId: string;
  cardId: string;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), {
    archived: true,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function restorePlanningBoardCard(params: {
  boardId: string;
  cardId: string;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");

  await updateDoc(doc(db, "planningBoards", boardId, "cards", cardId), {
    archived: false,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function deletePlanningBoardCard(params: {
  boardId: string;
  cardId: string;
}): Promise<void> {
  const boardId = requireNonEmptyString(params.boardId, "Board ID");
  const cardId = requireNonEmptyString(params.cardId, "Board card ID");

  await deleteDoc(doc(db, "planningBoards", boardId, "cards", cardId));
}

export function subscribePlanningBoardCards(
  boardId: string,
  onNext: (cards: PlanningBoardCardDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeBoardId = boardId.trim();
  if (!safeBoardId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningBoards", safeBoardId, "cards"),
    orderBy("sortOrder", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const cards = snap.docs
        .map((d) => mapPlanningBoardCardDoc(d.id, d.data()))
        .filter((card) => card.archived !== true);
      onNext(cards);
    },
    onError
  );
}

export function subscribeArchivedPlanningBoardCards(
  boardId: string,
  onNext: (cards: PlanningBoardCardDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeBoardId = boardId.trim();
  if (!safeBoardId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningBoards", safeBoardId, "cards"),
    orderBy("sortOrder", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const cards = snap.docs
        .map((d) => mapPlanningBoardCardDoc(d.id, d.data()))
        .filter((card) => card.archived === true);
      onNext(cards);
    },
    onError
  );
}

export function subscribePersonalPlanningBoards(
  ownerUid: string,
  onNext: (boards: PlanningBoardDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeOwnerUid = ownerUid.trim();
  if (!safeOwnerUid) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningBoards"),
    where("scope", "==", "personal"),
    where("ownerUid", "==", safeOwnerUid),
    where("archived", "==", false),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningBoardDoc(d.id, d.data())));
    },
    onError
  );
}

export function subscribeGroupPlanningBoards(
  groupId: string,
  onNext: (boards: PlanningBoardDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeGroupId = groupId.trim();
  if (!safeGroupId) {
    onNext([]);
    return () => {};
  }

  const qy = query(
    collection(db, "planningBoards"),
    where("scope", "==", "group"),
    where("groupId", "==", safeGroupId),
    where("archived", "==", false),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      onNext(snap.docs.map((d) => mapPlanningBoardDoc(d.id, d.data())));
    },
    onError
  );
}
