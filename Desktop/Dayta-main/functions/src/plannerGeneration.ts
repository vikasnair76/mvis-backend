import {FieldValue, Firestore,
  type QueryDocumentSnapshot} from "firebase-admin/firestore";
import {evaluatePlannerHeuristics, type PlannerSuggestionCandidate}
  from "./plannerHeuristics.js";
import {
  buildPlannerInputSnapshot,
  buildPlannerWindow,
  normalizePlannerTimeZone,
  PLANNER_SOURCE_LIMITS,
  type PlannerRawSnapshotSources,
} from "./plannerSnapshot.js";
import {buildTrustedPlannerSuggestionWrite, invalidateTrustedPlannerSuggestion,
  upsertTrustedPlannerSuggestion} from "./plannerSuggestionFoundation.js";

export const PLANNER_GENERATION_VERSION = 1;
export const PLANNER_ACTIVE_INVALIDATION_LIMIT = 50;
export const PLANNER_GENERATION_COOLDOWN_MS = 5 * 60 * 1000;
const IN_BATCH_SIZE = 10;
type SourceName = "goals" | "subtasks" | "boardCards" | "calendarEvents" |
  "routines" | "routineOccurrences";
export interface PlannerGenerationResult {
  runId: string; status: "completed" | "skipped" | "failed";
  suggestionsCreated: number; suggestionsReused: number;
  suggestionsInvalidated: number; candidateCount: number;
  truncated: boolean; failureCode: string | null;
  createdSuggestionIds?: string[];
}
export interface PlannerSourceReadDiagnostics {
  queryCount: number; sourceReadCounts: Record<string, number>;
  truncatedSources: string[]; activeGroupCount: number;
}
const chunks = <T>(values: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};
const rows = (snapshot: {docs: QueryDocumentSnapshot[]}) =>
  snapshot.docs.map((item) => ({id: item.id, data: item.data()}));
