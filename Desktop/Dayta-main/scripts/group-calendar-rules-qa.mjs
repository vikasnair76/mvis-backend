import { readFile } from "node:fs/promises";
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
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "dayta---goalsettingapp";
const groupId = "group-runtime-qa";
const otherGroupId = "group-unrelated-qa";
const nowMs = 1_800_000_000_000;
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
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

function timedEvent(id, creator = "member", overrides = {}) {
  return {
    id,
    scope: "group",
    type: "group",
    visibility: "group",
    groupId,
    title: `Runtime event ${id}`,
    description: null,
    location: null,
    allDay: false,
    startAtMs: nowMs + hourMs,
    endAtMs: nowMs + 2 * hourMs,
    startDate: null,
    endDate: null,
    timezone: "UTC",
    sortStartMs: nowMs + hourMs,
    sortEndMs: nowMs + 2 * hourMs,
    createdByUid: creator,
    createdByName: null,
    createdByEmail: null,
    attendeeUids: [],
    status: "scheduled",
    cancelledAtMs: null,
    cancelledByUid: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: Timestamp.fromMillis(nowMs),
    updatedAt: Timestamp.fromMillis(nowMs),
    ...overrides,
  };
}

function allDayEvent(id, overrides = {}) {
  return timedEvent(id, "member", {
    allDay: true,
    startAtMs: null,
    endAtMs: null,
    startDate: "2026-03-08",
    endDate: "2026-03-09",
    timezone: "America/New_York",
    sortStartMs: 1_773_028_800_000,
    sortEndMs: 1_773_111_600_000,
    ...overrides,
  });
}

function personalEvent(id, ownerUid = "member") {
  return {
    id,
    title: "Personal regression",
    description: null,
    scope: "personal",
    type: "personal",
    visibility: "private",
    ownerUid,
    groupId: null,
    goalId: null,
    boardId: null,
    routineId: null,
    startAtMs: nowMs,
    endAtMs: nowMs + hourMs,
    allDay: false,
    createdByUid: ownerUid,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    archived: false,
    createdAt: Timestamp.fromMillis(nowMs),
    updatedAt: Timestamp.fromMillis(nowMs),
  };
}

function eventRef(db, id) {
  return doc(db, "planningCalendarEvents", id);
}

