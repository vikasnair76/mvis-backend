# 8B.7B.1 Group Completion Ledger canonical architecture

Status: **Decided at repository level. Recording, queries, UI, rules implementation, backfill, deployment, and device acceptance are pending.**

## 1. Purpose and boundaries

The canonical internal name is `GroupHistoryEvent`. “Group Completion Ledger” describes the domain:

> An immutable, group-scoped ledger of trusted, factual completion and planning outcomes that active members are permitted to review as shared history.

It answers what shared work completed, when, which shared entity was affected, which group owned the outcome at occurrence time, and—only when reliably known—who caused or was credited for it.

It is not a messaging archive, activity-feed replacement, notification store, moderation archive, administration log, universal audit trail, attendance system, or member-performance system. Search, exports, charts, comparisons, rankings, rates, and per-member analytics are out of scope.

## 2. Repository inspection and existing systems

### Event and audit inventory

| System and path | Writers and trust | Purpose and audience | Mutability / retention | Identity fields | Ledger-source assessment |
|---|---|---|---|---|---|
| Group activity: `groups/{groupId}/activity/{activityId}` | Mostly client services in `services/groups.ts`; routine occurrence activity also comes from trusted transition processing | Recent member awareness; all active roles, including viewers, read non-hidden entries | Random IDs; moderator hiding, reactions, and client deletion are supported; query is recent-first and capped | `actorUid`, optional actor/email-derived names, targets, entity IDs, client `createdAtMs` | **Not canonical.** Broad, client-writable, mutable, incomplete, non-idempotent, sometimes email-bearing, and semantically inconsistent (`subtask_completed` is also used for a group task). A trusted source transition may separately emit activity and History. |
| Group inbox: `users/{uid}/groupInbox/{itemId}` | Client services plus trusted routine/planner processors | Per-user assignments, activity, conversations, moderation, planner and push-oriented awareness | Recipient can mark read/delete; some deterministic idempotency keys | recipient UID, actor, related entity, transition ID, deep link, timestamps | **Exclude.** It is a mutable per-recipient delivery projection, not group-owned history. |
| Admin logs: `groups/{groupId}/adminLogs/{logId}` | Manager clients; trusted routine correction processing for restricted actions | Owner/admin/moderator governance and moderation review | Append-only under rules, but random identity and client-authored for many actions | actor/target UID, names, emails, arbitrary metadata, message, timestamp | **Exclude.** Restricted audience, governance content, emails, and arbitrary metadata must never be exposed through member History. |
| Moderation reports: `groups/{groupId}/reports/{reportId}` | Active member client creates; managers update | Safety review, including DM/conversation evidence and reporter notes | Status and moderator fields mutate; deletion denied | reporter/reviewer/target identities, previews, notes, timestamps | **Exclude.** Contains sensitive private content and moderation state. |
| Moderation action history | `adminLogs` actions plus mutable fields on reports and moderated source documents | Restricted hide/restore/remove decision trail | Split across mutable and append-only records | reviewer/moderator, report and source IDs | **Exclude.** It is not ordinary shared-work history. |
| Notifications and push queues: top-level `assignmentNotificationRequests`, `mentionNotificationRequests`, `messageNotificationRequests`, `routineNotificationRequests`, `plannerNotificationRequests` | Mixed validated client enqueue and trusted processors/schedulers | Delivery workflow and retry state | Operational status mutates; cleanup exists for some queues | request IDs, recipients, source/transition IDs, processing timestamps | **Exclude.** Delivery is not a shared outcome. |
| Shared-goal links: `groups/{groupId}/sharedGoals/{goalId}` plus `goals/{goalId}` and subcollections | Client services under group/source rules | Establish group visibility for a separately stored goal | Link can become `removed` or be deleted; goal and completion state mutate | goal/group/owner/share IDs and timestamps | **Potential source context only.** The link is not a completion fact. Trusted recording must validate the group link at occurrence time. |
| Shared subtask completion/progress: goal/subtask/completion/progress documents | Client transition constrained by rules; Personal History already requires `latestProgressEventId` | Durable completion/progress state | Reversible/current state plus immutable progress identity | goal, subtask, assignee/user and progress transition IDs | **Initial candidate.** A trusted writer must validate active sharing and a stable progress transition identity for the exact group. |
| Group task pool: `groups/{groupId}/tasks/{taskId}` | Client transaction services; rules allow bounded member/manager transitions | Shared task claim, assignment, completion, reopen | Mutable; reopen clears completion fields; delete may be allowed | creator, claimant, assignee, completer, `completedAtMs` | **Initial domain candidate with prerequisite.** Add a stable completion-transition ID and trusted actor evidence before recording. Current `completedAtMs` alone is insufficient for repeat completion identity. |
| Planning boards: `planningBoards/{boardId}/cards/{cardId}` | Client services and rules | Group planning and Done/Completed movement | Mutable, archivable/deletable; cards can move out of terminal columns | board/card/group/assignee IDs, generic `updatedAtMs`; no completing actor field | **Deferred.** The terminal transition is factual, but actor and stable completion occurrence identity are absent. |
| Group calendar: `planningCalendarEvents/{eventId}` | Client services, routine materialization, planner-related paths | Scheduled/cancelled group time | Mutable/cancellable; recurrence/materialization exists | group/creator/source IDs and scheduled timestamps | **Explicitly excluded from initial registry.** There is no completed status; creation is not completion. |
| Group routines: `groupRoutineOccurrences/{occurrenceId}` and participant subcollections; trusted transition-side-effect ledger | Client transition under strict rules, then trusted processor | Durable recurring occurrence status and participation | Occurrence can reopen; trusted processor deduplicates side effects by transition event ID | group/routine/occurrence, status revision, actor/completer, transition event ID | **Initial candidate.** Stable occurrence and transition identities support repeat-safe append-only completion facts. Participant arrays are not copied into History. |
| Milestones: `goals/{goalId}/milestones/{milestoneId}` | Client service/source rules | Goal milestone status | Mutable completion fields; group ownership is indirect through parent goal | milestone/goal IDs and `completedAtMs`; no reliable completing actor identity | **Deferred.** Requires trusted exact-group resolution and completion-transition identity. |
| Planner suggestions and execution | Suggestion model permits group-shaped references, but current trusted action execution explicitly accepts personal scope only | Deterministic personal planning action application | Execution ledger is trusted/idempotent | owner/suggestion/execution IDs | **Deferred.** No current trusted group action execution exists. |
| Bulletins, comments, reactions, mentions, presence and read state | Primarily member/moderator clients | Social communication and current awareness | Editable, hideable, deletable, ephemeral, or user-specific | authors, bodies/media, reports, read/presence timestamps | **Explicitly excluded.** Content and behavioral telemetry do not belong in completion history. |
| DMs and group conversations | Participants and notification processors | Private/semi-private messaging | Editable/deletable/reaction/mute/leave/archive behavior | message bodies, replies, participant/read state | **Explicitly excluded.** Membership in a group never authorizes History to reveal message data. |
| Personal History: `users/{uid}/historyEvents/{eventId}` | Trusted Firebase Functions | Private immutable factual personal outcomes | Client writes denied; owner-only reads | owner, source, entity, deterministic event ID | **Conceptual precedent only.** Month bounds, strict mapping, deterministic ordering, and retry-safe writes are reusable patterns. Storage, tenancy, actor, membership, visibility, and redaction assumptions are not reusable. |
| Future Group Completion Ledger: `groups/{groupId}/historyEvents/{eventId}` | Trusted backend create only | Durable member-readable shared outcomes | Append-only; ordinary client mutations denied | authoritative path group, source transition, entity, bounded actor/credit snapshots | **Canonical system.** |

