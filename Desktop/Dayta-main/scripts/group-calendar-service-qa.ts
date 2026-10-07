import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  getCalendarDayBounds,
  getGroupCalendarTemporalState,
  overlapsGroupCalendarRange,
  safeGroupCalendarName,
  sortIntegratedGroupCalendarEvents,
} from "../services/groupCalendarIntegration";

async function main() {
const temporaryDirectory = await mkdtemp(
  path.join(process.cwd(), ".dayta-group-calendar-qa-")
);
const bundlePath = path.join(temporaryDirectory, "group-calendar.mjs");

await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["./services/groupCalendar.ts"],
  outfile: bundlePath,
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  target: "node22",
  plugins: [
    {
      name: "mock-dayta-firebase",
      setup(buildApi) {
        buildApi.onResolve(
          { filter: /^\.\/firebase$/ },
          () => ({ path: "dayta-firebase", namespace: "qa-mock" })
        );
        buildApi.onLoad(
          { filter: /.*/, namespace: "qa-mock" },
          () => ({ contents: "export const db = {};" })
        );
      },
    },
  ],
});

const calendar = await import(pathToFileURL(bundlePath).href);
let passed = 0;

function check(name: string, work: () => void) {
  work();
  passed += 1;
  console.log(`PASS ${name}`);
}

function expectError(name: string, work: () => unknown, message?: RegExp) {
  check(name, () => {
    if (!message) {
      assert.throws(work);
      return;
    }
    assert.throws(
      work,
      (error: unknown) =>
        error instanceof Error && message.test(error.message)
    );
  });
}

const timed = calendar.normalizeGroupCalendarEventInput({
  groupId: "group-runtime-qa",
  title: "  Runtime sync  ",
  description: "  Safe description  ",
  location: "  Room 1  ",
  allDay: false,
  startAtMs: 1_800_000_000_000,
  endAtMs: 1_800_003_600_000,
  startDate: null,
  endDate: null,
  timezone: "UTC",
  createdByUid: "creator",
  attendeeUids: [" attendee-1 ", "creator", "attendee-1", "attendee-2"],
});

check("timed input is canonical and trims bounded text", () => {
  assert.equal(timed.title, "Runtime sync");
  assert.equal(timed.description, "Safe description");
  assert.equal(timed.location, "Room 1");
  assert.equal(timed.allDay, false);
  assert.equal(timed.sortStartMs, timed.startAtMs);
  assert.equal(timed.sortEndMs, timed.endAtMs);
  assert.equal(timed.startDate, null);
  assert.equal(timed.endDate, null);
});

check("attendees are trimmed, deduplicated, deterministic, and exclude creator", () => {
  assert.deepEqual(timed.attendeeUids, ["attendee-1", "attendee-2"]);
});

expectError(
  "blank attendee entries are rejected",
  () => calendar.normalizeGroupCalendarAttendeeUids(["attendee-1", "  "]),
  /attendees are invalid/
);
expectError(
  "more than 50 normalized attendees is rejected",
  () =>
    calendar.normalizeGroupCalendarAttendeeUids(
      Array.from({ length: 51 }, (_, index) => `uid-${index}`),
      "creator"
    ),
  /Too many attendees/
);
expectError(
  "invalid IANA timezone is rejected",
  () =>
    calendar.normalizeGroupCalendarTiming({
      allDay: false,
      startAtMs: 1,
      endAtMs: 2,
      timezone: "Not/A_Real_Zone",
    }),
  /timezone is invalid/
);
for (const [name, input] of [
  ["end equal to start", { startAtMs: 10, endAtMs: 10 }],
  ["end before start", { startAtMs: 11, endAtMs: 10 }],
  ["missing start", { startAtMs: null, endAtMs: 10 }],
  ["missing end", { startAtMs: 10, endAtMs: null }],
  ["non-finite start", { startAtMs: Number.NaN, endAtMs: 10 }],
  ["zero start", { startAtMs: 0, endAtMs: 10 }],
] as const) {
  expectError(`timed validation rejects ${name}`, () =>
    calendar.normalizeGroupCalendarTiming({
      allDay: false,
      ...input,
      timezone: "UTC",
    })
  );
}
expectError("timed duration over seven days is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: false,
    startAtMs: 1,
    endAtMs: 1 + 7 * 24 * 60 * 60 * 1000 + 1,
    timezone: "UTC",
  })
);
expectError("timed/date field conflict is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: false,
    startAtMs: 1,
    endAtMs: 2,
    startDate: "2026-01-01",
    timezone: "UTC",
  })
);

const dstAllDay = calendar.normalizeGroupCalendarTiming({
  allDay: true,
  startDate: "2026-03-08",
  endDate: "2026-03-09",
  startAtMs: null,
  endAtMs: null,
  timezone: "America/New_York",
});
check("DST-boundary one-day event preserves dates and accepts 23 elapsed hours", () => {
  assert.equal(dstAllDay.startDate, "2026-03-08");
  assert.equal(dstAllDay.endDate, "2026-03-09");
  assert.equal(dstAllDay.sortEndMs - dstAllDay.sortStartMs, 23 * 60 * 60 * 1000);
});

