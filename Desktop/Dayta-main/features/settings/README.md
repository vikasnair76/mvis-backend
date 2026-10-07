# Settings feature

The Settings tab: account sign-in, Google Calendar connection, push and
local notifications, Planner suggestion preferences, and the theme picker.

`app/(tabs)/settings.tsx` is a one-line route wrapper. Everything lives here.
The two sub-routes — `app/settings/automation.tsx` and `app/settings/feedback.tsx`
— are separate screens and are **not** part of this module; the tab only links
to them.

```
features/settings/
├── SettingsScreen.tsx        composition root — wires hooks to sections, no logic of its own
├── components/               one file per card on screen; props in, callbacks out
├── hooks/                    one concern each; own the Firestore subscription + the actions
├── utils/                    pure helpers (sync window, theme copy, date formatting)
├── styles/                   createSettingsStyles(theme) — lifted verbatim from the monolith
├── types/                    CalendarIntegrationState, GoogleCalendarSyncSummary
└── settings.legacy.tsx.bak   the original 971-line screen, kept as reference — not compiled
```

---

## What the screen does

Top to bottom, as rendered:

1. **Account** — "Sign in with Google" / "Log out".
2. **Google Calendar** — Connect, Sync, and (when connected) Disconnect.
   Connect and Sync run the exact same pull; only the confirmation wording
   differs.
3. **Automation Preferences** link → `/settings/automation`, and the
   **Feedback & Support** card → `/settings/feedback`.
4. **Push Notifications** card — register / disable the Expo push token — plus
   the "Enable notifications" OS-permission button.
5. **Planner suggestions** card — master toggle, per-type visibility chips,
   personal / group toggles, five notification toggles, "Open Planner".
6. **Send test notification** — schedules a local notification 5s out.
7. **Theme** — one row per `APP_THEMES` entry with four colour swatches.
8. **Status footer** — integration state, last sync, last error, auth state, uid.

---

## Hooks

| Hook | Owns | Reads | Writes |
|---|---|---|---|
| `useAuthUser` | the Firebase `User` | `onAuthStateChanged` | — |
| `useGoogleSignIn` | `GoogleSignin.configure` (once), sign-in, sign-out, `busy` | — | `users/{uid}` profile upsert |
| `useGoogleCalendarIntegration` | integration doc, background auto-sync, connect / sync / disconnect, `busy` | `users/{uid}/integrations/googleCalendar` | `users/{uid}/calendarEvents/*` (via `syncGoogleEventsToFirestore`), integration doc |
| `usePushNotifications` | register / disable token, OS permission prompt, test ping, `busy` | — | via `services/pushNotifications` |
| `usePlannerPreferences` | live prefs doc + merge-and-save, `saving` | via `subscribePlannerPreferences` | via `updatePlannerPreferences` |
| `useThemePreference` | selected theme id (from `useCurrentAppTheme`), persisted select, `saving` | — | via `saveUserThemePreference` |

Every action hook exposes a `busy` / `saving` flag and guards against
re-entry. Sections should disable their buttons on it.

### Google sign-in scope — read before touching

`useGoogleSignIn` calls `GoogleSignin.configure` itself, requesting the
`https://www.googleapis.com/auth/calendar` scope. That scope is what lets
`connectGoogleCalendar()` (in `services/googleCalendarAuth`) reuse the signed-in
session without a second consent screen.

`services/googleSignInConfig.configureGoogleSignIn()` exists but does **not**
request the calendar scope — switching to it would silently break "Connect
Google Calendar". The client id constant is shared (`GOOGLE_WEB_CLIENT_ID`);
the scope list is not. `googleCalendarAuth.ts` also has a placeholder
`"YOUR_WEB_CLIENT_ID_HERE"` configure, but it is inside a commented-out block
and never runs.

---

## Behavioural notes

- **`busy` is per concern now.** The monolith shared one `busy` between sign-in
  and disconnect, and Connect / Sync had no busy state at all, so a double-tap
  could start two pulls. Each hook owns its own flag.
- **Connect and Sync are one code path.** `connectOrSync(mode)` — the pull,
  the Firestore write, the integration update, and the failure path
  (`connected: false, lastError`) are identical; only the alert titles change.
- **Auto-sync fires on `connected` becoming true**, not on every integration
  doc write. Depending on `lastSyncAtMs` would loop.
- **Manual sync window** is 7 days back → 1 month ahead (`getManualSyncWindow`).
- **Theme descriptions** live in `utils/settings.utils.ts`, keyed by theme id,
  with a default for unknown ids. Add a line there when adding a theme.
- Debug `console.log`s from the monolith ("SETTINGS SCREEN LOADED",
  "BUTTON PRESSED", raw sign-in result dumps) were dropped. Error logs kept.

---

## Adding things

- **A new settings card**: a hook if it needs data or a write, a
  `*Section.tsx` taking `styles` + values + callbacks, one block in
  `SettingsScreen`.
- **A new planner toggle**: add a `[label, key]` tuple to `NOTIFICATION_TOGGLES`
  in `PlannerPreferencesSection` — the key must exist on `PlannerPreferencesDoc`.
- **A new theme**: add it to `APP_THEMES` in `services/theme` and a description
  to `THEME_DESCRIPTIONS`.

---

## Verification status

Compile-verified on this branch: `eslint features/settings`, `expo export`, and
`tsc` with no new errors (the branch has pre-existing `functions/` errors
because its `tsconfig` doesn't exclude that directory yet — a later branch
fixes that). Not exercised on a device. Highest-value manual checks:

- Sign in → confirm `users/{uid}` gets the profile upsert.
- Connect Google Calendar → confirm the consent screen includes Calendar and
  events land in `users/{uid}/calendarEvents`.
- Toggle a planner switch → confirm the doc updates and the switch doesn't
  flicker back.