const withLimit = async (query: FirebaseFirestore.Query,
  limit: number, diagnostics: PlannerSourceReadDiagnostics, source: SourceName) => {
  diagnostics.queryCount += 1;
  const result = await query.limit(limit + 1).get();
  const wasTruncated = result.size > limit;
  if (wasTruncated) diagnostics.truncatedSources.push(`${source}_limit`);
  const selected = result.docs.slice(0, limit);
  diagnostics.sourceReadCounts[source] =
    (diagnostics.sourceReadCounts[source] || 0) + selected.length;
  return rows({docs: selected});
};
async function readGroupBatches(input: {
  firestore: Firestore; groupIds: string[]; collection: string;
  groupField?: string; source: SourceName; limit: number;
  diagnostics: PlannerSourceReadDiagnostics;
  collectionGroup?: boolean;
  configure?: (query: FirebaseFirestore.Query) => FirebaseFirestore.Query;
}) {
  const output: {id: string; data: Record<string, unknown>}[] = [];
  for (const batch of chunks(input.groupIds, IN_BATCH_SIZE)) {
    if (!batch.length || output.length >= input.limit) break;
    let query: FirebaseFirestore.Query = (input.collectionGroup ?
      input.firestore.collectionGroup(input.collection) :
      input.firestore.collection(input.collection))
      .where(input.groupField || "groupId", "in", batch);
    if (input.configure) query = input.configure(query);
    const remaining = input.limit - output.length;
    output.push(...await withLimit(query, remaining, input.diagnostics, input.source));
  }
  return output;
}
export async function readPlannerSnapshotSources(input: {
  firestore: Firestore; ownerUid: string; nowMs: number;
  window: {startAtMs: number; endAtMs: number};
}): Promise<{sources: PlannerRawSnapshotSources;
  diagnostics: PlannerSourceReadDiagnostics; timeZone: string}> {
  const diagnostics: PlannerSourceReadDiagnostics = {
    queryCount: 0, sourceReadCounts: {}, truncatedSources: [], activeGroupCount: 0,
  };
  const userRef = input.firestore.collection("users").doc(input.ownerUid);
  diagnostics.queryCount += 3;
  const [user, preferences, membershipResult] = await Promise.all([
    userRef.get(),
    userRef.collection("settings").doc("planner").get(),
    input.firestore.collection("groupMemberships")
      .where("uid", "==", input.ownerUid).where("status", "==", "active")
      .limit(PLANNER_SOURCE_LIMITS.activeGroups + 1).get(),
  ]);
  const memberships = membershipResult.docs.slice(0, PLANNER_SOURCE_LIMITS.activeGroups);
  if (membershipResult.size > PLANNER_SOURCE_LIMITS.activeGroups) {
    diagnostics.truncatedSources.push("activeGroups_limit");
  }
  const groupIds = Array.from(new Set(memberships.map((item) =>
    typeof item.data().groupId === "string" ? item.data().groupId : "")
    .filter(Boolean))).sort();
  diagnostics.activeGroupCount = groupIds.length;
  const timeZone = normalizePlannerTimeZone(user.data()?.timeZone ||
    user.data()?.timezone || "UTC");
  const [goals, subtasks, personalCards, personalEvents] = await Promise.all([
    withLimit(input.firestore.collection("goals")
      .where("userId", "==", input.ownerUid)
      .orderBy("createdAtMs", "desc"), PLANNER_SOURCE_LIMITS.goals,
    diagnostics, "goals"),
    withLimit(input.firestore.collectionGroup("subtasks")
      .where("userId", "==", input.ownerUid)
      .orderBy("createdAtMs", "desc"), PLANNER_SOURCE_LIMITS.subtasks,
    diagnostics, "subtasks"),
    withLimit(input.firestore.collectionGroup("cards")
      .where("ownerUid", "==", input.ownerUid)
      .orderBy("updatedAtMs", "desc"), PLANNER_SOURCE_LIMITS.boardCards,
    diagnostics, "boardCards"),
    withLimit(input.firestore.collection("planningCalendarEvents")
      .where("ownerUid", "==", input.ownerUid)
      .where("startAtMs", "<", input.window.endAtMs)
      .orderBy("startAtMs", "desc"), PLANNER_SOURCE_LIMITS.calendarEvents,
    diagnostics, "calendarEvents"),
  ]);
  const remainingCards = Math.max(0, PLANNER_SOURCE_LIMITS.boardCards - personalCards.length);
  const remainingEvents = Math.max(0, PLANNER_SOURCE_LIMITS.calendarEvents -
    personalEvents.length);
  const [groupCards, groupEvents, routines, occurrences] = await Promise.all([
    readGroupBatches({firestore: input.firestore, groupIds, collection: "cards",
      collectionGroup: true, source: "boardCards", limit: remainingCards, diagnostics,
      configure: (query) => query.orderBy("updatedAtMs", "desc")}),
    readGroupBatches({firestore: input.firestore, groupIds,
      collection: "planningCalendarEvents", source: "calendarEvents",
      limit: remainingEvents, diagnostics,
      configure: (query) => query.where("sortStartMs", "<", input.window.endAtMs)
        .orderBy("sortStartMs", "desc")}),
    readGroupBatches({firestore: input.firestore, groupIds,
      collection: "groupRoutines", source: "routines",
      limit: PLANNER_SOURCE_LIMITS.routines, diagnostics,
      configure: (query) => query.where("status", "==", "active")
        .orderBy("updatedAtMs", "desc")}),
    readGroupBatches({firestore: input.firestore, groupIds,
      collection: "groupRoutineOccurrences", source: "routineOccurrences",
      limit: PLANNER_SOURCE_LIMITS.routineOccurrences, diagnostics,
      configure: (query) => query.where("startAtMs", ">=", input.window.startAtMs)
        .where("startAtMs", "<", input.window.endAtMs).orderBy("startAtMs", "asc")}),
  ]);
  return {
    timeZone, diagnostics,
    sources: {
      preferences: preferences.data(),
      goals, subtasks,
      boardCards: [...personalCards, ...groupCards],
      calendarEvents: [...personalEvents, ...groupEvents].filter((item) => {
        const end = item.data.endAtMs ?? item.data.sortEndMs;
        return typeof end === "number" && end > input.window.startAtMs;
      }),
      routines, routineOccurrences: occurrences,
      truncatedSources: diagnostics.truncatedSources,
      authoritativeSources: diagnostics.truncatedSources.length ? [] :
        ["goals", "subtasks", "boardCards", "calendarEvents",
          "routines", "routineOccurrences", "memberships"],
    },
  };
}

