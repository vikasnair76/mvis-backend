import {FieldValue, Firestore} from "firebase-admin/firestore";

const id = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 &&
  value.length <= 500 ? value.trim() : null;
const STATUSES = ["pending", "completed", "skipped", "excused"];

function note(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length > 500) {
    throw new Error("invalid_request");
  }
  return value.trim() || null;
}

function rollup(participants: Record<string, unknown>[]) {
  const counts = {
    pendingParticipantCount: 0, completedParticipantCount: 0,
    skippedParticipantCount: 0, excusedParticipantCount: 0,
  };
  for (const participant of participants) {
    const key = `${participant.status}ParticipantCount` as keyof typeof counts;
    if (!(key in counts)) throw new Error("invalid_participants");
    counts[key]++;
  }
  const executionStatus = counts.pendingParticipantCount > 0 ?
    (counts.completedParticipantCount + counts.skippedParticipantCount +
      counts.excusedParticipantCount > 0 ? "in_progress" : "scheduled") :
    counts.completedParticipantCount > 0 ? "completed" : "skipped";
  return {counts, executionStatus};
}

async function activeMember(db: Firestore, groupId: string, uid: string) {
  const member = await db.doc(`groups/${groupId}/members/${uid}`).get();
  return member.exists && member.data()?.status === "active" ? member.data() : null;
}

export async function mutateTrustedRoutineOccurrence(
  db: Firestore,
  uid: string,
  payload: unknown
) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_request");
  const data = payload as Record<string, unknown>;
  const occurrenceId = id(data.occurrenceId);
  const action = data.action;
  if (!occurrenceId || !["participant", "empty"].includes(String(action))) {
    throw new Error("invalid_request");
  }
  const occurrenceRef = db.doc(`groupRoutineOccurrences/${occurrenceId}`);
  const occurrenceSnapshot = await occurrenceRef.get();
  const occurrence = occurrenceSnapshot.data();
  if (!occurrenceSnapshot.exists || occurrence?.status !== "scheduled") {
    throw new Error("occurrence_unavailable");
  }
  const actor = await activeMember(db, occurrence.groupId, uid);
  if (!actor) throw new Error("permission_denied");
  const routine = occurrence.routineId ?
    (await db.doc(`groupRoutines/${occurrence.routineId}`).get()).data() : null;
  const manager = ["owner", "admin", "moderator"].includes(actor.role) ||
    routine?.createdByUid === uid;
  const nowMs = Date.now();

  if (action === "empty") {
    const status = data.status;
    if (!manager || occurrence.participantCount !== 0 ||
      !["scheduled", "completed", "skipped"].includes(String(status))) {
      throw new Error("permission_denied");
    }
    await occurrenceRef.update({
      executionStatus: status, executionUpdatedAtMs: nowMs,
      executionUpdatedByUid: uid, executionParticipantUid: null,
      executionRevision: (occurrence.executionRevision ?? 0) + 1,
      completedAtMs: status === "completed" ? nowMs : null,
      completedByUid: status === "completed" ? uid : null,
      skippedAtMs: status === "skipped" ? nowMs : null,
      skippedByUid: status === "skipped" ? uid : null,
      skipReason: status === "skipped" ? note(data.note) : null,
      reopenedAtMs: status === "scheduled" ? nowMs : occurrence.reopenedAtMs,
      reopenedByUid: status === "scheduled" ? uid : occurrence.reopenedByUid,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    return {occurrenceId, status};
  }

  const participantUid = id(data.participantUid);
  if (!participantUid) {
    throw new Error("permission_denied");
  }
  return db.runTransaction(async (transaction) => {
    const freshOccurrence = (await transaction.get(occurrenceRef)).data();
    if (!freshOccurrence || freshOccurrence.status !== "scheduled" ||
      !freshOccurrence.participantUids?.includes(participantUid)) {
      throw new Error("occurrence_unavailable");
    }
    const participantRefs = freshOccurrence.participantUids.map((participant: string) =>
      db.doc(`groupRoutineOccurrences/${occurrenceId}/participants/${participant}`));
    const snapshots = await transaction.getAll(...participantRefs);
    const participants = snapshots.map((snapshot) => snapshot.data() as Record<string, unknown>);
    const index = freshOccurrence.participantUids.indexOf(participantUid);
    const current = participants[index];
    if (!current) throw new Error("participant_unavailable");
    const status = data.status === undefined ? String(current.status) : String(data.status);
    if (!STATUSES.includes(status) ||
      (!manager && (participantUid !== uid || status === "excused"))) {
      throw new Error("permission_denied");
    }
    const nextNote = data.note === undefined ?
      (typeof current.note === "string" ? current.note : null) : note(data.note);
    const priorCompletedAtMs = typeof current.completedAtMs === "number" ?
      current.completedAtMs : null;
    const priorSkippedAtMs = typeof current.skippedAtMs === "number" ?
      current.skippedAtMs : null;
    const priorExcusedAtMs = typeof current.excusedAtMs === "number" ?
      current.excusedAtMs : null;
    const next = {
      status, statusRevision: status === current.status ?
        Number(current.statusRevision ?? 0) :
        Number(current.statusRevision ?? 0) + 1,
      note: nextNote, completedAtMs: status === "completed" ?
        (status === current.status ? priorCompletedAtMs : nowMs) : null,
      skippedAtMs: status === "skipped" ?
        (status === current.status ? priorSkippedAtMs : nowMs) : null,
      excusedAtMs: status === "excused" ?
        (status === current.status ? priorExcusedAtMs : nowMs) : null,
      updatedByUid: uid, updatedAtMs: nowMs,
    };
    participants[index] = {...current, ...next};
    const result = rollup(participants);
    const transitioned = result.executionStatus !== freshOccurrence.executionStatus;
    transaction.update(participantRefs[index], next);
    transaction.update(occurrenceRef, {
      ...result.counts, executionStatus: result.executionStatus,
      executionUpdatedAtMs: nowMs, executionUpdatedByUid: uid,
      executionParticipantUid: participantUid,
      executionRevision: result.executionStatus === freshOccurrence.executionStatus ?
        freshOccurrence.executionRevision :
        Number(freshOccurrence.executionRevision ?? 0) + 1,
      completedAtMs: result.executionStatus === "completed" ?
        (transitioned ? nowMs : freshOccurrence.completedAtMs) : null,
      completedByUid: result.executionStatus === "completed" ?
        (transitioned ? uid : freshOccurrence.completedByUid) : null,
      skippedAtMs: result.executionStatus === "skipped" ?
        (transitioned ? nowMs : freshOccurrence.skippedAtMs) : null,
      skippedByUid: result.executionStatus === "skipped" ?
        (transitioned ? uid : freshOccurrence.skippedByUid) : null,
      skipReason: null,
      reopenedAtMs: transitioned &&
        ["scheduled", "in_progress"].includes(result.executionStatus) &&
        ["completed", "skipped"].includes(freshOccurrence.executionStatus) ?
        nowMs : freshOccurrence.reopenedAtMs,
      reopenedByUid: transitioned &&
        ["scheduled", "in_progress"].includes(result.executionStatus) &&
        ["completed", "skipped"].includes(freshOccurrence.executionStatus) ?
        uid : freshOccurrence.reopenedByUid,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    return {occurrenceId, participantUid, status};
  });
}
