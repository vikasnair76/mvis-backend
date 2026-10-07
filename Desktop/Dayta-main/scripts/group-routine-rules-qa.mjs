import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const groupId = "routine-group-qa";
const otherGroupId = "routine-other-group-qa";
const nowMs = 1_800_000_000_000;
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

function routine(id, creator = "member", overrides = {}, useServerTime = false) {
  return {
    id,
    groupId,
    title: `Routine ${id}`,
    description: null,
    location: null,
    status: "active",
    frequency: "weekly",
    interval: 1,
    weekdays: [1, 4],
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    weekdayOfMonth: null,
    localStartTime: "09:00",
    durationMinutes: 60,
    timezone: "UTC",
    startDate: "2026-01-01",
    endDate: null,
    nextOccurrenceAtMs: nowMs + 86_400_000,
    createdByUid: creator,
    createdByName: null,
    createdByEmail: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: useServerTime ? serverTimestamp() : Timestamp.fromMillis(nowMs),
    updatedAt: useServerTime ? serverTimestamp() : Timestamp.fromMillis(nowMs),
    pausedAtMs: null,
    pausedByUid: null,
    archivedAtMs: null,
    archivedByUid: null,
    participantUids: [],
    ...overrides,
  };
}

const routineRef = (db, id) => doc(db, "groupRoutines", id);
const updateTime = (ms) => ({ updatedAtMs: ms, updatedAt: serverTimestamp() });
const pausePatch = (uid, ms) => ({
  status: "paused",
  pausedAtMs: ms,
  pausedByUid: uid,
  nextOccurrenceAtMs: null,
  ...updateTime(ms),
});
const resumePatch = (ms) => ({
  status: "active",
  pausedAtMs: null,
  pausedByUid: null,
  nextOccurrenceAtMs: ms + 86_400_000,
  ...updateTime(ms),
});
const archivePatch = (uid, ms) => ({
  status: "archived",
  archivedAtMs: ms,
  archivedByUid: uid,
  nextOccurrenceAtMs: null,
  ...updateTime(ms),
});

