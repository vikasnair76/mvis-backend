# 8B.7B.5 — Group History Filters, Navigation & Timeline Polish

## 1. Scope

This phase polishes the authorized monthly Group History timeline with
service-backed category filters, presentation-state restoration, proven source
navigation, clearer states, pagination retry, responsive styling, and
accessibility semantics.

## 2. Non-goals

There are no new writers, rules, indexes, Functions, source joins, member
filters, analytics, rankings, charts, backfill, deployment, or physical-device
acceptance.

## 3. Repository inspection

The Group History model, strict mapper, hybrid category scan, cursor,
aggregation, existing UI, Personal History patterns, Goal Detail, routine
occurrence, group-task detail, and group membership services were inspected.

## 4. Category filter contract

`GroupHistoryFilter` is `"all" | "goals" | "tasks" | "routines"`.

## 5. Service-backed filtering

All maps to `null`; the other filters map to their canonical category.
`getGroupHistoryMonthPage` receives the category. Loaded rows are never locally
filtered.

## 6. Filter UI

All, Goals, Tasks, and Routines appear in a horizontally scrollable chip row.
The selected chip has a border, checkmark, and selected accessibility state.

## 7. Filter reset behavior

A change invalidates prior requests, clears rows, cursor, pagination and partial
state, scrolls to the top, and requests the first category page.

## 8. Summary independence

Filters affect the timeline only. The summary remains the entire canonical
month and is not reloaded on a filter-only transition.

## 9. Category empty states

Each category has factual empty copy. Tasks remains visible even though its
trusted writer is deferred.

## 10. Restoration scope

An in-memory module map restores year, month, and category for an in-session
remount.

## 11. Restoration privacy

No events, summaries, names, titles, cursors, paths, errors, or scroll offsets
are restored or persisted.

## 12. Access-safe restoration

The key is `group-history:{uid}:{groupId}`. State is read only after current
authentication and active membership are proven. Access loss deletes it.

## 13. Shared-subtask navigation assessment

Canonical subtask events contain the subtask entity ID and goal parent ID.
Goal Detail supports `highlightSubtaskId`, observes authorized shared-group
membership, and tolerates a missing highlighted subtask.

## 14. Routine navigation assessment

The existing occurrence route accepts group ID plus occurrence ID, validates
occurrence tenancy, and requires active group membership. It is a proven target.

## 15. Group-task navigation assessment

A task detail route exists, but the History writer remains deferred and its
historical routing behavior is not exercised. These rows remain informational.

## 16. Navigation-target helper

`getGroupHistoryNavigationTarget` exhaustively maps only proven event types.

## 17. Navigable row semantics

Proven targets use `Pressable`, button semantics, a navigation hint, pressed
state, and a decorative chevron.

## 18. Non-navigable row semantics

Other rows are readable static views with no button role, hint, or chevron.

## 19. Deleted-source behavior

The immutable History snapshot remains. Target routes provide their existing
missing/unavailable state; the ledger is not changed.

## 20. Navigation failure behavior

No raw route or Firebase error is displayed by History. An unavailable target
does not remove or mutate its historical row.

## 21. Navigation return behavior

Mounted state is preserved naturally. If remounted, only the access-safe
month/category presentation state is restored and all data is freshly queried.

## 22. Month transition polish

Month controls guard repeated taps, clear old rows and summary, invalidate stale
requests, reset pagination, preserve timezone/filter, and allow future months.

## 23. Filter transition polish

Filter transitions clear old-category rows immediately and preserve month,
timezone, authorization, and month-wide summary.

## 24. Refresh polish

Refresh preserves month, timezone, and filter; invalidates pagination; replaces
the first filtered page; and independently refreshes the full-month summary.
Ordinary failures retain previously authorized content with a visible notice.

## 25. Pagination polish

Load More preserves category and cursor, ignores repeated taps, deduplicates
rows, retains content on failure, and offers an explicit Retry action.

## 26. Partial-state copy

Internal scan reason codes map to calm month/category-aware user copy.

## 27. Error-state hierarchy

Invalid route, authorization, initial timeline, refresh, pagination, summary,
and partial states are distinct. Access loss is destructive.

## 28. Summary-card polish

The factual wrapping grid and coherent reading order remain. Partial totals now
state that they reflect entries that could be read safely.

## 29. Timeline-row polish

Rows have flexible text, stable snapshot titles, factual labels, safe optional
summaries, local time, pressed state only when navigable, and theme contrast.

## 30. Attribution presentation

Actor and credited-member snapshots appear on separate lines when different.
Matching names are deduplicated.

## 31. Departed-member handling

Stored snapshots remain readable without live member lookup. Missing names use
the neutral “Completion recorded” fallback.

## 32. Day-header behavior

Full local dates remain deterministic and use the query timezone.

## 33. Scroll-to-top

Month/filter changes use a guarded scroll responder call that is safe for an
empty `SectionList`.

## 34. Scroll restoration decision

True scroll restoration is deferred because reliable `SectionList` layout
restoration is not repository-proven.

## 35. Dashboard entry polish

The compact card now mentions month and category browsing and has a navigation
hint. It performs no History query.

## 36. Theme validation

All new colors use existing theme tokens, including chip selection, borders,
pressed state, notices, cards, and controls.

## 37. Responsive validation

The screen retains a centered 920-point maximum width, scrolling filters,
wrapping summary tiles, flexible rows, and no fixed text-row heights.

## 38. Accessibility

Filters expose labels and selection, month controls expose disabled state,
navigable rows match button behavior, static rows do not, pagination exposes
busy state, and error text contains no technical codes. Physical
VoiceOver/TalkBack acceptance remains pending.

## 39. Privacy-safe diagnostics

No analytics infrastructure was added. Existing safe service diagnostics
remain unchanged; the UI logs no IDs, names, titles, paths, or raw errors.

## 40. QA coverage

Focused QA covers mappings, empty/partial copy, restoration isolation, target
validation, static integration, accessibility semantics, pagination guards,
and deterministic data sets through 5,000 events.

## 41. Performance observations

Section preparation and accessibility/target preparation are deterministic.
Page merging uses a map rather than an O(n²) search. No device rendering
benchmark is claimed.

## 42. Known limitations

Group-task recording and navigation remain deferred. Source navigation relies
on the destination’s existing unavailable state. Scroll offset is not restored.

## 43. Deferred items

Member filters, search, analytics, rankings, charts, persistent event caching,
new writers, deeper navigation recovery, and device accessibility acceptance
remain outside this phase.

## 44. Deployment implications

No rules, indexes, Functions, storage contracts, or deployments changed.
Existing sparse History data remains authoritative.

## 45. Recommended next phase

Proceed to **8B.7B.6 — Group History Performance, Accessibility & Production
Acceptance** only after this repository work is accepted.

Filters affect only the timeline; summary remains full-month. No member filter,
analytics, ranking, source join, or backfill exists. Group-task recording
remains deferred. No deployment or physical-device acceptance occurred.
