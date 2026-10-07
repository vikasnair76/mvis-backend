import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail = readFileSync(
  new URL("../app/group/[id]/bulletin/[bulletinId].tsx", import.meta.url),
  "utf8"
);

const cases = [
  ["edit creates upload attempt", "createMediaUploadAttempt()"],
  ["edit checks current attempt", "isCurrentMediaUploadAttempt(attempt, editAttemptRef.current)"],
  ["edit exposes aggregate progress", "setEditUploadProgress(aggregate)"],
  ["edit exposes cancellation", "editUploadHandleRef.current?.cancel()"],
  ["edit invalidates cancelled attempt", "cancelMediaUploadAttempt(attempt)"],
  ["editor close is guarded", "\"Upload in progress\""],
  ["failed edit preserves bulletin copy", "\"Your bulletin was not changed.\""],
  ["new upload cleanup is context bound", "deleteMediaAttachmentObjects(newlyUploaded, context)"],
  ["removed media cleanup follows update", "await updateGroupBulletin({"],
  ["cleanup failure copy is truthful", "\"The bulletin was updated, but an old attachment could not be cleaned up.\""],
];

let passed = 0;
for (const [name, expected] of cases) {
  assert.ok(detail.includes(expected), `${name}: missing ${expected}`);
  passed += 1;
  console.log(`PASS ${name}`);
}

assert.ok(
  detail.indexOf("await updateGroupBulletin({") <
    detail.indexOf("deleteMediaAttachmentObjects(removed, context)"),
  "removed media must be cleaned only after Firestore update"
);
passed += 1;
console.log("PASS removed cleanup ordering");

console.log(`\nBulletin media lifecycle QA: ${passed} passed.`);