### Current membership and lifecycle findings

- Roles are `owner`, `admin`, `moderator`, `member`, and `viewer`.
- Membership documents use `active` or `removed`. The central rules helper `isGroupMember` requires an authenticated user and an active member document.
- All active roles currently read ordinary shared goals, group tasks, group boards, calendars, routines, and non-hidden activity. Therefore ordinary ledger events can use one `group_members` visibility.
- Invites and join requests are not active membership and grant no ordinary shared-work access.
- Remove/leave flows mark membership removed and update the top-level membership mirror. Blocking also has a separate `blockedUsers` document and removal behavior.
- Owners can currently delete a group document. Firestore does not recursively delete nested subcollections, so a nested ledger may physically remain while becoming unreadable. Permanent deletion/retention is unresolved and must not be claimed as cascading deletion.
- No canonical group archive field exists in `GroupDoc`; “archived group” behavior is deferred until a group lifecycle contract exists.

## 3. Storage decision and tenancy

### Options evaluated

1. **Group-nested canonical ledger:** `groups/{groupId}/historyEvents/{eventId}`. Best tenancy boundary, direct group query, rules reuse, and least cross-group exposure.
2. **Top-level ledger:** rejected because duplicated payload tenancy and global query/index surfaces increase cross-group risk.
3. **Nested ledger plus per-user projections:** rejected for the initial architecture because duplication complicates consistency, departure, deletion, and redaction.

