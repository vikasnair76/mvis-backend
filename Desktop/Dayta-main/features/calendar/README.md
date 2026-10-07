# Calendar feature

The Calendar tab. Shows the user's goal subtasks on a day / week / month
timeline, overlays synced Google Calendar events and group events, and runs
the automation that keeps subtasks and calendar events in step.

`app/(tabs)/calendar.tsx` is a one-line route wrapper. Everything lives here.

```
features/calendar/
├── CalendarScreen.tsx      composition root — owns selection state, wires hooks to components
├── components/             presentational; receive data + callbacks, hold only local UI state
├── hooks/                  one concern each; own Firestore subscriptions and write actions
├── utils/                  pure functions; no React, no Firestore, no side effects
├── types/                  domain models shared across the feature
└── calendar.legacy.tsx.bak the original 13k-line monolith, kept as reference — not compiled
```

Rule of thumb when adding something: data fetching or a Firestore write goes in a
hook, a derived value goes in a util, pixels go in a component, and
`CalendarScreen` only connects the three.

---

## What the screen does

Top to bottom, as rendered:

1. **Header** — title, `‹ › Today` navigation, `Day / Week / Month` switcher, and a
   "Group events on/off" pill (only shown when the user is in ≥1 active group).
2. **Month grid / Week strip** — 42-cell grid or 7-day strip. Each day shows up to
   3 dots + `+` for completions that day (subtask completions + whole-goal completions).
3. **Day agenda** — for the selected day: summary line, streak banner, then
   subtasks bucketed as **Due**, **Unscheduled** (one-time subtasks with no date
   yet), **Completed**, and **Completed goals**. Each card can be completed/undone,
   opens its goal, shows its linked Google event, and offers "Apply suggested event"
   when a matching event exists.
4. **Recovery** — cards for subtasks that **conflict** with a Google event, or were
   **unscheduled** off this day by an override. Actions: use suggested slot,
   reassign later today / tomorrow morning, mark unscheduled, skip for the day,
   restore schedule.
5. **Google Calendar** — the day's synced events with a manual Refresh button and
   last-sync age. Each event shows a suggested subtask (or an "ambiguous" hint),
   Quick link, and "Apply to a subtask".
6. **Apply panel** — inline panel opened from (3) or (5): pick a goal, then a
   subtask. Tapping a subtask opens the **action sheet**: apply event duration to
   progress, link only, link + use event time, mark complete, enable auto-link,
   enable auto-apply duration.
7. **Automation prompt** — after a manual link: step 1 "remember this match?"
   (`suggest_subtask` rule), step 2 "enable auto-link too?" (`auto_link` rule).
8. **Automation history** — last 20 automation actions this session (in-memory).
9. **Group events** — events from the user's groups in the visible range; tap opens
   the group calendar.
10. **Planning events** — personal free-form time blocks (create / archive), not
    tied to a goal.

---

## Data flow

Every hook is called once from `CalendarScreen`, in dependency order. The
important edges:

```
useCalendarGoals ──────► visibleGoals, subtasksByGoal, activeGoalIds
        │
        ├─► useCalendarHeatmap ──► heatByDayKey, goalCompletionCountsByDay, rangeKeys
        │           │
        │           └─► useScheduleOverrides(rangeKeys) ──► scheduleOverridesByKey
        │
        ├─► useDayCompletions ──► completedByDayKey, toggleSubtask
        │
        └─► useAgendaItems ──► selectedSplit {due, completed}, selectedDayUnscheduledItems
                    │
useGoogleCalendar ──┼─► selectedDayEvents, allEventsById (visible range only)
        │           │
        │           └─► useCalendarSuggestions ──► suggestedEventByItemKey,
        │                                          suggestedTaskByEventId, candidateItems
        │                                                │
        │                              useApplyFlow ◄────┘  (link / apply / rule prompts)
        │                                    │
        ├─► useAutomationRules ◄─────────────┤  (executes saved auto_* rules)
        │                                    │
        └─► useLinkedEventReconciliation ◄───┘  ──► eventsById (visible ∪ linked docs)
                    │
                    └─► useDayConflicts(eventsById) ──► recoveryItems, overlapSummary
                                │
                                └─► useScheduleRecovery  (the six recovery actions)
```