export function plannerCandidateToTrustedInput(candidate: PlannerSuggestionCandidate,
  input: {generationRunId: string; nowMs: number}) {
  return {
    ownerUid: candidate.ownerUid, scope: candidate.scope,
    groupId: candidate.groupId, type: candidate.type,
    priority: candidate.priority, confidence: candidate.confidence,
    title: candidate.title, summary: candidate.summary,
    rationale: candidate.rationale, evidence: candidate.evidence,
    target: candidate.target, proposedAction: candidate.proposedAction,
    source: {
      type: "deterministic_rule", ruleId: candidate.source.ruleId,
      ruleVersion: candidate.source.ruleVersion, generatedBy: "server",
      inputFingerprint: candidate.source.inputFingerprint,
      timeBucket: candidate.source.timeBucket,
    },
    generationRunId: input.generationRunId, generatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + 15 * 24 * 60 * 60 * 1000,
    createdAtMs: input.nowMs, updatedAtMs: input.nowMs,
  };
}
async function invalidateStalePlannerSuggestions(input: {
  firestore: Firestore; ownerUid: string; candidates: PlannerSuggestionCandidate[];
  nowMs: number; authoritative: boolean;
}) {
  if (!input.authoritative) return 0;
  const ids = new Set(input.candidates.map((candidate) =>
    buildTrustedPlannerSuggestionWrite(plannerCandidateToTrustedInput(candidate,
      {generationRunId: "comparison", nowMs: input.nowMs})).id));
  const result = await input.firestore.collection("users").doc(input.ownerUid)
    .collection("plannerSuggestions").where("status", "in", ["active", "snoozed"])
    .orderBy("generatedAtMs", "desc").limit(PLANNER_ACTIVE_INVALIDATION_LIMIT + 1).get();
  if (result.size > PLANNER_ACTIVE_INVALIDATION_LIMIT) return 0;
  let invalidated = 0;
  for (const document of result.docs) {
    const data = document.data();
    if (data.source?.type !== "deterministic_rule" || ids.has(document.id)) continue;
    const outcome = await invalidateTrustedPlannerSuggestion(input.firestore, {
      ownerUid: input.ownerUid, suggestionId: document.id,
      reason: "target_changed", nowMs: input.nowMs,
    });
    if (outcome === "invalidated") invalidated += 1;
  }
  return invalidated;
}
const safeFailureCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("index")) return "missing_index";
  if (message.includes("permission")) return "permission_denied";
  if (message.includes("invalid")) return "invalid_source";
  return "generation_failed";
};
export async function generatePlannerSuggestions(input: {
  firestore: Firestore; ownerUid: string; nowMs: number; runId: string;
  trigger?: "manual" | "scheduled" | "source_change" | "test";
  requestId?: string; reasonCodes?: string[]; attemptNumber?: number;
  enforceCooldown?: boolean;
}): Promise<PlannerGenerationResult> {
  const runRef = input.firestore.collection("users").doc(input.ownerUid)
    .collection("plannerGenerationRuns").doc(input.runId);
  const base = {id: input.runId, ownerUid: input.ownerUid,
    trigger: input.trigger || "manual", ruleVersion: PLANNER_GENERATION_VERSION,
    requestId: input.requestId ?? null,
    reasonCodes: (input.reasonCodes || []).slice(0, 8),
    attemptNumber: input.attemptNumber ?? 1,
    createdAtMs: input.nowMs, updatedAtMs: input.nowMs};
  if (input.enforceCooldown) {
    const recent = await input.firestore.collection("users").doc(input.ownerUid)
      .collection("plannerGenerationRuns").where("createdAtMs", ">",
        input.nowMs - PLANNER_GENERATION_COOLDOWN_MS)
      .orderBy("createdAtMs", "desc").limit(1).get();
    if (!recent.empty && recent.docs[0].id !== input.runId) {
      await runRef.set({...base, status: "skipped", startedAtMs: input.nowMs,
        completedAtMs: input.nowMs, suggestionsCreated: 0, suggestionsReused: 0,
        suggestionsInvalidated: 0, failureCode: "cooldown",
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
      return {runId: input.runId, status: "skipped", suggestionsCreated: 0,
        suggestionsReused: 0, suggestionsInvalidated: 0, candidateCount: 0,
        truncated: false, failureCode: "cooldown"};
    }
  }
  await runRef.set({...base, status: "running", startedAtMs: input.nowMs,
    completedAtMs: null, suggestionsCreated: 0, suggestionsReused: 0,
    suggestionsInvalidated: 0, failureCode: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
  try {
    const user = await input.firestore.collection("users").doc(input.ownerUid).get();
    const timeZone = normalizePlannerTimeZone(user.data()?.timeZone ||
      user.data()?.timezone || "UTC");
    const window = buildPlannerWindow(input.nowMs, timeZone);
    const read = await readPlannerSnapshotSources({...input, window});
    const snapshot = buildPlannerInputSnapshot({ownerUid: input.ownerUid,
      generatedAtMs: input.nowMs, timeZone: read.timeZone,
      sources: read.sources, window});
    if (!snapshot.preferences.enabled) {
      await runRef.update({status: "skipped", completedAtMs: input.nowMs,
        updatedAtMs: input.nowMs, failureCode: "planner_disabled",
        truncated: snapshot.metadata.truncated,
        updatedAt: FieldValue.serverTimestamp()});
      return {runId: input.runId, status: "skipped", suggestionsCreated: 0,
        suggestionsReused: 0, suggestionsInvalidated: 0, candidateCount: 0,
        truncated: snapshot.metadata.truncated, failureCode: "planner_disabled"};
    }
    const candidates = evaluatePlannerHeuristics(snapshot, {
      nowMs: input.nowMs, timeZone: snapshot.timeZone, maxCandidates: 25,
    });
    let suggestionsCreated = 0; let suggestionsReused = 0;
    const createdSuggestionIds: string[] = [];
    for (const candidate of candidates) {
      const result = await upsertTrustedPlannerSuggestion(input.firestore,
        plannerCandidateToTrustedInput(candidate,
          {generationRunId: input.runId, nowMs: input.nowMs}));
      if (result.outcome === "created") {
        suggestionsCreated += 1;
        createdSuggestionIds.push(result.id);
      }
      else suggestionsReused += 1;
    }
    const suggestionsInvalidated = await invalidateStalePlannerSuggestions({
      firestore: input.firestore, ownerUid: input.ownerUid, candidates,
      nowMs: input.nowMs, authoritative: !snapshot.metadata.truncated,
    });
    await runRef.update({status: "completed", completedAtMs: input.nowMs,
      updatedAtMs: input.nowMs, suggestionsCreated, suggestionsReused,
      suggestionsInvalidated, candidateCount: candidates.length,
      truncated: snapshot.metadata.truncated,
      truncationReasons: snapshot.metadata.truncationReasons,
      sourceCounts: snapshot.metadata.sourceCounts,
      updatedAt: FieldValue.serverTimestamp()});
    return {runId: input.runId, status: "completed", suggestionsCreated,
      suggestionsReused, suggestionsInvalidated, candidateCount: candidates.length,
      truncated: snapshot.metadata.truncated, failureCode: null,
      createdSuggestionIds};
  } catch (error) {
    const failureCode = safeFailureCode(error);
    await runRef.update({status: "failed", completedAtMs: input.nowMs,
      updatedAtMs: input.nowMs, failureCode, updatedAt: FieldValue.serverTimestamp()});
    return {runId: input.runId, status: "failed", suggestionsCreated: 0,
      suggestionsReused: 0, suggestionsInvalidated: 0, candidateCount: 0,
      truncated: false, failureCode};
  }
}