### Decision

Use `groups/{groupId}/historyEvents/{eventId}` only. The path is authoritative. Payload `groupId` is retained for strict mapping and must equal the path parameter. Trusted writers must derive group tenancy from validated source context, never from an untrusted payload alone.

Ordinary Group History queries will target one group subcollection. Collection-group queries are not part of the member product contract.

## 4. Canonical schema and registries

The repository contract is defined in `services/groupHistory.ts`.

```ts
type GroupHistoryEvent = {
  id: string;
  schemaVersion: 1;
  groupId: string;
  eventType:
    | "shared_subtask_completed"
    | "group_task_completed"
    | "group_routine_occurrence_completed";
  category: "goals" | "tasks" | "routines";
  occurredAtMs: number;
  createdAtMs: number;
  entityType: "subtask" | "group_task" | "routine_occurrence";
  entityId: string;
  parentEntityType: "goal" | "routine" | null;
  parentEntityId: string | null;
  sourceEventId: string;
  displayTitle: string | null;
  summary: string | null;
  actorUid: string | null;
  actorDisplayName: string | null;
  creditedMemberUid: string | null;
  creditedMemberDisplayName: string | null;
  visibility: "group_members";
  metadata: GroupHistoryMetadata;
};
```

`entityType` and parent registries also contain `goal` and `routine` because they are bounded parent routing types. There is deliberately no `activity`, `social`, `admin`, `moderation`, `message`, `other`, or `system` category.

Schema version 1 is the only supported version. Writers will emit the latest supported version. Readers reject/skip unsupported or malformed events and later query code must count them. Reads never rewrite old events.

### Strict metadata

Metadata is a discriminated bounded union:

- `shared_subtask_completed`: optional `assignmentUid`
- `group_task_completed`: optional `claimedByUid`
- `group_routine_occurrence_completed`: integer `participantCount`, 0–500

Unknown keys, nested objects, arrays, URLs, emails, message/comment/report text, moderator notes, and arbitrary metadata are rejected. Routing fields remain top-level instead of being duplicated.

### Snapshot limits

- IDs: non-empty, slash-free, at most 500 characters
- title: trim and truncate to 160 characters
- summary: trim and truncate to 240 characters
- actor/credited display name: trim and truncate to 80 characters

Titles are historical snapshots and do not change when a source is renamed or deleted. Safe sources are only the entity title. Descriptions, instructions, board bodies, calendar descriptions, planner evidence, comments, messages, filenames, media URLs, emails, and notes are prohibited.

Summary is normally `null`; later writers may use only a bounded system-generated factual phrase. They must not copy user-entered descriptive fields.

## 5. Event inclusion matrix

