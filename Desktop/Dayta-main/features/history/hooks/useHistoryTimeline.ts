import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  compareHistoryMonths,
  getCurrentHistoryMonth,
  type HistoryMonthValue,
} from "../../../components/history/PersonalHistoryTimeline";
import { auth } from "../../../services/firebase";
import type { PersonalHistoryCategory, PersonalHistoryEvent } from "../../../services/personalHistory";
import {
  groupPersonalHistoryEventsByDay,
  mergePersonalHistoryEventPages,
  type PersonalHistoryMonthSummary,
} from "../../../services/personalHistoryAggregation";
import {
  getPersonalHistoryMonthPage,
  getPersonalHistoryMonthSummary,
  type PersonalHistoryCursor,
} from "../../../services/personalHistoryQueries";
import type { HistoryFilter, HistoryUiError } from "../types/history.types";
import {
  EMPTY_SUMMARY,
  PAGE_SIZE,
  historySessionState,
  normalizeUiError,
  rememberHistorySession,
  resetHistorySession,
} from "../utils";

/**
 * The month timeline: auth-aware loading, paging, month/filter selection,
 * and the error states the UI distinguishes.
 *
 * Every async result is checked against `requestIdRef` before it touches
 * state, so a stale page from a previous month/filter/user can never land.
 */