function nextSnapshot(refOrQuery, predicate = () => true) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("listener timed out"));
    }, 5000);
    unsubscribe = onSnapshot(
      refOrQuery,
      (snapshot) => {
        if (!predicate(snapshot)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "groups", groupId), { name: "Routine QA" });
    await setDoc(doc(db, "groups", otherGroupId), { name: "Other QA" });
    const memberships = {
      owner: ["owner", "active"],
      admin: ["admin", "active"],
      moderator: ["moderator", "active"],
      member: ["member", "active"],
      member2: ["member", "active"],
      viewer: ["viewer", "active"],
      removed: ["member", "removed"],
      inactive: ["member", "inactive"],
    };
    for (const [uid, [role, status]] of Object.entries(memberships)) {
      await setDoc(doc(db, "groups", groupId, "members", uid), { uid, role, status });
    }
    await setDoc(doc(db, "groupMemberships", "stale_mirror"), {
      uid: "stale",
      groupId,
      role: "member",
      status: "active",
    });
    await setDoc(routineRef(db, "read-matrix"), routine("read-matrix"));
    await setDoc(routineRef(db, "other-member-owned"), routine("other-member-owned", "member2"));
  });

  const dbFor = (uid) => env.authenticatedContext(uid).firestore();
  const unauthDb = env.unauthenticatedContext().firestore();

  for (const uid of ["owner", "admin", "moderator", "member", "member2", "viewer"]) {
    await check(`${uid} reads routine`, () =>
      assertSucceeds(getDoc(routineRef(dbFor(uid), "read-matrix")))
    );
  }
  for (const uid of ["removed", "inactive", "unrelated", "stale"]) {
    await check(`${uid} cannot read routine`, () =>
      assertFails(getDoc(routineRef(dbFor(uid), "read-matrix")))
    );
  }
  await check("signed-out user cannot read routine", () =>
    assertFails(getDoc(routineRef(unauthDb, "read-matrix")))
  );
  await check("authorized missing routine returns missing", async () => {
    const snap = await assertSucceeds(getDoc(routineRef(dbFor("viewer"), "missing")));
    if (snap.exists()) throw new Error("missing routine exists");
  });

  for (const uid of ["owner", "admin", "moderator", "member"]) {
    await check(`${uid} creates active routine`, () =>
      assertSucceeds(
        setDoc(
          routineRef(dbFor(uid), `${uid}-create`),
          routine(`${uid}-create`, uid, {}, true)
        )
      )
    );
  }
  for (const uid of ["viewer", "removed", "inactive", "unrelated", "stale"]) {
    await check(`${uid} cannot create routine`, () =>
      assertFails(
        setDoc(
          routineRef(dbFor(uid), `${uid}-create-denied`),
          routine(`${uid}-create-denied`, uid, {}, true)
        )
      )
    );
  }
  await check("signed-out user cannot create", () =>
    assertFails(
      setDoc(routineRef(unauthDb, "signed-out-create"), routine("signed-out-create", "anon", {}, true))
    )
  );

  const createMutations = [
    ["creator spoof", { createdByUid: "member2" }],
    ["paused create", { status: "paused", nextOccurrenceAtMs: null, pausedAtMs: nowMs, pausedByUid: "member" }],
    ["archived create", { status: "archived", nextOccurrenceAtMs: null, archivedAtMs: nowMs, archivedByUid: "member" }],
    ["extra field", { extra: true }],
    ["blank title", { title: "" }],
    ["oversized title", { title: "x".repeat(121) }],
    ["interval zero", { interval: 0 }],
    ["interval over maximum", { interval: 101 }],
    ["empty weekdays", { weekdays: [] }],
    ["duplicate weekdays", { weekdays: [1, 1] }],
    ["unsorted weekdays", { weekdays: [4, 1] }],
    ["weekday zero", { weekdays: [0] }],
    ["weekly monthly conflict", { monthlyMode: "day_of_month", dayOfMonth: 1 }],
    ["bad local time", { localStartTime: "9:00" }],
    ["bad local hour", { localStartTime: "24:00" }],
    ["empty timezone", { timezone: "" }],
    ["oversized timezone", { timezone: "x".repeat(101) }],
    ["bad start shape", { startDate: "01-01-2026" }],
    ["end before start", { endDate: "2025-12-31" }],
    ["zero duration", { durationMinutes: 0 }],
    ["duration over maximum", { durationMinutes: 10081 }],
    ["null next while active", { nextOccurrenceAtMs: null }],
    ["spoofed created timestamp", { createdAt: Timestamp.fromMillis(nowMs) }],
  ];
  for (const [name, overrides] of createMutations) {
    await check(`create rejects ${name}`, () =>
      assertFails(
        setDoc(
          routineRef(dbFor("member"), `bad-${String(name).replaceAll(" ", "-")}`),
          routine(`bad-${String(name).replaceAll(" ", "-")}`, "member", overrides, true)
        )
      )
    );
  }
  await check("create rejects missing canonical field", () => {
    const value = routine("missing-field", "member", {}, true);
    delete value.location;
    return assertFails(setDoc(routineRef(dbFor("member"), "missing-field"), value));
  });
  for (const [name, overrides] of [
    ["daily", { frequency: "daily", weekdays: null }],
    ["monthly day", { frequency: "monthly", weekdays: null, monthlyMode: "day_of_month", dayOfMonth: 31 }],
    ["monthly nth", { frequency: "monthly", weekdays: null, monthlyMode: "nth_weekday", weekOfMonth: -1, weekdayOfMonth: 5 }],
  ]) {
    await check(`create accepts ${name} recurrence`, () => {
      const id = `valid-${String(name).replaceAll(" ", "-")}`;
      return assertSucceeds(setDoc(routineRef(dbFor("member"), id), routine(id, "member", overrides, true)));
    });
  }

  for (const uid of ["owner", "admin", "moderator"]) {
    await check(`${uid} updates another member routine`, () =>
      assertSucceeds(
        updateDoc(routineRef(dbFor(uid), "other-member-owned"), {
          title: `${uid} edit`,
          ...updateTime(nowMs + 10),
        })
      )
    );
  }
  await check("creator member updates own routine", () =>
    assertSucceeds(
      updateDoc(routineRef(dbFor("member"), "read-matrix"), {
        title: "Creator edit",
        ...updateTime(nowMs + 20),
      })
    )
  );
  for (const uid of ["member", "viewer", "removed", "inactive", "unrelated"]) {
    await check(`${uid} cannot update another member routine`, () =>
      assertFails(
        updateDoc(routineRef(dbFor(uid), "other-member-owned"), {
          title: "Denied edit",
          ...updateTime(nowMs + 30),
        })
      )
    );
  }
  for (const [name, patch] of [
    ["id", { id: "spoof" }],
    ["group", { groupId: otherGroupId }],
    ["creator", { createdByUid: "member2" }],
    ["creator name", { createdByName: "Changed" }],
    ["created milliseconds", { createdAtMs: nowMs + 1 }],
    ["created server timestamp", { createdAt: serverTimestamp() }],
    ["unknown field", { unknown: true }],
    ["invalid recurrence", { frequency: "daily" }],
    ["invalid duration", { durationMinutes: 0 }],
    ["invalid local time", { localStartTime: "99:00" }],
  ]) {
    await check(`update rejects immutable or malformed ${name}`, () =>
      assertFails(
        updateDoc(routineRef(dbFor("member"), "read-matrix"), {
          ...patch,
          ...updateTime(nowMs + 40),
        })
      )
    );
  }

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const id of ["pause-own", "pause-other", "resume-own", "archive-own", "archive-paused"]) {
      await setDoc(routineRef(db, id), routine(id, id.includes("other") ? "member2" : "member"));
    }
    await updateDoc(routineRef(db, "resume-own"), pausePatch("member", nowMs + 1));
    await updateDoc(routineRef(db, "archive-paused"), pausePatch("member", nowMs + 1));
  });

  await check("creator pauses own routine", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("member"), "pause-own"), pausePatch("member", nowMs + 50)))
  );
  await check("privileged moderator pauses another routine", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("moderator"), "pause-other"), pausePatch("moderator", nowMs + 51)))
  );
  await check("member cannot pause another routine", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "pause-other"), pausePatch("member", nowMs + 52)))
  );
  await check("pause rejects actor spoof", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "read-matrix"), pausePatch("member2", nowMs + 53)))
  );
  await check("pause rejects content edit", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "read-matrix"), { ...pausePatch("member", nowMs + 54), title: "Combined" }))
  );
  await check("repeat pause rejected", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "pause-own"), pausePatch("member", nowMs + 55)))
  );

  await check("creator resumes paused routine", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("member"), "resume-own"), resumePatch(nowMs + 60)))
  );
  await check("resume rejects uncleared pause actor", async () => {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(routineRef(context.firestore(), "bad-resume"), routine("bad-resume", "member", {
        status: "paused", nextOccurrenceAtMs: null, pausedAtMs: nowMs, pausedByUid: "member",
      }))
    );
    return assertFails(updateDoc(routineRef(dbFor("member"), "bad-resume"), {
      ...resumePatch(nowMs + 61),
      pausedByUid: "member",
    }));
  });
  await check("active content update may change next occurrence", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("member"), "resume-own"), resumePatch(nowMs + 62)))
  );

  await check("creator archives active routine", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("member"), "archive-own"), archivePatch("member", nowMs + 70)))
  );
  await check("creator archives paused routine preserving audit", () =>
    assertSucceeds(updateDoc(routineRef(dbFor("member"), "archive-paused"), archivePatch("member", nowMs + 71)))
  );
  await check("archive rejects actor spoof", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "read-matrix"), archivePatch("member2", nowMs + 72)))
  );
  await check("archived routine is terminal", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "archive-own"), { title: "No", ...updateTime(nowMs + 73) }))
  );
  await check("repeat archive rejected", () =>
    assertFails(updateDoc(routineRef(dbFor("member"), "archive-own"), archivePatch("member", nowMs + 74)))
  );

  for (const uid of ["owner", "admin", "moderator", "member", "viewer"]) {
    await check(`${uid} cannot physically delete`, () =>
      assertFails(deleteDoc(routineRef(dbFor(uid), "read-matrix")))
    );
  }

  const statusQuery = (db, status, requestedGroupId = groupId) =>
    query(
      collection(db, "groupRoutines"),
      where("groupId", "==", requestedGroupId),
      where("status", "==", status),
      limit(100)
    );
  for (const status of ["active", "paused", "archived"]) {
    await check(`viewer queries ${status} routines`, () =>
      assertSucceeds(getDocs(statusQuery(dbFor("viewer"), status)))
    );
  }
  for (const uid of ["removed", "inactive", "unrelated", "stale"]) {
    await check(`${uid} cannot query routines`, () =>
      assertFails(getDocs(statusQuery(dbFor(uid), "active")))
    );
  }
  await check("signed-out query denied", () =>
    assertFails(getDocs(statusQuery(unauthDb, "active")))
  );
  await check("broad routine query denied", () =>
    assertFails(getDocs(query(collection(dbFor("viewer"), "groupRoutines"), limit(100))))
  );
  await check("cross-group query denied", () =>
    assertFails(getDocs(statusQuery(dbFor("viewer"), "active", otherGroupId)))
  );

  await check("single listener receives routine", async () => {
    const snapshot = await nextSnapshot(routineRef(dbFor("viewer"), "read-matrix"));
    if (!snapshot.exists()) throw new Error("single routine missing");
  });
  await check("active listener receives initial snapshot", async () => {
    const snapshot = await nextSnapshot(statusQuery(dbFor("viewer"), "active"));
    if (snapshot.empty) throw new Error("active query empty");
  });
  await check("paused listener receives paused routine", async () => {
    const snapshot = await nextSnapshot(statusQuery(dbFor("viewer"), "paused"));
    if (snapshot.empty) throw new Error("paused query empty");
  });
  await check("archived listener receives archived routine", async () => {
    const snapshot = await nextSnapshot(statusQuery(dbFor("viewer"), "archived"));
    if (snapshot.empty) throw new Error("archived query empty");
  });
  await check("unauthorized listener reports permission failure", async () => {
    await assert.rejects(nextSnapshot(statusQuery(dbFor("removed"), "active")));
  });

  await check("stale mirror cannot write", () =>
    assertFails(
      setDoc(routineRef(dbFor("stale"), "stale-write"), routine("stale-write", "stale", {}, true))
    )
  );
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(routineRef(db, "deleted-group-routine"), routine("deleted-group-routine", "member", { groupId: "deleted-group" }));
    await setDoc(doc(db, "groups", "deleted-group", "members", "member"), { uid: "member", role: "member", status: "active" });
  });
  await check("missing group document denies stale nested member", () =>
    assertFails(getDoc(routineRef(dbFor("member"), "deleted-group-routine")))
  );

  // Actual service transaction alignment using the authenticated member database.
  globalThis.__DAYTA_ROUTINE_QA_DB = dbFor("member");
  const temporaryDirectory = await mkdtemp(path.join(process.cwd(), ".dayta-routine-runtime-"));
  const bundlePath = path.join(temporaryDirectory, "service.mjs");
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["./services/groupRoutines.ts"],
    outfile: bundlePath,
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node22",
    plugins: [{
      name: "routine-runtime-db",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "runtime-db", namespace: "qa" }));
        buildApi.onLoad({ filter: /.*/, namespace: "qa" }, () => ({
          contents: "export const db = globalThis.__DAYTA_ROUTINE_QA_DB;",
        }));
      },
    }],
  });
  const service = await import(pathToFileURL(bundlePath).href);
  let serviceRoutineId = "";
  await check("actual create service succeeds", async () => {
    serviceRoutineId = await service.createGroupRoutine({
      groupId,
      title: "Service routine",
      frequency: "daily",
      localStartTime: "09:00",
      timezone: "UTC",
      startDate: "2026-01-01",
      createdByUid: "member",
      nowMs,
    });
  });
  await check("actual update service succeeds", () =>
    service.updateGroupRoutine({ routineId: serviceRoutineId, title: "Service updated", nowMs: nowMs + 1 })
  );
  await check("actual pause service succeeds", () =>
    service.pauseGroupRoutine({ routineId: serviceRoutineId, actorUid: "member", nowMs: nowMs + 2 })
  );
  await check("actual resume service succeeds", () =>
    service.resumeGroupRoutine({ routineId: serviceRoutineId, actorUid: "member", nowMs: nowMs + 3 })
  );
  await check("actual service rejects active repeat resume", () =>
    assert.rejects(
      service.resumeGroupRoutine({ routineId: serviceRoutineId, actorUid: "member", nowMs: nowMs + 4 })
    )
  );
  await check("actual archive service succeeds", () =>
    service.archiveGroupRoutine({ routineId: serviceRoutineId, actorUid: "member", nowMs: nowMs + 5 })
  );
  await rm(temporaryDirectory, { recursive: true, force: true });
} finally {
  await env.cleanup();
}

console.log(`\nGroup routine rules/runtime QA: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
