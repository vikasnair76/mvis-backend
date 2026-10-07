import { Link, router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { PlannerContextPreview } from "../../components/planner/PlannerContextPreview";
import { dayKeyFromDate, dayKeyFromMs, getUserTz } from "../../services/dateKey";
import { auth, db } from "../../services/firebase";
import type {
  Goal,
  Subtask,
  SubtaskCompletionMode,
  SubtaskFrequency,
  SubtaskScheduleType,
} from "../../services/goalTypes";
import {
  getNowDecision,
  type HomeTaskItem,
  type NowDecision,
} from "../../services/nowDecision";
import { toggleSubtaskCompletedTx } from "../../services/subtasks";
import { UI_SIZES, type AppThemeTokens } from "../../services/theme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";
import { IntegratedGroupCalendarEventCard } from "../../components/groupCalendar/IntegratedGroupCalendarEventCard";
import { useIntegratedGroupCalendarEvents } from "../../hooks/useIntegratedGroupCalendarEvents";
import { getCalendarDayBounds } from "../../services/groupCalendarIntegration";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "../../services/haptics";

// --- helpers (same logic you already used) ---
function dayRangeMs(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

function isDueToday(subtask: Subtask, todayKey: string): boolean {
  const { start, end } = dayRangeMs();
  const todayDow = new Date().getDay();

  const scheduleType: SubtaskScheduleType =
    subtask.scheduleType === "oneTime" || subtask.frequency === "once"
      ? "oneTime"
      : "recurring";

  const freq: SubtaskFrequency = subtask.frequency ?? "once";

  if (scheduleType === "oneTime") {
    const completedEver =
      typeof subtask.firstCompletedAtMs === "number" &&
      subtask.firstCompletedAtMs > 0;

    if (completedEver) return false;

    const scheduledDayKey =
      typeof subtask.scheduledDayKey === "string" && subtask.scheduledDayKey
        ? subtask.scheduledDayKey
        : typeof subtask.dueAtMs === "number"
        ? dayKeyFromMs(subtask.dueAtMs, getUserTz())
        : null;

    if (scheduledDayKey) {
      return scheduledDayKey === todayKey;
    }

    return true;
  }

  if (
    typeof subtask.dueAtMs === "number" &&
    subtask.dueAtMs >= start &&
    subtask.dueAtMs < end
  ) {
    return true;
  }

  if (freq === "daily") return true;

  if (freq === "weekly") {
    const wd = typeof subtask.weeklyDay === "number" ? subtask.weeklyDay : null;
    return wd === todayDow;
  }

  return false;
}




function getActionLabel(item: TodayItem): string {
  if (item.completionMode === "count") {
    return item.isCompletedToday ? "Done" : "+1";
  }
  return item.isCompletedToday ? "Undo" : "Complete";
}

function getPendingActionLabel(item: TodayItem): string {
  if (item.isCompletedToday) return "Undoing…";
  if (item.completionMode === "count") return "Updating…";
  return "Completing…";
}

function getActionAccessibilityLabel(item: TodayItem): string {
  if (item.isCompletedToday) {
    return `Undo completion for ${item.title}`;
  }
  if (item.completionMode === "count") {
    return `Add 1 to ${item.title}`;
  }
  return `Complete ${item.title}`;
}

function findTodayItemForDecision(
  decision: NowDecision,
  todayItems: TodayItem[]
): TodayItem | null {
  if (decision.type === "all_clear") return null;

  return (
    todayItems.find(
      (item) =>
        item.goalId === decision.item.goalId &&
        item.subtaskId === decision.item.subtaskId
    ) ?? null
  );
}

function formatTodayDecisionDebugLabel(decision: NowDecision): string {
  switch (decision.type) {
    case "overdue":
      return `Overdue · ${decision.item.title}`;
    case "now":
      return `Now · ${decision.item.title}`;
    case "next":
      return `Next · ${decision.item.title}`;
    case "needs_time":
      return `Needs time · ${decision.item.title}`;
    case "all_clear":
      return "All clear";
  }
}

function getTodayDecisionCardStyle(
  decision: NowDecision,
  styles: ReturnType<typeof makeStyles>
) {
  switch (decision.type) {
    case "overdue":
      return styles.todayDecisionOverdue;
    case "now":
      return styles.todayDecisionNow;
    case "next":
      return styles.todayDecisionNext;
    case "needs_time":
      return styles.todayDecisionNeedsTime;
    case "all_clear":
      return styles.todayDecisionAllClear;
  }
}

function getTodayDecisionCardLabel(decision: NowDecision): "Overdue" | "Now" | "Next" | "Needs a time" | "All clear" {
  switch (decision.type) {
    case "overdue":
      return "Overdue";
    case "now":
      return "Now";
    case "next":
      return "Next";
    case "needs_time":
      return "Needs a time";
    case "all_clear":
      return "All clear";
  }
}

function formatScheduleFeedbackTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTodayItemKey(item: Pick<TodayItem, "goalId" | "subtaskId">): string {
  return `${item.goalId}:${item.subtaskId}`;
}

type DailyCompletionSnapshot = {
  completionCount: number | null;
  completedAtMs: number | null;
};

type TodayItem = {
  goalId: string;
  goalTitle: string;
  goalStatus: Goal["status"];

  subtaskId: string;
  title: string;
  description: string | null;

  scheduleType: SubtaskScheduleType;
  frequency: SubtaskFrequency;
  weeklyDay: number | null;
  scheduledDayKey: string | null;
  dueAtMs: number | null;

  completionMode: SubtaskCompletionMode;
  targetCount: number | null;
  completionCountToday: number;
  isCompletedToday: boolean;

  contributesToMetric: boolean;
  metricValue: number | null;
  metricUnit: string | null;

  isInProgress: boolean;
  isScheduledToday: boolean;
  needsAttention: boolean;

  isSharedAssigned: boolean;
  assignedToUid: string | null;
};

type QuickScheduleOption = {
  id: "next_opening" | "evening" | "tomorrow_morning";
  label: string;
  targetMs: number;
  metaLabel?: string;
  reasonLabel?: string;
};

export default function TodayScreen() {
  const [user, setUser] = useState(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);

const { theme } = useCurrentAppTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
const groupTodayTimezone = getUserTz();
const [groupTodayDayKey, setGroupTodayDayKey] = useState(() =>
  dayKeyFromDate(new Date(), groupTodayTimezone)
);
useEffect(() => {
  let midnightTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleNextDay = () => {
    const currentKey = dayKeyFromDate(new Date(), groupTodayTimezone);
    setGroupTodayDayKey(currentKey);
    const { endMs } = getCalendarDayBounds(currentKey, groupTodayTimezone);
    midnightTimer = setTimeout(
      scheduleNextDay,
      Math.max(1_000, endMs - Date.now() + 250)
    );
  };
  scheduleNextDay();
  return () => {
    if (midnightTimer) clearTimeout(midnightTimer);
  };
}, [groupTodayTimezone]);
const todayGroupRange = useMemo(() => {
  return getCalendarDayBounds(groupTodayDayKey, groupTodayTimezone);
}, [groupTodayDayKey, groupTodayTimezone]);
const integratedGroupCalendar = useIntegratedGroupCalendarEvents({
  uid: user?.uid ?? null,
  rangeStartMs: todayGroupRange.startMs,
  rangeEndMs: todayGroupRange.endMs,
  limitPerGroup: 100,
});

  const [goals, setGoals] = useState<Goal[]>([]);
  const [assignedSharedGoals, setAssignedSharedGoals] = useState<Goal[]>([]);
 const [subtasksByGoal, setSubtasksByGoal] = useState<Record<string, Subtask[]>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingCompletionIdsRef = useRef(new Set<string>());

  // track per-goal unsubscribers
  const subtasksUnsubsRef = useRef<Record<string, (() => void) | null>>({});
  const [completionSnapshotsByKey, setCompletionSnapshotsByKey] = useState<
  Record<string, DailyCompletionSnapshot>
>({});
  const [personalGoalsReady, setPersonalGoalsReady] = useState(false);
  const [sharedGoalsReady, setSharedGoalsReady] = useState(false);
  const [completionsReady, setCompletionsReady] = useState(false);
  const [readySubtaskGoalIds, setReadySubtaskGoalIds] = useState<Set<string>>(
    new Set()
  );
  const [todayDataError, setTodayDataError] = useState<string | null>(null);
  const [hasEstablishedTodayData, setHasEstablishedTodayData] = useState(false);
  const [scheduleOverridesByKey, setScheduleOverridesByKey] = useState<Record<string, any>>({});

  const [showCompleted, setShowCompleted] = useState(false);

const [scheduleConfirmTarget, setScheduleConfirmTarget] = useState<{
  item: TodayItem;
  preset: "next_opening" | "evening" | "tomorrow_morning" | "later_today" | "tonight" | "unschedule";
  targetMs: number | null;
  label: string;
  reasonLabel?: string | null;
} | null>(null);
const [pendingScheduleItemKey, setPendingScheduleItemKey] = useState<string | null>(null);
const [undoingSchedule, setUndoingSchedule] = useState(false);
const scheduleMutationLockRef = useRef<string | null>(null);
const undoScheduleLockRef = useRef(false);

const [plannerHistory, setPlannerHistory] = useState<
  { id: string; message: string; createdAtMs: number }[]
>([]);

const [lastScheduleChange, setLastScheduleChange] = useState<{
  item: TodayItem;
  previousDueAtMs: number | null;
  previousScheduledDayKey: string | null;
  message: string;
} | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setPersonalGoalsReady(false);
      setSharedGoalsReady(false);
      setCompletionsReady(false);
      setReadySubtaskGoalIds(new Set());
      setTodayDataError(null);
      setHasEstablishedTodayData(false);
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 1) subscribe to user goals
  useEffect(() => {
    if (!authReady) return;

    const uid = user?.uid ?? null;
    if (!uid) {
      setGoals([]);
      setSubtasksByGoal({});
      setPersonalGoalsReady(true);
      return;
    }

    const goalsRef = collection(db, "goals");
    const q = query(goalsRef, where("userId", "==", uid), orderBy("createdAtMs", "desc"));

    const unsubGoals = onSnapshot(
      q,
      (snap) => {
        const list: Goal[] = snap.docs.map((d) => {
          const data = d.data() as Omit<Goal, "id">;
          return { id: d.id, ...data };
        });
        setGoals(list);
        setPersonalGoalsReady(true);
        console.log("TODAY goals loaded", list.length, list.map((g) => ({
  id: g.id,
  title: g.title,
  status: g.status,
})));
      },
      (err) => {
        console.error(err);
        setPersonalGoalsReady(true);
        setTodayDataError("Today couldn’t load your goals. Please try again later.");
      }
    );

    return () => unsubGoals();
  }, [authReady, user]);

  const visibleGoals = useMemo(() => {
  const map = new Map<string, Goal>();

  goals.forEach((goal) => {
    map.set(goal.id, goal);
  });

  assignedSharedGoals.forEach((goal) => {
    map.set(goal.id, goal);
  });

  return Array.from(map.values());
}, [goals, assignedSharedGoals]);

  // 2) for each goal, subscribe to its subtasks

  useEffect(() => {
    // clean up removed goal subscriptions
    const existing = subtasksUnsubsRef.current;

   const goalIds = new Set(visibleGoals.map((g) => g.id));

    Object.keys(existing).forEach((gid) => {
      if (!goalIds.has(gid)) {
        existing[gid]?.();
        delete existing[gid];
        
        setSubtasksByGoal((prev) => {
          const next = { ...prev };
          delete next[gid];
          return next;
        });
        setReadySubtaskGoalIds((prev) => {
          const next = new Set(prev);
          next.delete(gid);
          return next;
        });
      }
    });

    // add new subscriptions
   visibleGoals.forEach((g) => {
      if (existing[g.id]) return;

      const ref = collection(db, "goals", g.id, "subtasks");
      const q = query(ref, orderBy("createdAtMs", "desc"));

      existing[g.id] = onSnapshot(
        q,
        (snap) => {
          const list: Subtask[] = snap.docs.map((d) => {
  const data = d.data() as Partial<Subtask>;

  return {
    id: d.id,
    goalId: typeof data.goalId === "string" ? data.goalId : g.id,
    userId: typeof data.userId === "string" ? data.userId : user?.uid ?? "",
    assignedToUid:
  typeof data.assignedToUid === "string" ? data.assignedToUid : null,

assignedToName:
  typeof data.assignedToName === "string" ? data.assignedToName : null,

assignedToEmail:
  typeof data.assignedToEmail === "string" ? data.assignedToEmail : null,

    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.description === "string" ? data.description : null,

    scheduleType:
      data.scheduleType === "oneTime" ? "oneTime" : "recurring",

    frequency:
      data.frequency === "once" ||
      data.frequency === "weekly" ||
      data.frequency === "daily"
        ? data.frequency
        : "daily",

    weeklyDay:
      typeof data.weeklyDay === "number" ? data.weeklyDay : null,

    scheduledDayKey:
      typeof data.scheduledDayKey === "string" ? data.scheduledDayKey : null,

    dueAtMs:
      typeof data.dueAtMs === "number" ? data.dueAtMs : null,

    completionMode:
      data.completionMode === "count" ? "count" : "binary",

    targetCount:
      typeof data.targetCount === "number" ? data.targetCount : null,

    contributesToMetric: data.contributesToMetric === true,

    metricValue:
      typeof data.metricValue === "number" ? data.metricValue : null,

    metricUnit:
      typeof data.metricUnit === "string" ? data.metricUnit : null,

    firstCompletedAtMs:
      typeof data.firstCompletedAtMs === "number"
        ? data.firstCompletedAtMs
        : null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : Date.now(),

    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
});
          console.log(
  "TODAY subtasks loaded",
  g.id,
  list.length,
  list.map((s: any) => ({
    id: s.id,
    title: s.title,
    frequency: s.frequency,
    dueAtMs: s.dueAtMs ?? null,
    weeklyDay: s.weeklyDay ?? null,
  }))
);
          setSubtasksByGoal((prev) => ({ ...prev, [g.id]: list }));
          setReadySubtaskGoalIds((prev) => new Set(prev).add(g.id));
        },
        (err) => {
          console.error(err);
          setReadySubtaskGoalIds((prev) => new Set(prev).add(g.id));
          setTodayDataError("Today couldn’t load all of your tasks. Please try again later.");
        }
      );
    });

    return () => {
      // on unmount, clean all
      Object.values(existing).forEach((fn) => fn?.());
      subtasksUnsubsRef.current = {};
    };
 }, [visibleGoals, user?.uid]);

useEffect(() => {
  if (!authReady) return;

  const uid = user?.uid ?? null;
  if (!uid) {
    setCompletionSnapshotsByKey({});
    setCompletionsReady(true);
    return;
  }

  const dayKey = dayKeyFromMs(Date.now(), getUserTz());

  const q = query(
    collectionGroup(db, "completions"),
    where("userId", "==", uid),
    where("dayKey", "==", dayKey)
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const next: Record<string, DailyCompletionSnapshot> = {};

      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (!data.goalId || !data.subtaskId) return;

        const key = `${data.goalId}:${data.subtaskId}`;

        next[key] = {
          completionCount:
            typeof data.completionCount === "number"
              ? data.completionCount
              : d.exists()
              ? 1
              : null,
          completedAtMs:
            typeof data.completedAtMs === "number"
              ? data.completedAtMs
              : null,
        };
      });

      setCompletionSnapshotsByKey(next);
      setCompletionsReady(true);
    },
    (err) => {
      console.error(err);
      setCompletionsReady(true);
      setTodayDataError("Today couldn’t load completion status. Please try again later.");
    }
  );

  return () => unsub();
}, [authReady, user]);