| Candidate | Decision | Reason / prerequisite |
|---|---|---|
| `shared_subtask_completed` | Include in initial registry | Completion progress has an immutable progress identity and can be resolved through a shared-goal link. The writer must validate exact group sharing at occurrence time. |
| `group_task_completed` | Include in initial registry, recording blocked by source retrofit | Clear group-owned completion and actor/claimant fields exist. Before 8B.7B.2, add a trusted stable completion-transition ID; timestamp-only identity is not sufficient after reopen. |
| `group_routine_occurrence_completed` | Include in initial registry | Durable occurrence identity, execution transition, and trusted transition side-effect identity already exist. |
| `shared_goal_completed` | Defer | Goal may be shared to multiple groups; current transition lacks exact per-group immutable completion identity and reliable actor attribution. |
| `shared_milestone_completed` | Defer | Group ownership is indirect and completion lacks a stable transition/actor contract. |
| `group_board_card_completed` | Defer | Done movement is reversible; no reliable completing actor or completion occurrence ID exists. |
| `group_calendar_event_completed` | Explicitly exclude for now | Calendar supports scheduled/cancelled, not completed. Creation is not completion. |
| `group_planner_suggestion_applied` | Defer | Current trusted planner action execution rejects group scope. |
| reopen/reversal events | Defer | Append-only completion remains factual. Separate reversal facts need explicit product semantics and their own event types later. |

Ordinary source updates, claim/release, assignments, calendar creation, skips, archives, and deletes do not silently become completion events.

## 6. Completion, identity, and timestamps

### Append-only semantics

A completion event states that completion occurred at a point in time; it does not guarantee the source remains completed forever. Reopen never updates or deletes that event. If reversal events are later approved, they are separate immutable facts with separate source identities.

Repeated task or recurring routine completions must use distinct immutable transition/occurrence identities. An unrelated source update produces no new identity.

### Source and event identity

`sourceEventId` identifies one validated source transition, not merely an entity. Examples:

- shared subtask: immutable progress event ID
- group task: future completion-transition ID (required retrofit)
- routine: occurrence ID plus trusted transition event/revision identity

The document ID is:

```text
group_history_ + stableHash(groupId + eventType + sourceEventId)
```

It is bounded, slash-safe, title-independent, display-name-independent, deterministic across retries, and group-specific. In 8B.7B.2 the writer must use create-if-absent transaction semantics and compare an existing immutable payload. A differing payload at the same ID is an identity collision and must fail closed.

### Time

- `occurredAtMs`: trusted authoritative transition time; used for ordering, month bounds, local-day grouping, and display.
- `createdAtMs`: trusted ledger write time.

Client arbitrary time is not sufficient. A writer may use a validated server-backed source transition timestamp or trusted function event time according to the per-source classifier. Replays preserve `occurredAtMs` but receive no second event because identity is stable.

Deterministic ordering is `occurredAtMs DESC`, then document ID `DESC`. The future serializable cursor is `{occurredAtMs, eventId}`.

## 7. Actor, assignee, and member identity

`actorUid` is the authenticated principal that caused the validated transition. It is not the creator, assignee, claimant, credited member, or Cloud Function service identity. If the source cannot prove the actor, it is `null`; writers do not guess.

`creditedMemberUid` is a separately validated assignee/participant credit when needed. It does not imply that person performed the action. Event-specific metadata may retain `assignmentUid` or `claimedByUid`, but no member arrays are stored.

Display snapshots are optional, bounded to 80 characters, and never sourced from email. No avatar URL or live profile lookup is required. Remaining active members may see the historical snapshot after the actor leaves. A neutral later UI fallback is “Former member” or “Group member.”

Actor and credited UIDs remain internal canonical references after departure, subject to future account-deletion redaction. Departed/removed/blocked users lose read access immediately. Historical presence never grants access. Rejoining restores access because current membership is active, not because the user appears in an event. Blocking does not rewrite history.

## 8. Visibility, membership races, and group lifecycle

Version 1 supports only `group_members`. Active owner/admin/moderator/member/viewer roles may read because all initial payloads are limited to ordinary shared-work data already readable by viewers. Invited, requesting, removed, departed, blocked, unrelated, and signed-out users are denied.

Future rules must require:

```text
signed in
AND group exists
AND groups/{groupId}/members/{uid}.status == "active"
AND no groups/{groupId}/blockedUsers/{uid}
```

