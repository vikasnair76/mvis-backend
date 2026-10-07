import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dm = readFileSync(new URL("../app/group/[id]/dm/[dmId].tsx", import.meta.url), "utf8");
const conversation = readFileSync(new URL("../app/group/[id]/conversation/[conversationId].tsx", import.meta.url), "utf8");
const groups = readFileSync(new URL("../services/groups.ts", import.meta.url), "utf8");
const cases = [
  ["DM reserves ID", dm, "reserveGroupDmMessageId(dmId)"],
  ["DM exact context", dm, "type: \"group_dm_message\" as const"],
  ["DM creates session", dm, "createMediaUploadSession({"],
  ["DM uses attempt", dm, "createMediaUploadAttempt()"],
  ["DM rejects stale callback", dm, "isCurrentMediaUploadAttempt(attempt, messageAttemptRef.current)"],
  ["DM cancels batch", dm, "messageUploadHandleRef.current?.cancel()"],
  ["DM cleans exact context", dm, "deleteMediaAttachmentObjects(uploaded, context)"],
  ["DM finalizes session", dm, "finalizeMediaUploadSession(sessionId, currentUser.uid)"],
  ["DM renders grid", dm, "<MediaAttachmentGrid"],
  ["DM has one viewer", dm, "<MediaAttachmentViewer"],
  ["conversation reserves ID", conversation, "reserveGroupConversationMessageId(conversationId)"],
  ["conversation exact context", conversation, "type: \"group_conversation_message\" as const"],
  ["conversation creates session", conversation, "createMediaUploadSession({"],
  ["conversation uses attempt", conversation, "createMediaUploadAttempt()"],
  ["conversation rejects stale callback", conversation, "isCurrentMediaUploadAttempt(attempt, messageAttemptRef.current)"],
  ["conversation cancels batch", conversation, "messageUploadHandleRef.current?.cancel()"],
  ["conversation cleans exact context", conversation, "deleteMediaAttachmentObjects(uploaded, context)"],
  ["conversation finalizes session", conversation, "finalizeMediaUploadSession(sessionId, currentUser.uid)"],
  ["conversation renders grid", conversation, "<MediaAttachmentGrid"],
  ["conversation has one viewer", conversation, "<MediaAttachmentViewer"],
  ["DM batch strategy preserved", groups, "const batch = writeBatch(db);"],
  ["DM atomic commit preserved", groups, "await batch.commit();"],
  ["conversation parent update is nonfatal", groups, "conversation parent preview update failed"],
  ["safe preview shared", groups, "export const getSafeMessagePreview"],
];
let passed = 0;
for (const [name, source, expected] of cases) {
  assert.ok(source.includes(expected), `${name}: missing ${expected}`);
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`\nMessage media lifecycle QA: ${passed} passed.`);
