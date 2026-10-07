import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bulletin = readFileSync(new URL("../app/group/[id]/bulletin/[bulletinId].tsx", import.meta.url), "utf8");
const goal = readFileSync(new URL("../app/goal/[id].tsx", import.meta.url), "utf8");

const cases = [
  ["bulletin reserves id", bulletin, "reserveGroupBulletinCommentId(groupId, bulletinId)"],
  ["bulletin exact context", bulletin, "type: \"bulletin_comment\" as const"],
  ["bulletin creates session", bulletin, "createMediaUploadSession({"],
  ["bulletin uses attempt identity", bulletin, "createMediaUploadAttempt()"],
  ["bulletin rejects stale callbacks", bulletin, "isCurrentMediaUploadAttempt(attempt, commentAttemptRef.current)"],
  ["bulletin cancellation", bulletin, "commentUploadHandleRef.current?.cancel()"],
  ["bulletin context cleanup", bulletin, "deleteMediaAttachmentObjects(uploaded, context)"],
  ["bulletin finalizes session", bulletin, "finalizeMediaUploadSession(sessionId, currentUser.uid)"],
  ["goal reserves id", goal, "reserveGroupGoalCommentId(goalDiscussionGroupId, goalId)"],
  ["goal exact context", goal, "type: \"shared_goal_comment\" as const"],
  ["goal creates session", goal, "createMediaUploadSession({"],
  ["goal uses attempt identity", goal, "createMediaUploadAttempt()"],
  ["goal rejects stale callbacks", goal, "isCurrentMediaUploadAttempt(attempt, goalCommentAttemptRef.current)"],
  ["goal cancellation", goal, "goalCommentUploadHandleRef.current?.cancel()"],
  ["goal context cleanup", goal, "deleteMediaAttachmentObjects(uploaded, context)"],
  ["goal finalizes session", goal, "finalizeMediaUploadSession(sessionId, currentUser.uid)"],
];
let passed = 0;
for (const [name, source, expected] of cases) {
  assert.ok(source.includes(expected), `${name}: missing ${expected}`);
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`\nComment media lifecycle QA: ${passed} passed.`);