useEffect(() => {
  if (!authReady) return;

  const uid = user?.uid ?? null;
  if (!uid) {
    setAssignedSharedGoals([]);
    setSharedGoalsReady(true);
    return;
  }

  const q = query(
    collectionGroup(db, "subtasks"),
    where("assignedToUid", "==", uid)
  );

  const unsub = onSnapshot(
    q,
    async (snap) => {
      try {
      const goalIds = Array.from(
        new Set(
          snap.docs
            .map((d) => d.ref.parent.parent?.id ?? null)
            .filter((goalId): goalId is string => !!goalId)
        )
      );

      const loadedGoals = await Promise.all(
        goalIds.map(async (goalId) => {
          const goalSnap = await getDoc(doc(db, "goals", goalId));

          if (!goalSnap.exists()) return null;

          const data = goalSnap.data() as Omit<Goal, "id">;
          const goal = { id: goalSnap.id, ...data } as Goal;

          if (goal.userId === uid) return null;
          if (goal.visibility !== "group_shared") return null;

          return goal;
        })
      );

      setAssignedSharedGoals(
        loadedGoals.filter((goal): goal is Goal => goal != null)
      );
      setSharedGoalsReady(true);
      } catch (err) {
        console.error(err);
        setSharedGoalsReady(true);
        setTodayDataError("Today couldn’t load assigned shared work. Please try again later.");
      }
    },
    (err) => {
      console.error(err);
      setSharedGoalsReady(true);
      setTodayDataError("Today couldn’t load assigned shared work. Please try again later.");
    }
  );

  return () => unsub();
}, [authReady, user]);

