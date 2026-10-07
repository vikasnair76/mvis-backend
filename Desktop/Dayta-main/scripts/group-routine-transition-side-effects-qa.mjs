import assert from "node:assert/strict";
import {
  allowsRoutineNotification,
  classifyRoutineOccurrenceTransition,
  classifyRoutineParticipantManagerTransition,
  getRoutineActivityId,
  getRoutineAdminLogId,
  getRoutineInboxId,
  getRoutineOccurrenceDeepLink,
  getRoutinePushRequestId,
  getRoutineTransitionCopy,
  getRoutineTransitionEventId,
} from "../functions/lib/groupRoutineTransitionSideEffects.js";

let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const occurrenceBefore = {
  groupId: "g 1",
  routineId: "r1",
  executionStatus: "in_progress",
  executionRevision: 4,
};
const completed = classifyRoutineOccurrenceTransition("o/1", occurrenceBefore, {
  ...occurrenceBefore,
  executionStatus: "completed",
  executionRevision: 5,
  executionUpdatedByUid: "actor",
});
check(completed?.type === "occurrence_completed", "classifies completion");
check(completed?.revision === 5, "keeps occurrence revision");
check(completed?.actorUid === "actor", "keeps occurrence actor");
check(
  classifyRoutineOccurrenceTransition("o1", occurrenceBefore, {
    ...occurrenceBefore,
    executionStatus: "skipped",
    executionRevision: 5,
    executionUpdatedByUid: "actor",
  })?.type === "occurrence_skipped",
  "classifies skip"
);
check(
  classifyRoutineOccurrenceTransition(
    "o1",
    { ...occurrenceBefore, executionStatus: "completed" },
    {
      ...occurrenceBefore,
      executionStatus: "scheduled",
      executionRevision: 5,
      executionUpdatedByUid: "actor",
    }
  )?.type === "occurrence_reopened",
  "classifies reopen"
);
check(
  classifyRoutineOccurrenceTransition("o1", occurrenceBefore, {
    ...occurrenceBefore,
    executionRevision: 5,
    executionUpdatedByUid: "actor",
  }) === null,
  "ignores unchanged status"
);
check(
  classifyRoutineOccurrenceTransition("o1", occurrenceBefore, {
    ...occurrenceBefore,
    executionStatus: "completed",
    executionRevision: 6,
    executionUpdatedByUid: "actor",
  }) === null,
  "rejects revision gaps"
);
check(
  classifyRoutineOccurrenceTransition("o1", occurrenceBefore, {
    ...occurrenceBefore,
    executionStatus: "completed",
    executionRevision: 5,
  }) === null,
  "requires actor"
);
check(
  classifyRoutineOccurrenceTransition("o1", occurrenceBefore, undefined) ===
    null,
  "ignores delete"
);
check(
  classifyRoutineOccurrenceTransition("o1", undefined, occurrenceBefore) ===
    null,
  "ignores create"
);

const participantBefore = {
  groupId: "g1",
  routineId: "r1",
  status: "completed",
  statusRevision: 2,
};
const correction = classifyRoutineParticipantManagerTransition(
  "o1",
  "member",
  participantBefore,
  {
    ...participantBefore,
    status: "pending",
    statusRevision: 3,
    updatedByUid: "manager",
  }
);
check(
  correction?.type === "participant_manager_corrected",
  "classifies manager correction"
);
check(correction?.participantUid === "member", "keeps target participant");
check(correction?.revision === 3, "keeps participant revision");
const excused = classifyRoutineParticipantManagerTransition(
  "o1",
  "member",
  participantBefore,
  {
    ...participantBefore,
    status: "excused",
    statusRevision: 3,
    updatedByUid: "manager",
  }
);
check(excused?.type === "participant_excused", "classifies excuse");
check(
  classifyRoutineParticipantManagerTransition(
    "o1",
    "member",
    participantBefore,
    {
      ...participantBefore,
      status: "pending",
      statusRevision: 3,
      updatedByUid: "member",
    }
  ) === null,
  "ignores self check-in"
);
check(
  classifyRoutineParticipantManagerTransition(
    "o1",
    "member",
    participantBefore,
    { ...participantBefore, statusRevision: 3, updatedByUid: "manager" }
  ) === null,
  "ignores participant metadata updates"
);
check(
  classifyRoutineParticipantManagerTransition(
    "o1",
    "member",
    participantBefore,
    {
      ...participantBefore,
      status: "pending",
      statusRevision: 4,
      updatedByUid: "manager",
    }
  ) === null,
  "rejects participant revision gaps"
);

const eventId = getRoutineTransitionEventId(completed);
check(eventId.startsWith("rte_"), "event id is namespaced");
check(eventId === getRoutineTransitionEventId(completed), "event id is stable");
check(
  eventId !==
    getRoutineTransitionEventId({ ...completed, revision: completed.revision + 1 }),
  "revision changes event id"
);
check(
  eventId !==
    getRoutineTransitionEventId({ ...completed, actorUid: "different" }),
  "actor changes event id"
);
check(getRoutineActivityId(eventId).includes(eventId), "activity id is stable");
check(getRoutineAdminLogId(eventId).includes(eventId), "admin id is stable");
check(
  getRoutineInboxId(eventId, "u1") === getRoutineInboxId(eventId, "u1"),
  "inbox id is stable"
);
check(
  getRoutineInboxId(eventId, "u1") !== getRoutineInboxId(eventId, "u2"),
  "inbox id includes recipient"
);
check(
  getRoutinePushRequestId(eventId, "u1") ===
    getRoutinePushRequestId(eventId, "u1"),
  "push id is stable"
);
check(
  getRoutinePushRequestId(eventId, "u1") !==
    getRoutinePushRequestId(eventId, "u2"),
  "push id includes recipient"
);
check(
  getRoutineOccurrenceDeepLink("g 1", "o/1") ===
    "/group/g%201/routine-occurrence/o%2F1",
  "deep link encodes identifiers"
);
check(allowsRoutineNotification(undefined), "missing preference defaults on");
check(allowsRoutineNotification({}), "empty preference defaults on");
check(
  !allowsRoutineNotification({ muted: true }),
  "group mute suppresses notification"
);
check(
  !allowsRoutineNotification({ categories: { activity: false } }),
  "activity category suppresses notification"
);
check(
  allowsRoutineNotification({ categories: { activity: true } }),
  "activity category allows notification"
);
check(
  getRoutineTransitionCopy(completed).title === "Routine completed",
  "completion copy is restrained"
);
check(
  !getRoutineTransitionCopy(completed).body.includes("note"),
  "completion copy contains no note"
);
check(
  getRoutineTransitionCopy(excused).body.includes("excused"),
  "excuse copy identifies outcome"
);
check(
  getRoutineTransitionCopy(correction).title === "Routine check-in reopened",
  "pending correction copy requests attention"
);

console.log(`Group routine transition side-effect QA passed (${checks} checks).`);
