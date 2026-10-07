import assert from "node:assert/strict";
import "./group-routine-checkin-qa";
import {
  canCreateGroupRoutineUi,
  canManageGroupRoutineUi,
  createGroupRoutineFormDefaults,
  createGroupRoutineFormFromDoc,
  formatGroupRoutineDuration,
  formatGroupRoutineNextOccurrence,
  formatGroupRoutineRecurrenceSummary,
  getGroupRoutineCreatorLabel,
  getGroupRoutineStatusLabel,
  normalizeGroupRoutineForm,
} from "../services/groupRoutineUi";
import type { GroupRoutineDoc } from "../services/groupRoutines";
import { mapGroupRoutineOccurrenceDoc } from "../services/groupRoutineOccurrences";

let passed = 0;
function check(name: string, work: () => void) {
  work();
  passed += 1;
  console.log(`PASS ${name}`);
}

function routine(patch: Partial<GroupRoutineDoc> = {}): GroupRoutineDoc {
  return {
    participantUids: [],
    id: "routine",
    groupId: "group",
    title: "Standup",
    description: null,
    location: null,
    status: "active",
    frequency: "weekly",
    interval: 1,
    weekdays: [1, 3, 5],
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    weekdayOfMonth: null,
    localStartTime: "09:00",
    durationMinutes: null,
    timezone: "UTC",
    startDate: "2026-01-01",
    endDate: null,
    nextOccurrenceAtMs: Date.UTC(2026, 0, 2, 9),
    createdByUid: "member",
    createdByName: "Alex",
    createdByEmail: "alex@example.com",
    createdAtMs: 1,
    updatedAtMs: 1,
    createdAt: null,
    updatedAt: null,
    pausedAtMs: null,
    pausedByUid: null,
    archivedAtMs: null,
    archivedByUid: null,
    ...patch,
  };
}

check("active status label", () => assert.equal(getGroupRoutineStatusLabel("active"), "Active"));
check("paused status label", () => assert.equal(getGroupRoutineStatusLabel("paused"), "Paused"));
check("archived status label", () => assert.equal(getGroupRoutineStatusLabel("archived"), "Archived"));
check("daily summary", () => assert.equal(formatGroupRoutineRecurrenceSummary(routine({ frequency: "daily", weekdays: null })), "Every day at 9:00 AM"));
check("interval daily summary", () => assert.equal(formatGroupRoutineRecurrenceSummary(routine({ frequency: "daily", interval: 2, weekdays: null })), "Every 2 days at 9:00 AM"));
check("weekly summary orders days", () => assert.equal(formatGroupRoutineRecurrenceSummary(routine()), "Every week on Monday, Wednesday, and Friday at 9:00 AM"));
check("weekly interval summary", () => assert.match(formatGroupRoutineRecurrenceSummary(routine({ interval: 2, weekdays: [2, 4] })), /Every 2 weeks on Tuesday and Thursday/));
check("monthly day summary", () => assert.equal(formatGroupRoutineRecurrenceSummary(routine({ frequency: "monthly", weekdays: null, monthlyMode: "day_of_month", dayOfMonth: 15 })), "Monthly on day 15 at 9:00 AM"));
check("monthly day interval", () => assert.match(formatGroupRoutineRecurrenceSummary(routine({ frequency: "monthly", interval: 2, weekdays: null, monthlyMode: "day_of_month", dayOfMonth: 31 })), /Every 2 months on day 31/));
check("monthly first weekday", () => assert.match(formatGroupRoutineRecurrenceSummary(routine({ frequency: "monthly", weekdays: null, monthlyMode: "nth_weekday", weekOfMonth: 1, weekdayOfMonth: 1 })), /first Monday/));
check("monthly last weekday", () => assert.match(formatGroupRoutineRecurrenceSummary(routine({ frequency: "monthly", weekdays: null, monthlyMode: "nth_weekday", weekOfMonth: -1, weekdayOfMonth: 5 })), /last Friday/));
check("duration null", () => assert.equal(formatGroupRoutineDuration(null), null));
check("duration minutes", () => assert.equal(formatGroupRoutineDuration(15), "15 min"));
check("duration hour", () => assert.equal(formatGroupRoutineDuration(60), "1 hr"));
check("duration mixed", () => assert.equal(formatGroupRoutineDuration(90), "1 hr 30 min"));
check("duration days", () => assert.equal(formatGroupRoutineDuration(1500), "1 day 1 hr"));
check("creator name preferred", () => assert.equal(getGroupRoutineCreatorLabel(routine()), "Alex"));
check("creator email fallback", () => assert.equal(getGroupRoutineCreatorLabel(routine({ createdByName: null })), "alex@example.com"));
check("creator safe fallback", () => assert.equal(getGroupRoutineCreatorLabel(routine({ createdByName: null, createdByEmail: null })), "Group member"));
check("paused next copy", () => assert.equal(formatGroupRoutineNextOccurrence(routine({ status: "paused", nextOccurrenceAtMs: null, pausedAtMs: 1, pausedByUid: "member" })), "Paused"));
check("archived next copy", () => assert.equal(formatGroupRoutineNextOccurrence(routine({ status: "archived", nextOccurrenceAtMs: null, archivedAtMs: 1, archivedByUid: "member" })), "Archived"));
check("ended next copy", () => assert.equal(formatGroupRoutineNextOccurrence(routine({ endDate: "2026-01-01", nextOccurrenceAtMs: Date.UTC(2026, 0, 1, 9) }), Date.UTC(2026, 0, 2)), "Schedule ended"));
check("stale cache recalculates display only", () => assert.match(formatGroupRoutineNextOccurrence(routine({ frequency: "daily", weekdays: null, nextOccurrenceAtMs: Date.UTC(2026, 0, 1, 9) }), Date.UTC(2026, 0, 2, 8)), /^Next:/));