The explicit blocked check is defense in depth even though current block flows also remove membership. The rule should reuse existing helpers carefully and stay within Firestore access-call limits.

On removal, leave, block, role change, or group deletion while a query is in flight, future query/UI code must fail closed, invalidate requests, and immediately clear cached rows, summary, filters, cursors, and restoration state for that group. Firestore rules remain authoritative; cached route membership is insufficient.

Viewers are included for version 1. If a later event contains data viewers cannot read at the source, that event cannot enter this visibility class. Introduce a new visibility only after a concrete event and rule design, not preemptively.

There is no current canonical group archive state. Archived behavior is deferred. Group deletion must stop new writes and reads. Physical retention of orphaned nested subcollections and legal deletion policy are unresolved; no automatic cascade is assumed.

## 9. Routing

`entityType/entityId` and bounded optional parent fields are enough to construct later known routes without a source lookup:

- subtask → parent goal
- group task → group task route if one remains supported
- routine occurrence → occurrence plus parent routine

The UI must derive the group from its authorized route context and ensure every destination remains in that group. It must not use raw Firestore paths from event data or invent routes. Deleted destinations fail safely and leave the historical row non-interactive.

## 10. Personal History and other systems

One source transition may independently create Personal and Group History events. They use separate paths, types, deterministic IDs, audiences, classifiers, and retry handling. They may share a source transition ID, but neither event is a projection of the other and failure in one ledger must not corrupt or block the other.

Activity can also be emitted for recent awareness, but activity is not source authority. Notifications are delivery projections. Admin logs contain governance actions. Reports and moderation actions contain restricted safety material. None can be copied to History without validation against the authoritative shared-work source transition.

## 11. Security-rule architecture and future test matrix

No Group History rules are added in 8B.7B.1. In 8B.7B.2 add:

```text
match /groups/{groupId}/historyEvents/{eventId} {
  allow read: if active, unblocked group member;
  allow create, update, delete: if false;
}
```

Admin SDK writers bypass client rules and must enforce tenancy, source authority, actor derivation, bounded schema, deterministic identity, and transaction collision checks.

Required emulator tests:

- active owner/admin/moderator/member/viewer can get and group-query ordinary events
- invited user, pending join requester, removed/departed/blocked member, unrelated authenticated user, and signed-out user are denied
- client create, update, and delete are denied for every role
- access is denied immediately after removal/block and an in-flight subsequent page cannot read
- rejoin restores reads only after active membership
- cross-group path/payload mismatch is rejected by writer/mapping tests
- query is group-subcollection scoped and cannot leak another group

## 12. Index and future query plan

The base group-subcollection month query uses range constraints and order on `occurredAtMs` plus document ID. Firestore’s single-field index and document-ID tie-break should satisfy the base query; 8B.7B.3 must prove this in the emulator and production index plan.

No speculative index is added now. Direct category/event/actor filters would introduce composite-index combinations. Prefer a bounded hybrid scan similar to Personal History, initially with page size 50, maximum requested page size 100, and an explicit monthly scan ceiling measured against group volume. Summary scans must report partial results when the ceiling is reached.

Future factual counters may include total events, shared subtasks completed, group tasks completed, routine occurrences completed, and active local days. Deferred event counters may be added only when their event types exist. No per-member totals, rates, comparisons, “best” member, productivity score, or ranking.

Actor filtering is deferred. If product intent later approves it, it should be factual discovery—not analytics—and must address ordinary-member versus manager access, departed-member labels, and surveillance risk.

## 13. Privacy threat model

