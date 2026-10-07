# 8B.7B.4 — Group History Monthly Timeline UI

## Scope and non-goals

This phase adds the first production-shaped, group-scoped monthly History
screen. It includes a factual whole-month summary, paginated day-grouped
timeline, month navigation, refresh, Load More, partial-state presentation,
and access-loss clearing.

It adds no category or member filters, search, analytics, rankings, scoring,
charts, backfill, realtime History listener, source enrichment, deployment,
or physical-device acceptance.

## Repository findings and reuse

The route follows existing nested group-screen conventions and uses
`subscribeGroupMembers` plus the group document for presentation context.
Firestore rules remain authoritative.

Personal History provided useful patterns for a single `SectionList`, separate
summary/timeline domains, month controls, refresh, request identities, and
theme/accessibility treatment. Group History does not reuse personal paths,
filters, session restoration, event labels, or navigation assumptions.

## Route and dashboard entry

The authorized route is:

```text
app/group/[id]/history.tsx
```

The Group Dashboard contains one compact History card with a “View History”
action. No global tab or dashboard preview/count was added.

The route validates the group ID before constructing query inputs. It observes
authentication, the group document, and active nested membership. Viewer is an
eligible active role. Any missing, removed, blocked, denied, signed-out, or
deleted-group state clears sensitive timeline and summary data and shows a
calm unavailable state.

## Initial timezone and month

The screen takes the validated device IANA timezone for one stable screen
session and falls back to UTC only when the device zone is invalid. The
initial selection is the current calendar month in that timezone.

Previous and next month navigation use calendar-month arithmetic, including
January/December rollover and leap years. Future months are allowed and
render as factual empty months. Changing month preserves timezone, invalidates
old requests, clears old pagination and events, and requests scroll-to-top.

## Request identity and state domains

A monotonically increasing request version protects group, auth, month,
refresh, and access transitions. Async results update state only when their
version remains current. Load More also has an immediate ref guard against
double taps.

State is separated into:

- group/auth/membership presentation context
- timeline events, cursor, `hasMore`, partial reason, and loading/error modes
- summary value, completeness, loading, and error
- access-loss state

The initial page and full-month summary use `Promise.allSettled`. Either can
succeed independently. If either reports access loss, both data domains are
cleared before any concurrently successful result can be displayed.

## Loading, refresh, and pagination

Initial summary and timeline loading use independent compact states.

Pull-to-refresh preserves month and timezone, invalidates Load More, replaces
the first timeline page, and independently reloads the summary. A retryable
summary-only failure preserves a previously successful summary and displays a
refresh notice. Access failure never preserves prior data.

Load More is explicit rather than automatic. It is hidden when complete,
disabled during refresh/loading, uses the canonical cursor, and appends through
`mergeGroupHistoryEvents`. Stale page responses cannot append after route or
month changes.

Partial pages show calm copy for safe scan limits or query conflict. Partial
summary results display factual returned counters under “Partial month
summary” and never claim a complete monthly total.

## Summary

The summary always covers the entire canonical month and is independent of the
paginated timeline. It displays:

- completions
- shared subtasks
- routine occurrences
- active local days

The registered group-task field remains in the service contract, but a zero
value is omitted until the trusted writer exists. A positive canonical value
would be displayed. No rate, chart, ranking, comparison, score, or member
total is shown.

## Day grouping and rows

`buildGroupHistoryDaySections` groups `occurredAtMs` by local calendar day in
the selected timezone. Days and rows remain deterministically descending and
canonical events are not mutated.

Each reusable row displays:

- factual event-type label and icon
- stored bounded title snapshot or safe event-specific fallback
- stored actor/credited-member names when present
- canonical optional summary
- local occurrence time from `occurredAtMs`

`createdAtMs` is not displayed. No UID, email, avatar, current role, current
profile, or source document is fetched.

Attribution rules are:

- same actor and credited name: `Completed by Name`
- different names: `Completed by Actor · Credit: Member`
- actor only: `Completed by Actor`
- credit only: `Credit: Member`

Departed members remain understandable through immutable display-name
snapshots. Deleted or renamed sources continue to render stored titles;
missing titles use factual fallbacks.

## Navigation decisions

The dashboard-to-History route is implemented. Rows are deliberately
non-pressable in this foundation phase because a uniformly safe canonical
target is not proven across deleted sources and differing shared-subtask and
routine route contracts. Source navigation and deep-link highlighting remain
8B.7B.5 polish.

## Empty and error states

Empty months explain that recorded completed shared work will appear after
deployment. Invalid routes, signed-out/access-lost states, deleted groups,
summary-only failures, timeline-only failures, refresh failures, and partial
loads have separate bounded copy. Raw Firebase errors and internal reason
codes are never rendered.

The UI never falls back to group activity, current task state, inbox items,
admin logs, moderation data, or Personal History.

## Theme, responsive behavior, and accessibility

All colors come from existing Dayta theme tokens, covering daytaGold,
indigoFocus, peachGrove, graphiteDark, paperWhite, and roseQuartz without a
History-specific palette.

The single `SectionList` owns scrolling. Content uses a readable 920-point
maximum width, flexible summary tiles, wrapping text, minimum 48-point
controls, and no fixed row heights.

Repository-level accessibility includes:

- header semantics for screen, month, and day titles
- labeled/hinted previous, next, back, retry-return, and Load More controls
- busy/disabled Load More state
- combined factual row labels
- combined summary semantics and partial notice
- decorative icons hidden from accessibility
- no button semantics on non-navigable rows

Physical VoiceOver and TalkBack acceptance remains pending.

## Privacy-safe diagnostics

No analytics SDK was added. The screen does not log group IDs, group names,
event/source/entity IDs, user IDs, names, titles, summaries, metadata, paths,
or raw errors.

## QA and preparation performance

`test:group-history-ui` verifies route and dashboard integration, canonical
service use, month rollover, timezone-explicit grouping, deterministic row
order, title fallbacks, attribution combinations, page deduplication,
accessibility markers, no source joins, and absence of filters/scoring.

Pure preparation is exercised for 0, 1, 25, 50, 100, 250, 500, 1,000, and
2,000 canonical events. Grouping and merging use `Map`/`Set`-based helpers.
These are Node correctness/stress checks, not React Native device render
benchmarks.

Existing Group History rules/query suites validate owner, admin, moderator,
member, and viewer access; denied roles and signed-out users; and query denial
after membership removal. No rules, indexes, or Functions changes were
required.

## Known limitations and deployment implications

- No category filter UI or member filtering exists.
- No source-row navigation exists yet.
- Group-task History remains absent until its trusted writer exists.
- Timeline and summary scan caps can produce honest partial states.
- Older activity is not backfilled or reconstructed.
- The screen may be empty until writers/rules are deployed and new canonical
  transitions occur.
- Deployment later requires the existing History writers, existing rules, and
  a mobile app build containing this route, followed by privacy-safe
  observation and physical access-loss testing.

No deployment, EAS build, backfill, or physical-device acceptance occurred.

## Recommended next phase

Proceed to **8B.7B.5 — Group History Filters, Navigation & Timeline Polish**.
That phase is not implemented here.