`useCalendarRules` and `usePlanningEvents` are independent leaves.
`useIntegratedGroupCalendarEvents` is a shared app hook (`hooks/`), not ours.

### Keys you will see everywhere

| Key | Shape | Meaning |
|---|---|---|
| `dayKey` | `"YYYY-MM-DD"` in the user's tz | canonical day id; from `services/dateKey` |
| `itemKey` | `goalId:subtaskId:dayKey` | one agenda item on one day |
| `completionKey` | `goalId:subtaskId` | membership in `completedByDayKey.get(dayKey)` |
| `overrideKey` | `subtaskId:dayKey` | index into `scheduleOverridesByKey` |
| `autoKey` | `eventId:goalId:subtaskId` | auto-link / auto-apply pending + suppression |

`dateKeyLocal(date, tz)` (utils) is the one to use for a `Date` — it normalizes
to the local calendar day first.

---

## Hooks

| Hook | Owns | Reads | Writes |
|---|---|---|---|
| `useCalendarGoals` | goals, group-shared goals assigned to me, one subtask listener per goal | `goals`, `collectionGroup(subtasks)`, `goals/{id}/subtasks` | — |
| `useCalendarHeatmap` | completion dots for the visible range; day-mode range = the single day | `collectionGroup(completions)`, `goalCompletions` | — (exposes `setHeatByDayKey` for optimistic bumps) |
| `useScheduleOverrides` | per-day overrides in range | `collectionGroup(scheduleOverrides)` | — (exposes setter for optimistic merges) |
| `useDayCompletions` | selected-day completions, whole-goal completions, `toggleSubtask` | `collectionGroup(completions)` where `dayKey ==`, `goalCompletions` | `toggleSubtaskCompletedTx` |
| `useAgendaItems` | pure derivation: goals × subtasks × dates → `DatedItem[]`, split by completion | — | — |
| `useGoogleCalendar` | integration doc, synced events fanned out per day, auto-sync, manual refresh | `users/{uid}/integrations/googleCalendar`, `users/{uid}/calendarEvents` | via `runGoogleCalendarAutoSync` |
| `useCalendarRules` | saved `calendarRules` | `users/{uid}/calendarRules` | — |
| `useCalendarSuggestions` | two-way matching: item→event and event→item | — | — |
| `useApplyFlow` | apply panel + action sheet state; link / duration / completion actions; rule prompts; history | — | subtask link fields, schedule (via `services/subtasks.applyEventTimeToSubtask`), `calendarRules`, `applySubtaskMetricProgressTx` |
| `useAutomationRules` | executes `auto_link` and `auto_apply_duration` rules against today's events | — | subtask link fields, `applySubtaskMetricProgressTx` |
| `useLinkedEventReconciliation` | one doc listener per linked event; moved/renamed/deleted handling; missing flags; unlink | `users/{uid}/calendarEvents/{eventId}` | subtask snapshot fields, `linkedEventHistory`, schedule |
| `useDayConflicts` | pure: due items × events → overlaps, recovery items, day-level slot | — | — |
| `useScheduleRecovery` | the six recovery actions with pending state + "Rescheduled" badge | — | subtask schedule / `scheduleOverrides` docs |
| `usePlanningEvents` | personal planning events | `planningCalendarEvents` | create / archive |

### Two hooks that write without a tap

`useAutomationRules` and `useLinkedEventReconciliation` are `useEffect`s that
mutate Firestore on their own once their inputs settle. Both are guarded so an
effect re-run mid-write does not double-fire (`pendingRef` / `syncing*Ref`), and
both are idempotent against **persisted** state — see "Invariants" below. If you
change either, re-check those guards first.

---

## Firestore shapes this feature depends on

Subtask fields written by this feature (all under `goals/{goalId}/subtasks/{id}`):