const initialTodayDataSettled =
  personalGoalsReady &&
  sharedGoalsReady &&
  completionsReady &&
  visibleGoals.every((goal) => readySubtaskGoalIds.has(goal.id));

useEffect(() => {
  if (initialTodayDataSettled && !todayDataError) {
    setHasEstablishedTodayData(true);
  }
}, [initialTodayDataSettled, todayDataError]);

useEffect(() => {
  if (
    Platform.OS === "android" &&
    UIManager.setLayoutAnimationEnabledExperimental
  ) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}, []);



const todayItems: TodayItem[] = useMemo(() => {
  const result: TodayItem[] = [];
 const dayKey = dayKeyFromMs(Date.now(), getUserTz());
  const { start, end } = dayRangeMs();

   const uid = user?.uid ?? null;

  for (const g of visibleGoals) {
    if (g.status === "completed") continue;

    const subs = subtasksByGoal[g.id] ?? [];

    for (const s of subs) {
            const isSharedAssigned =
        g.userId !== uid &&
        g.visibility === "group_shared" &&
        s.assignedToUid === uid;

      if (g.userId !== uid && !isSharedAssigned) continue;
      if (!isDueToday(s, dayKey)) continue;

      const completionKey = `${g.id}:${s.id}`;
      const completionSnapshot = completionSnapshotsByKey[completionKey] ?? null;
      const completionCountToday = completionSnapshot?.completionCount ?? 0;

      const isCompletedToday =
        s.completionMode === "count"
          ? typeof s.targetCount === "number" &&
            completionCountToday >= s.targetCount
          : completionSnapshot != null;

      const isInProgress =
        s.completionMode === "count" &&
        !isCompletedToday &&
        completionCountToday > 0;

      const isScheduledToday =
        typeof s.dueAtMs === "number" &&
        s.dueAtMs >= start &&
        s.dueAtMs < end;

      const needsAttention =
        !isCompletedToday &&
        !isInProgress &&
        !isScheduledToday &&
        (s.scheduleType === "oneTime" || s.frequency === "once");

      result.push({
        goalId: g.id,
        goalTitle: g.title,
        goalStatus: g.status,

        subtaskId: s.id,
        title: s.title,
        description: s.description ?? null,

        scheduleType: s.scheduleType,
        frequency: s.frequency ?? "once",
        weeklyDay: s.weeklyDay ?? null,
        scheduledDayKey: s.scheduledDayKey ?? null,
        dueAtMs: s.dueAtMs ?? null,

        completionMode: s.completionMode ?? "binary",
        targetCount: s.targetCount ?? null,
        completionCountToday,
        isCompletedToday,

        contributesToMetric: s.contributesToMetric === true,
        metricValue:
          typeof s.metricValue === "number" ? s.metricValue : null,
        metricUnit: s.metricUnit ?? null,

        isInProgress,
        isScheduledToday,
        needsAttention,
        isSharedAssigned,
        assignedToUid: s.assignedToUid ?? null,
      });
    }
  }

  result.sort(
    (a, b) =>
      Number(a.dueAtMs ?? 0) - Number(b.dueAtMs ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return result;
}, [visibleGoals, subtasksByGoal, completionSnapshotsByKey, user?.uid]);



const todayDecisionItems = useMemo<HomeTaskItem[]>(() => {
  return todayItems.map((item) => ({
    goalId: item.goalId,
    subtaskId: item.subtaskId,
    goalTitle: item.goalTitle,
    title: item.title,
    dueAtMs: item.dueAtMs,
    isCompletedToday: item.isCompletedToday,
    frequency: item.frequency,
    weeklyDay: item.weeklyDay,
    scheduledDayKey: item.scheduledDayKey,
    todayKey: dayKeyFromMs(Date.now(), getUserTz()),
  }));
}, [todayItems]);

const todayNowDecision = useMemo<NowDecision>(() => {
  return getNowDecision(todayDecisionItems, Date.now());
}, [todayDecisionItems]);

const sharedNowItem = useMemo(() => {
  return findTodayItemForDecision(todayNowDecision, todayItems);
}, [todayNowDecision, todayItems]);

const inProgressItems = useMemo(
  () => todayItems.filter((t) => t.isInProgress && !t.isCompletedToday),
  [todayItems]
);

const completedTodayItems = useMemo(
  () => todayItems.filter((t) => t.isCompletedToday),
  [todayItems]
);

const dueTodayItems = useMemo(
  () =>
    todayItems.filter(
      (t) =>
        !t.isCompletedToday &&
        !t.isInProgress &&
        !t.needsAttention
    ),
  [todayItems]
);

const needsAttentionItems = useMemo(
  () => todayItems.filter((t) => t.needsAttention && !t.isCompletedToday),
  [todayItems]
);

const unscheduledItems = useMemo(
  () =>
    todayItems.filter(
      (t) =>
        !t.isCompletedToday &&
        !t.isInProgress &&
        typeof t.dueAtMs !== "number"
    ),
  [todayItems]
);



const featuredTodayKeys = useMemo(() => {
  const keys = new Set<string>();

  if (sharedNowItem) {
    keys.add(getTodayItemKey(sharedNowItem));
  }

  return keys;
}, [sharedNowItem]);



const visibleInProgressItems = useMemo(
  () =>
    inProgressItems.filter(
      (t) => !featuredTodayKeys.has(getTodayItemKey(t))
    ),
  [inProgressItems, featuredTodayKeys]
);



const visibleUnscheduledItems = useMemo(
  () =>
    unscheduledItems.filter(
      (t) => !featuredTodayKeys.has(getTodayItemKey(t))
    ),
  [unscheduledItems, featuredTodayKeys]
);


const agendaItems = useMemo(
  () =>
    todayItems
      .filter(
        (t) =>
          !t.isCompletedToday &&
          typeof t.dueAtMs === "number" &&
          !featuredTodayKeys.has(getTodayItemKey(t))
      )
      .sort((a, b) => Number(a.dueAtMs ?? 0) - Number(b.dueAtMs ?? 0)),
  [todayItems, featuredTodayKeys]
);

const occupiedScheduleWindows = useMemo(
  () =>
    agendaItems
      .filter((item) => typeof item.dueAtMs === "number")
      .map((item) => ({
        startMs: Number(item.dueAtMs),
        endMs: Number(item.dueAtMs) + DEFAULT_TASK_DURATION_MS,
      })),
  [agendaItems]
);

 const toggle = async (item: TodayItem) => {
   const uid = auth.currentUser?.uid;
  if (!uid) {
    Alert.alert("Not signed in");
    return;
  }

  const dayKey = dayKeyFromMs(Date.now(), getUserTz());

  const key = getTodayItemKey(item);
  if (pendingCompletionIdsRef.current.has(key)) return;
  pendingCompletionIdsRef.current.add(key);

  setPendingIds((prev) => new Set(prev).add(key));

  try {
    const result = await toggleSubtaskCompletedTx(
      item.goalId,
      item.subtaskId,
      dayKey,
      uid
    );
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (result.changed && result.action === "undo") {
      void hapticSelection();
    } else if (
      result.changed &&
      (result.action === "complete" || result.action === "increment")
    ) {
      void hapticSuccess();
    }
  } catch (e: any) {
    console.error(e);
    void hapticError();
    Alert.alert("Update failed", e?.message ?? "Unknown error");
  } finally {
    pendingCompletionIdsRef.current.delete(key);
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }
};

const canScheduleTodayItem = (item: TodayItem): boolean => {
  return (
    !item.isSharedAssigned ||
    item.assignedToUid === auth.currentUser?.uid
  );
};
const assignExactTime = async (item: TodayItem, targetMs: number): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    Alert.alert("Not signed in");
    return false;
  }

  try {
    const previousDueAtMs = item.dueAtMs ?? null;
    const previousScheduledDayKey = item.scheduledDayKey ?? null;
    const target = new Date(targetMs);

await updateDoc(doc(db, "goals", item.goalId, "subtasks", item.subtaskId), {
  dueAtMs: targetMs,
  scheduledDayKey: dayKeyFromDate(target, getUserTz()),
  updatedAt: serverTimestamp(),
});

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLastScheduleChange({
      item,
      previousDueAtMs,
      previousScheduledDayKey,
      message: `Planned "${item.title}" for ${formatScheduleFeedbackTime(targetMs)}.`,
    });
    return true;
  } catch (e: any) {
    console.error(e);
    void hapticError();
    Alert.alert("Schedule failed", e?.message ?? "Unknown error");
    return false;
  }
};