function nextSnapshot(refOrQuery, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("listener timed out"));
    }, 5000);
    const unsubscribe = onSnapshot(
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
    await setDoc(doc(db, "groups", groupId), {
      name: "Runtime QA",
      createdAtMs: nowMs,
    });
    await setDoc(doc(db, "groups", otherGroupId), {
      name: "Unrelated",
      createdAtMs: nowMs,
    });
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
      await setDoc(doc(db, "groups", groupId, "members", uid), {
        uid,
        role,
        status,
      });
    }
  });

  const dbFor = (uid) => env.authenticatedContext(uid).firestore();
  const unauthDb = env.unauthenticatedContext().firestore();

  await check("member creates a valid timed event", async () => {
    await assertSucceeds(
      setDoc(eventRef(dbFor("member"), "member-create"), timedEvent("member-create"))
    );
    const snapshot = await getDoc(eventRef(dbFor("member"), "member-create"));
    const stored = snapshot.data();
    if (!stored || stored.id !== snapshot.id || stored.sortStartMs !== stored.startAtMs) {
      throw new Error("stored timed event parity failed");
    }
  });

  for (const uid of ["owner", "admin", "moderator"]) {
    await check(`${uid} creates a valid timed event`, () =>
      assertSucceeds(
        setDoc(eventRef(dbFor(uid), `${uid}-create`), timedEvent(`${uid}-create`, uid))
      )
    );
  }
  for (const uid of ["viewer", "removed", "inactive", "unrelated"]) {
    await check(`${uid} cannot create`, () =>
      assertFails(
        setDoc(eventRef(dbFor(uid), `${uid}-denied-create`), timedEvent(`${uid}-denied-create`, uid))
      )
    );
  }
  await check("unauthenticated user cannot create", () =>
    assertFails(setDoc(eventRef(unauthDb, "unauth-create"), timedEvent("unauth-create", "anon")))
  );

  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      eventRef(context.firestore(), "read-matrix"),
      timedEvent("read-matrix")
    );
  });
  for (const uid of ["owner", "admin", "moderator", "member", "member2", "viewer"]) {
    await check(`${uid} can read a group event`, () =>
      assertSucceeds(getDoc(eventRef(dbFor(uid), "read-matrix")))
    );
  }
  for (const uid of ["removed", "inactive", "unrelated"]) {
    await check(`${uid} cannot read a group event`, () =>
      assertFails(getDoc(eventRef(dbFor(uid), "read-matrix")))
    );
  }
  await check("unauthenticated user cannot read", () =>
    assertFails(getDoc(eventRef(unauthDb, "read-matrix")))
  );

  const groupQueryFor = (db) =>
    query(
      collection(db, "planningCalendarEvents"),
      where("groupId", "==", groupId),
      where("status", "==", "scheduled"),
      orderBy("sortStartMs", "asc")
    );
  await check("active viewer can list group-filtered events", () =>
    assertSucceeds(getDocs(groupQueryFor(dbFor("viewer"))))
  );
  for (const uid of ["removed", "inactive", "unrelated"]) {
    await check(`${uid} cannot list group-filtered events`, () =>
      assertFails(getDocs(groupQueryFor(dbFor(uid))))
    );
  }
  await check("unauthenticated user cannot list group-filtered events", () =>
    assertFails(getDocs(groupQueryFor(unauthDb)))
  );

  await check("creator updates own event", () =>
    assertSucceeds(
      updateDoc(eventRef(dbFor("member"), "read-matrix"), {
        title: "Creator edit",
        updatedAtMs: nowMs + 1,
        updatedAt: Timestamp.fromMillis(nowMs + 1),
      })
    )
  );
  await check("ordinary member cannot update another member event", () =>
    assertFails(
      updateDoc(eventRef(dbFor("member2"), "read-matrix"), {
        title: "Forbidden edit",
        updatedAtMs: nowMs + 2,
        updatedAt: Timestamp.fromMillis(nowMs + 2),
      })
    )
  );
  for (const uid of ["moderator", "admin", "owner"]) {
    await check(`${uid} updates another member event`, () =>
      assertSucceeds(
        updateDoc(eventRef(dbFor(uid), "read-matrix"), {
          title: `${uid} edit`,
          updatedAtMs: nowMs + 3,
          updatedAt: Timestamp.fromMillis(nowMs + 3),
        })
      )
    );
  }

  const immutableFields = {
    id: "spoofed-id",
    scope: "personal",
    type: "personal",
    visibility: "private",
    groupId: otherGroupId,
    createdByUid: "member2",
    createdByName: "Spoofed",
    createdByEmail: "spoof@example.com",
    createdAtMs: nowMs - 1,
  };
  for (const [field, value] of Object.entries(immutableFields)) {
    await check(`immutable ${field} cannot change`, () =>
      assertFails(
        updateDoc(eventRef(dbFor("owner"), "read-matrix"), {
          [field]: value,
          updatedAtMs: nowMs + 10,
          updatedAt: Timestamp.fromMillis(nowMs + 10),
        })
      )
    );
  }

  const invalidCreates = [
    ["document ID parity", "parity-doc", timedEvent("wrong-id")],
    ["scope spoofing", "bad-scope", timedEvent("bad-scope", "member", { scope: "personal" })],
    ["type spoofing", "bad-type", timedEvent("bad-type", "member", { type: "personal" })],
    ["visibility spoofing", "bad-visibility", timedEvent("bad-visibility", "member", { visibility: "private" })],
    ["creator spoofing", "bad-creator", timedEvent("bad-creator", "member2")],
    ["non-scheduled create", "bad-status", timedEvent("bad-status", "member", { status: "cancelled", cancelledAtMs: nowMs, cancelledByUid: "member" })],
    ["cancellation metadata on create", "bad-cancel-meta", timedEvent("bad-cancel-meta", "member", { cancelledAtMs: nowMs })],
    ["end equals start", "equal-time", timedEvent("equal-time", "member", { endAtMs: nowMs + hourMs, sortEndMs: nowMs + hourMs })],
    ["end before start", "reverse-time", timedEvent("reverse-time", "member", { endAtMs: nowMs, sortEndMs: nowMs })],
    ["missing start", "missing-start", (() => { const value = timedEvent("missing-start"); delete value.startAtMs; return value; })()],
    ["missing end", "missing-end", (() => { const value = timedEvent("missing-end"); delete value.endAtMs; return value; })()],
    ["zero timestamp", "zero-time", timedEvent("zero-time", "member", { startAtMs: 0, sortStartMs: 0 })],
    ["duration over seven days", "long-time", timedEvent("long-time", "member", { endAtMs: nowMs + hourMs + 7 * dayMs + 1, sortEndMs: nowMs + hourMs + 7 * dayMs + 1 })],
    ["conflicting timed date", "timed-date", timedEvent("timed-date", "member", { startDate: "2026-01-01" })],
    ["sort mismatch", "sort-mismatch", timedEvent("sort-mismatch", "member", { sortStartMs: nowMs })],
    ["blank timezone", "blank-timezone", timedEvent("blank-timezone", "member", { timezone: "" })],
    ["all-day lexical ordering", "bad-all-day", allDayEvent("bad-all-day", { startDate: "2026-03-09", endDate: "2026-03-08" })],
    ["attendee list over 50", "attendee-overflow", timedEvent("attendee-overflow", "member", { attendeeUids: Array.from({ length: 51 }, (_, index) => `uid-${index}`) })],
  ];
  for (const [name, id, value] of invalidCreates) {
    await check(`create rejects ${name}`, () =>
      assertFails(setDoc(eventRef(dbFor("member"), id), value))
    );
  }

  await check("valid all-day event is accepted by rules", () =>
    assertSucceeds(
      setDoc(eventRef(dbFor("member"), "all-day-valid"), allDayEvent("all-day-valid"))
    )
  );

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const id of ["cancel-creator", "cancel-member", "cancel-moderator", "cancel-attacks"]) {
      await setDoc(eventRef(db, id), timedEvent(id));
    }
  });
  const cancellationPatch = (uid, at = nowMs + 100) => ({
    status: "cancelled",
    cancelledByUid: uid,
    cancelledAtMs: at,
    updatedAtMs: at,
    updatedAt: Timestamp.fromMillis(at),
  });
  await check("creator cancels own event", () =>
    assertSucceeds(
      updateDoc(eventRef(dbFor("member"), "cancel-creator"), cancellationPatch("member"))
    )
  );
  await check("ordinary member cannot cancel another event", () =>
    assertFails(
      updateDoc(eventRef(dbFor("member2"), "cancel-member"), cancellationPatch("member2"))
    )
  );
  for (const uid of ["moderator", "admin", "owner"]) {
    const id = uid === "moderator" ? "cancel-moderator" : `cancel-${uid}`;
    if (uid !== "moderator") {
      await env.withSecurityRulesDisabled((context) =>
        setDoc(eventRef(context.firestore(), id), timedEvent(id))
      );
    }
    await check(`${uid} cancels another member event`, () =>
      assertSucceeds(updateDoc(eventRef(dbFor(uid), id), cancellationPatch(uid)))
    );
  }
  await check("repeat cancellation is denied", () =>
    assertFails(
      updateDoc(eventRef(dbFor("owner"), "cancel-creator"), cancellationPatch("owner", nowMs + 200))
    )
  );
  await check("cancelled event cannot be edited", () =>
    assertFails(
      updateDoc(eventRef(dbFor("member"), "cancel-creator"), {
        title: "Edited after cancellation",
        updatedAtMs: nowMs + 201,
        updatedAt: Timestamp.fromMillis(nowMs + 201),
      })
    )
  );
  await check("cancelled event cannot be uncancelled", () =>
    assertFails(
      updateDoc(eventRef(dbFor("member"), "cancel-creator"), {
        status: "scheduled",
        cancelledAtMs: null,
        cancelledByUid: null,
        updatedAtMs: nowMs + 202,
        updatedAt: Timestamp.fromMillis(nowMs + 202),
      })
    )
  );
  await check("cancellation cannot include content edit", () =>
    assertFails(
      updateDoc(eventRef(dbFor("owner"), "cancel-attacks"), {
        ...cancellationPatch("owner"),
        title: "Changed while cancelling",
      })
    )
  );
  await check("cancellation timestamp convention is enforced", () =>
    assertFails(
      updateDoc(eventRef(dbFor("owner"), "cancel-attacks"), {
        ...cancellationPatch("owner"),
        updatedAtMs: nowMs + 101,
      })
    )
  );

  for (const uid of ["member", "owner", "admin", "moderator"]) {
    await check(`${uid} cannot physically delete a group event`, () =>
      assertFails(deleteDoc(eventRef(dbFor(uid), "read-matrix")))
    );
  }

  await check("personal owner creates personal event", () =>
    assertSucceeds(
      setDoc(eventRef(dbFor("member"), "personal-regression"), personalEvent("personal-regression"))
    )
  );
  await check("personal owner updates personal event", () =>
    assertSucceeds(
      updateDoc(eventRef(dbFor("member"), "personal-regression"), {
        title: "Personal updated",
        updatedAtMs: nowMs + 1,
        updatedAt: Timestamp.fromMillis(nowMs + 1),
      })
    )
  );
  await check("personal owner archives personal event", () =>
    assertSucceeds(
      updateDoc(eventRef(dbFor("member"), "personal-regression"), {
        archived: true,
        updatedAtMs: nowMs + 2,
        updatedAt: Timestamp.fromMillis(nowMs + 2),
      })
    )
  );
  await check("personal owner deletes personal event", () =>
    assertSucceeds(deleteDoc(eventRef(dbFor("member"), "personal-regression")))
  );

  await check("single-event listener emits scheduled event", async () => {
    const snapshot = await nextSnapshot(eventRef(dbFor("viewer"), "read-matrix"));
    if (!snapshot.exists()) throw new Error("scheduled event was not emitted");
  });
  await check("single-event listener emits null for missing record", async () => {
    const snapshot = await nextSnapshot(eventRef(dbFor("viewer"), "missing-event"));
    if (snapshot.exists()) throw new Error("missing event unexpectedly exists");
  });
  await check("single-event listener emits edits and cancellation while queries drop cancelled event", async () => {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(
        eventRef(context.firestore(), "listener-lifecycle"),
        timedEvent("listener-lifecycle")
      )
    );
    const viewerRef = eventRef(dbFor("viewer"), "listener-lifecycle");
    const editedSnapshotPromise = nextSnapshot(
      viewerRef,
      (snapshot) => snapshot.data()?.title === "Listener edit"
    );
    await updateDoc(eventRef(dbFor("member"), "listener-lifecycle"), {
      title: "Listener edit",
      updatedAtMs: nowMs + 300,
      updatedAt: Timestamp.fromMillis(nowMs + 300),
    });
    const editedSnapshot = await editedSnapshotPromise;
    if (editedSnapshot.data()?.status !== "scheduled") {
      throw new Error("edited scheduled state was not emitted");
    }

    const cancelledSnapshotPromise = nextSnapshot(
      viewerRef,
      (snapshot) => snapshot.data()?.status === "cancelled"
    );
    await updateDoc(
      eventRef(dbFor("member"), "listener-lifecycle"),
      cancellationPatch("member", nowMs + 301)
    );
    const cancelledSnapshot = await cancelledSnapshotPromise;
    if (cancelledSnapshot.data()?.cancelledByUid !== "member") {
      throw new Error("cancelled state was not emitted");
    }

    const upcomingSnapshot = await getDocs(
      query(
        collection(dbFor("viewer"), "planningCalendarEvents"),
        where("groupId", "==", groupId),
        where("status", "==", "scheduled"),
        where("sortStartMs", ">=", nowMs),
        orderBy("sortStartMs", "asc"),
        limit(100)
      )
    );
    if (upcomingSnapshot.docs.some((item) => item.id === "listener-lifecycle")) {
      throw new Error("cancelled event remained in upcoming results");
    }
  });

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const candidates = [
      timedEvent("overlap-inside", "member", { startAtMs: nowMs + hourMs, endAtMs: nowMs + 2 * hourMs, sortStartMs: nowMs + hourMs, sortEndMs: nowMs + 2 * hourMs }),
      timedEvent("overlap-start-before", "member", { startAtMs: nowMs - hourMs, endAtMs: nowMs + hourMs, sortStartMs: nowMs - hourMs, sortEndMs: nowMs + hourMs }),
      timedEvent("overlap-end-after", "member", { startAtMs: nowMs + hourMs, endAtMs: nowMs + 4 * hourMs, sortStartMs: nowMs + hourMs, sortEndMs: nowMs + 4 * hourMs }),
      timedEvent("overlap-surround", "member", { startAtMs: nowMs - hourMs, endAtMs: nowMs + 4 * hourMs, sortStartMs: nowMs - hourMs, sortEndMs: nowMs + 4 * hourMs }),
      timedEvent("ends-at-start", "member", { startAtMs: nowMs - hourMs, endAtMs: nowMs, sortStartMs: nowMs - hourMs, sortEndMs: nowMs }),
      timedEvent("starts-at-end", "member", { startAtMs: nowMs + 3 * hourMs, endAtMs: nowMs + 4 * hourMs, sortStartMs: nowMs + 3 * hourMs, sortEndMs: nowMs + 4 * hourMs }),
      timedEvent("entirely-before", "member", { startAtMs: nowMs - 3 * hourMs, endAtMs: nowMs - 2 * hourMs, sortStartMs: nowMs - 3 * hourMs, sortEndMs: nowMs - 2 * hourMs }),
      timedEvent("entirely-after", "member", { startAtMs: nowMs + 4 * hourMs, endAtMs: nowMs + 5 * hourMs, sortStartMs: nowMs + 4 * hourMs, sortEndMs: nowMs + 5 * hourMs }),
      timedEvent("ongoing-past-start", "member", { startAtMs: nowMs - hourMs, endAtMs: nowMs + hourMs, sortStartMs: nowMs - hourMs, sortEndMs: nowMs + hourMs }),
      timedEvent("cancelled-query", "member", { status: "cancelled", cancelledAtMs: nowMs, cancelledByUid: "member" }),
    ];
    for (const candidate of candidates) {
      await setDoc(eventRef(db, candidate.id), candidate);
    }
  });

  await check("upcoming query uses future start, ascending order, and excludes cancelled/ongoing", async () => {
    const db = dbFor("viewer");
    const upcoming = query(
      collection(db, "planningCalendarEvents"),
      where("groupId", "==", groupId),
      where("status", "==", "scheduled"),
      where("sortStartMs", ">=", nowMs),
      orderBy("sortStartMs", "asc"),
      limit(10)
    );
    const snapshot = await nextSnapshot(upcoming);
    const docs = snapshot.docs.map((item) => item.data());
    if (docs.some((item) => item.id === "ongoing-past-start" || item.status !== "scheduled")) {
      throw new Error("upcoming semantics were violated");
    }
    if (docs.some((item, index) => index > 0 && docs[index - 1].sortStartMs > item.sortStartMs)) {
      throw new Error("upcoming order was not ascending");
    }
  });

  await check("range query plus half-open client filter returns four overlap shapes", async () => {
    const db = dbFor("viewer");
    const rangeEndMs = nowMs + 3 * hourMs;
    const rangeQuery = query(
      collection(db, "planningCalendarEvents"),
      where("groupId", "==", groupId),
      where("status", "==", "scheduled"),
      where("sortStartMs", ">=", nowMs - 367 * dayMs),
      where("sortStartMs", "<", rangeEndMs),
      orderBy("sortStartMs", "asc"),
      limit(200)
    );
    const snapshot = await nextSnapshot(rangeQuery);
    const ids = snapshot.docs
      .map((item) => item.data())
      .filter((item) => item.sortEndMs > nowMs)
      .map((item) => item.id);
    for (const expected of ["overlap-inside", "overlap-start-before", "overlap-end-after", "overlap-surround"]) {
      if (!ids.includes(expected)) throw new Error(`missing ${expected}`);
    }
    for (const excluded of ["ends-at-start", "starts-at-end", "entirely-before", "entirely-after", "cancelled-query"]) {
      if (ids.includes(excluded)) throw new Error(`included ${excluded}`);
    }
  });

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const longStart = nowMs - 365 * dayMs;
    await setDoc(
      eventRef(db, "long-span-lookback"),
      allDayEvent("long-span-lookback", {
        startDate: "2025-01-01",
        endDate: "2026-01-02",
        timezone: "UTC",
        sortStartMs: longStart,
        sortEndMs: nowMs + dayMs,
      })
    );
  });
  await check("367-day lookback includes a valid long overlapping event", async () => {
    const db = dbFor("viewer");
    const rangeQuery = query(
      collection(db, "planningCalendarEvents"),
      where("groupId", "==", groupId),
      where("status", "==", "scheduled"),
      where("sortStartMs", ">=", nowMs - 367 * dayMs),
      where("sortStartMs", "<", nowMs + hourMs),
      orderBy("sortStartMs", "asc"),
      limit(200)
    );
    const snapshot = await getDocs(rangeQuery);
    const found = snapshot.docs
      .map((item) => item.data())
      .some((item) => item.id === "long-span-lookback" && item.sortEndMs > nowMs);
    if (!found) throw new Error("long overlapping event was not returned");
  });
} finally {
  await env.cleanup();
}

console.log(`\nGroup calendar rules/runtime QA: ${passed} passed, ${failures.length} failed.`);
if (failures.length > 0) process.exitCode = 1;
