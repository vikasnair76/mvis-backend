import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const dbFor = (uid) => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const groupId = "media-group";
const now = Date.now();
const fields = {
  groupId: null, goalId: null, subtaskId: null, progressEventId: null,
  bulletinId: null, commentId: null, dmId: null, conversationId: null, messageId: null,
};
const session = (id, uid, contextType, context) => ({
  id, uploaderUid: uid, contextType, ...fields, ...context,
  status: "active", createdAtMs: now, expiresAtMs: now + 15 * 60_000,
  finalizedAtMs: null, cancelledAtMs: null, updatedAtMs: now,
  createdAt: Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now),
});

try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "groups", groupId), { name: "Media Group" });
    for (const [uid, role, status = "active"] of [
      ["owner", "owner"], ["admin", "admin"], ["moderator", "moderator"],
      ["member", "member"], ["viewer", "viewer"], ["removed", "member", "removed"],
      ["inactive", "member", "inactive"], ["participant2", "member"],
    ]) await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status });
    await setDoc(doc(db, "groups", groupId, "bulletins", "bulletin1"), { groupId, hiddenByModeration: false });
    await setDoc(doc(db, "groups", groupId, "bulletins", "hidden"), { groupId, hiddenByModeration: true });
    await setDoc(doc(db, "groups", groupId, "sharedGoals", "goal1"), { groupId, goalId: "goal1", status: "active" });
    await setDoc(doc(db, "groupDms", "dm1"), { groupId, participantUids: ["member", "participant2"] });
    await setDoc(doc(db, "groupConversations", "conversation1"), { groupId, memberUids: ["member", "participant2"] });
    await setDoc(doc(db, "groups", groupId, "sharedGoals", "progress-goal"), { groupId, goalId: "progress-goal", status: "active" });
    await setDoc(doc(db, "goals", "progress-goal"), {
      userId: "owner",
      visibility: "group_shared",
      sharedGroupIds: [groupId],
      currentMetricValue: 1,
      metricTargetValue: 1,
      progressPercentage: 100,
      status: "completed",
      completedAtMs: now,
    });
    await setDoc(doc(db, "goals", "progress-goal", "subtasks", "progress-task"), {
      title: "Progress task",
      assignedToUid: "member",
      frequency: "once",
      contributesToMetric: true,
      metricValue: 1,
      metricUnit: "task",
      firstCompletedAtMs: now,
      updatedAt: Timestamp.fromMillis(now),
    });
    await setDoc(doc(db, "goals", "progress-goal", "subtasks", "progress-task", "completions", "2026-07-28"), {
      userId: "owner",
      goalId: "progress-goal",
      subtaskId: "progress-task",
      dayKey: "2026-07-28",
      latestProgressEventId: "progress-event",
      metricValue: 1,
      metricContributionValue: 1,
    });
  });

  const progressVideo = {
    id: "progress-video",
    type: "video",
    storagePath: "progressMedia/member/progress-goal/progress-task/progress-event/progress-video/original.mp4",
    downloadUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/video",
    thumbnailUrl: null,
    externalUrl: null,
    mimeType: "video/mp4",
    fileName: "video.mp4",
    sizeBytes: 1024,
    width: 1080,
    height: 1920,
    durationMs: 5000,
    uploadedByUid: "member",
    createdAtMs: now,
    provider: null,
    providerMediaId: null,
    title: null,
  };
  const progressEvent = {
    goalId: "progress-goal",
    subtaskId: "progress-task",
    kind: "completion",
    authorUid: "member",
    authorName: null,
    authorEmail: null,
    dayKey: "2026-07-28",
    previousValue: 0,
    resultingValue: 1,
    targetValue: 1,
    unit: null,
    completed: true,
    metricContributionBefore: 0,
    metricContributionAfter: 1,
    metricContributionDelta: 1,
    metricContributionTarget: 1,
    metricUnitSnapshot: "task",
    attachments: [progressVideo],
    reverted: false,
    createdAtMs: now,
    updatedAtMs: now,
  };
  await check("assigned member creates progress event with uploaded video", () =>
    assertSucceeds(setDoc(doc(dbFor("member"), "goals/progress-goal/subtasks/progress-task/progressEvents/progress-event"), progressEvent)));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(
      doc(ctx.firestore(), "goals/progress-goal/subtasks/progress-task/progressEvents/progress-event"),
      { authorUid: "owner" }
    );
  });
  await check("assigned member atomically undoes shared completion recorded by owner", () => {
    const memberDb = dbFor("member");
    const batch = writeBatch(memberDb);
    batch.delete(doc(memberDb, "goals/progress-goal/subtasks/progress-task/completions/2026-07-28"));
    batch.update(doc(memberDb, "goals/progress-goal/subtasks/progress-task/progressEvents/progress-event"), {
      reverted: true,
      revertedAtMs: now + 1,
      revertedByUid: "member",
      updatedAtMs: now + 1,
    });
    batch.update(doc(memberDb, "goals/progress-goal/subtasks/progress-task"), {
      firstCompletedAtMs: null,
      updatedAt: Timestamp.fromMillis(now + 1),
    });
    batch.update(doc(memberDb, "goals/progress-goal"), {
      currentMetricValue: 0,
      progressPercentage: 0,
      status: "active",
      completedAtMs: null,
      lastProgressActorUid: "member",
      lastProgressSubtaskId: "progress-task",
      updatedAt: Timestamp.fromMillis(now + 1),
    });
    return assertSucceeds(batch.commit());
  });

  for (const uid of ["owner", "admin", "moderator"]) await check(`${uid} creates bulletin session`, () =>
    assertSucceeds(setDoc(doc(dbFor(uid), "mediaUploadSessions", `bulletin-${uid}`), session(`bulletin-${uid}`, uid, "bulletin", { groupId, bulletinId: "newBulletin" }))));
  for (const uid of ["member", "viewer", "removed", "inactive", "unrelated"]) await check(`${uid} cannot create bulletin session`, () =>
    assertFails(setDoc(doc(dbFor(uid), "mediaUploadSessions", `bulletin-denied-${uid}`), session(`bulletin-denied-${uid}`, uid, "bulletin", { groupId, bulletinId: "newBulletin" }))));
  await check("signed out cannot create", () => assertFails(setDoc(doc(dbFor(null), "mediaUploadSessions", "signedout"), session("signedout", "member", "bulletin", { groupId, bulletinId: "b" }))));

  for (const uid of ["member", "viewer"]) await check(`${uid} creates bulletin comment session`, () =>
    assertSucceeds(setDoc(doc(dbFor(uid), "mediaUploadSessions", `comment-${uid}`), session(`comment-${uid}`, uid, "bulletin_comment", { groupId, bulletinId: "bulletin1", commentId: `c-${uid}` }))));
  await check("hidden bulletin comment denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "hidden-comment"), session("hidden-comment", "member", "bulletin_comment", { groupId, bulletinId: "hidden", commentId: "c" }))));
  await check("shared goal comment session succeeds", () => assertSucceeds(setDoc(doc(dbFor("viewer"), "mediaUploadSessions", "goal-comment"), session("goal-comment", "viewer", "shared_goal_comment", { groupId, goalId: "goal1", commentId: "c1" }))));
  await check("missing shared goal denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "missing-goal"), session("missing-goal", "member", "shared_goal_comment", { groupId, goalId: "missing", commentId: "c" }))));

  await check("dm participant creates session", () => assertSucceeds(setDoc(doc(dbFor("member"), "mediaUploadSessions", "dm-ok"), session("dm-ok", "member", "group_dm_message", { groupId, dmId: "dm1", messageId: "m1" }))));
  await check("dm nonparticipant denied", () => assertFails(setDoc(doc(dbFor("viewer"), "mediaUploadSessions", "dm-no"), session("dm-no", "viewer", "group_dm_message", { groupId, dmId: "dm1", messageId: "m1" }))));
  await check("wrong dm group denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "dm-wrong"), session("dm-wrong", "member", "group_dm_message", { groupId: "other", dmId: "dm1", messageId: "m1" }))));
  await check("conversation member creates session", () => assertSucceeds(setDoc(doc(dbFor("member"), "mediaUploadSessions", "conversation-ok"), session("conversation-ok", "member", "group_conversation_message", { groupId, conversationId: "conversation1", messageId: "m1" }))));
  await check("conversation nonmember denied", () => assertFails(setDoc(doc(dbFor("viewer"), "mediaUploadSessions", "conversation-no"), session("conversation-no", "viewer", "group_conversation_message", { groupId, conversationId: "conversation1", messageId: "m1" }))));

  await check("spoofed uploader denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "spoof"), session("spoof", "viewer", "bulletin_comment", { groupId, bulletinId: "bulletin1", commentId: "c" }))));
  await check("expired create denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "expired"), { ...session("expired", "member", "bulletin_comment", { groupId, bulletinId: "bulletin1", commentId: "c" }), expiresAtMs: now - 1 })));
  await check("unknown field denied", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "unknown"), { ...session("unknown", "member", "bulletin_comment", { groupId, bulletinId: "bulletin1", commentId: "c" }), surprise: true })));

  await check("creator reads session", () => assertSucceeds(getDoc(doc(dbFor("member"), "mediaUploadSessions", "dm-ok"))));
  await check("other user cannot read session", () => assertFails(getDoc(doc(dbFor("viewer"), "mediaUploadSessions", "dm-ok"))));
  await check("creator finalizes session", () => assertSucceeds(updateDoc(doc(dbFor("member"), "mediaUploadSessions", "dm-ok"), { status: "finalized", finalizedAtMs: Date.now(), updatedAtMs: Date.now(), updatedAt: Timestamp.now() })));
  await check("reactivation denied", () => assertFails(updateDoc(doc(dbFor("member"), "mediaUploadSessions", "dm-ok"), { status: "active", finalizedAtMs: null, updatedAtMs: Date.now(), updatedAt: Timestamp.now() })));
  await check("creator cancels session", () => assertSucceeds(updateDoc(doc(dbFor("member"), "mediaUploadSessions", "conversation-ok"), { status: "cancelled", cancelledAtMs: Date.now(), updatedAtMs: Date.now(), updatedAt: Timestamp.now() })));
  await check("context mutation denied", () => assertFails(updateDoc(doc(dbFor("member"), "mediaUploadSessions", "conversation-ok"), { conversationId: "other" })));
  await check("other user cannot transition", () => assertFails(updateDoc(doc(dbFor("viewer"), "mediaUploadSessions", "comment-member"), { status: "cancelled", cancelledAtMs: Date.now(), updatedAtMs: Date.now(), updatedAt: Timestamp.now() })));
  await check("physical delete denied", () => assertFails(deleteDoc(doc(dbFor("member"), "mediaUploadSessions", "comment-member"))));

  await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), "groups", groupId)); });
  await check("missing group denies new session", () => assertFails(setDoc(doc(dbFor("member"), "mediaUploadSessions", "missing-group"), session("missing-group", "member", "bulletin_comment", { groupId, bulletinId: "bulletin1", commentId: "c" }))));
} finally {
  console.log(`\nShared media Firestore rules QA: ${passed} passed.`);
  await env.cleanup();
}
