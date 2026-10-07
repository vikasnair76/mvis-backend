# History feature

The History tab: a read-only, month-by-month timeline of the user's recorded
activity (goals, subtasks, planner actions, calendar blocks, boards,
milestones), with a monthly summary card and category filter.

`app/(tabs)/history.tsx` is a one-line route wrapper. Everything lives here.

```
features/history/
├── HistoryScreen.tsx         composition root — the SectionList and its wiring
├── components/               header, empty state, footer (props in, callbacks out)
├── hooks/                    useHistoryTimeline — the whole data lifecycle
├── utils/                    constants, error normalisation, and the session singleton
├── styles/                   createHistoryStyles(theme) — lifted verbatim
├── types/                    HistoryFilter, HistoryUiError
└── history.legacy.tsx.bak    original 907-line screen, not compiled
```

The row and summary-card presentation (`HistoryEventRow`, `HistorySummaryCard`)
and the month helpers (`shiftHistoryMonth`, `formatHistoryMonthLabel`, …) live
in the shared `components/history/PersonalHistoryTimeline` and are used as-is.

---

## What the screen does

1. **Header** — month navigator (`‹ Month YYYY ›`, next disabled at the current
   month), "Current month" shortcut when browsing the past, the monthly
   summary card, and horizontal category chips.
2. **Timeline** — a `SectionList` grouped by day, newest first, 50 events per
   page with a "Load more" footer, then "End of history for this month."
3. **States** — loading spinner, signed-out prompt, an error card with retry
   (distinguishes `permission_denied` from a generic failure), and the empty
   month message (worded per filter).
4. **Quiet notices** — refresh failed (keeps old data, offers retry), summary
   failed (timeline still shown), and "some items could not be displayed"
   when the query returned malformed docs.

No writes. Every read goes through `services/personalHistoryQueries`.

---

## The hook — `useHistoryTimeline(timeZone)`

Owns all state. The pieces that are easy to break:

**Request-id guard.** `requestIdRef` increments on every user/month/filter
change and on every initial load. Every async result checks
`requestId === requestIdRef.current` *and* `mountedRef.current` before touching
state. That is what stops a slow page for March landing after the user has
already moved to April. Any new async path must do the same check.

**Three reset scopes, deliberately different.**

| Trigger | Page state | Summary | Transient errors | `loading` |
|---|---|---|---|---|
| auth change | reset | reset | reset | untouched |
| `selectMonth` | reset | reset | reset | `true` |
| `selectFilter` | reset | **kept** | reset | `true` |
| `loadMonth("initial")` | reset | reset | untouched | `true` |

The filter case keeps the summary because the summary is month-scoped, not
category-scoped — the card should not flash away when you tap "Goals".
`resetPage` / `resetSummary` / `resetTransientErrors` exist so those
differences are visible at the call site rather than buried in twelve setters.

**Two loaders.** `loadMonth(mode)` fires the page and summary queries in
parallel with `Promise.allSettled`, so one failing doesn't hide the other.
`loadMore()` is cursor-based and refuses to run concurrently
(`loadingMoreRef`).

**Telemetry.** The `console.info` / `console.warn` calls with names like
`personal_history_ui_month_loaded` are intentional analytics-style events, not
debug logging. Keep the names stable.

---

## Session state that outlives the screen

`utils/historySession.ts` exports a module-level `historySessionState`
(`ownerUid`, `month`, `timeZone`, `filter`, `scrollOffset`). The tab unmounts
when the user switches away; this object is what brings them back to the same
month, filter, and scroll position. It is:

- written on month change, filter change, scroll, and before navigating into
  an event;
- restored on auth only when the uid **and** time zone match and the saved
  month is not in the future;
- reset to defaults when the signed-in user changes.

Scroll restore is done through `contentOffset` on the `SectionList`, and the
list is keyed by `year-month-filter-timeZone` so it remounts clean on any
view change.

---

## Adding things

- **A new filter chip**: add to `HISTORY_FILTERS` in `utils/history.utils.ts`.
  The `value` must be a `PersonalHistoryCategory`; add a matching `emptyLabel`.
- **A new notice** (e.g. "showing cached data"): a boolean in the hook, a block
  in `HistoryHeader`.
- **A new async load**: copy the `requestId` / `mountedRef` guard from
  `loadMore` exactly.

---

## Verification status

Compile-verified: `tsc --noEmit`, `eslint features/history`, `expo export`.
Faithfulness checked programmatically against the monolith: all 13 telemetry
event names, 9 accessibility labels, 33 user-facing strings, 11 service calls,
the 5 `SectionList` performance props, and the 5 session-state fields are
present. Not exercised on a device. Worth checking by hand:

- Switch tabs and come back — same month, filter, and scroll position.
- Tap a category chip — summary card stays; list reloads.
- Change month while a slow page is in flight — the stale page must not land.