const unscheduleItem = async (item: TodayItem): Promise<boolean> => {
  try {

    const previousDueAtMs = item.dueAtMs ?? null;
const previousScheduledDayKey = item.scheduledDayKey ?? null;
await updateDoc(doc(db, "goals", item.goalId, "subtasks", item.subtaskId), {
  dueAtMs: null,
  scheduledDayKey:
    item.scheduleType === "oneTime" ? item.scheduledDayKey : null,
  updatedAt: serverTimestamp(),
});

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLastScheduleChange({
  item,
  previousDueAtMs,
  previousScheduledDayKey,
  message: `"${item.title}" moved back to Needs a time.`,
});
    return true;
  } catch (e: any) {
    console.error(e);
    void hapticError();
    Alert.alert("Unschedule failed", e?.message ?? "Unknown error");
    return false;
  }
};

const undoLastScheduleChange = async () => {
  if (!lastScheduleChange || undoScheduleLockRef.current) return;

  const { item, previousDueAtMs, previousScheduledDayKey } = lastScheduleChange;

  undoScheduleLockRef.current = true;
  setUndoingSchedule(true);
  try {
await updateDoc(doc(db, "goals", item.goalId, "subtasks", item.subtaskId), {
  dueAtMs: previousDueAtMs,
  scheduledDayKey: previousScheduledDayKey,
  updatedAt: serverTimestamp(),
});

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLastScheduleChange(null);
    void hapticSelection();
  } catch (e: any) {
    console.error(e);
    void hapticError();
    Alert.alert("Undo failed", e?.message ?? "Unknown error");
  } finally {
    undoScheduleLockRef.current = false;
    setUndoingSchedule(false);
  }
};



const DEFAULT_TASK_DURATION_MS = 60 * 60 * 1000;
const SLOT_SHIFT_MS = 30 * 60 * 1000;

function roundUpToNextHour(date: Date): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function makeLocalDateAt(dayOffset: number, hour: number, minute = 0): Date {
  const base = new Date();

  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hour,
    minute,
    0,
    0
  );
}

function formatQuickScheduleLabel(date: Date): string {
  const now = new Date();
const tz = getUserTz();
const todayKey = dayKeyFromDate(now, tz);
const targetKey = dayKeyFromDate(date, tz);

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (targetKey === todayKey) {
    return `Today at ${time}`;
  }

  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );

 if (targetKey === dayKeyFromDate(tomorrow, tz)) {
    return `Tomorrow at ${time}`;
  }

  return `${date.toLocaleDateString()} at ${time}`;
}

function doesWindowOverlap(
  startMs: number,
  endMs: number,
  windows: { startMs: number; endMs: number }[]
): boolean {
  return windows.some((w) => startMs < w.endMs && endMs > w.startMs);
}

function shiftToOpenSlot(
  preferred: Date,
  occupiedWindows: { startMs: number; endMs: number }[],
  maxShifts = 8
): Date | null {
  let candidate = new Date(preferred);

  for (let i = 0; i <= maxShifts; i += 1) {
    const startMs = candidate.getTime();
    const endMs = startMs + DEFAULT_TASK_DURATION_MS;

    if (
      startMs > Date.now() &&
      !doesWindowOverlap(startMs, endMs, occupiedWindows)
    ) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() + SLOT_SHIFT_MS);
  }

  return null;
}

function getPlannerPriority(item: TodayItem): "high" | "normal" {
  if (item.isInProgress) return "high";
  if (item.needsAttention) return "high";
  if (item.scheduleType === "oneTime") return "high";

  if (
    item.completionMode === "count" &&
    item.completionCountToday > 0 &&
    !item.isCompletedToday
  ) {
    return "high";
  }

  return "normal";
}

function getPlannerDecisionReason(
  item: TodayItem,
  optionId: QuickScheduleOption["id"]
): string {
  if (optionId === "next_opening") {
    if (item.isInProgress) {
      return "This is the next open slot because you already started this task.";
    }

    if (item.needsAttention) {
      return "This is the next open slot because this task needs attention today.";
    }

    if (item.scheduleType === "oneTime") {
      return "This is the next open slot because one-time tasks should stay visible.";
    }

    return "This is the next open slot in your schedule.";
  }

  if (optionId === "evening") {
    return "This gives the task a simple evening slot.";
  }

  if (optionId === "tomorrow_morning") {
    return "This moves the task to a clear morning slot tomorrow.";
  }

  return "This time was selected from your available schedule.";
}

function getPlannerBadges(item: TodayItem): string[] {
  const badges: string[] = [];

  if (getPlannerPriority(item) === "high") {
    badges.push("High priority");
  }

  if (item.isInProgress) {
    badges.push("In progress");
  }

  if (item.needsAttention) {
    badges.push("Needs attention");
  }

  if (item.scheduleType === "oneTime") {
    badges.push("One-time");
  }

  if (
    item.completionMode === "count" &&
    item.completionCountToday > 0 &&
    !item.isCompletedToday
  ) {
    badges.push("Count progress");
  }

  return badges;
}

function getPlannerTrustMessage(item: TodayItem): string | null {
  if (item.isInProgress) {
    return "Already started — keeping this easy to resume.";
  }

  if (item.needsAttention) {
    return "Needs a time so it does not get lost today.";
  }

  if (item.scheduleType === "oneTime") {
    return "One-time task — give it a clear spot.";
  }

  if (
    item.completionMode === "count" &&
    item.completionCountToday > 0 &&
    !item.isCompletedToday
  ) {
    return "Partly done — schedule time to finish it.";
  }

  return null;
}

function getSimpleQuickPlanOptions(item: TodayItem): QuickScheduleOption[] {
  const now = new Date();

  const todayEvening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    18,
    0,
    0,
    0
  );

  if (todayEvening.getTime() <= now.getTime()) {
    todayEvening.setDate(todayEvening.getDate() + 1);
  }

  const tomorrowMorning = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    9,
    0,
    0,
    0
  );

  return [
    {
      id: "evening",
      label: "Today evening",
      targetMs: todayEvening.getTime(),
      metaLabel: "simple plan",
      reasonLabel: "A quick default time to give this task a spot.",
    },
    {
      id: "tomorrow_morning",
      label: "Tomorrow morning",
      targetMs: tomorrowMorning.getTime(),
      metaLabel: "safe fallback",
      reasonLabel: "A safe fallback if today is already full.",
    },
  ];
}

function filterDuplicateSmartOptions(
  simpleOptions: QuickScheduleOption[],
  smartOptions: QuickScheduleOption[]
): QuickScheduleOption[] {
  const simpleTargetKeys = new Set(
    simpleOptions.map((option) => {
      const d = new Date(option.targetMs);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    })
  );

  return smartOptions.filter((option) => {
    const d = new Date(option.targetMs);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;

    return !simpleTargetKeys.has(key);
  });
}

function getSmartQuickScheduleOptions(
  item: TodayItem,
  occupiedWindows: { startMs: number; endMs: number }[]
): QuickScheduleOption[] {
  const now = new Date();

  const priority = getPlannerPriority(item);

  const preferredSlots =
  priority === "high"
    ? [
        {
          id: "next_opening" as const,
          preferred: roundUpToNextHour(now),
          metaLabel: "next open slot",
        },
        {
          id: "evening" as const,
          preferred: makeLocalDateAt(0, 19),
          metaLabel: "evening slot",
        },
        {
          id: "tomorrow_morning" as const,
          preferred: makeLocalDateAt(1, 9),
          metaLabel: "tomorrow slot",
        },
      ]
    : [
        {
          id: "evening" as const,
          preferred: makeLocalDateAt(0, 19),
          metaLabel: "evening slot",
        },
        {
          id: "next_opening" as const,
          preferred: roundUpToNextHour(now),
          metaLabel: "next open slot",
        },
        {
          id: "tomorrow_morning" as const,
          preferred: makeLocalDateAt(1, 9),
          metaLabel: "tomorrow slot",
        },
      ];

  const options: QuickScheduleOption[] = [];
  const seen = new Set<number>();

  for (const slot of preferredSlots) {
    const shifted = shiftToOpenSlot(slot.preferred, occupiedWindows);

    if (!shifted) continue;

    const targetMs = shifted.getTime();

    if (seen.has(targetMs)) continue;

    seen.add(targetMs);

    options.push({
  id: slot.id,
  label: formatQuickScheduleLabel(shifted),
  targetMs,
  metaLabel: slot.metaLabel,
  reasonLabel: getPlannerDecisionReason(item, slot.id),
});
  }

  return options;
}

