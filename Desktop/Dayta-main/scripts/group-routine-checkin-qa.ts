import assert from "node:assert/strict";
import {
  canTransitionRoutineOccurrenceStatus,
  canTransitionRoutineParticipantStatus,
  deriveRoutineOccurrenceExecutionState,
  getRoutineCompletionMetrics,
  hasValidRoutineOccurrenceCountInvariant,
  mapGroupRoutineOccurrenceDoc,
  mapGroupRoutineOccurrenceParticipantDoc,
  normalizeRoutineCheckInNote,
  normalizeRoutineOccurrenceStatus,
  normalizeRoutineParticipantStatus,
} from "../services/groupRoutineOccurrences";

let count = 0;
function check(name: string, test: () => void) {
  test();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}
const rollup = (
  statuses: ("pending" | "completed" | "skipped" | "excused")[],
  cancelled = false
) =>
  deriveRoutineOccurrenceExecutionState({
    scheduleCancelled: cancelled,
    participantStatuses: statuses,
  });

check("normalizes valid occurrence status", () =>
  assert.equal(normalizeRoutineOccurrenceStatus("completed"), "completed"));
check("falls back invalid occurrence status", () =>
  assert.equal(normalizeRoutineOccurrenceStatus("bad"), "scheduled"));
check("normalizes valid participant status", () =>
  assert.equal(normalizeRoutineParticipantStatus("excused"), "excused"));
check("falls back invalid participant status", () =>
  assert.equal(normalizeRoutineParticipantStatus("bad"), "pending"));
check("normalizes note", () =>
  assert.equal(normalizeRoutineCheckInNote(" hello\r\nworld "), "hello\nworld"));
check("empty note becomes null", () =>
  assert.equal(normalizeRoutineCheckInNote("  "), null));
check("note max enforced", () =>
  assert.throws(() => normalizeRoutineCheckInNote("x".repeat(501))));
check("count invariant valid", () =>
  assert.equal(
    hasValidRoutineOccurrenceCountInvariant({
      participantCount: 3,
      pendingParticipantCount: 1,
      completedParticipantCount: 1,
      skippedParticipantCount: 0,
      excusedParticipantCount: 1,
    }),
    true
  ));
check("count invariant invalid", () =>
  assert.equal(
    hasValidRoutineOccurrenceCountInvariant({
      participantCount: 3,
      pendingParticipantCount: 0,
      completedParticipantCount: 1,
      skippedParticipantCount: 0,
      excusedParticipantCount: 1,
    }),
    false
  ));
check("all pending scheduled", () =>
  assert.equal(rollup(["pending", "pending"]).executionStatus, "scheduled"));
check("partial resolved in progress", () =>
  assert.equal(rollup(["completed", "pending"]).executionStatus, "in_progress"));
check("all completed complete", () =>
  assert.equal(rollup(["completed", "completed"]).executionStatus, "completed"));
check("completed and excused complete", () =>
  assert.equal(rollup(["completed", "excused"]).executionStatus, "completed"));
check("all skipped skipped", () =>
  assert.equal(rollup(["skipped", "skipped"]).executionStatus, "skipped"));
check("skipped and excused skipped", () =>
  assert.equal(rollup(["skipped", "excused"]).executionStatus, "skipped"));
check("mixed resolved complete", () =>
  assert.equal(rollup(["completed", "skipped"]).executionStatus, "completed"));
check("cancelled overrides completion", () =>
  assert.equal(rollup(["completed"], true).executionStatus, "cancelled"));
check("no participants scheduled", () =>
  assert.equal(rollup([]).executionStatus, "scheduled"));
check("no participants manager complete", () =>
  assert.equal(
    deriveRoutineOccurrenceExecutionState({
      scheduleCancelled: false,
      participantStatuses: [],
      noParticipantStatus: "completed",
    }).executionStatus,
    "completed"
  ));
check("self complete allowed", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "completed",
      actorRole: "member",
      actorStatus: "active",
      actorUid: "member",
      participantUid: "member",
      scheduleCancelled: false,
    }),
    true
  ));
check("self skip allowed", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "skipped",
      actorRole: "member",
      actorStatus: "active",
      actorUid: "member",
      participantUid: "member",
      scheduleCancelled: false,
    }),
    true
  ));
check("other-user update denied", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "completed",
      actorRole: "member",
      actorStatus: "active",
      actorUid: "member",
      participantUid: "other",
      scheduleCancelled: false,
    }),
    false
  ));
check("manager excuse allowed", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "excused",
      actorRole: "moderator",
      actorStatus: "active",
      actorUid: "mod",
      participantUid: "member",
      scheduleCancelled: false,
    }),
    true
  ));
check("viewer denied", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "completed",
      actorRole: "viewer",
      actorStatus: "active",
      actorUid: "viewer",
      participantUid: "viewer",
      scheduleCancelled: false,
    }),
    false
  ));
