import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function main() {
  const temporaryDirectory = await mkdtemp(
    path.join(process.cwd(), ".dayta-group-routine-qa-")
  );
  const bundlePath = path.join(temporaryDirectory, "group-routines.mjs");
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["./services/groupRoutines.ts"],
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

  const routines = await import(pathToFileURL(bundlePath).href);
  let passed = 0;
  const check = (name: string, work: () => void) => {
    work();
    passed += 1;
    console.log(`PASS ${name}`);
  };
  const expectError = (name: string, work: () => unknown, message?: RegExp) =>
    check(name, () => {
      if (!message) return assert.throws(work);
      assert.throws(
        work,
        (error: unknown) =>
          error instanceof Error && message.test(error.message)
      );
    });

  const baseSchedule = {
    frequency: "daily",
    interval: 1,
    weekdays: null,
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    weekdayOfMonth: null,
    localStartTime: "09:00",
    durationMinutes: 60,
    timezone: "America/New_York",
    startDate: "2026-01-01",
    endDate: null,
  };
  const activeRoutine = { ...baseSchedule, status: "active" };
  const at = (iso: string) => Date.parse(iso);
  const canonicalDoc = {
    id: "routine-1",
    groupId: "group-1",
    title: "Morning check-in",
    description: null,
    location: null,
    status: "active",
    ...baseSchedule,
    nextOccurrenceAtMs: at("2026-01-01T14:00:00.000Z"),
    createdByUid: "creator",
    createdByName: null,
    createdByEmail: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    createdAt: null,
    updatedAt: null,
    pausedAtMs: null,
    pausedByUid: null,
    archivedAtMs: null,
    archivedByUid: null,
  };

  check("valid daily routine maps", () => {
    assert.equal(routines.mapGroupRoutineDoc("routine-1", canonicalDoc)?.frequency, "daily");
  });
  check("valid weekly routine maps", () => {
    const value = {
      ...canonicalDoc,
      frequency: "weekly",
      weekdays: [1, 4],
    };
    assert.deepEqual(routines.mapGroupRoutineDoc("routine-1", value)?.weekdays, [1, 4]);
  });
  check("valid monthly day-of-month routine maps", () => {
    const value = {
      ...canonicalDoc,
      frequency: "monthly",
      monthlyMode: "day_of_month",
      dayOfMonth: 15,
    };
    assert.equal(routines.mapGroupRoutineDoc("routine-1", value)?.dayOfMonth, 15);
  });
  check("valid monthly nth-weekday routine maps", () => {
    const value = {
      ...canonicalDoc,
      frequency: "monthly",
      monthlyMode: "nth_weekday",
      weekOfMonth: 2,
      weekdayOfMonth: 5,
    };
    assert.equal(routines.mapGroupRoutineDoc("routine-1", value)?.weekOfMonth, 2);
  });
  expectError("blank title rejected", () => routines.normalizeGroupRoutineTitle(" "));
  check("invalid status mapper returns null", () => {
    assert.equal(routines.mapGroupRoutineDoc("routine-1", { ...canonicalDoc, status: "open" }), null);
  });
  expectError("invalid frequency rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, frequency: "yearly" })
  );
  expectError("interval zero rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, interval: 0 })
  );
  check("duplicate weekdays normalize and sort", () => {
    const normalized = routines.normalizeGroupRoutineSchedule({
      ...baseSchedule,
      frequency: "weekly",
      weekdays: [5, 1, 5, 3],
    });
    assert.deepEqual(normalized.weekdays, [1, 3, 5]);
  });
  expectError("invalid weekday rejected", () =>
    routines.normalizeGroupRoutineSchedule({
      ...baseSchedule,
      frequency: "weekly",
      weekdays: [0],
    })
  );
  expectError("conflicting recurrence fields rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, weekdays: [1] })
  );
  expectError("invalid local time rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, localStartTime: "9:00" })
  );
  expectError("invalid timezone rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, timezone: "Mars/Base" })
  );
  expectError("invalid start date rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, startDate: "2026-02-30" })
  );
  expectError("end before start rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, endDate: "2025-12-31" })
  );
  expectError("invalid duration rejected", () =>
    routines.normalizeGroupRoutineSchedule({ ...baseSchedule, durationMinutes: 0 })
  );
  check("malformed lifecycle metadata rejected", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", { ...canonicalDoc, pausedAtMs: 10 }),
      null
    );
  });
  check("missing creator rejected", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", { ...canonicalDoc, createdByUid: "" }),
      null
    );
  });
  check("document ID mismatch rejected", () => {
    assert.equal(routines.mapGroupRoutineDoc("other", canonicalDoc), null);
  });
  check("blank optional text becomes null", () => {
    const mapped = routines.mapGroupRoutineDoc("routine-1", {
      ...canonicalDoc,
      description: " ",
    });
    assert.equal(mapped?.description, null);
  });
  check("missing explicit-null field is rejected", () => {
    const value = { ...canonicalDoc } as Record<string, unknown>;
    delete value.location;
    assert.equal(routines.mapGroupRoutineDoc("routine-1", value), null);
  });

  check("daily first occurrence is on start date", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      activeRoutine,
      at("2026-01-01T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-01");
  });
  check("daily exactly-at boundary is strictly excluded", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      activeRoutine,
      at("2026-01-01T14:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-02");
  });
  check("every-two-days anchors to start date", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, interval: 2 },
      at("2026-01-02T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-03");
  });
  check("before-start candidates are excluded", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, startDate: "2026-02-01" },
      at("2026-01-01T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-02-01");
  });
  check("inclusive end date can occur", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, endDate: "2026-01-01" },
      at("2026-01-01T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-01");
  });
  check("after end date returns null", () => {
    assert.equal(
      routines.getNextGroupRoutineOccurrence(
        { ...activeRoutine, endDate: "2026-01-01" },
        at("2026-01-01T14:00:00.000Z")
      ),
      null
    );
  });

  const weekly = {
    ...activeRoutine,
    frequency: "weekly",
    weekdays: [1, 4],
    startDate: "2026-01-07",
  };
  check("weekly one weekday resolves", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...weekly, weekdays: [5] },
      at("2026-01-07T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-09");
  });
  check("weekly multiple weekdays resolve in order", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      weekly,
      at("2026-01-07T00:00:00.000Z"),
      at("2026-01-17T00:00:00.000Z")
    );
    assert.deepEqual(values.map((item: { localDate: string }) => item.localDate), [
      "2026-01-08",
      "2026-01-12",
      "2026-01-15",
    ]);
  });
  check("weekly start-date weekday occurs", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...weekly, weekdays: [3] },
      at("2026-01-07T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-07");
  });
  check("weekday before start date is excluded", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      weekly,
      at("2026-01-05T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-08");
  });
  check("every-two-week cadence uses anchor week", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...weekly, interval: 2, weekdays: [1] },
      at("2026-01-08T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-01-19");
  });
  check("weekly recurrence crosses month", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...weekly, weekdays: [1] },
      at("2026-01-30T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2026-02-02");
  });
  check("weekly recurrence crosses year", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...weekly, startDate: "2026-12-30", weekdays: [1] },
      at("2026-12-30T00:00:00.000Z")
    );
    assert.equal(next?.localDate, "2027-01-04");
  });

  const monthlyDay = {
    ...activeRoutine,
    frequency: "monthly",
    monthlyMode: "day_of_month",
    dayOfMonth: 15,
    startDate: "2026-01-01",
  };
  check("monthly day first occurrence resolves", () => {
    assert.equal(
      routines.getNextGroupRoutineOccurrence(monthlyDay, at("2026-01-01T00:00:00Z"))?.localDate,
      "2026-01-15"
    );
  });
  check("every-two-month cadence anchors to start month", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...monthlyDay, interval: 2 },
      at("2026-01-16T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-03-15");
  });
  check("start-month date before start is excluded", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...monthlyDay, startDate: "2026-01-20" },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-02-15");
  });
  check("day 31 skips short months", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...monthlyDay, dayOfMonth: 31 },
      at("2026-02-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-03-31");
  });
  check("leap-year February 29 occurs", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...monthlyDay, dayOfMonth: 29, startDate: "2028-02-01" },
      at("2028-02-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2028-02-29");
  });
  check("monthly inclusive end date occurs", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...monthlyDay, endDate: "2026-01-15" },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-01-15");
  });

  const nthWeekday = {
    ...activeRoutine,
    frequency: "monthly",
    monthlyMode: "nth_weekday",
    dayOfMonth: null,
    weekOfMonth: 1,
    weekdayOfMonth: 1,
  };
  check("first Monday resolves", () => {
    assert.equal(
      routines.getNextGroupRoutineOccurrence(nthWeekday, at("2026-01-01T00:00:00Z"))?.localDate,
      "2026-01-05"
    );
  });
  check("second Tuesday resolves", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...nthWeekday, weekOfMonth: 2, weekdayOfMonth: 2 },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-01-13");
  });
  check("fourth Sunday resolves", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...nthWeekday, weekOfMonth: 4, weekdayOfMonth: 7 },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-01-25");
  });
  check("last Friday resolves", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...nthWeekday, weekOfMonth: -1, weekdayOfMonth: 5 },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-01-30");
  });
  expectError("fifth weekday mode is rejected", () =>
    routines.normalizeGroupRoutineSchedule({
      ...nthWeekday,
      weekOfMonth: 5,
    })
  );
  check("nth-weekday interval months are anchored", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...nthWeekday, interval: 2 },
      at("2026-01-06T00:00:00Z")
    );
    assert.equal(next?.localDate, "2026-03-02");
  });

  check("wall time remains 9 AM across DST", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      activeRoutine,
      at("2026-03-07T00:00:00Z"),
      at("2026-03-10T23:00:00Z")
    );
    assert.deepEqual(
      values.map((item: { startAtMs: number }) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          hour12: false,
        }).format(item.startAtMs)
      ),
      ["09", "09", "09", "09"]
    );
  });
  check("spring-forward nonexistent time resolves deterministically", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, localStartTime: "02:30", startDate: "2026-03-08" },
      at("2026-03-08T00:00:00Z")
    );
    assert.equal(next?.startAtMs, at("2026-03-08T07:30:00.000Z"));
  });
  check("fall-back ambiguous time resolves deterministically", () => {
    const first = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, localStartTime: "01:30", startDate: "2026-11-01" },
      at("2026-11-01T00:00:00Z")
    );
    const second = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, localStartTime: "01:30", startDate: "2026-11-01" },
      at("2026-11-01T00:00:00Z")
    );
    assert.equal(first?.startAtMs, second?.startAtMs);
  });
  check("UTC routine preserves UTC wall time", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, timezone: "UTC" },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.startAtMs, at("2026-01-01T09:00:00Z"));
  });
  check("New York local date differs correctly from UTC boundary", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, localStartTime: "00:30" },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.startAtMs, at("2026-01-01T05:30:00Z"));
  });

  check("duration calculates end time", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      activeRoutine,
      at("2026-01-01T00:00:00Z")
    );
    assert.equal((next?.endAtMs ?? 0) - (next?.startAtMs ?? 0), 60 * 60 * 1000);
  });
  check("duration can cross midnight", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, localStartTime: "23:30", durationMinutes: 120 },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal((next?.endAtMs ?? 0) - (next?.startAtMs ?? 0), 120 * 60 * 1000);
  });
  check("maximum duration accepted", () => {
    assert.equal(
      routines.normalizeGroupRoutineSchedule({
        ...baseSchedule,
        durationMinutes: 10_080,
      }).durationMinutes,
      10_080
    );
  });
  expectError("over-maximum duration rejected", () =>
    routines.normalizeGroupRoutineSchedule({
      ...baseSchedule,
      durationMinutes: 10_081,
    })
  );
  check("null duration produces point occurrence", () => {
    const next = routines.getNextGroupRoutineOccurrence(
      { ...activeRoutine, durationMinutes: null },
      at("2026-01-01T00:00:00Z")
    );
    assert.equal(next?.endAtMs, null);
  });

  check("range includes occurrence exactly at start", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      activeRoutine,
      at("2026-01-01T14:00:00Z"),
      at("2026-01-02T14:00:00Z")
    );
    assert.equal(values[0]?.localDate, "2026-01-01");
  });
  check("range excludes occurrence exactly at end", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      activeRoutine,
      at("2026-01-01T14:00:00Z"),
      at("2026-01-02T14:00:00Z")
    );
    assert.equal(values.length, 1);
  });
  check("range results are deterministic ascending", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      activeRoutine,
      at("2026-01-01T00:00:00Z"),
      at("2026-01-05T00:00:00Z")
    );
    assert.deepEqual(
      values.map((item: { localDate: string }) => item.localDate),
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
    );
  });
  check("range limit is respected", () => {
    const values = routines.getGroupRoutineOccurrencesInRange(
      activeRoutine,
      at("2026-01-01T00:00:00Z"),
      at("2026-02-01T00:00:00Z"),
      { limit: 3 }
    );
    assert.equal(values.length, 3);
  });
  expectError("invalid range rejected", () =>
    routines.getGroupRoutineOccurrencesInRange(activeRoutine, 10, 10)
  );
  expectError("unbounded occurrence limit rejected", () =>
    routines.getGroupRoutineOccurrencesInRange(activeRoutine, 1, 10_000, {
      limit: 501,
    })
  );
  check("paused routine yields no occurrences", () => {
    assert.deepEqual(
      routines.getGroupRoutineOccurrencesInRange(
        { ...activeRoutine, status: "paused" },
        at("2026-01-01T00:00:00Z"),
        at("2026-01-03T00:00:00Z")
      ),
      []
    );
  });
  check("archived routine yields no next occurrence", () => {
    assert.equal(
      routines.getNextGroupRoutineOccurrence(
        { ...activeRoutine, status: "archived" },
        at("2026-01-01T00:00:00Z")
      ),
      null
    );
  });

  check("valid paused lifecycle maps", () => {
    const mapped = routines.mapGroupRoutineDoc("routine-1", {
      ...canonicalDoc,
      status: "paused",
      nextOccurrenceAtMs: null,
      pausedAtMs: 2,
      pausedByUid: "actor",
    });
    assert.equal(mapped?.status, "paused");
  });
  check("paused routine requires null next occurrence", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", {
        ...canonicalDoc,
        status: "paused",
        pausedAtMs: 2,
        pausedByUid: "actor",
      }),
      null
    );
  });
  check("valid archived lifecycle maps", () => {
    const mapped = routines.mapGroupRoutineDoc("routine-1", {
      ...canonicalDoc,
      status: "archived",
      nextOccurrenceAtMs: null,
      archivedAtMs: 3,
      archivedByUid: "actor",
    });
    assert.equal(mapped?.status, "archived");
  });
  check("archive may preserve prior pause metadata", () => {
    const mapped = routines.mapGroupRoutineDoc("routine-1", {
      ...canonicalDoc,
      status: "archived",
      nextOccurrenceAtMs: null,
      pausedAtMs: 2,
      pausedByUid: "pauser",
      archivedAtMs: 3,
      archivedByUid: "archiver",
    });
    assert.equal(mapped?.pausedByUid, "pauser");
  });
  check("archived routine requires archive actor", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", {
        ...canonicalDoc,
        status: "archived",
        nextOccurrenceAtMs: null,
        archivedAtMs: 3,
      }),
      null
    );
  });
  check("active routine rejects pause metadata", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", {
        ...canonicalDoc,
        pausedAtMs: 2,
        pausedByUid: "actor",
      }),
      null
    );
  });
  check("active ended routine permits null next occurrence", () => {
    assert.equal(
      routines.mapGroupRoutineDoc("routine-1", {
        ...canonicalDoc,
        nextOccurrenceAtMs: null,
      })?.status,
      "active"
    );
  });
  check("creator snapshot is retained by mapper", () => {
    const mapped = routines.mapGroupRoutineDoc("routine-1", {
      ...canonicalDoc,
      createdByName: "Creator",
    });
    assert.equal(mapped?.createdByName, "Creator");
  });
  const activeMapped = routines.mapGroupRoutineDoc("routine-1", canonicalDoc);
  assert.ok(activeMapped);
  check("pause transition clears next occurrence", () => {
    const patch = routines.getGroupRoutineLifecycleTransition(
      activeMapped,
      "pause",
      "actor",
      10
    );
    assert.equal(patch.status, "paused");
    assert.equal(patch.nextOccurrenceAtMs, null);
  });
  expectError("repeat pause is rejected", () =>
    routines.getGroupRoutineLifecycleTransition(
      { ...activeMapped, status: "paused" },
      "pause",
      "actor",
      10
    )
  );
  check("resume recalculates and clears pause metadata", () => {
    const patch = routines.getGroupRoutineLifecycleTransition(
      {
        ...activeMapped,
        status: "paused",
        nextOccurrenceAtMs: null,
        pausedAtMs: 2,
        pausedByUid: "pauser",
      },
      "resume",
      "actor",
      at("2026-01-02T00:00:00Z")
    );
    assert.equal(patch.status, "active");
    assert.equal(patch.pausedAtMs, null);
    assert.ok((patch.nextOccurrenceAtMs ?? 0) > at("2026-01-02T00:00:00Z"));
  });
  expectError("resume of active routine is rejected", () =>
    routines.getGroupRoutineLifecycleTransition(
      activeMapped,
      "resume",
      "actor",
      10
    )
  );
  expectError("resume with expired recurrence is rejected", () =>
    routines.getGroupRoutineLifecycleTransition(
      {
        ...activeMapped,
        status: "paused",
        nextOccurrenceAtMs: null,
        pausedAtMs: 2,
        pausedByUid: "pauser",
        endDate: "2026-01-01",
      },
      "resume",
      "actor",
      at("2026-01-02T00:00:00Z")
    )
  );
  check("archive clears next occurrence", () => {
    const patch = routines.getGroupRoutineLifecycleTransition(
      activeMapped,
      "archive",
      "actor",
      10
    );
    assert.equal(patch.status, "archived");
    assert.equal(patch.nextOccurrenceAtMs, null);
  });
  check("archive preserves prior pause audit metadata", () => {
    const patch = routines.getGroupRoutineLifecycleTransition(
      {
        ...activeMapped,
        status: "paused",
        nextOccurrenceAtMs: null,
        pausedAtMs: 2,
        pausedByUid: "pauser",
      },
      "archive",
      "archiver",
      10
    );
    assert.equal(patch.pausedByUid, "pauser");
    assert.equal(patch.archivedByUid, "archiver");
  });
  expectError("repeat archive is rejected", () =>
    routines.getGroupRoutineLifecycleTransition(
      {
        ...activeMapped,
        status: "archived",
        nextOccurrenceAtMs: null,
        archivedAtMs: 2,
        archivedByUid: "actor",
      },
      "archive",
      "actor",
      10
    )
  );

  await rm(temporaryDirectory, { recursive: true, force: true });
  console.log(`\nGroup routine service QA: ${passed} passed, 0 failed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
