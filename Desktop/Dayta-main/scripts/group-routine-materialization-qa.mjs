import assert from "node:assert/strict";
import {
  buildOccurrenceData,
  buildProjectionData,
  getNextRoutineOccurrence,
  getRoutineContentFingerprint,
  getRoutineOccurrenceId,
  getRoutineOccurrencesInRange,
  getRoutineProjectionId,
  getRoutineScheduleFingerprint,
  mapRoutineForMaterialization,
  MAX_OCCURRENCES_PER_ROUTINE,
} from "../functions/lib/groupRoutineMaterialization.js";

let passed = 0;
function check(name, work) {
  work();
  passed += 1;
  console.log(`PASS ${name}`);
}
function raw(patch = {}) {
  return {
    id: "routine-1", groupId: "group-1", title: "Morning",
    description: null, location: null, status: "active", frequency: "daily",
    interval: 1, weekdays: null, monthlyMode: null, dayOfMonth: null,
    weekOfMonth: null, weekdayOfMonth: null, localStartTime: "09:00",
    durationMinutes: 60, timezone: "America/New_York",
    startDate: "2026-01-01", endDate: null,
    nextOccurrenceAtMs: Date.parse("2026-01-01T14:00:00Z"),
    createdByUid: "member", createdByName: "Alex",
    createdByEmail: "alex@example.com", createdAtMs: 1, updatedAtMs: 2,
    ...patch,
  };
}
const at = (iso) => Date.parse(iso);
const routine = (patch = {}) =>
  mapRoutineForMaterialization("routine-1", raw(patch));