```
linkedCalendarEventId / EventTitle / EventStartMs / EventEndMs / CalendarId / EventUpdatedRaw
linkedCalendarLinkedAtMs / LastSyncedAtMs
linkedCalendarLastHandledStartMs / LastHandledEndMs / LastHandledUpdatedRaw   ← what we last reconciled against
linkedCalendarLastKnownMissing / MissingAtMs                                  ← event vanished from sync
autoAppliedDurationEventIds: string[]                                          ← events whose duration was already counted
scheduledDayKey / dueAtMs                                                      ← one-time schedule (via buildOneTimeSchedulePatch)
```

Per-day overrides: `goals/{goalId}/subtasks/{id}/scheduleOverrides/{dayKey}` with
`{ dueAtMs, isSkipped, isUnscheduled, source }`. Built only through
`services/scheduling` helpers (`buildRecurring*Override`) — never hand-rolled.
The one write that moves a subtask to an event's time (one-time patch vs
recurring override) is `services/subtasks.applyEventTimeToSubtask`; both
`useApplyFlow` and the reconciler call it.

Rules to know about (`firestore.rules`): a goal **owner** can write any subtask
field; an **assigned** non-owner is field-allowlisted. If you add a subtask field
that an assigned user's automation needs to write, add it to
`isAssignedCompletionSubtaskUpdate` too, or the write silently fails at the
rules layer.

`autoAppliedDurationEventIds` is additionally **append-only for assigned
non-owners** (`isAutoAppliedMarkerAppendOnly`): the new list must contain every
id already stored, and may grow by at most one per write. It is the persisted
idempotency guard for auto-applied durations, so letting an assigned member drop
an id would make that event eligible to contribute progress a second time. Keep
the client on a single `arrayUnion` per write — a multi-id append, a rewrite
that reorders into a shorter list, or a `deleteField()` is denied. Owners are
unrestricted. Covered by `npm run test:auto-apply-marker-rules`.

Composite indexes are all present in `firestore.indexes.json`; the queries here
were carried over unchanged from the monolith.

---

## Invariants — do not break these

1. **Auto-apply must never double-count.** `applySubtaskMetricProgressTx(..., { autoAppliedEventId })`
   checks `autoAppliedDurationEventIds` inside the transaction and no-ops if the
   event is already there. Session-level suppression alone is *not* enough; that
   was a real double-count bug in the monolith. Manual applies from the action
   sheet intentionally don't pass the id.

2. **"Missing" is decided by the event's own document, never by the visible range.**
   `useLinkedEventReconciliation` keeps a tri-state per linked event
   (`loading` / `present` / `missing`) from a dedicated `onSnapshot`. `loading` is
   never treated as missing. The merged `eventsById` it returns (visible-range
   events ∪ linked-event docs) is what agenda cards and `useDayConflicts` use —
   not `googleCalendar.allEventsById`, which only covers the days on screen.

3. **Recovery slots stay inside 08:00–20:00 and never in the past.** All slot
   search goes through `recoveryUtils` and uses `workDayBounds`. Anything that
   *writes* a slot must use the same not-before cutoff the row's *label* was
   computed with (`getRecoverySuggestionNotBeforeMs`), or the tap does something
   different from what the card said.

4. **Function-valued `style` and `Link asChild` don't mix.** `Link asChild`
   merges props through `@radix-ui/react-slot`, whose style merge spreads the
   child style — a function spreads to `{}` and the card loses all styling.
   Cards that need pressed feedback navigate with `router.push` instead.

5. **A user's manual unlink is respected for the session.** `unlinkEvent` calls
   `suppressAutoLink(eventId, goalId, subtaskId)` so `useAutomationRules` doesn't
   immediately re-link the pair the user just broke.

6. **One-time subtasks don't get dragged by the calendar** unless they were still
   aligned to the old event time (`shouldAllowControlledAutoFollow`). Recurring
   subtasks follow any `auto_propagate` decision from `services/linkedEventPolicy`.

---

