import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
let passed = 0;
const check = async (name, work) => {
  await work();
  passed += 1;
  console.log(`PASS ${name}`);
};
const groupId = "materialization-rules-group";
const occurrenceId = "gro_rules";
const projectionId = "grp_gro_rules";
const occurrence = {
  id: occurrenceId, groupId, routineId: "routine", occurrenceKey: "09:00@2026-07-26",
  calendarProjectionId: projectionId, materializationVersion: 1,
  scheduleFingerprint: "schedule", contentFingerprint: "content",
  startAtMs: 1_800_000_000_000, endAtMs: 1_800_003_600_000,
  localDate: "2026-07-26", localStartTime: "09:00",
  timezone: "UTC", durationMinutes: 60, status: "scheduled",
  executionStatus: "scheduled", executionRevision: 0, executionUpdatedAtMs: null,
  executionUpdatedByUid: null, executionParticipantUid: null,
  completedAtMs: null, completedByUid: null,
  skippedAtMs: null, skippedByUid: null, skipReason: null,
  reopenedAtMs: null, reopenedByUid: null,
  participantUids: ["member", "other"], participantCount: 2,
  pendingParticipantCount: 2, completedParticipantCount: 0,
  skippedParticipantCount: 0, excusedParticipantCount: 0,
  routineTitleSnapshot: "Routine", routineDescriptionSnapshot: null,
  routineLocationSnapshot: null, routineCreatedByUid: "member",
  routineCreatedByName: "Member", routineCreatedByEmail: null,
  routineUpdatedAtMsSnapshot: 1, generatedAtMs: 1, updatedAtMs: 1,
  cancelledAtMs: null, cancelledReason: null,
  generatedAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
};
const projection = {
  id: projectionId, scope: "group", type: "group", visibility: "group", groupId,
  title: "Routine", description: null, location: null, allDay: false,
  startAtMs: occurrence.startAtMs, endAtMs: occurrence.endAtMs,
  startDate: null, endDate: null, timezone: "UTC",
  sortStartMs: occurrence.startAtMs, sortEndMs: occurrence.endAtMs,
  createdByUid: "member", createdByName: "Member", createdByEmail: null,
  attendeeUids: [], status: "scheduled", cancelledAtMs: null,
  cancelledByUid: null, createdAtMs: 1, updatedAtMs: 1,
  createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
  sourceType: "group_routine", sourceRoutineId: "routine",
  sourceOccurrenceId: occurrenceId, sourceScheduleFingerprint: "schedule",
};
const dbFor = (uid) => env.authenticatedContext(uid).firestore();

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "groups", groupId), { name: "Group" });
    for (const [uid, role, status = "active"] of [
      ["owner", "owner"], ["member", "member"], ["viewer", "viewer"],
      ["other", "member"],
      ["unassigned", "member"],
      ["removed", "member", "removed"],
    ]) {
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status });
    }
    await setDoc(doc(db, "groupRoutineOccurrences", occurrenceId), occurrence);
    await setDoc(doc(db, "groupRoutines", "routine"), {
      id: "routine", groupId, title: "Routine", description: null, location: null,
      status: "active", frequency: "daily", interval: 1, weekdays: null,
      monthlyMode: null, dayOfMonth: null, weekOfMonth: null,
      weekdayOfMonth: null, localStartTime: "09:00", durationMinutes: 60,
      timezone: "UTC", startDate: "2026-07-26", endDate: null,
      nextOccurrenceAtMs: occurrence.startAtMs, participantUids: ["member", "other"],
      createdByUid: "member", createdByName: "Member", createdByEmail: null,
      createdAtMs: 1, updatedAtMs: 1, createdAt: Timestamp.fromMillis(1),
      updatedAt: Timestamp.fromMillis(1), pausedAtMs: null, pausedByUid: null,
      archivedAtMs: null, archivedByUid: null,
    });
    for (const uid of ["member", "other"]) {
      await setDoc(
        doc(db, "groupRoutineOccurrences", occurrenceId, "participants", uid),
        {
          id: uid, uid, groupId, routineId: "routine", occurrenceId,
          status: "pending", statusRevision: 0, note: null, completedAtMs: null,
          skippedAtMs: null, excusedAtMs: null, updatedByUid: "system",
          updatedAtMs: 1, createdAtMs: 1,
        }
      );
    }
    await setDoc(doc(db, "planningCalendarEvents", projectionId), projection);
    await setDoc(doc(db, "groupRoutineOccurrences", "missing-group"), {
      ...occurrence, id: "missing-group", groupId: "deleted-group",
      calendarProjectionId: "grp_missing",
    });
  });

  for (const uid of ["owner", "member", "viewer"]) {
    await check(`${uid} reads occurrence`, () =>
      assertSucceeds(getDoc(doc(dbFor(uid), "groupRoutineOccurrences", occurrenceId)))
    );
    await check(`${uid} reads generated projection`, () =>
      assertSucceeds(getDoc(doc(dbFor(uid), "planningCalendarEvents", projectionId)))
    );
  }
  for (const uid of ["removed", "unrelated"]) {
    await check(`${uid} cannot read occurrence`, () =>
      assertFails(getDoc(doc(dbFor(uid), "groupRoutineOccurrences", occurrenceId)))
    );
  }
  await check("signed-out cannot read occurrence", () =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "groupRoutineOccurrences", occurrenceId)))
  );
  await check("viewer can query generated occurrences", () =>
    assertSucceeds(getDocs(query(
      collection(dbFor("viewer"), "groupRoutineOccurrences"),
      where("groupId", "==", groupId),
      where("status", "==", "scheduled")
    )))
  );
  await check("broad occurrence query denied", () =>
    assertFails(getDocs(collection(dbFor("viewer"), "groupRoutineOccurrences")))
  );
  await check("missing parent group denies occurrence", () =>
    assertFails(getDoc(doc(dbFor("viewer"), "groupRoutineOccurrences", "missing-group")))
  );
  for (const uid of ["owner", "member", "viewer"]) {
    await check(`${uid} cannot create occurrence`, () =>
      assertFails(setDoc(doc(dbFor(uid), "groupRoutineOccurrences", `fake-${uid}`), {
        ...occurrence, id: `fake-${uid}`,
      }))
    );
    await check(`${uid} cannot update occurrence`, () =>
      assertFails(updateDoc(doc(dbFor(uid), "groupRoutineOccurrences", occurrenceId), {
        routineTitleSnapshot: "Forged",
      }))
    );
    await check(`${uid} cannot delete occurrence`, () =>
      assertFails(deleteDoc(doc(dbFor(uid), "groupRoutineOccurrences", occurrenceId)))
    );
  }
  await check("member cannot forge generated projection", () =>
    assertFails(setDoc(doc(dbFor("member"), "planningCalendarEvents", "fake-projection"), {
      ...projection, id: "fake-projection",
    }))
  );
  await check("owner cannot edit generated projection", () =>
    assertFails(updateDoc(doc(dbFor("owner"), "planningCalendarEvents", projectionId), {
      title: "Forged", updatedAtMs: 2,
    }))
  );
  await check("owner cannot delete generated projection", () =>
    assertFails(deleteDoc(doc(dbFor("owner"), "planningCalendarEvents", projectionId))
  ));
  await check("generated projection cannot convert to user event", () =>
    assertFails(updateDoc(doc(dbFor("member"), "planningCalendarEvents", projectionId), {
      sourceType: null, sourceRoutineId: null, sourceOccurrenceId: null,
      sourceScheduleFingerprint: null,
    }))
  );
  await check("assigned member reads participants", () =>
    assertSucceeds(
      getDocs(
        collection(
          dbFor("member"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants"
        )
      )
    )
  );
  await check("viewer reads participants", () =>
    assertSucceeds(
      getDoc(
        doc(
          dbFor("viewer"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "member"
        )
      )
    )
  );
  await check("removed member cannot read participants", () =>
    assertFails(
      getDoc(
        doc(
          dbFor("removed"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "member"
        )
      )
    )
  );
  await check("unassigned member cannot edit another participant", () =>
    assertFails(
      updateDoc(
        doc(
          dbFor("unassigned"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "other"
        ),
        { status: "completed", updatedByUid: "unassigned", updatedAtMs: 2 }
      )
    )
  );
  await check("non-manager member cannot excuse self", () =>
    assertFails(
      updateDoc(
        doc(
          dbFor("other"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "other"
        ),
        { status: "excused", updatedByUid: "other", updatedAtMs: 2 }
      )
    )
  );
  await check("viewer cannot check in", () =>
    assertFails(
      updateDoc(
        doc(
          dbFor("viewer"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "member"
        ),
        { status: "completed", updatedByUid: "viewer", updatedAtMs: 2 }
      )
    )
  );
  await check("participant delete denied", () =>
    assertFails(
      deleteDoc(
        doc(
          dbFor("owner"),
          "groupRoutineOccurrences",
          occurrenceId,
          "participants",
          "member"
        )
      )
    )
  );
  await check("member self-completion and rollup succeeds atomically", async () => {
    const db = dbFor("member");
    const batch = writeBatch(db);
    batch.update(
      doc(db, "groupRoutineOccurrences", occurrenceId, "participants", "member"),
      {
        status: "completed", statusRevision: 1, completedAtMs: 2, skippedAtMs: null,
        excusedAtMs: null, updatedByUid: "member", updatedAtMs: 2,
      }
    );
    batch.update(doc(db, "groupRoutineOccurrences", occurrenceId), {
      executionStatus: "in_progress", executionRevision: 1, executionUpdatedAtMs: 2,
      executionUpdatedByUid: "member", executionParticipantUid: "member",
      completedAtMs: null,
      completedByUid: null, skippedAtMs: null, skippedByUid: null,
      skipReason: null, reopenedAtMs: null, reopenedByUid: null,
      participantCount: 2, pendingParticipantCount: 1,
      completedParticipantCount: 1, skippedParticipantCount: 0,
      excusedParticipantCount: 0, updatedAtMs: 2, updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
  await check("participant cannot spoof aggregate without participant transition", () =>
    assertFails(
      updateDoc(doc(dbFor("other"), "groupRoutineOccurrences", occurrenceId), {
        pendingParticipantCount: 0, completedParticipantCount: 2,
        executionStatus: "completed", executionUpdatedAtMs: 3,
        executionUpdatedByUid: "other", executionParticipantUid: "other",
        updatedAtMs: 3,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("owner can excuse participant with valid rollup", async () => {
    const db = dbFor("owner");
    const batch = writeBatch(db);
    batch.update(
      doc(db, "groupRoutineOccurrences", occurrenceId, "participants", "other"),
      {
        status: "excused", statusRevision: 1, completedAtMs: null, skippedAtMs: null,
        excusedAtMs: 4, updatedByUid: "owner", updatedAtMs: 4,
      }
    );
    batch.update(doc(db, "groupRoutineOccurrences", occurrenceId), {
      executionStatus: "completed", executionRevision: 2, executionUpdatedAtMs: 4,
      executionUpdatedByUid: "owner", executionParticipantUid: "other",
      completedAtMs: 4,
      completedByUid: "owner", skippedAtMs: null, skippedByUid: null,
      skipReason: null, reopenedAtMs: null, reopenedByUid: null,
      participantCount: 2, pendingParticipantCount: 0,
      completedParticipantCount: 1, skippedParticipantCount: 0,
      excusedParticipantCount: 1, updatedAtMs: 4, updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
  await check("client cannot forge trusted routine activity", () =>
    assertFails(
      setDoc(doc(dbFor("owner"), "groups", groupId, "activity", "forged"), {
        groupId,
        actorUid: "owner",
        type: "occurrence_completed",
        message: "forged",
        createdAtMs: 5,
      })
    )
  );
  await check("client cannot forge trusted routine admin log", () =>
    assertFails(
      setDoc(doc(dbFor("owner"), "groups", groupId, "adminLogs", "forged"), {
        groupId,
        actorUid: "owner",
        action: "routine_participant_excused",
        message: "forged",
        createdAtMs: 5,
      })
    )
  );
  await check("client cannot forge trusted routine inbox item", () =>
    assertFails(
      setDoc(doc(dbFor("member"), "users", "member", "groupInbox", "forged"), {
        uid: "member",
        groupId,
        type: "activity",
        trustedRoutine: true,
        createdAtMs: 5,
      })
    )
  );
  await check("client cannot create transition ledger", () =>
    assertFails(
      setDoc(doc(dbFor("owner"), "routineTransitionEvents", "forged"), {
        status: "processed",
      })
    )
  );
  await check("client cannot read transition ledger", () =>
    assertFails(getDoc(doc(dbFor("owner"), "routineTransitionEvents", "forged")))
  );
  await check("client cannot create routine push request", () =>
    assertFails(
      setDoc(doc(dbFor("owner"), "routineNotificationRequests", "forged"), {
        status: "queued",
      })
    )
  );
  await check("participant revision jump is denied", () =>
    assertFails(
      updateDoc(
        doc(dbFor("other"), "groupRoutineOccurrences", occurrenceId, "participants", "other"),
        { status: "pending", statusRevision: 3, updatedByUid: "other", updatedAtMs: 6 }
      )
    )
  );
  await check("participant revision-only update is denied", () =>
    assertFails(
      updateDoc(
        doc(dbFor("owner"), "groupRoutineOccurrences", occurrenceId, "participants", "other"),
        { statusRevision: 2, updatedByUid: "owner", updatedAtMs: 6 }
      )
    )
  );
  await check("occurrence revision-only update is denied", () =>
    assertFails(
      updateDoc(doc(dbFor("owner"), "groupRoutineOccurrences", occurrenceId), {
        executionRevision: 3,
        updatedAtMs: 6,
      })
    )
  );
  await check("occurrence status change without revision is denied", () =>
    assertFails(
      updateDoc(doc(dbFor("owner"), "groupRoutineOccurrences", occurrenceId), {
        executionStatus: "skipped",
        executionRevision: 2,
        updatedAtMs: 6,
      })
    )
  );
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(context.firestore(), "groups", groupId, "members", "member"),
      { status: "removed" }
    );
  });
  await check("removed member offline replay is denied", () =>
    assertFails(
      updateDoc(
        doc(dbFor("member"), "groupRoutineOccurrences", occurrenceId, "participants", "member"),
        { note: "offline", updatedByUid: "member", updatedAtMs: 7 }
      )
    )
  );
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "groupRoutineOccurrences", occurrenceId), {
      status: "cancelled",
      cancelledAtMs: 7,
      cancelledReason: "paused",
    });
  });
  await check("cancelled occurrence offline replay is denied", () =>
    assertFails(
      updateDoc(
        doc(dbFor("other"), "groupRoutineOccurrences", occurrenceId, "participants", "other"),
        { note: "offline", updatedByUid: "other", updatedAtMs: 8 }
      )
    )
  );
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "groupRoutineOccurrences", occurrenceId), {
      status: "scheduled",
      cancelledAtMs: null,
      cancelledReason: null,
      participantUids: ["member"],
      participantCount: 1,
    });
  });
  await check("removed assignment note replay is denied", () =>
    assertFails(
      updateDoc(
        doc(dbFor("other"), "groupRoutineOccurrences", occurrenceId, "participants", "other"),
        { note: "offline", updatedByUid: "other", updatedAtMs: 9 }
      )
    )
  );
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "groups", groupId, "members", "owner"), {
      role: "member",
    });
  });
  await check("manager authority loss denies stale correction", () =>
    assertFails(
      updateDoc(
        doc(dbFor("owner"), "groupRoutineOccurrences", occurrenceId, "participants", "member"),
        { status: "excused", statusRevision: 2, updatedByUid: "owner", updatedAtMs: 10 }
      )
    )
  );
} finally {
  await env.cleanup();
}

console.log(`\nGroup routine materialization rules QA: ${passed} passed, 0 failed.`);
