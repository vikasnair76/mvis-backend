# Home feature

The Home tab: a "what should I do right now" card driven by
`services/nowDecision`, today's counts, an overdue/unscheduled nudge, and
three short lists (upcoming, needs a time, done today).

`app/(tabs)/index.tsx` is a one-line route wrapper. Everything lives here.

```
features/home/
├── HomeScreen.tsx          composition root — loading / signed-out gates, then the list
├── components/             one card or section per file; props in, callbacks out
├── hooks/                  auth, tasks + writes, pure derivation, entrance animation
├── utils/                  pure: relevance rule, greeting, quick-plan dates, decision copy
├── styles/                 createHomeStyles(theme) — lifted verbatim (62 keys)
├── types/                  GoalLite, SubtaskLite, QuickPlanOption, TodayStats, RecoveryHint
└── home.legacy.tsx.bak     original 1,429-line screen, not compiled
```

---

## What the screen does

Gated first: while auth is restoring, or while the goals snapshot hasn't
landed yet, it shows a full-screen "Getting your day ready…" card; signed out
shows "Welcome to Dayta". Once ready the content fades/slides in (220 ms).

1. **Logo + greeting** — "Good morning / afternoon / evening".
2. **Now card** — one of `overdue` / `now` / `next` / `needs_time` / `all_clear`
   from `getNowDecision`. Actions vary by type: Complete (overdue/now),
   View task / Open planner (next/needs_time), Quick plan pills (needs_time),
   Open goal (all), Review goals (all_clear).
3. **Today stats** — `N upcoming • N need time • N done`.
4. **Recovery hint** — "N overdue" or "N need a time", deep-links to the
   Today tab. Overdue wins if both apply.
5. **Upcoming** — next 3 timed, incomplete tasks by due time.
6. **Needs a time** — top 3 untimed, incomplete tasks, each with the two
   quick-plan pills.
7. **Done today** — first 5 completed.

---

## Hooks

| Hook | Owns | Reads | Writes |
|---|---|---|---|
| `useHomeAuth` | `uid`, `authHydrated` | `onAuthStateChanged` | — |
| `useHomeTasks` | today's candidate items, today's completion set, `hydratedUid`, `pendingCompleteKey`; `completeTask`, `quickPlanTask` | `goals` (active, mine) → one `subtasks` listener per goal; `collectionGroup(completions)` where `dayKey == today` | `toggleSubtaskCompletedTx`; `subtasks/{id}` `{dueAtMs, scheduledDayKey}` on quick-plan |
| `useHomeDecision` | pure derivation: decision, stats, hint, the three lists | — | — |
| `useHomeEntrance` | the two `Animated.Value`s and the parallel timing | — | — |

### Which subtasks show up (`isRelevantForToday`)

A subtask is "for today" if **any** of: `dueAtMs` falls on today; `scheduledDayKey`
is today; `frequency === "daily"`. Weekly subtasks with no date are *not*
shown here. `todayKey` is computed inside the subtask snapshot callback, so a
long-open app picks up the new day on the next Firestore push — but the
completions listener computes its `todayKey` once at subscribe time and would
need a re-subscribe at midnight. Legacy had the same limitation.

### Listener shape

The goals listener owns the subtask listeners: on every goals snapshot it
tears all of them down and re-creates one per goal. `byGoal` is rebuilt per
snapshot, so a goal leaving the active set drops its items. `hydratedUid`
is set on the first subtask snapshot for *any* goal, not when all have
landed — the UI can render with a partial set for a moment. Legacy behaviour.

### Hydration is keyed to the uid, not a boolean

`useHomeTasks` exposes `hydratedUid` — the uid whose first goals result
(snapshot, zero goals, or error) has settled. `HomeScreen` is ready only when
`!uid || tasks.hydratedUid === uid`.

This matters because auth and data live in different hooks. When the uid
changes, `useHomeAuth` re-renders with the new uid *before* `useHomeTasks`'s
effect has run to reset anything. With a plain `homeHydrated` boolean that
render would see `uid = B, homeHydrated = true (from A)` and briefly show A's
tasks — or "All clear" on a fresh sign-in. The monolith avoided it by
setting both in the same auth callback; keying by uid gets the same guarantee
without coupling the hooks. (Caught in review of PR #7.)

### Completion is optimistic

`completeTask` flips the key in `completedTodayKeys` locally after the
transaction resolves; the `completions` snapshot then confirms. Both
`useHomeTasks` and `useHomeDecision` key items by `taskKey(item)` =
`goalId:subtaskId` — use that helper, not string concatenation.

---

## Behavioural notes vs the monolith

- **Dropped dead code.** Four unused `stylesFallback*` constants; four
  always-empty fields on `getDecisionMeta` (`actionLabel`, `eyebrowStyle`,
  `buttonStyle`, `buttonTextStyle` — only `label` and `helper` were ever
  read). `"Plan this"` was an `actionLabel` and never rendered.
- **`handleOpenPlannerFromHome` was a byte-identical copy of
  `handleOpenTaskFromHome`** (both push `/goal/[id]`). One `openGoal` now
  serves both props.
- **Pure helpers take their inputs.** `isRelevantForToday(item, tz)`,
  `getQuickPlanDate(option, now)`, `getTimeOfDayGreeting(now)` — the callers
  pass `getUserTz()` / `new Date()`. `utils/` has no Firebase, `Alert`,
  `router`, or `Date.now()`.
- **Quick-plan hours** are named: `QUICK_PLAN_EVENING_HOUR = 18`,
  `QUICK_PLAN_MORNING_HOUR = 9`. "Today evening" rolls to tomorrow if 18:00
  has already passed.
- **The logo accent is fixed `#EAB308`** regardless of theme, as before; it's a
  named constant in `HomeLogo`.

---

## Adding things

- **A new mini list**: derive it in `useHomeDecision`, add a `*Section.tsx`,
  one line in `HomeScreen`.
- **A new decision type**: extend `NowDecision` in `services/nowDecision`, add a
  case to `getDecisionMeta` (copy) and `getNowCardStyle` (card colour), and the
  action buttons in `NowDecisionCard`.
- **A new quick-plan option**: extend `QuickPlanOption`, `getQuickPlanDate`,
  and the alert wording in `quickPlanTask`.

---

## Verification status

Compile-verified: `tsc --noEmit`, `eslint features/home`, `expo export`.
Programmatic faithfulness check against the monolith: all 3 route targets,
8 service calls, 9 decision labels/helpers, both list caps, and all 62 style
keys present; user-facing strings all present except the never-rendered
`"Plan this"`. Not exercised on a device. Worth checking by hand:

- Sign in → loading card → content fades in once. No "All clear" flash
  between the two.
- Switch accounts (sign out, sign in as someone else) → loading card, never a
  frame of the previous account's tasks.
- Complete from the Now card → button shows "Completing…", then the item moves
  to Done today.
- Tap "Today evening" after 18:00 → alert says "this evening" but the
  scheduled time is tomorrow 18:00 (legacy wording; arguably misleading).
