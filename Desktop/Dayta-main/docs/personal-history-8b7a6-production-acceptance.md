# 8B.7A.6 Personal History production acceptance

Status: **Repository accepted, physical QA pending.**

This phase has not deployed Firebase resources, run an EAS build, or changed production data. It does not authorize starting 8B.7B.

## Automated evidence

Run from the repository root:

```text
npm run test:personal-history:acceptance
npx tsc --noEmit
npx expo config --type public
firebase deploy --only firestore:rules --dry-run
firebase deploy --only firestore:indexes --dry-run
```

The acceptance aggregate covers the canonical model and mapper, deterministic recording, owner-only rules, month queries and bounded sparse scans, UI contracts, independent summary/timeline failures, pagination deduplication, and measured 0–2,000 event aggregation fixtures. Timings printed by the performance suite are observations from the current machine, not device claims.

The history month query is scoped to `/users/{uid}/historyEvents`, ordered by `occurredAtMs DESC` and document ID `DESC`, and uses a serializable cursor. Emulator query coverage is the index proof available before deployment. No new composite history index is currently declared; a production smoke test remains required because production index state is external to this repository.

Firestore rules permit only the authenticated owner to read their history and deny all client creates, updates, and deletes. Server lifecycle triggers remain responsible for writes. Existing data is intentionally sparse: no backfill is part of this phase.

## Physical-device matrix

All rows below are **Pending** until recorded on real hardware. Capture app version/build, OS/device, account fixture, result, and a screenshot or screen recording for each failure.

| Area | Android / TalkBack | iOS / VoiceOver | Expected result |
|---|---|---|---|
| Sign-in and account switch | Pending | Pending | Signed-out state shows no prior rows; switching A → B never flashes or restores A's month, filter, scroll, summary, or events. |
| Current and older months | Pending | Pending | Previous/current navigation is announced; future month is disabled; older sparse months show factual empty/partial content. |
| Filters | Pending | Pending | Tabs announce label and selected state; changing filters resets pagination without changing month-wide totals. |
| 0, 25, 50, 100+ events | Pending | Pending | Initial render remains responsive, rows are stable, and 50+ events paginate without duplicates or missing equal-timestamp items. |
| Pull to refresh and races | Pending | Pending | Rapid month/filter/refresh actions show only the newest request; refresh retains existing content when either timeline or summary fails. |
| Load more | Pending | Pending | Repeated taps start one request; failure preserves loaded rows and retry resumes from the same cursor. |
| Summary failure | Pending | Pending | Timeline remains usable and a quiet monthly-totals notice appears. |
| Timeline failure | Pending | Pending | A successful summary can remain visible while timeline retry is offered. |
| Malformed event | Pending | Pending | Valid events remain; malformed items are skipped with a neutral notice and no raw payload. |
| Navigation | Pending | Pending | Supported goal/subtask/board/milestone/planner/calendar rows open their canonical destination; unsupported rows are non-interactive. |
| Dynamic Type / font scaling | Pending | Pending | Titles and summaries wrap without clipping; touch targets remain usable at the largest accessibility size. |
| Screen reader order | Pending | Pending | History title, month controls, summary, filters, day headings, rows, and pagination are read in visual order; no focus is forced after updates. |
| Light/dark themes | Pending | Pending | Text, borders, chips, notices, loading states, and disabled controls remain legible in both themes. |
| Small phone / tablet / rotation | Pending | Pending | Content respects the 760 px maximum width, safe areas, wrapping, and orientation changes without horizontal clipping. |
| Offline / reconnect | Pending | Pending | Cached content behavior is observed, failures are recoverable, reconnect refreshes cleanly, and no success is claimed for writes that were not recorded server-side. |

### Device procedure

1. Seed separate test accounts A and B with controlled history at 0, 25, 50, 100, and more than 100 events, including equal timestamps, sparse categories, multiple days, and one malformed server fixture.
2. Begin on A, choose an older month/filter, scroll deeply, then sign out and sign in as B. Record the screen continuously to detect even a single-frame leak.
3. Use network conditioning to fail the page request and summary request independently during initial load and refresh. Repeat while changing months rapidly.
4. Trigger repeated load-more taps and refresh gestures under high latency. Compare displayed document IDs with the fixture manifest.
5. Complete the accessibility, theme, form-factor, rotation, offline, and reconnect rows above on both platforms.

## Production enablement checklist

Keep every item pending until an explicitly authorized release window:

- [ ] Review the Firebase project alias and authenticated CLI target.
- [ ] Re-run rules, query, recording, UI, performance, TypeScript, Expo config, and relevant goal/calendar/board/milestone/planner regression suites at the release commit.
- [ ] Dry-run Firestore rules and indexes; inspect the plan. A dry run is validation, not deployment.
- [ ] Deploy required Firestore rules and any explicitly validated indexes.
- [ ] Deploy the personal-history lifecycle functions and confirm trigger regions, runtime, service account, and environment configuration.
- [ ] Build signed Android and iOS artifacts through the approved release workflow.
- [ ] Smoke test owner reads, cross-owner denial, client-write denial, goal/subtask/planner/calendar/board/milestone recording, idempotent retry behavior, equal-timestamp pagination, partial summary messaging, and account switching.
- [ ] Observe function error rate, permission denials, duplicate/conflict logs, query latency, and index errors without logging UIDs, titles, entity IDs, or payloads.
- [ ] Confirm older months remain intentionally sparse and that no production backfill ran.

## Rollback

If acceptance fails, stop rollout and preserve evidence. Roll back the mobile release through the store/channel procedure, then roll back functions to the prior known-good revision if recording triggers are implicated. Rules may be restored to the prior reviewed ruleset, but do not loosen owner isolation or enable client writes as a workaround. Do not delete history documents or run a compensating backfill without a separately reviewed migration plan. Re-test account switching and owner isolation before resuming.