for (const role of ["owner", "admin", "moderator"] as const) {
  check(`${role} manages any routine`, () => assert.equal(canManageGroupRoutineUi(role, "active", "other", routine()), true));
}
check("member manages own", () => assert.equal(canManageGroupRoutineUi("member", "active", "member", routine()), true));
check("member cannot manage another", () => assert.equal(canManageGroupRoutineUi("member", "active", "other", routine()), false));
check("viewer cannot manage", () => assert.equal(canManageGroupRoutineUi("viewer", "active", "member", routine()), false));
check("removed member cannot manage", () => assert.equal(canManageGroupRoutineUi("owner", "removed", "member", routine()), false));
check("archived cannot be managed", () => assert.equal(canManageGroupRoutineUi("owner", "active", "member", routine({ status: "archived" })), false));
check("member can create", () => assert.equal(canCreateGroupRoutineUi("member", "active"), true));
check("viewer cannot create", () => assert.equal(canCreateGroupRoutineUi("viewer", "active"), false));
check("removed cannot create", () => assert.equal(canCreateGroupRoutineUi("owner", "removed"), false));

check("blank optional values normalize null", () => {
  const normalized = normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", description: " ", location: "" });
  assert.equal(normalized.description, null);
  assert.equal(normalized.location, null);
});
check("daily clears recurrence fields", () => {
  const normalized = normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", frequency: "daily" });
  assert.equal(normalized.weekdays, null);
  assert.equal(normalized.monthlyMode, null);
});
check("weekly weekdays sort", () => {
  const normalized = normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", weekdays: [5, 1, 3] });
  assert.deepEqual(normalized.weekdays, [1, 3, 5]);
});
check("monthly day clears nth values", () => {
  const normalized = normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", frequency: "monthly", monthlyMode: "day_of_month", dayOfMonthText: "15" });
  assert.equal(normalized.dayOfMonth, 15);
  assert.equal(normalized.weekOfMonth, null);
});
check("monthly nth clears day value", () => {
  const normalized = normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, weekdayOfMonth: 5 });
  assert.equal(normalized.dayOfMonth, null);
  assert.equal(normalized.weekOfMonth, -1);
});
check("disabled end date normalizes null", () => assert.equal(normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", hasEndDate: false }).endDate, null));
check("disabled duration normalizes null", () => assert.equal(normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", hasDuration: false }).durationMinutes, null));
check("duration combines hours and minutes", () => assert.equal(normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", hasDuration: true, durationHoursText: "1", durationMinutesText: "30" }).durationMinutes, 90));
check("invalid interval rejected", () => assert.throws(() => normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", intervalText: "0" })));
check("invalid timezone rejected", () => assert.throws(() => normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", timezone: "Nope/Zone" })));
check("missing weekly day rejected", () => assert.throws(() => normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", weekdays: [] })));
check("invalid monthly day rejected", () => assert.throws(() => normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", frequency: "monthly", dayOfMonthText: "32" })));
check("invalid duration rejected", () => assert.throws(() => normalizeGroupRoutineForm({ ...createGroupRoutineFormDefaults(), title: "Routine", hasDuration: true, durationHoursText: "0", durationMinutesText: "60" })));
check("existing routine populates form", () => assert.equal(createGroupRoutineFormFromDoc(routine()).title, "Standup"));

const canonicalOccurrence = {
  id: "occurrence", groupId: "group", routineId: "routine",
  occurrenceKey: "09:00@2026-01-02", calendarProjectionId: "projection",
  materializationVersion: 1, scheduleFingerprint: "schedule",
  contentFingerprint: "content", startAtMs: Date.UTC(2026, 0, 2, 9),
  endAtMs: Date.UTC(2026, 0, 2, 10), localDate: "2026-01-02",
  localStartTime: "09:00", timezone: "UTC", durationMinutes: 60,
  status: "scheduled", routineTitleSnapshot: "Standup",
  routineDescriptionSnapshot: null, routineLocationSnapshot: null,
  routineCreatedByUid: "member", routineCreatedByName: "Alex",
  routineCreatedByEmail: null, routineUpdatedAtMsSnapshot: 1,
  generatedAtMs: 1, updatedAtMs: 1, cancelledAtMs: null,
  cancelledReason: null, generatedAt: null, updatedAt: null,
};
check("occurrence mapper accepts canonical generated record", () =>
  assert.equal(
    mapGroupRoutineOccurrenceDoc("occurrence", canonicalOccurrence)?.routineId,
    "routine"
  )
);
check("occurrence mapper rejects document id mismatch", () =>
  assert.equal(mapGroupRoutineOccurrenceDoc("other", canonicalOccurrence), null)
);
check("occurrence mapper rejects missing provenance", () => {
  const { scheduleFingerprint: _omitted, ...missing } = canonicalOccurrence;
  assert.equal(mapGroupRoutineOccurrenceDoc("occurrence", missing), null);
});
check("occurrence mapper rejects incoherent cancellation", () =>
  assert.equal(
    mapGroupRoutineOccurrenceDoc("occurrence", {
      ...canonicalOccurrence,
      status: "cancelled",
    }),
    null
  )
);

console.log(`\nGroup routine UI helper QA: ${passed} passed, 0 failed.`);