check("deterministic occurrence id", () => {
  assert.equal(getRoutineOccurrenceId("routine-1", 123), getRoutineOccurrenceId("routine-1", 123));
});
check("different instants produce different ids", () => {
  assert.notEqual(getRoutineOccurrenceId("routine-1", 123), getRoutineOccurrenceId("routine-1", 124));
});
check("different routines produce different ids", () => {
  assert.notEqual(getRoutineOccurrenceId("routine-1", 123), getRoutineOccurrenceId("routine-2", 123));
});
check("projection id is deterministic and prefixed", () => {
  assert.equal(getRoutineProjectionId("gro_x"), "grp_gro_x");
});
check("schedule fingerprint is stable", () => {
  assert.equal(getRoutineScheduleFingerprint(routine()), getRoutineScheduleFingerprint(routine()));
});
check("schedule fingerprint changes with time", () => {
  assert.notEqual(getRoutineScheduleFingerprint(routine()), getRoutineScheduleFingerprint(routine({ localStartTime: "10:00" })));
});
check("schedule fingerprint ignores title", () => {
  assert.equal(getRoutineScheduleFingerprint(routine()), getRoutineScheduleFingerprint(routine({ title: "Changed" })));
});
check("content fingerprint changes with title", () => {
  assert.notEqual(getRoutineContentFingerprint(routine()), getRoutineContentFingerprint(routine({ title: "Changed" })));
});
check("content fingerprint ignores schedule", () => {
  assert.equal(getRoutineContentFingerprint(routine()), getRoutineContentFingerprint(routine({ localStartTime: "10:00" })));
});
check("daily range materializes", () => {
  assert.equal(getRoutineOccurrencesInRange(routine(), at("2026-01-01T00:00:00Z"), at("2026-01-04T00:00:00Z")).length, 3);
});
check("daily interval remains anchored", () => {
  const values = getRoutineOccurrencesInRange(routine({ interval: 2 }), at("2026-01-01T00:00:00Z"), at("2026-01-06T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-01-01", "2026-01-03", "2026-01-05"]);
});
check("weekly recurrence materializes", () => {
  const values = getRoutineOccurrencesInRange(routine({ frequency: "weekly", weekdays: [1, 3], durationMinutes: null }), at("2026-01-01T00:00:00Z"), at("2026-01-15T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-01-05", "2026-01-07", "2026-01-12", "2026-01-14"]);
});
check("monthly day materializes", () => {
  const values = getRoutineOccurrencesInRange(routine({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15 }), at("2026-01-01T00:00:00Z"), at("2026-04-01T00:00:00Z"));
  assert.equal(values.length, 3);
});
check("monthly unavailable day skips", () => {
  const values = getRoutineOccurrencesInRange(routine({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 31 }), at("2026-02-01T00:00:00Z"), at("2026-04-01T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-03-31"]);
});
check("monthly nth weekday materializes", () => {
  const values = getRoutineOccurrencesInRange(routine({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 2, weekdayOfMonth: 2 }), at("2026-01-01T00:00:00Z"), at("2026-03-01T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-01-13", "2026-02-10"]);
});
check("monthly last weekday materializes", () => {
  const values = getRoutineOccurrencesInRange(routine({ frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, weekdayOfMonth: 5 }), at("2026-01-01T00:00:00Z"), at("2026-03-01T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-01-30", "2026-02-27"]);
});
check("inclusive end date materializes", () => {
  const values = getRoutineOccurrencesInRange(routine({ endDate: "2026-01-02" }), at("2026-01-01T00:00:00Z"), at("2026-01-04T00:00:00Z"));
  assert.deepEqual(values.map((item) => item.localDate), ["2026-01-01", "2026-01-02"]);
});
check("paused returns no occurrences", () => {
  assert.deepEqual(getRoutineOccurrencesInRange(routine({ status: "paused", nextOccurrenceAtMs: null }), 1, 2), []);
});
check("archived returns no occurrences", () => {
  assert.deepEqual(getRoutineOccurrencesInRange(routine({ status: "archived", nextOccurrenceAtMs: null }), 1, 2), []);
});
check("spring forward preserves local wall time", () => {
  const values = getRoutineOccurrencesInRange(routine({ startDate: "2026-03-07", localStartTime: "09:00" }), at("2026-03-07T00:00:00Z"), at("2026-03-10T00:00:00Z"));
  assert.equal(values.length, 3);
  assert.equal(values[1].startAtMs - values[0].startAtMs, 23 * 60 * 60 * 1000);
});
check("fall back preserves local wall time", () => {
  const values = getRoutineOccurrencesInRange(routine({ startDate: "2026-10-31", localStartTime: "09:00" }), at("2026-10-31T00:00:00Z"), at("2026-11-03T00:00:00Z"));
  assert.equal(values[1].startAtMs - values[0].startAtMs, 25 * 60 * 60 * 1000);
});
check("duration uses elapsed minutes", () => {
  const [value] = getRoutineOccurrencesInRange(routine({ durationMinutes: 90 }), at("2026-01-01T00:00:00Z"), at("2026-01-02T00:00:00Z"));
  assert.equal(value.endAtMs - value.startAtMs, 90 * 60 * 1000);
});
check("cross midnight duration is retained", () => {
  const [value] = getRoutineOccurrencesInRange(routine({ localStartTime: "23:30", durationMinutes: 120 }), at("2026-01-01T00:00:00Z"), at("2026-01-02T12:00:00Z"));
  assert.equal(value.endAtMs - value.startAtMs, 120 * 60 * 1000);
});
check("next occurrence is strictly after boundary", () => {
  const value = getNextRoutineOccurrence(routine(), at("2026-01-01T14:00:00Z"));
  assert.equal(value.localDate, "2026-01-02");
});
check("ended routine has no next occurrence", () => {
  assert.equal(getNextRoutineOccurrence(routine({ endDate: "2026-01-01" }), at("2026-01-02T00:00:00Z")), null);
});
check("occurrence builder has exact deterministic identity", () => {
  const occurrence = getNextRoutineOccurrence(routine(), at("2026-01-01T00:00:00Z"));
  const built = buildOccurrenceData(routine(), occurrence, 100);
  assert.equal(built.id, getRoutineOccurrenceId("routine-1", occurrence.startAtMs));
  assert.equal(built.status, "scheduled");
});
check("occurrence builder preserves generated timestamp", () => {
  const occurrence = getNextRoutineOccurrence(routine(), at("2026-01-01T00:00:00Z"));
  assert.equal(buildOccurrenceData(routine(), occurrence, 200, 100).generatedAtMs, 100);
});
check("projection builder is timed", () => {
  const occurrence = getNextRoutineOccurrence(routine(), at("2026-01-01T00:00:00Z"));
  const projection = buildProjectionData(routine(), buildOccurrenceData(routine(), occurrence, 100), 100);
  assert.equal(projection.allDay, false);
  assert.equal(projection.sourceType, "group_routine");
});
check("point occurrence gets one-minute calendar span", () => {
  const point = routine({ durationMinutes: null });
  const occurrence = getNextRoutineOccurrence(point, at("2026-01-01T00:00:00Z"));
  const projection = buildProjectionData(point, buildOccurrenceData(point, occurrence, 100), 100);
  assert.equal(projection.endAtMs - projection.startAtMs, 60_000);
});
check("projection snapshots copy content", () => {
  const source = routine({ description: "Info", location: "Room" });
  const occurrence = getNextRoutineOccurrence(source, at("2026-01-01T00:00:00Z"));
  const projection = buildProjectionData(source, buildOccurrenceData(source, occurrence, 100), 100);
  assert.equal(projection.description, "Info");
  assert.equal(projection.location, "Room");
});
check("materializer limit is enforced", () => {
  assert.throws(() => getRoutineOccurrencesInRange(routine(), 1, Date.now(), MAX_OCCURRENCES_PER_ROUTINE + 1));
});
check("malformed timezone fails closed", () => {
  assert.throws(() => routine({ timezone: "Nope/Zone" }));
});
check("malformed routine id fails closed", () => {
  assert.throws(() => mapRoutineForMaterialization("other", raw()));
});
check("invalid range fails closed", () => {
  assert.throws(() => getRoutineOccurrencesInRange(routine(), 2, 1));
});

console.log(`\nGroup routine materialization QA: ${passed} passed, 0 failed.`);
