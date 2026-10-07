import { FieldValue, Firestore, type DocumentData } from "firebase-admin/firestore";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}
function hash(value: unknown) {
  const input = JSON.stringify(canonical(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second ^ input.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function buildTrustedPlannerSuggestionWrite(input: DocumentData) {
  const identityRef = (ref: DocumentData) => ({
    type: ref?.type ?? null,
    id: ref?.id ?? null,
    ownerUid: ref?.ownerUid ?? null,
    groupId: ref?.groupId ?? null,
    goalId: ref?.goalId ?? null,
    boardId: ref?.boardId ?? null,
    routineId: ref?.routineId ?? null,
  });
  const action = input.proposedAction ?? {};
  const proposedAction =
    action.type === "create_focus_block"
      ? {
          type: action.type,
          proposedStartAtMs: action.proposedStartAtMs,
          proposedEndAtMs: action.proposedEndAtMs,
          linkedTargets: Array.isArray(action.linkedTargets)
            ? action.linkedTargets.map(identityRef)
            : [],
        }
      : {
          type: action.type ?? null,
          target: identityRef(action.target),
          proposedStartAtMs: action.proposedStartAtMs ?? null,
          proposedEndAtMs: action.proposedEndAtMs ?? null,
          existingStartAtMs: action.existingStartAtMs ?? null,
          timeZone: action.timeZone ?? null,
          proposedPriority: action.proposedPriority ?? null,
          proposedDueAtMs: action.proposedDueAtMs ?? null,
          boardId: action.boardId ?? null,
          proposedColumnId: action.proposedColumnId ?? null,
        };
  const identity = {
    ownerUid: input.ownerUid,
    scope: input.scope,
    groupId: input.groupId ?? null,
    type: input.type,
    target: {
      primary: identityRef(input.target?.primary),
      related: Array.isArray(input.target?.related)
        ? input.target.related.map(identityRef)
        : [],
    },
    proposedAction,
    ruleId: input.source?.ruleId,
    ruleVersion: input.source?.ruleVersion,
    timeBucket: input.source?.timeBucket ?? null,
  };
  const dedupeKey = `planner_${hash(identity)}`;
  const id = `plannerSuggestion_${hash(dedupeKey)}`;
  if (
    typeof input.ownerUid !== "string" ||
    !input.ownerUid ||
    !["personal", "group"].includes(input.scope) ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.trim().length > 120 ||
    typeof input.summary !== "string" ||
    !input.summary.trim() ||
    input.summary.trim().length > 240 ||
    typeof input.rationale !== "string" ||
    !input.rationale.trim() ||
    input.rationale.trim().length > 500 ||
    !Array.isArray(input.evidence) ||
    input.evidence.length > 5 ||
    !Array.isArray(input.target?.related) ||
    input.target.related.length > 5
  ) {
    throw new Error("invalid_planner_suggestion");
  }
  return {
    id,
    data: {
      id,
      ownerUid: input.ownerUid,
      scope: input.scope,
      groupId: input.groupId ?? null,
      type: input.type,
      priority: input.priority,
      confidence: input.confidence,
      title: input.title.trim(),
      summary: input.summary.trim(),
      rationale: input.rationale.trim(),
      evidence: input.evidence,
      target: input.target,
      proposedAction: input.proposedAction,
      source: input.source,
      dedupeKey,
      status: "active",
      generationRunId: input.generationRunId ?? null,
      generatedAtMs: input.generatedAtMs,
      expiresAtMs: input.expiresAtMs ?? null,
      snoozedUntilMs: null,
      viewedAtMs: null,
      actedAtMs: null,
      acceptedAtMs: null,
      acceptedByUid: null,
      executionResult: null,
      notifiedAtMs: null,
      notificationBatchId: null,
      dismissedAtMs: null,
      dismissalReason: null,
      expiredAtMs: null,
      archivedAtMs: null,
      invalidatedAtMs: null,
      invalidationReason: null,
      createdAtMs: input.createdAtMs,
      updatedAtMs: input.updatedAtMs,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}

export async function upsertTrustedPlannerSuggestion(
  firestore: Firestore,
  input: DocumentData
) {
  const write = buildTrustedPlannerSuggestionWrite(input);
  const ref = firestore
    .collection("users")
    .doc(input.ownerUid)
    .collection("plannerSuggestions")
    .doc(write.id);
  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const data = existing.data()!;
      if (!["active", "snoozed"].includes(data.status)) {
        return {id: write.id, outcome: "terminal" as const};
      }
      transaction.set(ref, {
        ...write.data,
        status: data.status,
        snoozedUntilMs: data.snoozedUntilMs ?? null,
        viewedAtMs: data.viewedAtMs ?? null,
        notifiedAtMs: data.notifiedAtMs ?? null,
        notificationBatchId: data.notificationBatchId ?? null,
        createdAtMs: data.createdAtMs ?? write.data.createdAtMs,
        createdAt: data.createdAt ?? write.data.createdAt,
      }, {merge: false});
      return {id: write.id, outcome: "reused" as const};
    }
    transaction.create(ref, write.data);
    return {id: write.id, outcome: "created" as const};
  });
}

export async function invalidateTrustedPlannerSuggestion(
  firestore: Firestore,
  input: {
    ownerUid: string;
    suggestionId: string;
    reason: string;
    nowMs?: number;
  }
) {
  const nowMs = input.nowMs ?? Date.now();
  const ref = firestore
    .collection("users")
    .doc(input.ownerUid)
    .collection("plannerSuggestions")
    .doc(input.suggestionId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return "missing";
    const data = snapshot.data()!;
    if (data.status === "invalidated") return "duplicate";
    if (!["active", "snoozed"].includes(data.status)) return "ineligible";
    transaction.update(ref, {
      status: "invalidated",
      invalidatedAtMs: nowMs,
      invalidationReason: input.reason,
      snoozedUntilMs: null,
      updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "invalidated";
  });
}

export async function expireTrustedPlannerSuggestion(
  firestore: Firestore,
  input: { ownerUid: string; suggestionId: string; nowMs?: number }
) {
  const nowMs = input.nowMs ?? Date.now();
  const ref = firestore
    .collection("users")
    .doc(input.ownerUid)
    .collection("plannerSuggestions")
    .doc(input.suggestionId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return "missing";
    const data = snapshot.data()!;
    if (data.status === "expired") return "duplicate";
    if (!["active", "snoozed"].includes(data.status)) return "ineligible";
    if (
      typeof data.expiresAtMs !== "number" ||
      data.expiresAtMs > nowMs
    ) {
      return "not_due";
    }
    transaction.update(ref, {
      status: "expired",
      snoozedUntilMs: null,
      expiredAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "expired";
  });
}