| Threat | Mitigation | Remaining limitation / validation |
|---|---|---|
| Cross-group reads or forged group payload | Nested authoritative path, current membership rule, mapper equality check, group-specific ID | Emulator writer/rules tests in 8B.7B.2 |
| Departed or blocked member reads | Active membership plus explicit blocked check; clear cached data on loss | Query/UI race tests in 8B.7B.3–4 |
| Prior-user cached state | Future state keyed by auth UID and group ID; clear on auth/membership change | UI/device privacy acceptance in 8B.7B.4–6 |
| Forged actor or role escalation | Trusted classifier derives actor; client writes denied | Some current sources lack actor evidence and remain blocked/deferred |
| Email or private identity leakage | Exact-key mapper, no email/avatar fields, bounded optional display snapshot | Account-redaction policy unresolved |
| Message, comment, report, or moderation leakage | Entire domains and unsafe keys excluded; no arbitrary metadata | Future registry review on every new event |
| N+1 source/profile reads | Historical title/name snapshots and routing IDs | Deleted-account redaction may later alter snapshots |
| Guessed/cross-group routes | Bounded entity fields, authorized group context, no raw source path | Route feasibility tested with UI phase |
| Replays and duplicates | Stable source transition identity, group-specific deterministic ID, create-if-absent collision check | Group task source identity retrofit required |
| Unbounded event content | Exact keys, strict metadata union, text/ID/count limits | Firestore rules cannot validate trusted Admin SDK writes; writer tests required |
| Collection-group misuse | Ordinary product queries only nested subcollection | Administrative/legal access is unresolved and separate |
| Group deletion ambiguity | Group existence required for reads/writes; no retention guarantee | Physical orphan cleanup/legal policy unresolved |

## 14. Retention, redaction, and open decisions

Unresolved policy questions:

- retention duration and whether physical group deletion must recursively remove the ledger
- legal/safety exceptional access
- account-deletion redaction of actor/credited UIDs and display snapshots
- whether a dedicated trusted redaction overlay or event mutation mechanism is permissible
- whether owners or moderators may ever hide an erroneous History event
- whether group rename affects only current UI context or needs a historical group-name snapshot
- archived-group semantics once group archival exists

Initial engineering decisions:

- ordinary clients, owners, and moderators cannot create, update, hide, or delete ledger events
- source rename, deletion, reopen, or moderation does not automatically mutate an event
- no owner-facing delete controls, retention jobs, redaction tools, or moderation browsing extension are added now
- historical names are treated as personal data requiring a future explicit redaction policy; no legal retention promise is made

## 15. Architecture mismatches and prerequisites found

1. Group activity is unsuitable as a ledger because it is broad, mutable, random-ID, mostly client-written, and email-bearing.
2. Group task completion can be repeated after reopen but has no immutable completion-transition ID; `completedAtMs` alone cannot safely deduplicate.
3. Group task activity labels the completion as `subtask_completed`, showing that activity taxonomy is not canonical work taxonomy.
4. Group board cards have generic `updatedAtMs` but no reliable transition actor or completion occurrence ID.
5. Shared goals can reference multiple `sharedGroupIds`, while some current permission/source helpers use the first element; trusted recording must resolve and validate each exact group explicitly.
6. Milestone completion actor and group tenancy are indirect.
7. Calendar has no completion semantic.
8. Current trusted planner action execution rejects group scope.
9. Group deletion does not imply recursive Firestore subcollection deletion.
10. The central active-member helper does not itself include the separate blocked-document check; the ledger design requires it explicitly.

These findings do not authorize source-schema changes in 8B.7B.1. They are prerequisites or deferrals for later recording work.

## 16. Sequenced roadmap

- **8B.7B.2 — Trusted Deterministic Group History Recording:** implement source prerequisites, classifiers, trusted transactional writers, client-deny/member-read rules, collision handling, and emulator tests.
- **8B.7B.3 — Group Monthly Query & Aggregation:** month bounds, stable cursor, bounded filtering/summary scans, malformed-event isolation, and membership-loss behavior.
- **8B.7B.4 — Group History Timeline UI:** authorized group route, timeline, safe actor/credit display, navigation, cached-state privacy, and access-loss clearing.
- **8B.7B.5 — Group History Filters & Oversight Polish:** category filters and only an explicitly approved factual actor filter; no rankings or member analytics.
- **8B.7B.6 — Performance, Accessibility & Production Acceptance:** stress, assistive technology, device, deployment, and production observation.

No trusted writers, lifecycle triggers, queries, aggregation, UI, navigation, backfill, rules, indexes, deployments, builds, or device work are implemented in 8B.7B.1.
