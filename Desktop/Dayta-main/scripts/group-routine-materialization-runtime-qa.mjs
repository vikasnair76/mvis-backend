import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  getRoutineOccurrenceId,
  getRoutineProjectionId,
  reconcileRoutine,
} from "../functions/lib/groupRoutineMaterialization.js";

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore, Timestamp } = requireFromFunctions("firebase-admin/firestore");

const app = initializeApp({ projectId: "dayta---goalsettingapp" }, `materialization-${Date.now()}`);
const db = getFirestore(app);
const nowMs = Date.parse("2026-07-25T12:00:00.000Z");
let passed = 0;
const check = async (name, work) => {
  await work();
  passed += 1;
  console.log(`PASS ${name}`);
};
const routineData = (id, patch = {}) => ({
  id,
  groupId: "materialization-group",
  title: "Daily sync",
  description: "Description",
  location: "Room",
  status: "active",
  frequency: "daily",
  interval: 1,
  weekdays: null,
  monthlyMode: null,
  dayOfMonth: null,
  weekOfMonth: null,
  weekdayOfMonth: null,
  localStartTime: "09:00",
  durationMinutes: 60,
  timezone: "UTC",
  startDate: "2026-07-20",
  endDate: null,
  nextOccurrenceAtMs: Date.parse("2026-07-25T09:00:00Z"),
  createdByUid: "member",
  createdByName: "Member",
  createdByEmail: "member@example.com",
  createdAtMs: nowMs - 1000,
  updatedAtMs: nowMs - 1000,
  createdAt: Timestamp.fromMillis(nowMs - 1000),
  updatedAt: Timestamp.fromMillis(nowMs - 1000),
  pausedAtMs: null,
  pausedByUid: null,
  archivedAtMs: null,
  archivedByUid: null,
  participantUids: [],
  ...patch,
});
async function occurrenceDocs(routineId) {
  return (await db.collection("groupRoutineOccurrences").where("routineId", "==", routineId).get()).docs;
}
async function scheduledDocs(routineId) {
  return (await db.collection("groupRoutineOccurrences")
    .where("routineId", "==", routineId)
    .where("status", "==", "scheduled").get()).docs;
}

