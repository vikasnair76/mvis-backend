import * as Crypto from "expo-crypto";
import {httpsCallable} from "firebase/functions";

import {functions} from "./firebase";
import {
  validateMediaAttachmentContext,
  type MediaAttachmentContext,
  type MediaAttachmentContextType,
} from "./mediaAttachments";

export const MEDIA_UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;
export const MEDIA_UPLOAD_SESSION_MAX_TTL_MS = 30 * 60 * 1000;

export type MediaUploadSessionStatus = "active" | "finalized" | "cancelled";

export type MediaUploadSessionDoc = {
  id: string;
  uploaderUid: string;
  contextType: MediaAttachmentContextType;
  groupId: string | null;
  goalId: string | null;
  subtaskId: string | null;
  progressEventId: string | null;
  bulletinId: string | null;
  commentId: string | null;
  dmId: string | null;
  conversationId: string | null;
  messageId: string | null;
  status: MediaUploadSessionStatus;
  createdAtMs: number;
  expiresAtMs: number;
  finalizedAtMs: number | null;
  cancelledAtMs: number | null;
  updatedAtMs: number;
};

const SESSION_KEYS = [
  "id", "uploaderUid", "contextType", "groupId", "goalId", "subtaskId",
  "progressEventId", "bulletinId", "commentId", "dmId", "conversationId",
  "messageId", "status", "createdAtMs", "expiresAtMs", "finalizedAtMs",
  "cancelledAtMs", "updatedAtMs", "createdAt", "updatedAt",
] as const;

function nullableId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function contextFields(context: MediaAttachmentContext) {
  return {
    groupId: "groupId" in context ? context.groupId : null,
    goalId: "goalId" in context ? context.goalId : null,
    subtaskId: context.type === "progress" ? context.subtaskId : null,
    progressEventId: context.type === "progress" ? context.progressEventId : null,
    bulletinId: context.type === "bulletin" || context.type === "bulletin_comment" ? context.bulletinId : null,
    commentId: "commentId" in context ? context.commentId : null,
    dmId: context.type === "group_dm_message" ? context.dmId : null,
    conversationId: context.type === "group_conversation_message" ? context.conversationId : null,
    messageId: context.type === "group_dm_message" || context.type === "group_conversation_message" ? context.messageId : null,
  };
}

export function mediaUploadSessionContext(session: MediaUploadSessionDoc): MediaAttachmentContext | null {
  const s = session;
  if (s.contextType === "progress" && s.goalId && s.subtaskId && s.progressEventId &&
    !s.groupId && !s.bulletinId && !s.commentId && !s.dmId && !s.conversationId && !s.messageId)
    return { type: "progress", goalId: s.goalId, subtaskId: s.subtaskId, progressEventId: s.progressEventId };
  if (s.contextType === "bulletin" && s.groupId && s.bulletinId &&
    !s.goalId && !s.subtaskId && !s.progressEventId && !s.commentId && !s.dmId && !s.conversationId && !s.messageId)
    return { type: "bulletin", groupId: s.groupId, bulletinId: s.bulletinId };
  if (s.contextType === "bulletin_comment" && s.groupId && s.bulletinId && s.commentId &&
    !s.goalId && !s.subtaskId && !s.progressEventId && !s.dmId && !s.conversationId && !s.messageId)
    return { type: "bulletin_comment", groupId: s.groupId, bulletinId: s.bulletinId, commentId: s.commentId };
  if (s.contextType === "shared_goal_comment" && s.groupId && s.goalId && s.commentId &&
    !s.subtaskId && !s.progressEventId && !s.bulletinId && !s.dmId && !s.conversationId && !s.messageId)
    return { type: "shared_goal_comment", groupId: s.groupId, goalId: s.goalId, commentId: s.commentId };
  if (s.contextType === "group_dm_message" && s.groupId && s.dmId && s.messageId &&
    !s.goalId && !s.subtaskId && !s.progressEventId && !s.bulletinId && !s.commentId && !s.conversationId)
    return { type: "group_dm_message", groupId: s.groupId, dmId: s.dmId, messageId: s.messageId };
  if (s.contextType === "group_conversation_message" && s.groupId && s.conversationId && s.messageId &&
    !s.goalId && !s.subtaskId && !s.progressEventId && !s.bulletinId && !s.commentId && !s.dmId)
    return { type: "group_conversation_message", groupId: s.groupId, conversationId: s.conversationId, messageId: s.messageId };
  return null;
}

export function createMediaUploadSessionId(): string {
  return Crypto.randomUUID().replace(/-/g, "");
}

