/**
 * Firestore rules QA for the auto-applied duration idempotency markers.
 *
 * `goals/{goalId}/subtasks/{subtaskId}.autoAppliedDurationEventIds` records
 * which calendar events already contributed metric progress. An assigned
 * member is allowed to append to it, but never to remove, replace or clear
 * it — dropping an id would let the same event be counted twice.
 */
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const groupId = "group-auto-apply-qa";
const goalId = "goal-auto-apply-qa";
const subtaskId = "subtask-auto-apply-qa";
const nowMs = 1_800_000_000_000;

const OWNER = "owner";
const ASSIGNEE = "assignee";
const OTHER_MEMBER = "member2";
const OUTSIDER = "outsider";

const EXISTING = ["event-a", "event-b"];
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

let passed = 0;
const failures = [];

async function check(name, work) {
  try {
    await work();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

const env = await initializeTestEnvironment({ projectId, firestore: { rules } });

/** Reset the subtask to a known marker list before each case. */
async function seedSubtask(autoAppliedDurationEventIds = EXISTING) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "goals", goalId, "subtasks", subtaskId), {
      id: subtaskId,
      goalId,
      title: "Deep work",
      assignedToUid: ASSIGNEE,
      assignedByUid: OWNER,
      contributesToMetric: true,
      metricUnit: "hours",
      firstCompletedAtMs: null,
      autoAppliedDurationEventIds,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  });
}

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "groups", groupId), { name: "Auto apply QA", createdAtMs: nowMs });

    for (const [uid, status] of [
      [OWNER, "active"],
      [ASSIGNEE, "active"],
      [OTHER_MEMBER, "active"],
    ]) {
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role: "member", status });
    }

    await setDoc(doc(db, "goals", goalId), {
      userId: OWNER,
      title: "Shared goal",
      visibility: "group_shared",
      sharedGroupIds: [groupId],
      contributesToMetric: true,
      metricTargetValue: 10,
      currentMetricValue: 0,
      status: "active",
      createdAtMs: nowMs,
    });

    await setDoc(doc(db, "groups", groupId, "sharedGoals", goalId), {
      goalId,
      ownerUid: OWNER,
      sharedAtMs: nowMs,
    });
  });

  const dbFor = (uid) => env.authenticatedContext(uid).firestore();
  const subtaskRef = (uid) => doc(dbFor(uid), "goals", goalId, "subtasks", subtaskId);

  // -------------------------------------------------------------------------
  // Allowed: the real automation path
  // -------------------------------------------------------------------------

  await check("assignee appends a new marker with arrayUnion", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: arrayUnion("event-c"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee appends a marker written as an explicit superset", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: [...EXISTING, "event-c"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee re-writing the identical list is allowed (idempotent retry)", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: [...EXISTING],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee seeds the first marker when the field is absent", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "goals", goalId, "subtasks", subtaskId), {
        id: subtaskId,
        goalId,
        title: "Deep work",
        assignedToUid: ASSIGNEE,
        assignedByUid: OWNER,
        contributesToMetric: true,
        metricUnit: "hours",
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    });
    await assertSucceeds(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: arrayUnion("event-a"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee updates firstCompletedAtMs without touching the markers", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(ASSIGNEE), {
        firstCompletedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      })
    );
  });

  // -------------------------------------------------------------------------
  // Denied: anything that loses an existing marker
  // -------------------------------------------------------------------------

  await check("assignee cannot remove an existing marker with arrayRemove", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: arrayRemove("event-a"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot drop a marker by writing a shorter list", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: ["event-a"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot replace the marker list with unrelated ids", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: ["event-x", "event-y"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot swap one marker while keeping the size", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: ["event-a", "event-z"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot reset the marker list to empty", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot delete the marker field", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: deleteField(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot change the markers to a non-list", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: "event-a",
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee cannot append more than one marker per write", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        autoAppliedDurationEventIds: [...EXISTING, "event-c", "event-d"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  // -------------------------------------------------------------------------
  // Denied: anyone who is not the assignee
  // -------------------------------------------------------------------------

  await check("another group member cannot append a marker", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(OTHER_MEMBER), {
        autoAppliedDurationEventIds: arrayUnion("event-c"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("another group member cannot clear the markers", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(OTHER_MEMBER), {
        autoAppliedDurationEventIds: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("a non-member cannot touch the markers", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(OUTSIDER), {
        autoAppliedDurationEventIds: arrayUnion("event-c"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("an unauthenticated client cannot touch the markers", async () => {
    await seedSubtask();
    const db = env.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, "goals", goalId, "subtasks", subtaskId), {
        autoAppliedDurationEventIds: arrayUnion("event-c"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // -------------------------------------------------------------------------
  // Owner behaviour is unchanged
  // -------------------------------------------------------------------------

  await check("goal owner can still append a marker", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(OWNER), {
        autoAppliedDurationEventIds: arrayUnion("event-c"),
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("goal owner can still clear the markers", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(OWNER), {
        autoAppliedDurationEventIds: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("goal owner can still edit unrelated subtask fields", async () => {
    await seedSubtask();
    await assertSucceeds(
      updateDoc(subtaskRef(OWNER), {
        title: "Deeper work",
        updatedAt: serverTimestamp(),
      })
    );
  });

  await check("assignee still cannot edit unrelated subtask fields", async () => {
    await seedSubtask();
    await assertFails(
      updateDoc(subtaskRef(ASSIGNEE), {
        title: "Renamed by assignee",
        updatedAt: serverTimestamp(),
      })
    );
  });
} finally {
  await env.cleanup();
}

console.log(
  `\nAuto-apply marker rules QA: ${passed} passed, ${failures.length} failed.`
);
if (failures.length > 0) process.exitCode = 1;
