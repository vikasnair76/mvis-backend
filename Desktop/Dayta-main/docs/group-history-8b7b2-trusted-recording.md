# 8B.7B.2 — Trusted Deterministic Group History Recording

## Scope

This phase adds trusted, append-only recording at
`groups/{groupId}/historyEvents/{eventId}` for the version-1
`GroupHistoryEvent` registry. It does not add queries, aggregation, UI,
backfill, deployment, notifications, or device acceptance.

The canonical schema in `services/groupHistory.ts` remains unchanged.

## Approved registry and activation

| Event type | Recording status | Authoritative source |
| --- | --- | --- |
| `shared_subtask_completed` | Active | Created subtask `progressEvents` completion transition |
| `group_routine_occurrence_completed` | Active | Classified routine occurrence completion transition |
| `group_task_completed` | Deferred | No durable transition identity in the current task lifecycle |

No deferred or excluded event type was added.

## Lifecycle findings

### Shared subtasks

Subtask completion transactions create distinct progress-event documents.
Binary undo deletes the mutable completion projection; count-mode increments
create separate progress events. The first increment that crosses the target
is the factual completion transition. A goal may reference zero, one, or
multiple groups, so recording fails closed unless exactly one active
`groups/{groupId}/sharedGoals/{goalId}` link proves tenancy.

The progress event's `authorUid` is the actor evidence. It is never inferred
from the goal owner, subtask assignee, or creator. The subtask assignee, when
valid, is stored separately as the credited member. Personal History may
observe the same source, but its success or failure is not coupled to Group
History recording.

### Routine occurrences

Routine occurrence transitions already have a deterministic transition ID
derived from occurrence identity, transition type, revision, actor, and
before/after status. The occurrence and routine both carry group tenancy.
Completion time and execution revision are stored on the occurrence.
Reopening is a separate transition and does not remove the completion ledger
entry.

The transition actor is authoritative. Routine completion is currently a
group rollup, so no individual credited member is inferred; participant count
is stored as bounded factual metadata.

### Group tasks

The current group-task document is mutable and has no immutable completion
transition ID. Deriving identity from task ID and completion time would be
unsafe across reopen/recomplete races. The event remains registered, and its
canonical builder is tested, but no production trigger is activated. A future
task lifecycle retrofit must create a durable transition record before this
writer can be enabled.

## Trusted recording flow

Functions build a bounded canonical snapshot and call one shared transactional
writer:

1. Validate source path identifiers and transition shape.
2. Prove the source's group tenancy from authoritative parent documents.
3. Preserve the provable actor and distinct credited-member semantics.
4. Build a version-1 event containing all future display fields.
5. Derive the event ID from `groupId`, `eventType`, and `sourceEventId`.
6. In a Firestore transaction, create the event only when absent.
7. Treat an exact retry as `already_exists`.
8. Return `conflict` when the deterministic ID exists with different canonical
   content; never merge or overwrite it.

The deterministic IDs use the same stable hash contract as the client-side
architecture helper. Source IDs are:

- `subtask_progress:{goalId}:{subtaskId}:{progressEventId}`
- `routine_transition:{existing deterministic routine transition ID}`

`occurredAtMs` is copied from the authoritative completion occurrence.
`createdAtMs` is the trusted ledger-write time. These timestamps are
intentionally distinct.

## Snapshot and privacy policy

Events retain bounded title snapshots so later reads need no source-document
lookup. Titles are limited to 160 characters, names to 80, and summaries to
240. The two active writers use a null summary because no additional factual
sentence is required.

Events do not copy emails, avatars, descriptions, comments, messages, reports,
planner evidence, or mutable source content beyond the approved bounded
display fields. Logs contain only event type, source kind, normalized result or
reason, schema version, and retryability—never group IDs, entity IDs, user IDs,
titles, or other user content.

## Retry and failure behavior

Both Firestore triggers opt into retry. Transient source-read or event-write
failures throw normalized retryable errors. Deterministic retries cannot
duplicate events.

Malformed, irrelevant, ambiguous, reverted, non-group, or unsupported source
documents produce terminal skip results. Existing-event conflicts are visible
as a normalized outcome and never mutate the existing record.

Group History runs after the established routine activity/notification
processor and is not a dependency of those side effects. Shared-subtask
Personal History and Group History use independent triggers. A failure in one
ledger therefore does not roll back or suppress the other ledger or the
source transition.

## Firestore access model

Ordinary clients cannot create, update, or delete Group History events,
including owners and admins. Reads require an active group membership accepted
by `isGroupMember` and an explicit absence of the group's block record. Owner,
admin, moderator, member, and viewer roles can read. Removed, departed,
blocked, invited, pending/requested, unrelated, cross-group, and signed-out
users cannot read. Losing membership immediately removes query access.

Trusted Admin SDK code bypasses these client rules and is the only writer.

## Emulator fixtures and acceptance coverage

`scripts/group-history-recording-emulator-qa.mjs` covers:

- canonical builder validation and bounded/privacy-safe payloads
- deterministic ID parity and uniqueness
- valid shared-subtask and routine completion recording
- exact retry idempotency
- deterministic-ID conflict protection without overwrite
- parent and tenancy validation
- ambiguous multi-group and personal-goal rejection
- binary and count-mode completion behavior
- unsupported/reverted/reopen handling
- actor and credited-member separation
- source deletion or rename without historical mutation
- safe diagnostics
- deferred group-task trigger absence

`scripts/group-history-rules-qa.mjs` covers every active role, viewer queries,
membership loss, blocked and non-member states, cross-group isolation,
signed-out access, and create/update/delete denial for ordinary clients.

Commands:

```text
npm run test:group-history-architecture
npm run test:group-history-recording
npm run test:group-history-rules
```

## Known limitations and open risks

- Group tasks remain deferred until their source contract exposes an immutable
  trusted transition identity.
- Existing production completions are not backfilled, so the ledger begins
  sparsely when these Functions are eventually deployed.
- Actor authority is preserved from the source transition. A user leaving the
  group before delayed trigger delivery does not erase the historical actor.
- Multi-group shared goals fail closed rather than selecting a group.
- Count-mode records only the transition that first reaches the target, not
  partial increments.
- Completion reversal events are outside the version-1 registry. Original
  completion facts remain append-only.
- Production deployment, scheduler/Functions observation, and device
  acceptance remain pending.

## Deployment requirements

No deployment was performed. A later release must deploy the Functions and
Firestore rules together, observe retry/error rates with privacy-safe logs,
and run device acceptance. No production backfill is included.

## Next phase

After deployment planning and acceptance of this recording layer, the
repository can proceed to **8B.7B.3 — Group Monthly Query & Aggregation
Layer**. That work is intentionally not included here.
