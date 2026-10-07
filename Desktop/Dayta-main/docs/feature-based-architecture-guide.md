# React Native & Expo Router Feature-Based Architecture Guide

_A Step-by-Step Guide to Separation of Concerns & Clean Architecture_

---

## 1. Mental Model: Android Architecture vs React Native (Expo Router)

Coming from Android (MVVM, Clean Architecture, Jetpack Compose / XML layouts, ViewModels, and Multi-Module structures), here is how concepts translate into React Native with Expo Router:

| Android Concept                            | React Native (Clean Architecture) Equivalent | Location in Project                     | Responsibility                                                            |
| :----------------------------------------- | :------------------------------------------- | :-------------------------------------- | :------------------------------------------------------------------------ |
| **`AndroidManifest.xml` / `NavGraph`**     | **Expo Router `app/` Directory**             | `app/` (e.g. `app/(tabs)/calendar.tsx`) | **Routing & Navigation Only**. Never contains heavy UI or business logic. |
| **Activity / Screen Composable**           | **Feature Screen Coordinator**               | `features/<feature>/<ScreenName>.tsx`   | Composes feature hooks and sub-components together.                       |
| **Small UI Composables / Custom Views**    | **Focused UI Components**                    | `features/<feature>/components/`        | Self-contained presentation widgets (100–200 lines each).                 |
| **`ViewModel` + `StateFlow` / `LiveData`** | **Custom React Hooks**                       | `features/<feature>/hooks/`             | Subscribes to database/network and exposes UI state & event callbacks.    |
| **Data Classes / DTOs**                    | **TypeScript Interfaces & Types**            | `features/<feature>/types/`             | Domain models, request/response structures, and UI enums.                 |
| **Repositories & Data Sources**            | **Services & Firebase SDK calls**            | `services/`                             | Raw network requests, Firestore operations, Cloud Function triggers.      |
| **`theme.xml` / Compose Theme Tokens**     | **`StyleSheet.create` + App Theme**          | Component-level or `styles/`            | Theme-aware layout and styling.                                           |

---

## 2. The Core Rule: Single Responsibility Principle (SRP)

> **Rule:** _One file must have only one reason to change._

When a file balloons to thousands of lines (like a 13,000-line screen), it violates SRP because it mixes:

1. Navigation route declaration
2. Data schemas & TypeScript types
3. Pure math, date calculations & string formatters
4. Firestore snapshot listeners & real-time subscriptions
5. State management (dozens of `useState` & `useEffect`)
6. Giant JSX trees with deeply nested layouts
7. Massive CSS/StyleSheets

---

## 3. Recommended Feature-First Folder Structure

Everything related to a specific feature lives together inside a dedicated `features/<feature_name>/` folder outside `app/`:

