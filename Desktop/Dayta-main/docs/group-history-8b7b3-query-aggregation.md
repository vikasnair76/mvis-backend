# 8B.7B.3 — Group Monthly Query & Aggregation Layer

## Scope and non-goals

This phase adds framework-independent monthly Group History queries and pure,
factual aggregation. It adds no UI, hooks, realtime listeners, source joins,
analytics, rankings, scoring, backfill, migration, deployment, or device work.

## Repository findings and reuse

The canonical version-1 mapper and registry remain in
`services/groupHistory.ts`. Personal History established useful patterns for
Luxon month bounds, serializable cursors, bounded scans, strict mapping, and
pure aggregation. Group History reuses those concepts without importing
owner paths, personal categories, personal permissions, or personal event
types.

The Group History reader distinguishes malformed and unsupported-schema
documents, reports explicit partial reasons, and uses a last-scanned source
cursor when a sparse bounded scan cannot fill a page.

## Canonical query contract

The only query source is:

```text
groups/{groupId}/historyEvents
```

The group ID is trimmed and must be non-empty, at most 500 characters,
slash-free, and not `.` or `..`. Validation happens before path construction.
Firestore rules remain the authorization authority.

Queries use:

```text
occurredAtMs >= startMs
occurredAtMs < endExclusiveMs
occurredAtMs DESC
document ID DESC
```

No collection-group query, activity feed, inbox, admin log, Personal History
ledger, or source collection is consulted.

## Month and timezone semantics

Inputs are a year from 2000 through 2100, month 1 through 12, and a valid IANA
timezone. Bounds are the local start of the requested month and local start
of the following month. The end is exclusive. Luxon calendar arithmetic
preserves DST, leap-year, negative-offset, and non-hour-offset semantics
without using the device timezone or substituting a UTC month.

## Cursor and page-size contract

The serializable cursor is:

```ts
type GroupHistoryCursor = {
  occurredAtMs: number;
  eventId: string;
};
```

Its integer timestamp must lie inside the requested month and its event ID
must pass document-ID validation. `startAfter(timestamp, eventId)` resumes
after the exact descending source boundary.

Page size defaults to 50 and must be an integer from 1 through 100. Invalid
values fail validation rather than being silently clamped.

## Has-more and bounded refill

The reader scans ordered source chunks of at most 100 documents. It continues
while it needs valid matching rows and source documents remain. A timeline
request scans at most 1,000 source documents.

When an extra matching event is found, the public cursor is the last returned
event, so the next page cannot skip intervening source rows. When the scan cap
is reached before a page is filled, the cursor is the last scanned source
document and the result is partial. This prevents loops across malformed or
category-sparse ranges.

Partial page reasons are:

- `malformed_scan_limit`
- `category_scan_limit`
- `query_conflict`

Non-descending source results, invalid source boundaries, and repeated
boundaries are treated as conflicts.

## Category filtering and indexes

`null` means all categories; otherwise `goals`, `tasks`, or `routines` is
validated. Filtering is performed by the service while it scans the canonical
ordered monthly query. Future UI must request filtered pages from this
service, not locally filter an already-loaded page.

This bounded hybrid strategy avoids a speculative category/range/order
composite index. Emulator execution proves the base nested range query and
document-ID tie-break work with existing indexes. No Group History index was
added.

## Strict mapping and tenancy

Every version-1 document is passed to `mapGroupHistoryEventDoc` with the
requested path group ID and document ID. The mapper enforces exact fields,
path/payload tenancy, event/category/entity registry consistency, metadata,
visibility, timestamps, IDs, and bounded snapshots.

Malformed version-1 events and unsupported schema versions are separately
counted and excluded. Readers never repair stored data or expose raw
snapshots. Canonical IDs are defensively deduplicated; contradictory duplicate
identity or ordering conditions are surfaced as conflicts.

Future versions must add explicit mapper support before they can be included.

## Normalized failures and membership loss

The public error codes are:

```text
invalid_group
invalid_year
invalid_month
invalid_timezone
invalid_page_size
invalid_cursor
invalid_category
unauthenticated
permission_denied
group_not_found
query_failed
query_conflict
```

Raw Firebase errors and document content are never returned. Firestore rule
denial during initial load or pagination fails closed. Future UI must clear
already displayed Group History when membership or authentication access is
lost and must not substitute cached activity data.

## Full-month summary

Summary loading is independent from timeline loading and ignores the timeline
category. It scans the entire canonical month in 100-document batches, up to
5,000 source documents, and produces:

- total canonical events
- shared-subtask completion count
- group-task completion count
- routine-occurrence completion count
- timezone-aware active local-day count

The registered task counter remains compatible with canonical fixtures but
will normally remain zero until the trusted task writer exists.

Aggregation is pure, deterministic, linear, and deduplicates by canonical
event ID. It includes no rates, rankings, member comparisons, scores,
streaks, or inferred productivity.

A fully exhausted month returns `complete: true`. Reaching the scan limit
returns `complete: false` with `scan_limit_reached`. Failure before any batch
throws a normalized error. Failure after at least one completed batch returns
a factual partial summary with `query_failed_after_partial_scan`; it never
claims completeness.

Timeline and summary calls are separate, so either can succeed while the
other fails.

## Rules and privacy

Existing rules allow active owner, admin, moderator, member, and viewer reads,
while denying invited, pending, removed, departed, blocked, unrelated, and
signed-out access. All client writes remain denied. Membership loss removes
pagination and summary access.

Diagnostics contain only query mode, normalized result/reason, schema version,
bounded counts, page size, and completeness. They omit group, event, source,
entity, and user IDs; paths; timestamps; titles; summaries; names; metadata;
emails; and raw errors.

## QA and performance

The pure suite covers validation, month bounds, DST, leap years, non-hour
offsets, ordering, equal timestamps, cursors, malformed/unsupported rows,
category scans, conflicts, failures, complete and partial summaries, active
days, and generated datasets from 0 through 5,000 events.

The emulator suite executes the real nested Firestore query, tied timestamp
pagination, month boundaries, strict skip accounting, full-month aggregation,
and access loss. Existing rules QA covers the full role/status matrix.

These measurements are local Node correctness/stress checks, not production
device benchmark claims. Duplicate tracking uses sets/maps and aggregation is
linear rather than quadratic.

## Known limitations and deployment implications

- The 1,000-document page refill cap can return a partial sparse category page.
- The 5,000-document summary cap can return a partial monthly summary.
- Group-task counts remain zero until its trusted writer is activated.
- No historical events are inferred or backfilled.
- Existing activity and current completed source state are not query sources.
- Sparse or empty months are expected before writer deployment and usage.
- No Firestore rules, Functions, indexes, or application code was deployed.

## Recommended next phase

After this layer is accepted, proceed to **8B.7B.4 — Group History Monthly
Timeline UI**. That phase is not implemented here.