## Utils

| File | What's in it |
|---|---|
| `dateUtils` | `addDays`, `startOfWeekSunday`, `buildMonthGridDates`, range → dayKeys, planning-event parsing/formatting, `doesEventOverlapDate` |
| `goalUtils` | `isOneTimeSubtask`, `isGroupSharedGoal`, `dateKeyLocal`, `completionKey`, `bumpHeatCount`, badge/label formatters, `formatLinkedEventLabel` |
| `matchUtils` | token normalization + scoring: `getCalendarMatchSuggestion` (item → best event), `getTaskSuggestionForEvent` (event → best item, `single` / `ambiguous`), `doesItemOverlapEventOnDate`, linked-event predicates |
| `ruleUtils` | everything about `calendarRules`: preselection from saved rules, `getAuto*RuleMatchForEvent`, prompt keys/titles/bodies, `canShowQuickSuggestedApply` |
| `metricUtils` | event duration → metric value, heatmap aggregation, `splitDueCompleted`, apply-blocked reasons |
| `recoveryUtils` | slot search (`findFirstAvailableSlot*`), conflict labels, `confirmAction`, overlap summary |
| `linkedEventUtils` | `getLinkedSubtasks`, `detectLinkedEventChange`, metadata-only vs time-shift classification, `CLEAR_LINKED_EVENT_FIELDS` |

`doesItemOverlapEventOnDate` semantics, since it's easy to get wrong: an all-day
event overlaps everything that day; a timed event overlaps if it intersects a
30-minute window centered on the item's due time.

---

## Types

`types/calendar.types.ts` — read this first. The ones that matter:

- `CalendarItem` — a subtask projected for display (goal + subtask ids, titles, metric, override state, linked-event fields).
- `DatedItem = CalendarItem & { date: Date }` — the agenda unit. Almost every callback takes one.
- `GoogleCalendarEvent` — a synced event doc. `startDayKey` / `endDayKey` drive the range query; `htmlLink` is what "Open event" opens.
- `RecoveryItem` — `{ type: "conflict" | "unscheduled", item, suggestedSlot, detail }`.
- `LinkedEventChangeDetection` — output of `detectLinkedEventChange`; `startChanged` is the time-shift flag.
- `ApplyActionMenuTarget` — which subtask the action sheet is about, and whether it's already linked.

---

## Adding things — where it goes

- **A new day-level list** (e.g. reminders): a hook that subscribes and derives, a
  `*Section.tsx` component, one line in `CalendarScreen`.
- **A new recovery action**: add a `RecoveryAction` variant and a callback in
  `useScheduleRecovery` (use `runAction` for pending + error handling), a button in
  `RecoverySection`.
- **A new rule type**: extend `CalendarRuleType` in `services/calendarRules`,
  add matching in `ruleUtils`, execution in `useAutomationRules`, prompt copy in
  `getAutomationPrompt*`.
- **A new apply action**: handler in `useApplyFlow` (follow `applyEventDurationToProgress`),
  button in `ApplyActionSheet`, blocked-reason in `metricUtils` if it has preconditions.

---

## Verification status

Compile-verified: `tsc --noEmit`, `eslint features/calendar`, `expo export`. The
feature has **not** been exercised on a device by the author of the modular
version; the highest-value manual checks are:

- Enable auto-apply on a rule, restart the app twice, confirm the goal's
  `currentMetricValue` moved exactly once.
- Move a linked event in Google Calendar; confirm the subtask follows (recurring)
  or holds (manually-rescheduled one-time), and one `linkedEventHistory` doc lands.
- Delete a linked event; confirm the card shows "missing from synced calendar"
  and `linkedCalendarLastKnownMissing` is stamped — and *not* stamped for an
  event that's merely outside the visible week.

## Not yet ported from the monolith

- Snooze menu (30 min / 60 min / tomorrow) on agenda items.
- "Use linked event time" as a standalone action on a card (it exists inside the
  apply flow as "Link + use event time").
- Advanced unlink options (unlink + disable rule).