```text
Dayta/
├── app/                               <-- 🚦 NAVIGATION ROUTING ONLY (Thin wrappers)
│   ├── _layout.tsx                    <-- Root layout & auth provider
│   └── (tabs)/
│       ├── _layout.tsx                <-- Bottom navigation tabs setup
│       └── calendar.tsx               <-- 10 lines: renders <CalendarScreen />
│
├── features/                          <-- 📦 FEATURE MODULES (UI + Logic + State)
│   └── calendar/
│       ├── CalendarScreen.tsx         <-- Feature screen coordinator (~150 lines)
│       ├── index.ts                   <-- Public API export barrel
│       │
│       ├── types/                     <-- 1. DOMAIN & UI TYPES
│       │   └── calendar.types.ts      <-- Data models, state enums
│       │
│       ├── utils/                     <-- 2. PURE UTILITIES (No React / No Side-effects)
│       │   ├── dateUtils.ts           <-- Date math, grid dates, range calculations
│       │   ├── matchUtils.ts          <-- Fuzzy match scoring, tokenization
│       │   ├── ruleUtils.ts           <-- Automation rules matching & body helpers
│       │   ├── metricUtils.ts         <-- Duration math & heatmap calculations
│       │   └── index.ts
│       │
│       ├── hooks/                     <-- 3. CUSTOM HOOKS (React ViewModels)
│       │   ├── usePlanningEvents.ts   <-- Personal events Firestore subscriptions & CRUD
│       │   ├── useCalendarRules.ts    <-- Rules Firestore subscriptions & mutations
│       │   ├── useCalendarHeatmap.ts  <-- Monthly streak & completion aggregation
│       │   └── index.ts
│       │
│       ├── components/                <-- 4. FOCUSED UI PIECES (With Scoped Styles)
│       │   ├── CalendarHeader.tsx     <-- Title, date navigator, view mode tabs
│       │   ├── MonthGridView.tsx      <-- 42-cell month grid & completion dots
│       │   ├── WeekStripView.tsx      <-- 7-day horizontal strip view
│       │   ├── PlanningEventsSection.tsx <-- Event creation form & list
│       │   ├── AutomationPromptBanner.tsx <-- Automation reminder banner
│       │   └── index.ts
│       │
│       └── styles/                    <-- 5. STYLES (Optional shared stylesheets)
│           └── calendar.styles.ts
│
├── services/                          <-- 🌐 GLOBAL DATA REPOSITORIES (Firebase / APIs)
├── components/                        <-- 🧩 GLOBAL SHARED UI (Buttons, Generic Modals)
└── constants/                         <-- 🎨 THEME TOKENS & TYPOGRAPHY
```

---

## 4. Step-by-Step Refactoring Workflow

Follow this 5-step checklist whenever breaking down a monolithic React Native file:

### Step 1: Extract Types & Models

- **Action:** Move all `type` and `interface` definitions to `features/<feature>/types/<feature>.types.ts`.
- **Example:** `ViewMode`, `CalendarItem`, `DatedItem`, `RecoveryItem`, `Goal`.
- **Why first:** All subsequent files (utils, hooks, components) will rely on these types.

### Step 2: Extract Pure Utility Functions

- **Action:** Extract every function that is **pure** into `features/<feature>/utils/`. A function qualifies as a utility only if it meets all three tests:
  1. **Deterministic** — the same inputs always produce the same output.
  2. **No external state access** — it does not read Firestore, `auth.currentUser`, AsyncStorage, the network, `Date.now()`, timers, or module-level mutable variables. Anything it needs comes in as an argument.
  3. **No observable side effects** — it does not write to Firestore, storage, or the network, does not mutate its arguments, and does not show alerts, log, or navigate.
- **"Doesn't use React hooks" is not the test.** A function can be hook-free and still write to Firestore or call an API — that is a **service** (`services/`) or a hook-internal action, never a utility. The reverse is also true: the presence or absence of `useState` says nothing about whether a function is pure.
- **Where non-pure helpers go instead:**
  - Shared, reusable I/O (Firestore reads/writes, API calls) → `services/`.
  - Feature-specific I/O that only this feature uses → a private function inside the hook that owns it, or a `features/<feature>/hooks/` helper. If two hooks share it, it belongs in `services/`.
  - Anything that needs `Date.now()` or the current user → take them as parameters so the core stays pure; do the lookup in the caller.
- **Subdivide by domain:**
  - `dateUtils.ts`: Date math (`addDays`, `startOfMonth`, `sameDay`, `buildMonthGridDates`).
  - `matchUtils.ts`: String matching, scoring algorithms, and token filtering.
  - `metricUtils.ts`: Calculations, unit conversions, and partition helpers (`splitDueCompleted`).
- **Why:** Functions that pass all three tests can be unit-tested with plain inputs, reused anywhere without wiring, and reasoned about in isolation. Functions that fail any one of them cannot, and putting them in `utils/` quietly re-creates the service/UI tangle this guide exists to remove.

### Step 3: Extract Custom Hooks (React's "ViewModels")