const multiDay = calendar.normalizeGroupCalendarTiming({
  allDay: true,
  startDate: "2026-10-31",
  endDate: "2026-11-03",
  timezone: "America/New_York",
});
check("multi-day all-day timing uses authoritative date-only boundaries", () => {
  assert.equal(multiDay.allDay, true);
  assert.equal(multiDay.startAtMs, null);
  assert.equal(multiDay.endAtMs, null);
  assert.ok(multiDay.sortEndMs > multiDay.sortStartMs);
});
for (const [name, startDate, endDate] of [
  ["invalid syntax", "03/08/2026", "2026-03-09"],
  ["impossible date", "2026-02-30", "2026-03-01"],
  ["same dates", "2026-03-08", "2026-03-08"],
  ["reversed dates", "2026-03-09", "2026-03-08"],
] as const) {
  expectError(`all-day validation rejects ${name}`, () =>
    calendar.normalizeGroupCalendarTiming({
      allDay: true,
      startDate,
      endDate,
      timezone: "UTC",
    })
  );
}
expectError("all-day span over 366 calendar days is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: true,
    startDate: "2025-01-01",
    endDate: "2026-01-03",
    timezone: "UTC",
  })
);
expectError("all-day/timestamp conflict is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: true,
    startDate: "2026-03-08",
    endDate: "2026-03-09",
    startAtMs: 1,
    timezone: "UTC",
  })
);

const canonicalTimed = {
  id: "timed-map",
  ...timed,
  status: "scheduled",
  cancelledAtMs: null,
  cancelledByUid: null,
  createdAtMs: 1_800_000_000_000,
  updatedAtMs: 1_800_000_000_000,
};
const canonicalAllDay = {
  ...canonicalTimed,
  id: "all-day-map",
  ...dstAllDay,
};
const canonicalCancelled = {
  ...canonicalTimed,
  id: "cancelled-map",
  status: "cancelled",
  cancelledAtMs: 1_800_000_000_100,
  cancelledByUid: "creator",
  updatedAtMs: 1_800_000_000_100,
};
check("mapper accepts canonical timed event", () => {
  assert.equal(
    calendar.mapGroupCalendarEventDoc("timed-map", canonicalTimed)?.id,
    "timed-map"
  );
});
check("mapper accepts canonical all-day event", () => {
  assert.equal(
    calendar.mapGroupCalendarEventDoc("all-day-map", canonicalAllDay)?.allDay,
    true
  );
});
check("mapper accepts canonical cancelled event", () => {
  assert.equal(
    calendar.mapGroupCalendarEventDoc("cancelled-map", canonicalCancelled)?.status,
    "cancelled"
  );
});
const canonicalRoutineProjection = {
  ...canonicalTimed,
  id: "routine-projection",
  sourceType: "group_routine",
  sourceRoutineId: "routine-1",
  sourceOccurrenceId: "occurrence-1",
  sourceScheduleFingerprint: "schedule",
};
check("mapper accepts complete routine projection provenance", () => {
  assert.equal(
    calendar.mapGroupCalendarEventDoc(
      "routine-projection",
      canonicalRoutineProjection
    )?.sourceRoutineId,
    "routine-1"
  );
});
check("mapper rejects partial routine projection provenance", () => {
  const { sourceOccurrenceId: _omitted, ...partial } =
    canonicalRoutineProjection;
  assert.equal(
    calendar.mapGroupCalendarEventDoc("routine-projection", partial),
    null
  );
});
check("routine projection is read-only in UI permissions", () => {
  assert.equal(
    calendar.canManageGroupCalendarEvent({
      role: "owner",
      currentUid: "owner",
      createdByUid: "member",
      sourceType: "group_routine",
    }),
    false
  );
});

const malformedMapperCases: [string, Record<string, unknown>][] = [
  ["personal event", { ...canonicalTimed, scope: "personal" }],
  ["wrong type", { ...canonicalTimed, type: "personal" }],
  ["wrong visibility", { ...canonicalTimed, visibility: "private" }],
  ["missing group identity", { ...canonicalTimed, groupId: "" }],
  ["document ID mismatch", { ...canonicalTimed, id: "other" }],
  ["timed/date conflict", { ...canonicalTimed, startDate: "2026-01-01" }],
  ["invalid ordering", { ...canonicalTimed, endAtMs: timed.startAtMs }],
  ["sort mismatch", { ...canonicalTimed, sortStartMs: timed.sortStartMs + 1 }],
  ["incoherent cancellation", { ...canonicalTimed, cancelledAtMs: 1 }],
  ["oversized title", { ...canonicalTimed, title: "x".repeat(161) }],
  ["oversized attendee list", { ...canonicalTimed, attendeeUids: Array.from({ length: 51 }, (_, index) => `uid-${index}`) }],
];
for (const [name, value] of malformedMapperCases) {
  check(`mapper safely returns null for ${name}`, () => {
    assert.doesNotThrow(() =>
      calendar.mapGroupCalendarEventDoc("timed-map", value)
    );
    assert.equal(calendar.mapGroupCalendarEventDoc("timed-map", value), null);
  });
}