function addPlannerHistory(message: string) {
  setPlannerHistory((prev) => [
    {
      id: `${Date.now()}:${Math.random()}`,
      message,
      createdAtMs: Date.now(),
    },
    ...prev,
  ].slice(0, 3));
}





const requestSmartScheduleChange = (item: TodayItem, option: QuickScheduleOption) => {
  setScheduleConfirmTarget({
    item,
    preset:
      option.id === "evening"
        ? "tonight"
        : option.id === "tomorrow_morning"
        ? "tomorrow_morning"
        : "later_today",
    targetMs: option.targetMs,
    label: option.label,
    reasonLabel: option.reasonLabel ?? null,
  });
};

const confirmScheduleChange = async () => {
  if (!scheduleConfirmTarget) return;

  const target = scheduleConfirmTarget;
  const itemKey = getTodayItemKey(target.item);
  if (scheduleMutationLockRef.current) return;
  scheduleMutationLockRef.current = itemKey;
  setPendingScheduleItemKey(itemKey);

  try {
    if (target.preset === "unschedule") {
      const succeeded = await unscheduleItem(target.item);
      if (!succeeded) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      addPlannerHistory(`${target.item.title} moved back to Needs a time.`);
      setScheduleConfirmTarget(null);
      void hapticSuccess();
      return;
    }

    if (typeof target.targetMs === "number") {
      const succeeded = await assignExactTime(target.item, target.targetMs);
      if (!succeeded) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      addPlannerHistory(
        `Planned ${target.item.title} for ${formatScheduleFeedbackTime(target.targetMs)}.`
      );
      setScheduleConfirmTarget(null);
      void hapticSuccess();
    }
  } finally {
    scheduleMutationLockRef.current = null;
    setPendingScheduleItemKey(null);
  }
};