- **Action:** Group `useState`, `useEffect`, and Firestore listeners into focused custom hooks in `features/<feature>/hooks/`.
- **Pattern:**

  ```tsx
  export function usePlanningEvents(userId: string | null, isReady: boolean) {
    const [planningEvents, setPlanningEvents] = useState<
      PlanningCalendarEventDoc[]
    >([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (!isReady || !userId) return;
      const unsub = subscribePersonalPlanningCalendarEvents(
        userId,
        setPlanningEvents,
      );
      return () => unsub();
    }, [isReady, userId]);

    const addEvent = useCallback(
      async (params) => {
        /* mutation */
      },
      [userId],
    );
    const removeEvent = useCallback(
      async (eventId) => {
        /* mutation */
      },
      [userId],
    );

    return { planningEvents, loading, addEvent, removeEvent };
  }
  ```

- **Why:** Decouples business logic and data persistence from UI rendering.

### Step 4: Extract Discrete UI Sub-Components & Styles

- **Action:** Break down the large JSX tree into smaller UI components inside `features/<feature>/components/`.
- **Rule for Styles:** In React Native, do not use CSS files. Keep styling collocated inside each component file using `StyleSheet.create()` and the app theme hook (`useCurrentAppTheme()`), or extract to a `.styles.ts` file if shared.
- **Component Responsibilities:**
  - `CalendarHeader.tsx`: Handles date navigation bar and mode switcher pills.
  - `MonthGridView.tsx`: Renders the calendar grid and dots.
  - `WeekStripView.tsx`: Renders the 7-day horizontal strip.
  - `PlanningEventsSection.tsx`: Self-contained form with title/date inputs and event list.
  - `AutomationPromptBanner.tsx`: Self-contained confirmation card.

### Step 5: Screen Assembly & Thin Navigation Route

- **Action 1:** In `features/<feature>/<ScreenName>.tsx`, import the hooks and components and assemble them cleanly:

  ```tsx
  export function CalendarScreen() {
    const { theme } = useCurrentAppTheme();
    const { planningEvents, addEvent, removeEvent } = usePlanningEvents(user?.uid, authReady);
    const { heatByDayKey, goalCompletionCountsByDay } = useCalendarHeatmap(...);

    return (
      <ScrollView contentContainerStyle={styles.container}>
        <CalendarHeader ... />
        {viewMode === "month" && <MonthGridView ... />}
        {viewMode === "week" && <WeekStripView ... />}
        <PlanningEventsSection events={planningEvents} onAddEvent={addEvent} onArchiveEvent={removeEvent} />
      </ScrollView>
    );
  }
  ```

- **Action 2:** Update the route in `app/(tabs)/calendar.tsx` to be a thin 10-line wrapper:

  ```tsx
  import React from "react";
  import { CalendarScreen } from "@/features/calendar";

  export default function CalendarRoute() {
    return <CalendarScreen />;
  }
  ```

---

## 5. Verification & TypeScript Safety

After every step, run the project's TypeScript compilation check to ensure strict type safety:

```bash
npx tsc --noEmit
```

### Keep the mobile client type-check isolated from Cloud Functions

The root `tsconfig.json` includes `**/*.ts`, which would pull `functions/src` into the client type-check and fail on server-only dependencies (`firebase-admin`, `@google-cloud/storage`, …). The root config must exclude it. This is the exact configuration the project uses:

```jsonc
// tsconfig.json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "paths": { "@/*": ["./*"] },
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["functions", "node_modules"],
}
```

`functions/` has its own `tsconfig.json` and is type-checked by its own build (`npm --prefix functions run build`).

**Verify the isolation, don't assume it.** This prints every file the client check will compile; the count must be zero:

```bash
npx tsc --noEmit --listFilesOnly -p tsconfig.json | grep -c "/functions/src/"
```

If it is not zero, the `exclude` is missing or a client file is importing from `functions/` directly — both must be fixed before trusting `tsc --noEmit` as a migration gate.