export function buildMediaUploadSession(input: {
  id: string;
  uploaderUid: string;
  context: MediaAttachmentContext;
  nowMs?: number;
  ttlMs?: number;
}): MediaUploadSessionDoc {
  validateMediaAttachmentContext(input.context);
  if (!/^[A-Za-z0-9_-]+$/.test(input.id) || !/^[A-Za-z0-9_-]+$/.test(input.uploaderUid)) {
    throw new Error("Invalid upload session identity.");
  }
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? MEDIA_UPLOAD_SESSION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MEDIA_UPLOAD_SESSION_MAX_TTL_MS) {
    throw new Error("Invalid upload session expiration.");
  }
  return {
    id: input.id,
    uploaderUid: input.uploaderUid,
    contextType: input.context.type,
    ...contextFields(input.context),
    status: "active",
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    finalizedAtMs: null,
    cancelledAtMs: null,
    updatedAtMs: nowMs,
  };
}

export function mapMediaUploadSessionDoc(value: unknown, documentId?: string): MediaUploadSessionDoc | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  if (Object.keys(d).some((key) => !(SESSION_KEYS as readonly string[]).includes(key))) return null;
  const id = nullableId(d.id);
  const uploaderUid = nullableId(d.uploaderUid);
  const contextType = d.contextType;
  const status = d.status;
  if (!id || (documentId && id !== documentId) || !uploaderUid ||
    !["progress", "bulletin", "bulletin_comment", "shared_goal_comment", "group_dm_message", "group_conversation_message"].includes(String(contextType)) ||
    !["active", "finalized", "cancelled"].includes(String(status)) ||
    typeof d.createdAtMs !== "number" || typeof d.expiresAtMs !== "number" ||
    typeof d.updatedAtMs !== "number" || d.expiresAtMs <= d.createdAtMs) return null;
  const result = {
    id, uploaderUid, contextType: contextType as MediaAttachmentContextType,
    groupId: nullableId(d.groupId), goalId: nullableId(d.goalId),
    subtaskId: nullableId(d.subtaskId), progressEventId: nullableId(d.progressEventId),
    bulletinId: nullableId(d.bulletinId), commentId: nullableId(d.commentId),
    dmId: nullableId(d.dmId), conversationId: nullableId(d.conversationId),
    messageId: nullableId(d.messageId), status: status as MediaUploadSessionStatus,
    createdAtMs: d.createdAtMs, expiresAtMs: d.expiresAtMs,
    finalizedAtMs: d.finalizedAtMs === null ? null : typeof d.finalizedAtMs === "number" ? d.finalizedAtMs : NaN,
    cancelledAtMs: d.cancelledAtMs === null ? null : typeof d.cancelledAtMs === "number" ? d.cancelledAtMs : NaN,
    updatedAtMs: d.updatedAtMs,
  };
  if (!Number.isFinite(result.finalizedAtMs ?? 0) || !Number.isFinite(result.cancelledAtMs ?? 0)) return null;
  if ((result.status === "active" && (result.finalizedAtMs !== null || result.cancelledAtMs !== null)) ||
    (result.status === "finalized" && (result.finalizedAtMs === null || result.cancelledAtMs !== null)) ||
    (result.status === "cancelled" && (result.cancelledAtMs === null || result.finalizedAtMs !== null)) ||
    !mediaUploadSessionContext(result)) return null;
  return result;
}

export function isMediaUploadSessionExpired(session: MediaUploadSessionDoc, nowMs = Date.now()): boolean {
  return session.expiresAtMs <= nowMs;
}

export async function createMediaUploadSession(input: {
  uploaderUid: string;
  context: MediaAttachmentContext;
  id?: string;
}) {
  const id = input.id ?? createMediaUploadSessionId();
  const callable = httpsCallable<
    {id: string; context: MediaAttachmentContext},
    MediaUploadSessionDoc
  >(functions, "createMediaUploadSession");
  return (await callable({id, context: input.context})).data;
}

async function transitionSession(id: string, uploaderUid: string, status: "finalized" | "cancelled") {
  if (!id || !uploaderUid) throw new Error("Invalid upload session identity.");
  const callable = httpsCallable<
    {id: string; status: "finalized" | "cancelled"},
    {id: string; status: "finalized" | "cancelled"}
  >(functions, "transitionMediaUploadSession");
  await callable({id, status});
}

export const finalizeMediaUploadSession = (id: string, uploaderUid: string) => transitionSession(id, uploaderUid, "finalized");
export const cancelMediaUploadSession = (id: string, uploaderUid: string) => transitionSession(id, uploaderUid, "cancelled");