check("timed-to-all-day complete transition validates", () => {
  const result = calendar.normalizeGroupCalendarTiming({
    allDay: true,
    startAtMs: null,
    endAtMs: null,
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    timezone: "UTC",
  });
  assert.equal(result.allDay, true);
});
expectError("timed-to-all-day incomplete transition is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: true,
    startAtMs: timed.startAtMs,
    endAtMs: timed.endAtMs,
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    timezone: "UTC",
  })
);
check("all-day-to-timed complete transition validates", () => {
  const result = calendar.normalizeGroupCalendarTiming({
    allDay: false,
    startAtMs: 1_800_000_000_000,
    endAtMs: 1_800_003_600_000,
    startDate: null,
    endDate: null,
    timezone: "America/New_York",
  });
  assert.equal(result.allDay, false);
});
expectError("all-day-to-timed incomplete transition is rejected", () =>
  calendar.normalizeGroupCalendarTiming({
    allDay: false,
    startAtMs: null,
    endAtMs: null,
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    timezone: "UTC",
  })
);

check("permission helpers implement the active-role matrix", () => {
  for (const role of ["owner", "admin", "moderator", "member"]) {
    assert.equal(calendar.canCreateGroupCalendarEvent(role, "active"), true);
  }
  assert.equal(calendar.canCreateGroupCalendarEvent("viewer", "active"), false);
  assert.equal(calendar.canCreateGroupCalendarEvent("member", "removed"), false);
  assert.equal(
    calendar.canManageGroupCalendarEvent({
      role: "member",
      status: "active",
      currentUid: "creator",
      createdByUid: "creator",
    }),
    true
  );
  assert.equal(
    calendar.canManageGroupCalendarEvent({
      role: "member",
      status: "active",
      currentUid: "other",
      createdByUid: "creator",
    }),
    false
  );
});

const integrationEvent = {
  ...canonicalTimed,
  id: "integration-event",
  status: "scheduled",
  allDay: false,
  sortStartMs: 1_800_000_000_000,
  sortEndMs: 1_800_003_600_000,
};
check("timed event is upcoming before its start", () => {
  assert.equal(
    getGroupCalendarTemporalState(integrationEvent, integrationEvent.sortStartMs - 1),
    "upcoming"
  );
});
check("timed event is ongoing exactly at its start", () => {
  assert.equal(
    getGroupCalendarTemporalState(integrationEvent, integrationEvent.sortStartMs),
    "ongoing"
  );
});
check("timed event is ended exactly at its end", () => {
  assert.equal(
    getGroupCalendarTemporalState(integrationEvent, integrationEvent.sortEndMs),
    "ended"
  );
});
check("event ending at range start does not overlap", () => {
  assert.equal(
    overlapsGroupCalendarRange(
      integrationEvent,
      integrationEvent.sortEndMs,
      integrationEvent.sortEndMs + 1
    ),
    false
  );
});
check("event starting at range end does not overlap", () => {
  assert.equal(
    overlapsGroupCalendarRange(
      integrationEvent,
      integrationEvent.sortStartMs - 10,
      integrationEvent.sortStartMs
    ),
    false
  );
});
check("cancelled event is excluded from overlap", () => {
  assert.equal(
    overlapsGroupCalendarRange(
      { ...integrationEvent, status: "cancelled" },
      integrationEvent.sortStartMs,
      integrationEvent.sortEndMs
    ),
    false
  );
});
const allDayEvent = { ...integrationEvent, allDay: true };
check("all-day event is active within its half-open span", () => {
  assert.equal(
    getGroupCalendarTemporalState(allDayEvent, allDayEvent.sortStartMs),
    "all_day_active"
  );
});
check("all-day exclusive end is past", () => {
  assert.equal(
    getGroupCalendarTemporalState(allDayEvent, allDayEvent.sortEndMs),
    "past_all_day"
  );
});
check("spring-forward bounds use a 23-hour calendar day", () => {
  const bounds = getCalendarDayBounds("2026-03-08", "America/New_York");
  assert.equal(bounds.endMs - bounds.startMs, 23 * 60 * 60 * 1000);
});
check("fall-back bounds use a 25-hour calendar day", () => {
  const bounds = getCalendarDayBounds("2026-11-01", "America/New_York");
  assert.equal(bounds.endMs - bounds.startMs, 25 * 60 * 60 * 1000);
});
check("missing group name uses a safe fallback", () => {
  assert.equal(safeGroupCalendarName(null), "Group event");
});
check("group sort places all-day before timed", () => {
  const sorted = sortIntegratedGroupCalendarEvents([
    { source: "group", groupId: "g", groupName: "G", event: integrationEvent },
    { source: "group", groupId: "g", groupName: "G", event: allDayEvent },
  ]);
  assert.equal(sorted[0].event.allDay, true);
});

await rm(temporaryDirectory, { recursive: true, force: true });
console.log(`\nGroup calendar service QA: ${passed} passed, 0 failed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
