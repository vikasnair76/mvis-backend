import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "dayta---goalsettingapp",
  firestore: { rules },
});
let passed = 0;
const check = async (name, work) => {
  await work();
  passed += 1;
  console.log(`PASS ${name}`);
};
const now = Date.now();
const suggestion = (id, patch = {}) => ({
  id,
  ownerUid: "owner",
  scope: "personal",
  groupId: null,
  type: "schedule_work",
  status: "active",
  priority: "high",
  confidence: { level: "high", score: 0.8 },
  title: "Schedule overdue work",
  summary: "This work has no scheduled time.",
  rationale: "This subtask is overdue and has no scheduled time.",
  evidence: [{ kind: "overdue", label: "Overdue by 3 days", valueNumber: 3 }],
  target: {
    primary: { type: "subtask", id: "task", goalId: "goal" },
    related: [],
  },
  proposedAction: {
    type: "schedule_entity",
    target: { type: "subtask", id: "task", goalId: "goal" },
    proposedStartAtMs: now + 10_000,
    proposedEndAtMs: now + 20_000,
    timeZone: "UTC",
  },
  source: {
    type: "manual_fixture",
    ruleId: "fixture",
    ruleVersion: 1,
    generatedBy: "server",
    inputFingerprint: "input",
    timeBucket: "day",
  },
  dedupeKey: `planner_${id}`,
  generationRunId: null,
  generatedAtMs: now,
  expiresAtMs: now + 86_400_000,
  snoozedUntilMs: null,
  viewedAtMs: null,
  actedAtMs: null,
  acceptedAtMs: null,
  dismissedAtMs: null,
  dismissalReason: null,
  expiredAtMs: null,
  archivedAtMs: null,
  invalidatedAtMs: null,
  invalidationReason: null,
  createdAtMs: now,
  updatedAtMs: now,
  createdAt: Timestamp.fromMillis(now),
  updatedAt: Timestamp.fromMillis(now),
  ...patch,
});
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const ownerDb = dbFor("owner");
const otherDb = dbFor("other");

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "owner"), { uid: "owner" });
    for (const [id, patch] of [
      ["active", {}],
      ["dismiss", {}],
      ["snooze", {}],
      ["viewed", {}],
      ["accepted", { status: "accepted", acceptedAtMs: now, actedAtMs: now }],
      ["expired", { expiresAtMs: now - 1 }],
      ["group-private", { scope: "group", groupId: "group-1" }],
    ]) {
      await setDoc(
        doc(db, "users", "owner", "plannerSuggestions", id),
        suggestion(id, patch)
      );
    }
    for (let index = 0; index < 200; index += 1) {
      const status =
        index < 50 ? "active" : index < 100 ? "snoozed" : "dismissed";
      await setDoc(
        doc(db, "users", "owner", "plannerSuggestions", `perf-${index}`),
        suggestion(`perf-${index}`, {
          status,
          snoozedUntilMs: status === "snoozed" ? now + 50_000 : null,
          dismissedAtMs: status === "dismissed" ? now : null,
          actedAtMs: status === "dismissed" ? now : null,
          updatedAtMs: now + index,
        })
      );
    }
  });

  await check("owner reads own suggestion", () =>
    assertSucceeds(getDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "active")))
  );
  await check("other user denied", () =>
    assertFails(getDoc(doc(otherDb, "users", "owner", "plannerSuggestions", "active")))
  );
  await check("signed out denied", () =>
    assertFails(
      getDoc(
        doc(env.unauthenticatedContext().firestore(), "users", "owner", "plannerSuggestions", "active")
      )
    )
  );
  await check("group membership does not expose private suggestion", () =>
    assertFails(getDoc(doc(otherDb, "users", "owner", "plannerSuggestions", "group-private")))
  );
  await check("client creation denied", () =>
    assertFails(
      setDoc(
        doc(ownerDb, "users", "owner", "plannerSuggestions", "forged"),
        suggestion("forged")
      )
    )
  );
  await check("owner cannot accept active without trusted execution", () =>
    assertFails(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "active"), {
        status: "accepted",
        acceptedAtMs: now + 1,
        actedAtMs: now + 1,
        snoozedUntilMs: null,
        updatedAtMs: now + 1,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("execution record read denied", () =>
    assertFails(getDoc(doc(ownerDb, "users", "owner",
      "plannerSuggestionExecutions", "active")))
  );
  await check("execution record creation denied", () =>
    assertFails(setDoc(doc(ownerDb, "users", "owner",
      "plannerSuggestionExecutions", "active"), {
      ownerUid: "owner", suggestionId: "active", status: "completed",
    }))
  );
  await check("owner dismisses active", () =>
    assertSucceeds(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "dismiss"), {
        status: "dismissed",
        dismissedAtMs: now + 2,
        actedAtMs: now + 2,
        dismissalReason: "not_relevant",
        snoozedUntilMs: null,
        updatedAtMs: now + 2,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("owner snoozes active", () =>
    assertSucceeds(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "snooze"), {
        status: "snoozed",
        snoozedUntilMs: now + 60_000,
        updatedAtMs: now + 3,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("owner marks viewed", () =>
    assertSucceeds(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "viewed"), {
        viewedAtMs: now + 4,
        updatedAtMs: now + 4,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("accepted archives", () =>
    assertSucceeds(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "accepted"), {
        status: "archived",
        archivedAtMs: now + 5,
        updatedAtMs: now + 5,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("expired accept denied", () =>
    assertFails(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "expired"), {
        status: "accepted",
        acceptedAtMs: now + 6,
        actedAtMs: now + 6,
        updatedAtMs: now + 6,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("accepted cannot reactivate", () =>
    assertFails(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "accepted"), {
        status: "active",
        updatedAtMs: now + 7,
        updatedAt: serverTimestamp(),
      })
    )
  );
  for (const [name, field, value] of [
    ["owner", "ownerUid", "other"],
    ["title", "title", "Changed"],
    ["evidence", "evidence", []],
    ["action", "proposedAction", { type: "review_entity" }],
    ["dedupe", "dedupeKey", "changed"],
    ["expiration", "expiresAtMs", now + 99],
  ]) {
    await check(`${name} mutation denied`, () =>
      assertFails(
        updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "viewed"), {
          [field]: value,
          updatedAtMs: now + 8,
          updatedAt: serverTimestamp(),
        })
      )
    );
  }
  await check("unknown field denied", () =>
    assertFails(
      updateDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "viewed"), {
        rawPatch: { delete: true },
        updatedAtMs: now + 9,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("delete denied", () =>
    assertFails(
      import("firebase/firestore").then(({ deleteDoc }) =>
        deleteDoc(doc(ownerDb, "users", "owner", "plannerSuggestions", "viewed"))
      )
    )
  );
  await check("valid preferences create", () =>
    assertSucceeds(
      setDoc(doc(ownerDb, "users", "owner", "settings", "planner"), {
        enabled: true,
        allowPersonalSuggestions: true,
        allowGroupSuggestions: false,
        notificationsEnabled: true,
        personalNotificationsEnabled: true,
        groupNotificationsEnabled: true,
        conflictNotificationsEnabled: true,
        opportunityNotificationsEnabled: true,
        hiddenSuggestionTypes: ["focus_block"],
        updatedAtMs: now,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("other user preferences denied", () =>
    assertFails(getDoc(doc(otherDb, "users", "owner", "settings", "planner")))
  );
  await check("invalid hidden type denied", () =>
    assertFails(
      setDoc(doc(ownerDb, "users", "owner", "settings", "planner"), {
        enabled: true,
        allowPersonalSuggestions: true,
        allowGroupSuggestions: true,
        notificationsEnabled: true,
        personalNotificationsEnabled: true,
        groupNotificationsEnabled: true,
        conflictNotificationsEnabled: true,
        opportunityNotificationsEnabled: true,
        hiddenSuggestionTypes: ["unknown"],
        updatedAtMs: now,
        updatedAt: serverTimestamp(),
      })
    )
  );
  await check("generation run client write denied", () =>
    assertFails(
      setDoc(doc(ownerDb, "users", "owner", "plannerGenerationRuns", "run"), {
        status: "queued",
      })
    )
  );
  await check("active query bounded", async () => {
    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(ownerDb, "users", "owner", "plannerSuggestions"),
          where("status", "in", ["active", "snoozed"]),
          orderBy("generatedAtMs", "desc"),
          limit(50)
        )
      )
    );
    if (snapshot.size > 50) throw new Error("query exceeded limit");
  });
  await check("history query bounded", async () => {
    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(ownerDb, "users", "owner", "plannerSuggestions"),
          where("status", "in", ["accepted", "dismissed", "expired", "invalidated", "archived"]),
          orderBy("updatedAtMs", "desc"),
          limit(25)
        )
      )
    );
    if (snapshot.size > 25) throw new Error("query exceeded limit");
  });
} finally {
  await env.cleanup();
}

console.log(`Planner suggestion Firestore QA passed (${passed} checks).`);