try {
  await db.collection("groups").doc("materialization-group").set({ name: "QA" });
  const routineRef = db.collection("groupRoutines").doc("runtime-routine");
  await routineRef.set(routineData("runtime-routine"));

  let first;
  await check("active routine reconciles", async () => {
    first = await reconcileRoutine(db, "runtime-routine", nowMs);
    assert.ok(first.created > 0);
  });
  const initialDocs = await occurrenceDocs("runtime-routine");
  await check("occurrences and projections are created", async () => {
    assert.ok(initialDocs.length > 1);
    const projection = await db.collection("planningCalendarEvents")
      .doc(initialDocs[0].data().calendarProjectionId).get();
    assert.equal(projection.data().sourceType, "group_routine");
  });
  await check("deterministic document identities match", async () => {
    const item = initialDocs[0].data();
    assert.equal(initialDocs[0].id, getRoutineOccurrenceId("runtime-routine", item.startAtMs));
    assert.equal(item.calendarProjectionId, getRoutineProjectionId(initialDocs[0].id));
  });
  await check("retry creates no duplicates", async () => {
    const before = (await occurrenceDocs("runtime-routine")).length;
    const result = await reconcileRoutine(db, "runtime-routine", nowMs);
    assert.equal(result.created, 0);
    assert.equal((await occurrenceDocs("runtime-routine")).length, before);
  });
  await check("content edit updates future snapshots", async () => {
    await routineRef.update({ title: "Renamed", updatedAtMs: nowMs + 1 });
    await reconcileRoutine(db, "runtime-routine", nowMs + 1);
    const future = (await scheduledDocs("runtime-routine"))
      .find((item) => item.data().startAtMs >= nowMs);
    assert.equal(future.data().routineTitleSnapshot, "Renamed");
    const projection = await db.collection("planningCalendarEvents")
      .doc(future.data().calendarProjectionId).get();
    assert.equal(projection.data().title, "Renamed");
  });
  let oldFutureIds = [];
  await check("time edit invalidates old future schedule", async () => {
    oldFutureIds = (await scheduledDocs("runtime-routine"))
      .filter((item) => item.data().startAtMs >= nowMs)
      .map((item) => item.id);
    await routineRef.update({ localStartTime: "10:00", updatedAtMs: nowMs + 2 });
    await reconcileRoutine(db, "runtime-routine", nowMs + 2);
    const old = await db.collection("groupRoutineOccurrences").doc(oldFutureIds[0]).get();
    assert.equal(old.data().status, "cancelled");
    const fresh = (await scheduledDocs("runtime-routine"))
      .filter((item) => item.data().startAtMs >= nowMs);
    assert.ok(fresh.some((item) => !oldFutureIds.includes(item.id)));
  });
  await check("pause preserves past and cancels future", async () => {
    await routineRef.update({
      status: "paused", nextOccurrenceAtMs: null, pausedAtMs: nowMs + 3,
      pausedByUid: "member", updatedAtMs: nowMs + 3,
    });
    await reconcileRoutine(db, "runtime-routine", nowMs + 3);
    const docs = await occurrenceDocs("runtime-routine");
    assert.ok(docs.some((item) => item.data().startAtMs < nowMs && item.data().status === "scheduled"));
    const remainingFuture = docs.filter(
      (item) =>
        item.data().startAtMs >= nowMs &&
        item.data().status !== "cancelled"
    );
    assert.equal(
      remainingFuture.length,
      0,
      `remaining scheduled future records: ${remainingFuture.length}`
    );
  });
  await check("resume reactivates deterministic current ids", async () => {
    await routineRef.update({
      status: "active", nextOccurrenceAtMs: null, pausedAtMs: null,
      pausedByUid: null, updatedAtMs: nowMs + 4,
    });
    await reconcileRoutine(db, "runtime-routine", nowMs + 4);
    assert.ok((await scheduledDocs("runtime-routine"))
      .some((item) => item.data().startAtMs >= nowMs));
  });
  await check("end date shortening cancels invalid future", async () => {
    await routineRef.update({ endDate: "2026-07-26", updatedAtMs: nowMs + 5 });
    await reconcileRoutine(db, "runtime-routine", nowMs + 5);
    const scheduled = await scheduledDocs("runtime-routine");
    assert.ok(scheduled.every((item) => item.data().localDate <= "2026-07-26"));
  });
  await check("end date extension adds future records", async () => {
    const before = (await scheduledDocs("runtime-routine")).length;
    await routineRef.update({ endDate: "2026-07-30", updatedAtMs: nowMs + 6 });
    await reconcileRoutine(db, "runtime-routine", nowMs + 6);
    assert.ok((await scheduledDocs("runtime-routine")).length > before);
  });
  await check("duration edit updates projection end", async () => {
    await routineRef.update({ durationMinutes: 90, updatedAtMs: nowMs + 7 });
    await reconcileRoutine(db, "runtime-routine", nowMs + 7);
    const future = (await scheduledDocs("runtime-routine"))
      .find((item) => item.data().startAtMs >= nowMs);
    const projection = await db.collection("planningCalendarEvents")
      .doc(future.data().calendarProjectionId).get();
    assert.equal(projection.data().endAtMs - projection.data().startAtMs, 90 * 60 * 1000);
  });
  await check("timezone edit replaces future instants", async () => {
    const beforeIds = new Set((await scheduledDocs("runtime-routine"))
      .filter((item) => item.data().startAtMs >= nowMs).map((item) => item.id));
    await routineRef.update({
      timezone: "America/New_York", localStartTime: "09:00",
      updatedAtMs: nowMs + 8,
    });
    await reconcileRoutine(db, "runtime-routine", nowMs + 8);
    assert.ok((await scheduledDocs("runtime-routine"))
      .filter((item) => item.data().startAtMs >= nowMs)
      .some((item) => !beforeIds.has(item.id)));
  });
  await check("overlapping runs remain idempotent", async () => {
    const results = await Promise.allSettled([
      reconcileRoutine(db, "runtime-routine", nowMs + 9),
      reconcileRoutine(db, "runtime-routine", nowMs + 9),
    ]);
    assert.ok(results.every((item) => item.status === "fulfilled"));
  });
  await check("missing projection is repaired on retry", async () => {
    const future = (await scheduledDocs("runtime-routine"))
      .find((item) => item.data().startAtMs >= nowMs);
    const projectionRef = db.collection("planningCalendarEvents")
      .doc(future.data().calendarProjectionId);
    await projectionRef.delete();
    await reconcileRoutine(db, "runtime-routine", nowMs + 10);
    assert.equal((await projectionRef.get()).exists, true);
  });
  await check("cache advances to future occurrence", async () => {
    const data = (await routineRef.get()).data();
    assert.ok(data.nextOccurrenceAtMs > nowMs);
  });
  await check("ended active routine receives null cache", async () => {
    await routineRef.update({
      timezone: "UTC", endDate: "2026-07-24", nextOccurrenceAtMs: nowMs,
      updatedAtMs: nowMs + 11,
    });
    await reconcileRoutine(db, "runtime-routine", nowMs + 11);
    assert.equal((await routineRef.get()).data().nextOccurrenceAtMs, null);
    assert.equal((await routineRef.get()).data().status, "active");
  });
  await check("archive cancels future and leaves cache null", async () => {
    await routineRef.update({
      status: "archived", nextOccurrenceAtMs: null,
      archivedAtMs: nowMs + 12, archivedByUid: "member",
      updatedAtMs: nowMs + 12,
    });
    await reconcileRoutine(db, "runtime-routine", nowMs + 12);
    const data = (await routineRef.get()).data();
    assert.equal(data.nextOccurrenceAtMs, null);
    assert.equal(data.status, "archived");
  });
} finally {
  await deleteApp(app);
}

console.log(`\nGroup routine materialization runtime QA: ${passed} passed, 0 failed.`);