const renderNowNextCard = (
  decision: NowDecision,
  item: TodayItem | null
) => {
  const label = getTodayDecisionCardLabel(decision);
 if (!item) {
  return (
    <View
      style={[
  styles.nowNextCard,
  getTodayDecisionCardStyle(decision, styles),
]}
    >
      <Text style={styles.nowNextLabel}>{label}</Text>
      <Text style={styles.nowNextTitle}>Nothing urgent — pick anything 👍</Text>
    </View>
  );
}

  const key = `${item.goalId}:${item.subtaskId}`;
  const pending = pendingIds.has(key);

  return (
    <View
  style={[
  styles.nowNextCard,
  getTodayDecisionCardStyle(decision, styles),
]}
>
      <Text style={styles.nowNextLabel}>{label}</Text>

      <Link
        href={{ pathname: "/goal/[id]", params: { id: item.goalId } }}
        asChild
      >
        <Pressable>
          <Text style={styles.nowNextGoal}>{item.goalTitle}</Text>
<Text style={styles.nowNextTitle}>{item.title}</Text>

{item.isSharedAssigned ? (
  <Text style={styles.sharedBadge}>Shared • Assigned to me</Text>
) : null}

{!!item.description && (
            <Text style={styles.nowNextDescription}>{item.description}</Text>
          )}

          <Text style={styles.rowMeta}>
            {item.scheduleType === "oneTime"
              ? "one time"
              : item.frequency === "daily"
              ? "daily"
              : item.frequency === "weekly"
              ? "weekly"
              : "once"}

            {typeof item.dueAtMs === "number"
              ? ` • ${new Date(item.dueAtMs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </Text>

          {item.completionMode === "count" && (
            <Text style={styles.rowMeta}>
              {item.completionCountToday}/{item.targetCount ?? "?"}
            </Text>
          )}
        </Pressable>
      </Link>

{decision.type === "needs_time" && canScheduleTodayItem(item) && (
  <>
    <Text style={styles.quickPlanPrompt}>Quick plan</Text>

    <View style={styles.simpleQuickPlanRow}>
      {getSimpleQuickPlanOptions(item).map((option) => (
        <Pressable
          key={option.id}
          onPress={() => requestSmartScheduleChange(item, option)}
          style={({ pressed }) => [
            styles.simpleQuickPlanPill,
            pressed && styles.pillPressed,
          ]}
        >
          <Text style={styles.simpleQuickPlanText}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  </>
)}

      {decision.type !== "needs_time" && (
  <Pressable
    onPress={() => toggle(item)}
    disabled={pending}
    style={({ pressed }) => [
      styles.actionBtn,
      { marginTop: 12, alignSelf: "stretch" },
      pressed && styles.actionPressed,
      pending && { opacity: 0.5 },
    ]}
    accessibilityRole="button"
    accessibilityLabel={getActionAccessibilityLabel(item)}
    accessibilityState={{ disabled: pending, busy: pending }}
  >
    <Text style={styles.actionText}>
      {pending ? getPendingActionLabel(item) : getActionLabel(item)}
    </Text>
  </Pressable>
)}
    </View>
  );
};

const renderUnscheduledSection = (items: TodayItem[]) => {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>Needs a time</Text>
     <Text style={styles.sectionIntro}>
  Give these tasks a spot in your day so they can move into your schedule.
</Text>

      {items.length === 0 ? (
        <View style={styles.emptyInlineCard}>
  <Text style={styles.emptyInlineTitle}>Everything has a spot 👍</Text>
<Text style={styles.emptyInlineText}>
  Tasks without a time will appear here when they need planning.
</Text>
</View>
      ) : (
        items.map((t) => {
          const key = `${t.goalId}:${t.subtaskId}`;
          const pending = pendingIds.has(key);
          const simpleQuickPlanOptions = getSimpleQuickPlanOptions(t);
const smartOptions = filterDuplicateSmartOptions(
  simpleQuickPlanOptions,
  getSmartQuickScheduleOptions(t, occupiedScheduleWindows)
);
          const badges = getPlannerBadges(t);
          const trustMessage = getPlannerTrustMessage(t);
          //const quickPresets = getAvailableQuickSchedulePresets();

          return (
            <View key={key} style={styles.card}>
              <Link
                href={{ pathname: "/goal/[id]", params: { id: t.goalId } }}
                asChild
              >
                <Pressable>
                  <Text style={styles.goalTitle}>{t.goalTitle}</Text>
                </Pressable>
              </Link>

<View style={styles.taskCardBody}>
  <Text style={styles.rowText}>{t.title}</Text>

  {t.isSharedAssigned ? (
    <Text style={styles.sharedBadge}>Shared • Assigned to me</Text>
  ) : null}

    {badges.length > 0 && (
  <View style={styles.badgeRow}>
    {badges.map((badge) => (
      <Text key={badge} style={styles.priorityBadge}>
        {badge}
      </Text>
    ))}

    
  </View>
)}

{!!trustMessage && (
  <Text style={styles.trustMessage}>{trustMessage}</Text>
)}

    {!!t.description && (
      <Text style={styles.rowMeta}>{t.description}</Text>
    )}

    <Text style={styles.rowMeta}>
      {t.scheduleType === "oneTime"
        ? "one time"
        : t.frequency === "daily"
        ? "daily"
        : t.frequency === "weekly"
        ? "weekly"
        : "once"}{" "}
      • no time assigned
    </Text>

    {t.completionMode === "count" && (
      <Text style={styles.rowMeta}>
        {t.completionCountToday}/{t.targetCount ?? "?"}
      </Text>
    )}

{canScheduleTodayItem(t) ? (
  <>
    <Text style={styles.quickPlanPrompt}>Quick plan</Text>

    <View style={styles.simpleQuickPlanRow}>
      {simpleQuickPlanOptions.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => requestSmartScheduleChange(t, option)}
          style={({ pressed }) => [
            styles.simpleQuickPlanPill,
            pressed && styles.pillPressed,
          ]}
        >
          <Text style={styles.simpleQuickPlanText}>{option.label}</Text>
        </Pressable>
      ))}
    </View>

    <Text style={styles.smartPlanPrompt}>Smart suggestions</Text>

    <View style={styles.quickActionRow}>
      {smartOptions.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => requestSmartScheduleChange(t, option)}
          style={({ pressed }) => [
            styles.quickActionPill,
            pressed && styles.pillPressed,
          ]}
        >
          <Text style={styles.quickActionText}>{option.label}</Text>
        </Pressable>
      ))}

      {smartOptions.length === 0 && (
        <Text style={styles.rowMeta}>
          No smart openings found right now. You can still use Quick plan.
        </Text>
      )}
    </View>
  </>
) : (
  <Text style={styles.rowMeta}>
    You can only schedule shared work assigned to you.
  </Text>
)}
              </View>

              <View style={styles.taskCardFooter}>
                <Pressable
                  onPress={() => toggle(t)}
                  disabled={pending}
                  style={({ pressed }) => [
                    styles.fullWidthActionBtn,
                    pressed && styles.actionPressed,
                    pending && { opacity: 0.5 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={getActionAccessibilityLabel(t)}
                  accessibilityState={{ disabled: pending, busy: pending }}
                >
                  <Text style={styles.actionText}>
                    {pending ? getPendingActionLabel(t) : getActionLabel(t)}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
};

const renderAgendaSection = (items: TodayItem[]) => {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>Agenda</Text>
<Text style={styles.sectionIntro}>
  Timed tasks that still need your attention today.
</Text>

      {items.length === 0 ? (
        <View style={styles.emptyInlineCard}>
<Text style={styles.emptyInlineTitle}>No scheduled tasks left.</Text>
<Text style={styles.emptyInlineText}>
  Your timed tasks are clear for now. Plan a task or keep going from the top card.
</Text>
</View>
      ) : (
        items.map((t) => {
          const key = `${t.goalId}:${t.subtaskId}`;
          const pending = pendingIds.has(key);
          const smartOptions = getSmartQuickScheduleOptions(t, occupiedScheduleWindows);
          const badges = getPlannerBadges(t);
          const trustMessage = getPlannerTrustMessage(t);
          //const quickPresets = getAvailableQuickSchedulePresets();

          return (
            <View key={key} style={styles.card}>
              <Link
                href={{ pathname: "/goal/[id]", params: { id: t.goalId } }}
                asChild
              >
                <Pressable>
                  <Text style={styles.goalTitle}>{t.goalTitle}</Text>
                </Pressable>
              </Link>

                            <View style={styles.taskCardBody}>
                <Text style={styles.agendaTime}>
                    {typeof t.dueAtMs === "number"
                      ? new Date(t.dueAtMs).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : ""}
                  </Text>

<Text style={styles.rowText}>{t.title}</Text>

{t.isSharedAssigned ? (
  <Text style={styles.sharedBadge}>Shared • Assigned to me</Text>
) : null}

{badges.length > 0 && (
  <View style={styles.badgeRow}>
    {badges.map((badge) => (
      <Text key={badge} style={styles.priorityBadge}>
        {badge}
      </Text>
    ))}


  </View>
)}

{!!trustMessage && (
  <Text style={styles.trustMessage}>{trustMessage}</Text>
)}

                  {!!t.description && (
                    <Text style={styles.rowMeta}>{t.description}</Text>
                  )}

                  <Text style={styles.rowMeta}>
                    {t.scheduleType === "oneTime"
                      ? "one time"
                      : t.frequency === "daily"
                      ? "daily"
                      : t.frequency === "weekly"
                      ? "weekly"
                      : "once"}
                  </Text>
{canScheduleTodayItem(t) ? (
  <View style={styles.quickActionRow}>
    {smartOptions.map((option) => (
      <Pressable
        key={option.id}
        onPress={() => requestSmartScheduleChange(t, option)}
        style={({ pressed }) => [
          styles.quickActionPill,
          pressed && styles.pillPressed,
        ]}
      >
        <Text style={styles.quickActionText}>{option.label}</Text>
      </Pressable>
    ))}

    {smartOptions.length === 0 && (
      <Text style={styles.rowMeta}>No open quick slots right now.</Text>
    )}

    <Pressable
      onPress={() =>
        setScheduleConfirmTarget({
          item: t,
          preset: "unschedule",
          targetMs: null,
          label: "Remove scheduled time",
          reasonLabel:
            "This removes the scheduled time and sends the task back to Needs a time.",
        })
      }
      style={({ pressed }) => [
        styles.quickActionPill,
        styles.quickActionPillMuted,
        pressed && styles.pillPressed,
      ]}
    >
      <Text style={[styles.quickActionText, styles.quickActionTextMuted]}>
        Unschedule
      </Text>
    </Pressable>
  </View>
) : (
  <Text style={styles.rowMeta}>
    You can only schedule shared work assigned to you.
  </Text>
)}
                              </View>

              <View style={styles.taskCardFooter}>
                <Pressable
                  onPress={() => toggle(t)}
                  disabled={pending}
                  style={({ pressed }) => [
                    styles.fullWidthActionBtn,
                    pressed && styles.actionPressed,
                    pending && { opacity: 0.5 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={getActionAccessibilityLabel(t)}
                  accessibilityState={{ disabled: pending, busy: pending }}
                >
                  <Text style={styles.actionText}>
                    {pending ? getPendingActionLabel(t) : getActionLabel(t)}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
};

const renderSection = (title: string, items: TodayItem[]) => {
  if (!items.length) {
  if (title === "Unscheduled") {
    return (
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.muted}>
          Nothing needs a time right now 👍
        </Text>
      </View>
    );
  }

  if (title === "Needs Attention") {
    return (
     <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.emptyText}>Nothing needs attention 👍</Text>
      </View>
    );
  }

  return null;
}

  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>

      {items.map((t) => {
        const key = `${t.goalId}:${t.subtaskId}`;
        const pending = pendingIds.has(key);

        return (
          <View key={key} style={styles.card}>
            <Link
              href={{ pathname: "/goal/[id]", params: { id: t.goalId } }}
              asChild
            >
              <Pressable>
                <Text style={styles.goalTitle}>{t.goalTitle}</Text>
              </Pressable>
            </Link>

<View style={styles.taskCardBody}>
  <Text style={styles.rowText}>{t.title}</Text>

  {t.isSharedAssigned ? (
    <Text style={styles.sharedBadge}>Shared • Assigned to me</Text>
  ) : null}

  <Text style={styles.rowMeta}>
  {t.scheduleType === "oneTime"
    ? "one time"
    : t.frequency === "daily"
    ? "daily"
    : t.frequency === "weekly"
    ? "weekly"
    : "once"}

  {typeof t.dueAtMs === "number"
    ? ` • ${new Date(t.dueAtMs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : ` • no time assigned`}
</Text>

                {t.completionMode === "count" && (
                  <Text style={styles.rowMeta}>
                    {t.completionCountToday}/{t.targetCount ?? "?"}
                  </Text>
                )}
            </View>

            <View style={styles.taskCardFooter}>
              <Pressable
                onPress={() => toggle(t)}
                disabled={pending}
                style={({ pressed }) => [
                  styles.fullWidthActionBtn,
                  pressed && styles.actionPressed,
                  pending && { opacity: 0.5 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={getActionAccessibilityLabel(t)}
                accessibilityState={{ disabled: pending, busy: pending }}
              >
                <Text style={styles.actionText}>
                  {pending ? getPendingActionLabel(t) : getActionLabel(t)}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
};

  if (!authReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Today</Text>
        <Text style={styles.muted}>Loading account…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Today</Text>
        <Text style={styles.muted}>Sign in on Settings to see your tasks.</Text>
      </View>
    );
  }

  if (!hasEstablishedTodayData) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Today</Text>
        <Text style={styles.subtitle}>
          Start with your top action, then work through your agenda.
        </Text>
        {todayDataError ? (
          <View accessibilityRole="alert" style={styles.todayDataErrorCard}>
            <Text style={styles.todayDataErrorTitle}>Today is unavailable</Text>
            <Text style={styles.todayDataErrorText}>{todayDataError}</Text>
          </View>
        ) : (
          <View
            accessibilityLabel="Loading today’s tasks"
            style={styles.emptyPlannerCard}
          >
            <Text style={styles.emptyPlannerTitle}>Getting Today ready…</Text>
            <Text style={styles.emptyPlannerText}>
              Loading your tasks and completion status.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  const scheduleMutationPending =
    !!scheduleConfirmTarget &&
    pendingScheduleItemKey === getTodayItemKey(scheduleConfirmTarget.item);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Today</Text>

<Text style={styles.subtitle}>
  Start with your top action, then work through your agenda.
</Text>

<PlannerContextPreview ownerUid={user.uid} theme={theme} />

{todayDataError ? (
  <View accessibilityRole="alert" style={styles.todayDataErrorCard}>
    <Text style={styles.todayDataErrorTitle}>Some Today data couldn’t refresh</Text>
    <Text style={styles.todayDataErrorText}>
      Your last available tasks are still shown below.
    </Text>
  </View>
) : null}



     <Modal
  visible={!!scheduleConfirmTarget}
  transparent
  animationType="fade"
  onRequestClose={() => {
    if (!scheduleMutationPending) setScheduleConfirmTarget(null);
  }}
>
  <View style={styles.confirmModalBackdrop}>
    <View style={styles.confirmCard}>
      <Text style={styles.confirmTitle}>
        {scheduleConfirmTarget?.preset === "unschedule"
          ? "Remove scheduled time?"
          : "Schedule this task?"}
      </Text>

      <Text style={styles.confirmText}>
        {scheduleConfirmTarget?.item.title}
      </Text>

     <Text style={styles.confirmMeta}>
  {scheduleConfirmTarget?.preset === "unschedule"
    ? "Move back to Needs a time"
    : scheduleConfirmTarget?.label}
</Text>

      {!!scheduleConfirmTarget?.reasonLabel && (
  <>
    <Text style={styles.confirmReasonTitle}>
  Why this time?
</Text>
    <Text style={styles.confirmText}>
      {scheduleConfirmTarget.reasonLabel}
    </Text>
  </>
)}

      <View style={styles.confirmRow}>
        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            styles.confirmCancel,
            pressed && styles.actionPressed,
            scheduleMutationPending && styles.actionDisabled,
          ]}
          onPress={() => setScheduleConfirmTarget(null)}
          disabled={scheduleMutationPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: scheduleMutationPending }}
        >
          <Text style={styles.confirmBtnText}>Cancel</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            styles.confirmPrimary,
            pressed && styles.actionPressed,
            scheduleMutationPending && styles.actionDisabled,
          ]}
          onPress={confirmScheduleChange}
          disabled={scheduleMutationPending}
          accessibilityRole="button"
          accessibilityLabel={
            scheduleConfirmTarget?.preset === "unschedule"
              ? "Remove scheduled time"
              : "Schedule task"
          }
          accessibilityState={{
            disabled: scheduleMutationPending,
            busy: scheduleMutationPending,
          }}
        >
          <Text style={[styles.confirmBtnText, styles.confirmPrimaryText]}>
            {scheduleMutationPending
              ? scheduleConfirmTarget?.preset === "unschedule"
                ? "Unscheduling…"
                : "Scheduling…"
              : scheduleConfirmTarget?.preset === "unschedule"
              ? "Remove"
              : "Schedule"}
          </Text>
        </Pressable>
      </View>
    </View>
  </View>
</Modal>

{lastScheduleChange && (
  <View style={styles.undoBanner}>
    <Text style={styles.undoText}>{lastScheduleChange.message}</Text>

    <Pressable
      onPress={undoLastScheduleChange}
      disabled={undoingSchedule}
      style={({ pressed }) => [
        styles.undoBtn,
        pressed && styles.actionPressed,
        undoingSchedule && styles.actionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Undo last schedule change"
      accessibilityState={{ disabled: undoingSchedule, busy: undoingSchedule }}
    >
      <Text style={styles.undoBtnText}>
        {undoingSchedule ? "Undoing…" : "Undo"}
      </Text>
    </Pressable>
  </View>
)}

{integratedGroupCalendar.events.length > 0 ||
integratedGroupCalendar.loading ||
integratedGroupCalendar.partialError ? (
  <View style={styles.groupEventsSection}>
    <Text style={styles.sectionTitle}>Today’s group events</Text>
    {integratedGroupCalendar.loading ? (
      <Text style={styles.muted}>Loading group events…</Text>
    ) : null}
    {integratedGroupCalendar.partialError ? (
      <Text style={styles.muted}>Some group events couldn’t be loaded.</Text>
    ) : null}
    {integratedGroupCalendar.events.map((item) => (
      <IntegratedGroupCalendarEventCard
        key={`${item.groupId}:${item.event.id}`}
        item={item}
        theme={theme}
        onPress={() =>
          router.push({
            pathname: "/group/[id]/calendar",
            params: { id: item.groupId, eventId: item.event.id },
          } as any)
        }
      />
    ))}
  </View>
) : null}
     
     {todayItems.length === 0 ? (
  <View style={styles.emptyPlannerCard}>
    <Text style={styles.emptyPlannerTitle}>Nothing needs your attention 🎉</Text>
<Text style={styles.emptyPlannerText}>
  You’re clear for today. Review your goals, plan ahead, or enjoy the breathing room.
</Text>
  </View>
) : (
  <>
{renderNowNextCard(todayNowDecision, sharedNowItem)}



<Text style={styles.summaryText}>
  {getTodayDecisionCardLabel(todayNowDecision)} ·{" "}
  {visibleUnscheduledItems.length} need time · {agendaItems.length} agenda ·{" "}
  {visibleInProgressItems.length} in progress
  
</Text>

{renderUnscheduledSection(visibleUnscheduledItems)}
{renderAgendaSection(agendaItems)}
{renderSection("In Progress", visibleInProgressItems)}

{plannerHistory.length > 0 && (
  <View style={styles.plannerHistoryCard}>
    <Text style={styles.subsectionLabel}>Recent planner activity</Text>

    {plannerHistory.map((entry) => (
      <Text key={entry.id} style={styles.helperText}>
        {entry.message}
      </Text>
    ))}
  </View>
)}


    
  <View style={styles.sectionBlock}>
    <Pressable
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setShowCompleted((v) => !v);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${showCompleted ? "Hide" : "Show"} completed tasks from today`}
      accessibilityState={{ expanded: showCompleted }}
      style={({ pressed }) => pressed && styles.sectionTogglePressed}
    >
      <Text style={styles.sectionTitle}>
        Done Today ({completedTodayItems.length}) {showCompleted ? "▲" : "▼"}
      </Text>
    </Pressable>

    {completedTodayItems.length === 0 ? (
  <View style={styles.emptyInlineCard}>
    <Text style={styles.emptyInlineTitle}>Completed tasks will appear here.</Text>
    <Text style={styles.emptyInlineText}>
      Finish a task from the top card or agenda to build momentum.
    </Text>
  </View>
) : (
  showCompleted &&
  completedTodayItems.map((t) => {
        const key = `${t.goalId}:${t.subtaskId}`;
        const pending = pendingIds.has(key);

        return (
          <View
  key={key}
  style={[
    styles.card,
    t.isCompletedToday && styles.cardCompleted,
  ]}
>
            <Text style={styles.goalTitle}>{t.goalTitle}</Text>

<View style={styles.taskCardBody}>
  <Text style={styles.rowText}>{t.title}</Text>

  {t.isSharedAssigned ? (
    <Text style={styles.sharedBadge}>Shared • Assigned to me</Text>
  ) : null}
</View>

            <View style={styles.taskCardFooter}>
              <Pressable
                onPress={() => toggle(t)}
                disabled={pending}
                style={({ pressed }) => [
                  styles.fullWidthActionBtn,
                  pressed && styles.actionPressed,
                  pending && { opacity: 0.5 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={getActionAccessibilityLabel(t)}
                accessibilityState={{ disabled: pending, busy: pending }}
              >
                <Text style={styles.actionText}>
                  {pending ? getPendingActionLabel(t) : "Undo"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
            })
)}
  </View>
  </>
)}
          
    </ScrollView>
  );
}

const makeStyles = (theme: AppThemeTokens) =>
  StyleSheet.create({
  container: {
  padding: UI_SIZES.spacing.lg,
  paddingBottom: 120,
  gap: UI_SIZES.spacing.md,
  backgroundColor: theme.colors.background,
},
  center: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  backgroundColor: theme.colors.background,
},
  title: {
  fontSize: 24,
  fontWeight: "800",
  color: theme.colors.text,
  marginBottom: 8,
},
  muted: {
  color: theme.colors.textMuted,
},

  card: {
  backgroundColor: theme.colors.surface,
  borderRadius: UI_SIZES.radius.lg,
  padding: UI_SIZES.cardPadding.md,
  marginBottom: UI_SIZES.spacing.md,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
cardCompleted: {
  opacity: 0.6,
},
 goalTitle: {
  fontSize: 13,
  fontWeight: "800",
  color: theme.colors.textMuted,
},
 row: {
  paddingVertical: 8,
  borderTopWidth: 1,
  borderColor: theme.colors.border,
},
 rowText: {
  fontSize: 16,
  fontWeight: "700",
  color: theme.colors.text,
},
rowMeta: {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 16,
  color: theme.colors.textMuted,
},
  sectionTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: theme.colors.text,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  marginTop: 8,
},

summaryText: {
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "700",
  color: theme.colors.textMuted,
  marginBottom: 8,
},

emptyText: {
  marginTop: 20,
  fontSize: 14,
  color: theme.colors.textMuted,
  textAlign: "center",
},

actionBtn: {
  minHeight: UI_SIZES.buttonHeight.md,
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: UI_SIZES.radius.md,
  backgroundColor: theme.colors.primary,
  shadowColor: "#000",
  shadowOpacity: 0.12,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
  justifyContent: "center",
  alignItems: "center",
},

actionText: {
  color: theme.colors.primaryText,
  fontWeight: "800",
  fontSize: 12,
},
actionPressed: {
  opacity: 0.82,
},
actionDisabled: {
  opacity: 0.5,
},
sectionTogglePressed: {
  opacity: 0.7,
},
nowNextCard: {
  borderWidth: 1,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderRadius: UI_SIZES.radius.lg,
  padding: UI_SIZES.cardPadding.md,
  marginBottom: UI_SIZES.spacing.sm,
},

nowNextLabel: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
  marginBottom: 6,
},

nowNextGoal: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.textMuted,
  marginBottom: 2,
},

nowNextTitle: {
  fontSize: 18,
  fontWeight: "800",
  color: theme.colors.text
},

nowNextDescription: {
  fontSize: 13,
  color: theme.colors.textMuted,
  marginTop: 4,
},

nowNextActions: {
  marginTop: 12,
  flexDirection: "row",
  justifyContent: "flex-start",
},
nowNextCardPrimary: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},
sectionIntro: {
  fontSize: 13,
  color: theme.colors.textMuted,
  marginBottom: 8,
},
quickActionRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 10,
},

quickActionPill: {
  minHeight: UI_SIZES.chipHeight.md,
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: UI_SIZES.radius.xl,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
  justifyContent: "center",
},

quickActionText: {
  fontSize: 12,
  fontWeight: "700",
 color: theme.colors.primary,
},
agendaTime: {
  fontSize: 13,
  fontWeight: "800",
  color: theme.colors.primary,
  marginBottom: 4,
},
quickActionPillMuted: {
  backgroundColor: theme.colors.surfaceMuted,
borderColor: theme.colors.border,
},

quickActionTextMuted: {
  color: theme.colors.textMuted,
},


confirmCard: {
  borderRadius: UI_SIZES.radius.md,
  padding: UI_SIZES.cardPadding.md,
  borderWidth: 1,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  shadowColor: "#000",
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 4,
  width: "100%",
  maxWidth: 420,
},

confirmTitle: {
  fontSize: 16,
  fontWeight: "800",
   color: theme.colors.text,
},

confirmText: {
  marginTop: 6,
  fontSize: 14,
  fontWeight: "700",
   color: theme.colors.text,
},

confirmMeta: {
  marginTop: 4,
  fontSize: 13,
 color: theme.colors.primary,
  fontWeight: "800",
},

confirmRow: {
  flexDirection: "row",
  gap: 8,
  marginTop: 12,
},

confirmBtn: {
  flex: 1,
  alignItems: "center",
  paddingVertical: 10,
  borderRadius: 10,
},

confirmCancel: {
    backgroundColor: theme.colors.surfaceMuted
},

confirmPrimary: {
   backgroundColor: theme.colors.primary,
},

confirmBtnText: {
  fontSize: 13,
  fontWeight: "800",
  color: theme.colors.text,
},
undoBanner: {
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
  borderWidth: 1,
  borderRadius: 14,
  padding: 12,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
},

undoText: {
  flex: 1,
  color: theme.colors.successText,
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "800",
},

undoBtn: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: theme.colors.primary,
},

undoBtnText: {
  color: theme.colors.primaryText,
  fontSize: 12,
  fontWeight: "800",
},
confirmModalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(17, 24, 39, 0.35)",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
},



emptyPlannerCard: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: UI_SIZES.radius.md,
  padding: UI_SIZES.cardPadding.md,
  marginTop: UI_SIZES.spacing.sm,
},

emptyPlannerTitle: {
  fontSize: 18,
  fontWeight: "800",
color: theme.colors.text,
},

emptyPlannerText: {
  marginTop: 6,
  fontSize: 13,
    color: theme.colors.textMuted,
  lineHeight: 18,
},
todayDataErrorCard: {
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
  borderWidth: 1,
  borderRadius: UI_SIZES.radius.md,
  padding: UI_SIZES.cardPadding.md,
  marginTop: UI_SIZES.spacing.sm,
},
todayDataErrorTitle: {
  color: theme.colors.dangerText,
  fontSize: 16,
  fontWeight: "800",
},
todayDataErrorText: {
  color: theme.colors.dangerText,
  fontSize: 13,
  lineHeight: 18,
  marginTop: UI_SIZES.spacing.xs,
},

emptyInlineCard: {
  backgroundColor: theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  borderWidth: 1,
  borderRadius: UI_SIZES.radius.md,
  padding: UI_SIZES.cardPadding.sm,
},

emptyInlineTitle: {
  fontSize: 14,
  fontWeight: "800",
  color: theme.colors.text,
},

emptyInlineText: {
  marginTop: 4,
  fontSize: 12,
  color: theme.colors.textMuted,
  lineHeight: 17,
},
badgeRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 6,
},

priorityBadge: {
  minHeight: UI_SIZES.chipHeight.sm,
  fontSize: 11,
  fontWeight: "800",
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: UI_SIZES.radius.xl,
  overflow: "hidden",
},
trustMessage: {
  marginTop: 6,
  fontSize: 12,
  color: theme.colors.textMuted,
  lineHeight: 16,
},
subtitle: {
  fontSize: 13,
  color: theme.colors.textMuted,
  marginTop: -4,
  marginBottom: 8,
},

plannerHistoryCard: {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
   backgroundColor: theme.colors.surfaceMuted,
},
helperText: {
  fontSize: 13,
  color: theme.colors.textMuted,
  lineHeight: 18,
  marginTop: 2,
},
subsectionLabel: {
  fontSize: 13,
  fontWeight: "800",
    color: theme.colors.textMuted,
  marginBottom: 6,
},
confirmPrimaryText: {
  color: theme.colors.primaryText,
},

simpleQuickPlanRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
},

simpleQuickPlanPill: {
  minHeight: UI_SIZES.chipHeight.md,
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: UI_SIZES.radius.xl,
  backgroundColor: theme.colors.primary,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  justifyContent: "center",
},

simpleQuickPlanText: {
  fontSize: 12,
  fontWeight: "800",
  color: theme.colors.primaryText,
},
quickPlanPrompt: {
  marginTop: 12,
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.text,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},

smartPlanPrompt: {
  marginTop: 12,
  fontSize: 12,
  fontWeight: "900",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},
confirmReasonTitle: {
  marginTop: 12,
  fontSize: 13,
  fontWeight: "900",
  color: theme.colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},
pillPressed: {
  opacity: 0.84,
  transform: [{ scale: 0.98 }],
},
todayDecisionOverdue: {
  backgroundColor: theme.colors.dangerBackground,
  borderColor: theme.colors.dangerBorder,
},

todayDecisionNow: {
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
},

todayDecisionNext: {
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
},

todayDecisionNeedsTime: {
  backgroundColor: theme.colors.warningBackground,
  borderColor: theme.colors.warningBorder,
},

todayDecisionAllClear: {
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
},
sectionBlock: {
  marginTop: UI_SIZES.spacing.xl,
},
groupEventsSection: {
  marginTop: UI_SIZES.spacing.xl,
  gap: UI_SIZES.spacing.sm,
},
taskCardBody: {
  paddingTop: UI_SIZES.spacing.sm,
  borderTopWidth: 1,
  borderColor: theme.colors.border,
},

taskCardFooter: {
  marginTop: UI_SIZES.spacing.md,
},

fullWidthActionBtn: {
  minHeight: UI_SIZES.buttonHeight.md,
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: UI_SIZES.radius.md,
  backgroundColor: theme.colors.primary,
  shadowColor: "#000",
  shadowOpacity: 0.12,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
  justifyContent: "center",
  alignItems: "center",
  alignSelf: "stretch",
},
sharedBadge: {
  alignSelf: "flex-start",
  marginTop: 6,
  minHeight: UI_SIZES.chipHeight.sm,
  fontSize: 11,
  fontWeight: "900",
  color: theme.colors.primary,
  backgroundColor: theme.colors.badge,
  borderWidth: 1,
  borderColor: theme.colors.primary,
  paddingHorizontal: 9,
  paddingVertical: 4,
  borderRadius: UI_SIZES.radius.xl,
  overflow: "hidden",
},
});
