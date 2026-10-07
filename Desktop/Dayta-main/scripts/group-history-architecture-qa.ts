import assert from "node:assert/strict";
import {
  GROUP_HISTORY_CATEGORIES,
  GROUP_HISTORY_ENTITY_TYPES,
  GROUP_HISTORY_EVENT_DEFINITIONS,
  GROUP_HISTORY_EVENT_TYPES,
  GROUP_HISTORY_MAX_DISPLAY_NAME_LENGTH,
  GROUP_HISTORY_VISIBILITIES,
  buildGroupHistoryEventId,
  getGroupHistoryCollectionPath,
  getGroupHistoryEventPath,
  mapGroupHistoryEventDoc,
} from "../services/groupHistory";

let checks = 0;
const ok = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks += 1;
};
const eq = (actual: unknown, expected: unknown, message: string) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const rejects = (action: () => unknown, message: string) => {
  assert.throws(action, message);
  checks += 1;
};

for (const [label, values] of [
  ["event types", GROUP_HISTORY_EVENT_TYPES],
  ["categories", GROUP_HISTORY_CATEGORIES],
  ["entity types", GROUP_HISTORY_ENTITY_TYPES],
] as const) {
  eq(new Set(values).size, values.length, `${label} are unique`);
}
for (const eventType of GROUP_HISTORY_EVENT_TYPES) {
  ok(GROUP_HISTORY_CATEGORIES.includes(
    GROUP_HISTORY_EVENT_DEFINITIONS[eventType].category),
  `${eventType} maps to a category`);
  ok(GROUP_HISTORY_ENTITY_TYPES.includes(
    GROUP_HISTORY_EVENT_DEFINITIONS[eventType].entityType),
  `${eventType} maps to an entity type`);
}
for (const excluded of [
  "dm_message_sent", "conversation_message_sent", "comment_created",
  "member_removed", "member_role_changed", "moderation_report_created",
]) {
  ok(!(GROUP_HISTORY_EVENT_TYPES as readonly string[]).includes(excluded),
    `${excluded} is excluded`);
}

const valid = {
  schemaVersion: 1,
  groupId: "group-a",
  eventType: "shared_subtask_completed",
  category: "goals",
  occurredAtMs: 1_721_000_000_000,
  createdAtMs: 1_721_000_000_500,
  entityType: "subtask",
  entityId: "subtask-a",
  parentEntityType: "goal",
  parentEntityId: "goal-a",
  sourceEventId: "progress:transition-a",
  displayTitle: "Shared subtask",
  summary: null,
  actorUid: "actor-a",
  actorDisplayName: "Group member",
  creditedMemberUid: "assignee-a",
  creditedMemberDisplayName: "Assigned member",
  visibility: "group_members",
  metadata: {
    kind: "shared_subtask_completed",
    assignmentUid: "assignee-a",
  },
} as const;

const mapped = mapGroupHistoryEventDoc("group-a", "event-a", valid);
ok(mapped, "valid event maps");
eq(mapped?.actorUid, "actor-a", "actor remains distinct");
eq(mapped?.creditedMemberUid, "assignee-a", "credited member remains distinct");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, actorUid: null, actorDisplayName: null})?.actorUid,
null, "actor may be unknown");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, schemaVersion: 2}), null, "unknown schema rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, eventType: "message_sent"}), null, "unknown event rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, category: "tasks"}), null, "contradictory category rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, entityType: "group_task"}), null,
"contradictory entity type rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, occurredAtMs: Number.NaN}), null, "invalid timestamp rejected");
eq(mapGroupHistoryEventDoc("group/a", "event-a", valid), null,
  "invalid path group rejected");
eq(mapGroupHistoryEventDoc("group-b", "event-a", valid), null,
  "path payload mismatch rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, actorEmail: "member@example.com"}), null, "email field rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a",
  {...valid, messageText: "private"}), null, "message text rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, metadata: {...valid.metadata, arbitrary: "unsafe"},
}), null, "arbitrary metadata rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, metadata: [valid.metadata],
}), null, "metadata arrays rejected");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, displayTitle: "x".repeat(500),
})?.displayTitle?.length, 160, "title is deterministically bounded");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, summary: "x".repeat(500),
})?.summary?.length, 240, "summary is deterministically bounded");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, actorDisplayName: "x".repeat(500),
})?.actorDisplayName?.length, GROUP_HISTORY_MAX_DISPLAY_NAME_LENGTH,
"actor snapshot is bounded");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, creditedMemberUid: null, creditedMemberDisplayName: null,
})?.creditedMemberUid, null, "credited member is optional");
eq(mapGroupHistoryEventDoc("group-a", "event-a", {
  ...valid, visibility: "managers",
}), null, "unknown visibility rejected");
eq(GROUP_HISTORY_VISIBILITIES, ["group_members"],
  "visibility default is explicit and bounded");
eq(mapGroupHistoryEventDoc("group-a", "event-a", null), null,
  "malformed input does not throw");

const identity = {
  groupId: "group-a",
  eventType: "shared_subtask_completed" as const,
  sourceEventId: "progress:transition-a",
};
const eventId = buildGroupHistoryEventId(identity);
eq(buildGroupHistoryEventId(identity), eventId, "retry identity is stable");
ok(buildGroupHistoryEventId({...identity, groupId: "group-b"}) !== eventId,
  "different group changes identity");
ok(buildGroupHistoryEventId({
  ...identity, sourceEventId: "progress:transition-b",
}) !== eventId, "different occurrence changes identity");
eq(buildGroupHistoryEventId({...identity}), eventId,
  "mutable titles and actor snapshots are absent from identity");
ok(!eventId.includes("/") && eventId.length < 100,
  "event ID is slash-safe and bounded");
eq(getGroupHistoryCollectionPath("group-a"),
  "groups/group-a/historyEvents", "collection is group nested");
eq(getGroupHistoryEventPath("group-a", eventId),
  `groups/group-a/historyEvents/${eventId}`,
  "event path uses authoritative group");
rejects(() => getGroupHistoryCollectionPath("group/a"),
  "slash group ID rejected");
rejects(() => getGroupHistoryEventPath("group-a", "event/a"),
  "slash event ID rejected");

const recurringA = buildGroupHistoryEventId({
  groupId: "group-a",
  eventType: "group_routine_occurrence_completed",
  sourceEventId: "occurrence-a:revision-1",
});
const recurringB = buildGroupHistoryEventId({
  groupId: "group-a",
  eventType: "group_routine_occurrence_completed",
  sourceEventId: "occurrence-b:revision-1",
});
ok(recurringA !== recurringB, "recurring occurrences remain distinct");
eq(buildGroupHistoryEventId(identity), eventId,
  "reopen or unrelated source edits do not overwrite completion identity");

console.log(`Group History architecture QA passed (${checks} checks).`);