check("removed member denied", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "completed",
      actorRole: "owner",
      actorStatus: "removed",
      actorUid: "owner",
      participantUid: "member",
      scheduleCancelled: false,
    }),
    false
  ));
check("cancelled occurrence denied", () =>
  assert.equal(
    canTransitionRoutineParticipantStatus({
      from: "pending",
      to: "completed",
      actorRole: "owner",
      actorStatus: "active",
      actorUid: "owner",
      participantUid: "member",
      scheduleCancelled: true,
    }),
    false
  ));
check("assigned occurrence blocks direct completion", () =>
  assert.equal(
    canTransitionRoutineOccurrenceStatus({
      from: "scheduled",
      to: "completed",
      actorRole: "owner",
      actorStatus: "active",
      actorUid: "owner",
      routineCreatedByUid: "member",
      hasParticipants: true,
      scheduleCancelled: false,
    }),
    false
  ));
check("manager can complete no-participant occurrence", () =>
  assert.equal(
    canTransitionRoutineOccurrenceStatus({
      from: "scheduled",
      to: "completed",
      actorRole: "owner",
      actorStatus: "active",
      actorUid: "owner",
      routineCreatedByUid: "member",
      hasParticipants: false,
      scheduleCancelled: false,
    }),
    true
  ));

const baseOccurrence = {
  id: "occ",
  groupId: "group",
  routineId: "routine",
  occurrenceKey: "09:00@2026-07-25",
  calendarProjectionId: "projection",
  materializationVersion: 1,
  scheduleFingerprint: "schedule",
  contentFingerprint: "content",
  startAtMs: 100,
  endAtMs: 200,
  localDate: "2026-07-25",
  localStartTime: "09:00",
  timezone: "UTC",
  durationMinutes: 1,
  status: "scheduled",
  routineTitleSnapshot: "Routine",
  routineDescriptionSnapshot: null,
  routineLocationSnapshot: null,
  routineCreatedByUid: "owner",
  routineCreatedByName: null,
  routineCreatedByEmail: null,
  routineUpdatedAtMsSnapshot: 100,
  generatedAtMs: 100,
  updatedAtMs: 100,
  cancelledAtMs: null,
  cancelledReason: null,
  generatedAt: null,
  updatedAt: null,
};
check("legacy occurrence defaults execution", () =>
  assert.equal(
    mapGroupRoutineOccurrenceDoc("occ", baseOccurrence)?.executionStatus,
    "scheduled"
  ));
check("legacy occurrence defaults empty participant snapshot", () =>
  assert.deepEqual(
    mapGroupRoutineOccurrenceDoc("occ", baseOccurrence)?.participantUids,
    []
  ));
check("completed metadata maps", () =>
  assert.equal(
    mapGroupRoutineOccurrenceDoc("occ", {
      ...baseOccurrence,
      executionStatus: "completed",
      executionUpdatedAtMs: 110,
      executionUpdatedByUid: "owner",
      completedAtMs: 110,
      completedByUid: "owner",
    })?.completedByUid,
    "owner"
  ));
check("cancelled schedule overrides execution", () =>
  assert.equal(
    mapGroupRoutineOccurrenceDoc("occ", {
      ...baseOccurrence,
      status: "cancelled",
      cancelledAtMs: 110,
      cancelledReason: "paused",
      executionStatus: "completed",
    })?.executionStatus,
    "cancelled"
  ));
const participant = {
  id: "member",
  uid: "member",
  groupId: "group",
  routineId: "routine",
  occurrenceId: "occ",
  status: "pending",
  note: null,
  completedAtMs: null,
  skippedAtMs: null,
  excusedAtMs: null,
  updatedByUid: "system",
  updatedAtMs: 100,
  createdAtMs: 100,
};
for (const status of ["pending", "completed", "skipped", "excused"] as const) {
  check(`maps participant ${status}`, () =>
    assert.equal(
      mapGroupRoutineOccurrenceParticipantDoc("member", {
        ...participant,
        status,
      })?.status,
      status
    ));
}
check("participant context mismatch rejected", () =>
  assert.equal(
    mapGroupRoutineOccurrenceParticipantDoc("other", participant),
    null
  ));
check("completion metrics exclude unresolved and cancelled", () => {
  const mapped = ["completed", "skipped", "scheduled", "cancelled"].map(
    (executionStatus) =>
      mapGroupRoutineOccurrenceDoc("occ", {
        ...baseOccurrence,
        executionStatus,
        status: executionStatus === "cancelled" ? "cancelled" : "scheduled",
        cancelledAtMs: executionStatus === "cancelled" ? 110 : null,
        cancelledReason: executionStatus === "cancelled" ? "paused" : null,
      })!
  );
  assert.deepEqual(getRoutineCompletionMetrics(mapped), {
    completed: 1,
    skipped: 1,
    resolved: 2,
    completionRate: 0.5,
  });
});

console.log(`1..${count}`);