export function useHistoryTimeline(timeZone: string) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);

  const currentMonth = useMemo(() => getCurrentHistoryMonth(timeZone), [timeZone]);

  const [selectedMonth, setSelectedMonth] = useState<HistoryMonthValue>(currentMonth);
  const [selectedFilter, setSelectedFilter] = useState<HistoryFilter>("all");

  const [events, setEvents] = useState<PersonalHistoryEvent[]>([]);
  const [summary, setSummary] = useState<PersonalHistoryMonthSummary>(EMPTY_SUMMARY);
  const [summaryComplete, setSummaryComplete] = useState(true);
  const [hasSummary, setHasSummary] = useState(false);
  const [invalidEventCount, setInvalidEventCount] = useState(0);
  const [cursor, setCursor] = useState<PersonalHistoryCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [initialError, setInitialError] = useState<HistoryUiError | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);

  // ---- Reset helpers ------------------------------------------------------
  // Three call sites reset overlapping subsets of state. Kept as one helper
  // with explicit flags so the differences are visible rather than implicit.

  const resetPage = useCallback(() => {
    requestIdRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setEvents([]);
    setCursor(null);
    setHasMore(false);
    setInvalidEventCount(0);
    setInitialError(null);
  }, []);

  const resetSummary = useCallback(() => {
    setSummary(EMPTY_SUMMARY);
    setSummaryComplete(true);
    setHasSummary(false);
    setSummaryError(false);
  }, []);

  const resetTransientErrors = useCallback(() => {
    setRefreshError(false);
    setLoadMoreError(false);
  }, []);

  // ---- Auth + session restore ----------------------------------------------
  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      resetPage();
      resetSummary();
      resetTransientErrors();

      const nextUid = nextUser?.uid ?? null;

      // Restore the last month/filter only for the same user + zone, and only
      // if that month is not in the future relative to now.
      const canRestore =
        !!nextUid &&
        historySessionState.ownerUid === nextUid &&
        historySessionState.timeZone === timeZone &&
        !!historySessionState.month &&
        compareHistoryMonths(historySessionState.month, currentMonth) <= 0;

      if (canRestore) {
        setSelectedMonth(historySessionState.month!);
        setSelectedFilter(historySessionState.filter);
      } else {
        setSelectedMonth(currentMonth);
        setSelectedFilter("all");
        resetHistorySession({
          ownerUid: nextUid,
          month: nextUid ? currentMonth : null,
          timeZone: nextUid ? timeZone : null,
        });
      }

      setUser(nextUser);
      setAuthReady(true);
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [currentMonth, timeZone, resetPage, resetSummary, resetTransientErrors]);

  // ---- Request models -----------------------------------------------------
  const monthRequestModel = useMemo(
    () => ({
      ownerUid: user?.uid ?? "",
      year: selectedMonth.year,
      month: selectedMonth.month,
      timeZone,
    }),
    [selectedMonth.month, selectedMonth.year, timeZone, user?.uid]
  );

  const pageRequestModel = useMemo(
    () => ({
      ...monthRequestModel,
      categories:
        selectedFilter === "all"
          ? undefined
          : ([selectedFilter] as PersonalHistoryCategory[]),
    }),
    [monthRequestModel, selectedFilter]
  );

  const telemetryContext = useMemo(
    () => ({ year: selectedMonth.year, month: selectedMonth.month, timeZone }),
    [selectedMonth.year, selectedMonth.month, timeZone]
  );

  // ---- Load month (initial / pull-to-refresh) -------------------------------
  const loadMonth = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!user?.uid) return;

      const requestId = ++requestIdRef.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);

      if (mode === "initial") {
        setLoading(true);
        setEvents([]);
        resetSummary();
        setCursor(null);
        setHasMore(false);
        setInitialError(null);
        setInvalidEventCount(0);
      } else {
        setRefreshing(true);
        setRefreshError(false);
      }

      try {
        const [pageResult, summaryResult] = await Promise.allSettled([
          getPersonalHistoryMonthPage({ ...pageRequestModel, pageSize: PAGE_SIZE }),
          getPersonalHistoryMonthSummary(monthRequestModel),
        ]);

        if (!mountedRef.current || requestId !== requestIdRef.current) return;

        const pageInvalid =
          pageResult.status === "fulfilled" ? pageResult.value.invalidEventCount : 0;
        const summaryInvalid =
          summaryResult.status === "fulfilled" ? summaryResult.value.invalidEventCount : 0;
        setInvalidEventCount(pageInvalid + summaryInvalid);

        if (pageResult.status === "fulfilled") {
          const page = pageResult.value;
          setEvents(page.events);
          setCursor(page.nextCursor);
          setHasMore(page.hasMore);
          setInitialError(null);
          console.info("personal_history_ui_month_loaded", {
            ...telemetryContext,
            count: page.events.length,
            hasMore: page.hasMore,
          });
        } else {
          const code = normalizeUiError(pageResult.reason);
          if (mode === "initial") setInitialError(code);
          else setRefreshError(true);
          console.warn("personal_history_ui_month_failed", {
            ...telemetryContext,
            errorCode: code,
          });
        }

        if (summaryResult.status === "fulfilled") {
          const monthSummary = summaryResult.value;
          setSummary(monthSummary.summary);
          setSummaryComplete(monthSummary.summaryComplete);
          setHasSummary(true);
          setSummaryError(false);
          console.info("personal_history_ui_summary_loaded", {
            ...telemetryContext,
            summaryComplete: monthSummary.summaryComplete,
          });
        } else {
          setSummaryError(true);
          console.warn("personal_history_ui_summary_failed", {
            ...telemetryContext,
            errorCode: normalizeUiError(summaryResult.reason),
          });
        }

        console.info("personal_history_ui_load_settled", {
          ...telemetryContext,
          pageLoaded: pageResult.status === "fulfilled",
          summaryLoaded: summaryResult.status === "fulfilled",
        });
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [monthRequestModel, pageRequestModel, telemetryContext, user?.uid, resetSummary]
  );

  useEffect(() => {
    if (!authReady) return;
    if (!user?.uid) {
      requestIdRef.current += 1;
      setEvents([]);
      setLoading(false);
      return;
    }
    void loadMonth("initial");
  }, [authReady, loadMonth, selectedMonth.month, selectedMonth.year, timeZone, user?.uid]);

  // ---- Load more ------------------------------------------------------------
  const loadMore = useCallback(async () => {
    if (!user?.uid || !cursor || !hasMore || loadingMoreRef.current) return;

    const requestId = requestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    try {
      const page = await getPersonalHistoryMonthPage({
        ...pageRequestModel,
        pageSize: PAGE_SIZE,
        cursor,
      });

      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      setEvents((current) =>
        mergePersonalHistoryEventPages(current, page.events, (event) => {
          console.warn("personal_history_ui_page_conflict", {
            eventType: event.eventType,
            entityType: event.entityType,
          });
        })
      );
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setInvalidEventCount((count) => count + page.invalidEventCount);
      console.info("personal_history_ui_page_loaded", {
        ...telemetryContext,
        count: page.events.length,
        hasMore: page.hasMore,
      });
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadMoreError(true);
      console.warn("personal_history_ui_page_failed", {
        ...telemetryContext,
        errorCode: normalizeUiError(error),
      });
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [cursor, hasMore, pageRequestModel, telemetryContext, user?.uid]);

  // ---- Selection ------------------------------------------------------------
  const selectMonth = useCallback(
    (next: HistoryMonthValue) => {
      if (compareHistoryMonths(next, currentMonth) > 0) return;

      resetPage();
      resetTransientErrors();
      setLoading(true);
      // Month changes drop the summary; it is month-scoped.
      setSummary(EMPTY_SUMMARY);
      setSummaryComplete(true);
      setHasSummary(false);
      setSelectedMonth(next);

      rememberHistorySession({
        ownerUid: user?.uid ?? null,
        month: next,
        timeZone,
        filter: historySessionState.filter,
        scrollOffset: 0,
      });

      console.info("history_month_changed", { year: next.year, month: next.month, timeZone });
    },
    [currentMonth, timeZone, user?.uid, resetPage, resetTransientErrors]
  );

  const selectFilter = useCallback(
    (next: HistoryFilter) => {
      if (next === selectedFilter) return;

      resetPage();
      resetTransientErrors();
      setLoading(true);
      // Filter changes keep the summary: it is not category-scoped.
      setSelectedFilter(next);

      historySessionState.filter = next;
      historySessionState.ownerUid = user?.uid ?? null;
      historySessionState.scrollOffset = 0;

      console.info("history_filter_changed", { category: next, ...telemetryContext });
    },
    [selectedFilter, telemetryContext, user?.uid, resetPage, resetTransientErrors]
  );

  /** Persist the current view before navigating away, so it can be restored. */
  const rememberForNavigation = useCallback(() => {
    rememberHistorySession({
      ownerUid: user?.uid ?? null,
      month: selectedMonth,
      timeZone,
      filter: selectedFilter,
    });
  }, [selectedFilter, selectedMonth, timeZone, user?.uid]);

  const rememberScrollOffset = useCallback(
    (offsetY: number) => {
      rememberHistorySession({
        ownerUid: user?.uid ?? null,
        month: selectedMonth,
        timeZone,
        filter: selectedFilter,
        scrollOffset: offsetY,
      });
    },
    [selectedFilter, selectedMonth, timeZone, user?.uid]
  );

  // ---- Derived ---------------------------------------------------------------
  const dayGroups = useMemo(
    () => groupPersonalHistoryEventsByDay(events, timeZone),
    [events, timeZone]
  );

  const sections = useMemo(
    () => dayGroups.map((group) => ({ ...group, data: group.events })),
    [dayGroups]
  );

  const viewingCurrentMonth = compareHistoryMonths(selectedMonth, currentMonth) === 0;
  const canMoveNext = compareHistoryMonths(selectedMonth, currentMonth) < 0;

  return {
    user,
    authReady,
    currentMonth,
    selectedMonth,
    selectedFilter,
    viewingCurrentMonth,
    canMoveNext,

    events,
    sections,
    summary,
    summaryComplete,
    hasSummary,
    invalidEventCount,
    hasMore,

    loading,
    refreshing,
    loadingMore,
    initialError,
    refreshError,
    loadMoreError,
    summaryError,

    loadMonth,
    loadMore,
    selectMonth,
    selectFilter,
    rememberForNavigation,
    rememberScrollOffset,
    initialScrollOffset: historySessionState.scrollOffset,
  };
}
