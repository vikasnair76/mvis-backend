import {FieldValue, Firestore} from "firebase-admin/firestore";

const DISMISSAL_REASONS = [
  "not_relevant", "already_handled", "bad_timing",
  "dont_suggest_again", "other",
];
const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;

export async function mutateTrustedPlannerSuggestion(
  db: Firestore,
  uid: string,
  payload: unknown
) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_request");
  const data = payload as Record<string, unknown>;
  const suggestionId = id(data.suggestionId);
  const action = data.action;
  if (!suggestionId ||
    !["view", "dismiss", "snooze", "archive"].includes(String(action))) {
    throw new Error("invalid_request");
  }
  return db.runTransaction(async (transaction) => {
    const ref = db.doc(`users/${uid}/plannerSuggestions/${suggestionId}`);
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists || current?.ownerUid !== uid) {
      throw new Error("suggestion_unavailable");
    }
    const nowMs = Date.now();
    let patch: Record<string, unknown>;
    if (action === "view") {
      if (current.viewedAtMs != null) return {suggestionId, status: current.status};
      patch = {viewedAtMs: nowMs};
    } else if (action === "dismiss") {
      if (!["active", "snoozed"].includes(current.status)) {
        throw new Error("invalid_transition");
      }
      const reason = data.reason == null ? null : String(data.reason);
      if (reason !== null && !DISMISSAL_REASONS.includes(reason)) {
        throw new Error("invalid_request");
      }
      patch = {
        status: "dismissed", dismissedAtMs: nowMs, actedAtMs: nowMs,
        dismissalReason: reason, snoozedUntilMs: null,
      };
    } else if (action === "snooze") {
      const until = data.snoozedUntilMs;
      if (!["active", "snoozed"].includes(current.status) ||
        typeof until !== "number" || !Number.isFinite(until) ||
        until <= nowMs || until > nowMs + 90 * 24 * 60 * 60 * 1000 ||
        (typeof current.expiresAtMs === "number" && until > current.expiresAtMs)) {
        throw new Error("invalid_transition");
      }
      patch = {status: "snoozed", snoozedUntilMs: until};
    } else {
      if (!["active", "snoozed", "accepted", "dismissed", "expired", "invalidated"]
        .includes(current.status)) throw new Error("invalid_transition");
      patch = {status: "archived", archivedAtMs: nowMs};
    }
    transaction.update(ref, {
      ...patch, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
    });
    return {suggestionId, status: patch.status ?? current.status};
  });
}
