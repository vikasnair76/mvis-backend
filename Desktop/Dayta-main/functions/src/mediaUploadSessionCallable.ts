import {FieldValue, Firestore} from "firebase-admin/firestore";

const CONTEXT_TYPES = [
  "progress", "bulletin", "bulletin_comment", "shared_goal_comment",
  "group_dm_message", "group_conversation_message",
] as const;
type ContextType = typeof CONTEXT_TYPES[number];

const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;

async function activeMember(db: Firestore, groupId: string, uid: string) {
  const member = await db.doc(`groups/${groupId}/members/${uid}`).get();
  return member.exists && member.data()?.status === "active";
}

async function validateContext(
  db: Firestore,
  uid: string,
  type: ContextType,
  data: Record<string, unknown>
) {
  const groupId = id(data.groupId);
  if (type === "progress") {
    const goalId = id(data.goalId);
    const subtaskId = id(data.subtaskId);
    if (!goalId || !subtaskId || !id(data.progressEventId)) return false;
    const [goal, subtask] = await Promise.all([
      db.doc(`goals/${goalId}`).get(),
      db.doc(`goals/${goalId}/subtasks/${subtaskId}`).get(),
    ]);
    return goal.exists && subtask.exists &&
      (goal.data()?.userId === uid || subtask.data()?.assignedToUid === uid);
  }
  if (!groupId || !(await activeMember(db, groupId, uid))) return false;
  if (type === "bulletin") {
    const member = await db.doc(`groups/${groupId}/members/${uid}`).get();
    return !!id(data.bulletinId) &&
      ["owner", "admin", "moderator"].includes(member.data()?.role);
  }
  if (type === "bulletin_comment") {
    const bulletinId = id(data.bulletinId);
    if (!bulletinId || !id(data.commentId)) return false;
    const bulletin = await db.doc(`groups/${groupId}/bulletins/${bulletinId}`).get();
    return bulletin.exists && bulletin.data()?.hiddenByModeration !== true &&
      bulletin.data()?.deletedByAuthor !== true;
  }
  if (type === "shared_goal_comment") {
    const goalId = id(data.goalId);
    if (!goalId || !id(data.commentId)) return false;
    const goal = await db.doc(`groups/${groupId}/sharedGoals/${goalId}`).get();
    return goal.exists && goal.data()?.status === "active";
  }
  const collection = type === "group_dm_message" ? "groupDms" : "groupConversations";
  const threadId = id(type === "group_dm_message" ? data.dmId : data.conversationId);
  if (!threadId || !id(data.messageId)) return false;
  const thread = await db.doc(`${collection}/${threadId}`).get();
  const participants = type === "group_dm_message" ?
    thread.data()?.participantUids : thread.data()?.memberUids;
  const blocked = await db.doc(`groups/${groupId}/blockedUsers/${uid}`).get();
  return thread.exists && thread.data()?.groupId === groupId &&
    Array.isArray(participants) && participants.includes(uid) && !blocked.exists;
}

export async function createTrustedMediaUploadSession(
  db: Firestore,
  uid: string,
  payload: unknown
) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_request");
  const data = payload as Record<string, unknown>;
  const sessionId = id(data.id);
  const context = data.context;
  if (!sessionId || !context || typeof context !== "object") {
    throw new Error("invalid_request");
  }
  const contextData = context as Record<string, unknown>;
  const type = contextData.type;
  if (!CONTEXT_TYPES.includes(type as ContextType) ||
    !(await validateContext(db, uid, type as ContextType, contextData))) {
    throw new Error("permission_denied");
  }
  const nowMs = Date.now();
  const session = {
    id: sessionId, uploaderUid: uid, contextType: type,
    groupId: id(contextData.groupId), goalId: id(contextData.goalId),
    subtaskId: id(contextData.subtaskId),
    progressEventId: id(contextData.progressEventId),
    bulletinId: id(contextData.bulletinId), commentId: id(contextData.commentId),
    dmId: id(contextData.dmId), conversationId: id(contextData.conversationId),
    messageId: id(contextData.messageId), status: "active",
    createdAtMs: nowMs, expiresAtMs: nowMs + 15 * 60 * 1000,
    finalizedAtMs: null, cancelledAtMs: null, updatedAtMs: nowMs,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc(`mediaUploadSessions/${sessionId}`).create(session);
  const {createdAt: _createdAt, updatedAt: _updatedAt, ...result} = session;
  return result;
}

export async function transitionTrustedMediaUploadSession(
  db: Firestore,
  uid: string,
  payload: unknown
) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_request");
  const data = payload as Record<string, unknown>;
  const sessionId = id(data.id);
  const status = data.status;
  if (!sessionId || !["finalized", "cancelled"].includes(String(status))) {
    throw new Error("invalid_request");
  }
  return db.runTransaction(async (transaction) => {
    const ref = db.doc(`mediaUploadSessions/${sessionId}`);
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    const nowMs = Date.now();
    if (!snapshot.exists || current?.uploaderUid !== uid ||
      current.status !== "active" || current.expiresAtMs <= nowMs) {
      throw new Error("session_unavailable");
    }
    transaction.update(ref, {
      status,
      finalizedAtMs: status === "finalized" ? nowMs : null,
      cancelledAtMs: status === "cancelled" ? nowMs : null,
      updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    return {id: sessionId, status};
  });
}
