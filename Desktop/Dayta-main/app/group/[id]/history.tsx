import {Ionicons} from "@expo/vector-icons";
import {router, useLocalSearchParams} from "expo-router";
import {onAuthStateChanged, type User} from "firebase/auth";
import {doc, onSnapshot} from "firebase/firestore";
import {DateTime, IANAZone} from "luxon";
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  buildGroupHistoryDaySections,
  formatGroupHistoryMonthLabel,
  getCurrentGroupHistoryMonth,
  getGroupHistoryEmptyCopy,
  getGroupHistoryNavigationTarget,
  getGroupHistoryPartialCopy,
  getGroupHistoryQueryCategory,
  getGroupHistoryRestorationKey,
  GROUP_HISTORY_FILTERS,
  GroupHistoryEventRow,
  GroupHistorySummaryCard,
  normalizeRestoredGroupHistoryState,
  readGroupHistoryRestorationState,
  shiftGroupHistoryMonth,
  storeGroupHistoryRestorationState,
  type GroupHistoryFilter,
  type GroupHistoryMonthValue,
  type GroupHistoryRestoredState,
} from "../../../components/history/GroupHistoryTimeline";
import {auth, db} from "../../../services/firebase";
import {type GroupHistoryEvent} from "../../../services/groupHistory";
import {
  createEmptyGroupHistoryMonthSummary,
  mergeGroupHistoryEvents,
  type GroupHistoryMonthSummary,
} from "../../../services/groupHistoryAggregation";
import {
  getGroupHistoryMonthPage,
  getGroupHistoryMonthSummary,
  GroupHistoryQueryError,
  type GroupHistoryCursor,
  type GroupHistoryPagePartialReason,
} from "../../../services/groupHistoryQueries";
import {
  subscribeGroupMembers,
  type GroupDoc,
  type GroupMemberDoc,
} from "../../../services/groups";
import {UI_SIZES, type AppThemeTokens} from "../../../services/theme";
import {useCurrentAppTheme} from "../../../services/useCurrentAppTheme";

const PAGE_SIZE = 50;
type UiError = "access_lost" | "unavailable";
const restorationState = new Map<string, GroupHistoryRestoredState>();

function normalizeUiError(error: unknown): UiError {
  if (error instanceof GroupHistoryQueryError &&
    ["unauthenticated", "permission_denied", "group_not_found"]
      .includes(error.code)) return "access_lost";
  return "unavailable";
}

export default function GroupHistoryScreen() {
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const groupId = typeof rawId === "string" ? rawId.trim() : "";
  const validGroupId = !!groupId && groupId.length <= 500 &&
    !groupId.includes("/") && groupId !== "." && groupId !== "..";
  const {theme} = useCurrentAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {width} = useWindowDimensions();
  const deviceZone = DateTime.local().zoneName;
  const timeZone = IANAZone.isValidZone(deviceZone) ? deviceZone : "UTC";
  const currentMonth = useMemo(
    () => getCurrentGroupHistoryMonth(timeZone), [timeZone]);
  const [selectedMonth, setSelectedMonth] =
    useState<GroupHistoryMonthValue>(currentMonth);
  const [selectedFilter, setSelectedFilter] =
    useState<GroupHistoryFilter>("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [contributorsExpanded, setContributorsExpanded] = useState(false);
  const [restorationReady, setRestorationReady] = useState(false);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [groupReady, setGroupReady] = useState(false);
  const [members, setMembers] = useState<GroupMemberDoc[]>([]);
  const [membershipReady, setMembershipReady] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [events, setEvents] = useState<GroupHistoryEvent[]>([]);
  const [cursor, setCursor] = useState<GroupHistoryCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [timelinePartial, setTimelinePartial] =
    useState<GroupHistoryPagePartialReason | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineRefreshing, setTimelineRefreshing] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState(false);
  const [timelineError, setTimelineError] = useState<UiError | null>(null);
  const [summary, setSummary] = useState<GroupHistoryMonthSummary>(
    createEmptyGroupHistoryMonthSummary());
  const [hasSummary, setHasSummary] = useState(false);
  const [summaryComplete, setSummaryComplete] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<UiError | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const requestVersionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const transitionRef = useRef(false);
  const skipSummaryOnNextLoadRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const listRef = useRef<SectionList<GroupHistoryEvent>>(null);
  const previousUidRef = useRef(auth.currentUser?.uid ?? null);

  const restorationKey = useMemo(() =>
    user?.uid ? getGroupHistoryRestorationKey(user.uid, groupId) : null,
  [groupId, user?.uid]);

  const clearSensitiveState = useCallback((clearRestoration = false) => {
    requestVersionRef.current += 1;
    loadingMoreRef.current = false;
    transitionRef.current = false;
    refreshInFlightRef.current = false;
    setEvents([]);
    setCursor(null);
    setHasMore(false);
    setTimelinePartial(null);
    setTimelineLoadingMore(false);
    setPaginationError(false);
    setSummary(createEmptyGroupHistoryMonthSummary());
    setHasSummary(false);
    setSummaryComplete(true);
    if (clearRestoration && restorationKey) {
      restorationState.delete(restorationKey);
      setSelectedFilter("all");
      setSelectedMonth(currentMonth);
    }
  }, [currentMonth, restorationKey]);

  const loseAccess = useCallback(() => {
    clearSensitiveState(true);
    setAccessLost(true);
    setTimelineLoading(false);
    setTimelineRefreshing(false);
    setSummaryLoading(false);
  }, [clearSensitiveState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    const previousUid = previousUidRef.current;
    if (previousUid && previousUid !== nextUser?.uid) {
      const previousKey = getGroupHistoryRestorationKey(previousUid, groupId);
      if (previousKey) restorationState.delete(previousKey);
      setSelectedMonth(currentMonth);
      setSelectedFilter("all");
    }
    previousUidRef.current = nextUser?.uid ?? null;
    clearSensitiveState(false);
    setRestorationReady(false);
    setUser(nextUser);
    setAuthReady(true);
    setAccessLost(!nextUser);
  }), [clearSensitiveState, currentMonth, groupId]);

  useEffect(() => {
    setGroup(null);
    setGroupReady(false);
    setContextError(false);
    if (!validGroupId || !user) {
      setGroupReady(true);
      return;
    }
    return onSnapshot(doc(db, "groups", groupId), (snapshot) => {
      if (!snapshot.exists()) {
        setGroup(null);
        loseAccess();
      } else {
        setGroup({id: snapshot.id, ...snapshot.data()} as GroupDoc);
      }
      setGroupReady(true);
    }, () => {
      setContextError(true);
      loseAccess();
      setGroupReady(true);
    });
  }, [groupId, loseAccess, user, validGroupId]);

  useEffect(() => {
    setMembers([]);
    setMembershipReady(false);
    if (!validGroupId || !user) {
      setMembershipReady(true);
      return;
    }
    return subscribeGroupMembers(groupId, (items) => {
      setMembers(items);
      setMembershipReady(true);
    }, () => {
      setContextError(true);
      loseAccess();
      setMembershipReady(true);
    });
  }, [groupId, loseAccess, user, validGroupId]);

  const currentMember = useMemo(() => members.find(
    (member) => member.uid === user?.uid && member.status === "active"
  ) ?? null, [members, user?.uid]);
  const contextReady = authReady && groupReady && membershipReady;
  const hasAccess = validGroupId && !!user && !!group && !!currentMember &&
    !contextError && !accessLost;

  useEffect(() => {
    if (!contextReady) return;
    if (!hasAccess) loseAccess();
  }, [contextReady, hasAccess, loseAccess]);

  useEffect(() => {
    if (!hasAccess || restorationReady) return;
    const restored = restorationKey ?
      normalizeRestoredGroupHistoryState(
        readGroupHistoryRestorationState(restorationState, restorationKey)
      ) :
      null;
    if (restored) {
      setSelectedMonth({year: restored.year, month: restored.month});
      setSelectedFilter(restored.filter);
    }
    setRestorationReady(true);
  }, [hasAccess, restorationKey, restorationReady]);

  useEffect(() => {
    if (!hasAccess || !restorationReady || !restorationKey) return;
    storeGroupHistoryRestorationState(restorationState, restorationKey, {
      year: selectedMonth.year,
      month: selectedMonth.month,
      filter: selectedFilter,
    });
  }, [
    hasAccess, restorationKey, restorationReady, selectedFilter,
    selectedMonth.month, selectedMonth.year,
  ]);

  const requestModel = useMemo(() => ({
    groupId,
    year: selectedMonth.year,
    month: selectedMonth.month,
    timeZone,
  }), [groupId, selectedMonth.month, selectedMonth.year, timeZone]);
  const category = getGroupHistoryQueryCategory(selectedFilter);

  const loadTimeline = useCallback(async (
    mode: "initial" | "refresh",
    version = ++requestVersionRef.current
  ) => {
    if (!hasAccess) return;
    loadingMoreRef.current = false;
    setTimelineLoadingMore(false);
    setPaginationError(false);
    if (mode === "initial") {
      setEvents([]);
      setCursor(null);
      setHasMore(false);
      setTimelinePartial(null);
      setTimelineLoading(true);
      setTimelineError(null);
    } else {
      setTimelineRefreshing(true);
      setTimelineError(null);
    }
    try {
      const page = await getGroupHistoryMonthPage({
        ...requestModel, pageSize: PAGE_SIZE, category,
      });
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      setEvents(page.events);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTimelinePartial(page.partialReason);
    } catch (error) {
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      const normalized = normalizeUiError(error);
      if (normalized === "access_lost") loseAccess();
      else setTimelineError(normalized);
    } finally {
      if (mountedRef.current && version === requestVersionRef.current) {
        setTimelineLoading(false);
        setTimelineRefreshing(false);
        refreshInFlightRef.current = false;
        transitionRef.current = false;
      }
    }
  }, [category, hasAccess, loseAccess, requestModel]);

  const loadSummary = useCallback(async (
    mode: "initial" | "refresh",
    version: number
  ) => {
    if (!hasAccess) return;
    if (mode === "initial") {
      setSummary(createEmptyGroupHistoryMonthSummary());
      setHasSummary(false);
      setSummaryComplete(true);
    }
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await getGroupHistoryMonthSummary(requestModel);
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      setSummary(result.summary);
      setHasSummary(true);
      setSummaryComplete(result.complete);
    } catch (error) {
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      const normalized = normalizeUiError(error);
      if (normalized === "access_lost") loseAccess();
      else setSummaryError(normalized);
    } finally {
      if (mountedRef.current && version === requestVersionRef.current) {
        setSummaryLoading(false);
      }
    }
  }, [hasAccess, loseAccess, requestModel]);

  const loadMonth = useCallback((mode: "initial" | "refresh") => {
    if (!hasAccess || !restorationReady ||
      (mode === "refresh" && refreshInFlightRef.current)) return;
    if (mode === "refresh") refreshInFlightRef.current = true;
    const version = ++requestVersionRef.current;
    void loadTimeline(mode, version);
    if (mode === "initial" && skipSummaryOnNextLoadRef.current) {
      skipSummaryOnNextLoadRef.current = false;
    } else {
      void loadSummary(mode, version);
    }
  }, [hasAccess, loadSummary, loadTimeline, restorationReady]);

  useEffect(() => {
    if (hasAccess && restorationReady) loadMonth("initial");
  }, [hasAccess, loadMonth, restorationReady]);

  const scrollToTop = useCallback(() => {
    listRef.current?.getScrollResponder()?.scrollTo({
      y: 0, animated: false,
    });
  }, []);

  const selectMonth = useCallback((month: GroupHistoryMonthValue) => {
    if (transitionRef.current) return;
    transitionRef.current = true;
    requestVersionRef.current += 1;
    loadingMoreRef.current = false;
    setEvents([]);
    setCursor(null);
    setHasMore(false);
    setTimelinePartial(null);
    setTimelineError(null);
    setPaginationError(false);
    setSummary(createEmptyGroupHistoryMonthSummary());
    setHasSummary(false);
    setSummaryError(null);
    skipSummaryOnNextLoadRef.current = false;
    setSelectedMonth(month);
    scrollToTop();
  }, [scrollToTop]);

  const selectFilter = useCallback((next: GroupHistoryFilter) => {
    if (next === selectedFilter || transitionRef.current) return;
    transitionRef.current = true;
    requestVersionRef.current += 1;
    loadingMoreRef.current = false;
    setEvents([]);
    setCursor(null);
    setHasMore(false);
    setTimelinePartial(null);
    setTimelineError(null);
    setPaginationError(false);
    skipSummaryOnNextLoadRef.current = true;
    setSelectedFilter(next);
    scrollToTop();
  }, [scrollToTop, selectedFilter]);

  const loadMore = useCallback(async () => {
    if (!hasAccess || !cursor || !hasMore || timelineRefreshing ||
      loadingMoreRef.current) return;
    const version = requestVersionRef.current;
    loadingMoreRef.current = true;
    setTimelineLoadingMore(true);
    setPaginationError(false);
    try {
      const page = await getGroupHistoryMonthPage({
        ...requestModel, pageSize: PAGE_SIZE, cursor, category,
      });
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      const merged = mergeGroupHistoryEvents(events, page.events);
      setTimelinePartial(merged.conflict ?
        "query_conflict" : page.partialReason);
      setEvents(merged.events);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      if (!mountedRef.current || version !== requestVersionRef.current) return;
      if (normalizeUiError(error) === "access_lost") loseAccess();
      else setPaginationError(true);
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current && version === requestVersionRef.current) {
        setTimelineLoadingMore(false);
      }
    }
  }, [
    category, cursor, events, hasAccess, hasMore, loseAccess, requestModel,
    timelineRefreshing,
  ]);

  const openEvent = useCallback((event: GroupHistoryEvent) => {
    const target = getGroupHistoryNavigationTarget(event, groupId);
    if (!target) return;
    if (restorationKey) {
      storeGroupHistoryRestorationState(restorationState, restorationKey, {
        year: selectedMonth.year,
        month: selectedMonth.month,
        filter: selectedFilter,
      });
    }
    router.push({
      pathname: target.pathname,
      params: target.params,
    } as never);
  }, [
    groupId, restorationKey, selectedFilter, selectedMonth.month,
    selectedMonth.year,
  ]);

  const memberNames = useMemo(() => new Map(members.map((member) => [
    member.uid,
    member.displayName?.trim() || member.email?.trim() || member.uid,
  ])), [members]);
  const normalizedMemberSearch = memberSearch.trim().toLocaleLowerCase();
  const contributorName = useCallback((uid: string | null, stored: string | null) =>
    (uid ? memberNames.get(uid) : null) || stored || "Former member",
  [memberNames]);
  const visibleContributors = useMemo(() =>
    summary.sharedSubtaskContributors.filter((contributor) => {
      if (!normalizedMemberSearch) return true;
      return contributorName(contributor.uid, contributor.displayName)
        .toLocaleLowerCase().includes(normalizedMemberSearch);
    }), [
    contributorName, normalizedMemberSearch,
    summary.sharedSubtaskContributors,
  ]);
  const filteredEvents = useMemo(() => events.filter((event) => {
    if (!normalizedMemberSearch) return true;
    const creditedName = contributorName(
      event.creditedMemberUid, event.creditedMemberDisplayName);
    const actorName = contributorName(event.actorUid, event.actorDisplayName);
    return creditedName.toLocaleLowerCase().includes(normalizedMemberSearch) ||
      actorName.toLocaleLowerCase().includes(normalizedMemberSearch);
  }), [contributorName, events, normalizedMemberSearch]);
  const sections = useMemo(
    () => buildGroupHistoryDaySections(filteredEvents, timeZone),
    [filteredEvents, timeZone]);
  const contentWidth = Math.min(width, 920);
  const partialCopy = getGroupHistoryPartialCopy(
    timelinePartial, selectedFilter);

  const header = (
    <View style={styles.headerContent}>
      <View style={styles.titleRow}>
        <Pressable style={({pressed}) => [
          styles.iconButton, pressed && styles.pressed,
        ]} onPress={() => router.back()} accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the group.">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={styles.titleText}>
          <Text style={styles.title} accessibilityRole="header">
            Group History
          </Text>
          {group?.name ? <Text style={styles.subtitle}>{group.name}</Text> : null}
        </View>
      </View>
      <View style={styles.monthControls}>
        <Pressable style={({pressed}) => [
          styles.iconButton, pressed && styles.pressed,
        ]} onPress={() => selectMonth(
          shiftGroupHistoryMonth(selectedMonth, -1))}
          disabled={transitionRef.current}
          accessibilityRole="button" accessibilityLabel="Previous month"
          accessibilityHint="Shows the previous month of group history."
          accessibilityState={{disabled: transitionRef.current}}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.monthLabel} accessibilityRole="header"
          accessibilityLabel={`Showing ${
            formatGroupHistoryMonthLabel(selectedMonth)}`}>
          {formatGroupHistoryMonthLabel(selectedMonth)}
        </Text>
        <Pressable style={({pressed}) => [
          styles.iconButton, pressed && styles.pressed,
        ]} onPress={() => selectMonth(
          shiftGroupHistoryMonth(selectedMonth, 1))}
          disabled={transitionRef.current}
          accessibilityRole="button" accessibilityLabel="Next month"
          accessibilityHint="Shows the next month of group history."
          accessibilityState={{disabled: transitionRef.current}}>
          <Ionicons name="chevron-forward" size={22}
            color={theme.colors.text} />
        </Pressable>
      </View>
      {summaryLoading && !hasSummary ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.muted}>Loading month summary…</Text>
        </View>
      ) : hasSummary ? (
        <GroupHistorySummaryCard summary={summary}
          complete={summaryComplete} theme={theme} />
      ) : (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Summary unavailable</Text>
          <Text style={styles.muted}>
            The timeline can still be viewed. Pull to refresh to retry.
          </Text>
        </View>
      )}
      {summaryError && hasSummary ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Couldn’t refresh the summary</Text>
          <Text style={styles.muted}>
            The previously loaded summary remains visible.
          </Text>
        </View>
      ) : null}
      <View style={styles.contributorCard}>
        <Pressable style={styles.contributorToggle}
          onPress={() => setContributorsExpanded((current) => !current)}
          accessibilityRole="button"
          accessibilityState={{expanded: contributorsExpanded}}
          accessibilityLabel="Toggle shared-goal completions by member">
          <View style={styles.contributorToggleText}>
            <Text style={styles.contributorHeading} accessibilityRole="header">
              Shared-goal completions by member
            </Text>
            <Text style={styles.muted}>
              {summary.sharedSubtaskCompletedCount} net completion{
                summary.sharedSubtaskCompletedCount === 1 ? "" : "s"} this month
            </Text>
          </View>
          <Ionicons name={contributorsExpanded ? "chevron-up" : "chevron-down"}
            size={22} color={theme.colors.text} />
        </Pressable>
        {contributorsExpanded ? <>
          <Text style={styles.muted}>
            Completed shared subtasks during {formatGroupHistoryMonthLabel(
              selectedMonth)}.
          </Text>
          <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={theme.colors.textMuted} />
          <TextInput
            value={memberSearch}
            onChangeText={setMemberSearch}
            placeholder="Filter by username"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Filter group history by username"
          />
          {memberSearch ? (
            <Pressable onPress={() => setMemberSearch("")}
              accessibilityRole="button" accessibilityLabel="Clear username filter">
              <Ionicons name="close-circle" size={20}
                color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
          </View>
          {visibleContributors.length ? (
          <View style={styles.chart}>
            {visibleContributors.map((contributor) => {
              const maximum = Math.max(
                1, ...visibleContributors.map((item) => item.completedCount));
              const label = contributorName(
                contributor.uid, contributor.displayName);
              return (
                <View key={contributor.uid ?? `unknown-${label}`}
                  style={styles.chartRow}
                  accessibilityLabel={`${label}, ${
                    contributor.completedCount} completed shared subtasks`}>
                  <Text style={styles.chartLabel} numberOfLines={1}>{label}</Text>
                  <View style={styles.chartTrack}>
                    <View style={[
                      styles.chartBar,
                      {width: `${Math.max(
                        6, contributor.completedCount / maximum * 100)}%` as any},
                    ]} />
                  </View>
                  <Text style={styles.chartValue}>
                    {contributor.completedCount}
                  </Text>
                </View>
              );
            })}
          </View>
          ) : (
          <Text style={styles.muted}>
            {normalizedMemberSearch
              ? "No matching member completions this month."
              : "No shared-subtask completions recorded this month."}
          </Text>
          )}
        </> : null}
      </View>
      <View style={styles.filterSection}>
        <Text style={styles.filterHeading} accessibilityRole="header">
          Timeline category
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}>
          {GROUP_HISTORY_FILTERS.map((filter) => {
            const selected = selectedFilter === filter.value;
            return (
              <Pressable key={filter.value}
                onPress={() => selectFilter(filter.value)}
                style={({pressed}) => [
                  styles.filterChip,
                  selected && styles.filterChipSelected,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={filter.accessibilityLabel}
                accessibilityState={{selected}}>
                <Text style={[
                  styles.filterChipText,
                  selected && styles.filterChipTextSelected,
                ]}>
                  {selected ? `✓ ${filter.label}` : filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {timelinePartial ? (
        <View style={styles.noticeCard} accessible>
          <Text style={styles.noticeTitle}>Partial timeline</Text>
          <Text style={styles.muted}>{partialCopy}</Text>
        </View>
      ) : null}
      {timelineError && events.length > 0 ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Couldn’t refresh the timeline</Text>
          <Text style={styles.muted}>
            Existing entries remain visible. Pull to refresh and try again.
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!validGroupId) return <SafeAreaView style={styles.safe}>
    <View style={styles.centerState}>
      <Text style={styles.stateTitle}>Invalid group</Text>
      <Text style={styles.muted}>This Group History link is not valid.</Text>
    </View>
  </SafeAreaView>;
  if (!contextReady || (hasAccess && !restorationReady)) {
    return <SafeAreaView style={styles.safe}>
      <View style={styles.centerState}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.muted}>Checking group access…</Text>
      </View>
    </SafeAreaView>;
  }
  if (!hasAccess || accessLost) return <SafeAreaView style={styles.safe}>
    <View style={styles.centerState} accessible
      accessibilityLabel="Group History unavailable. You may no longer have access to this group.">
      <Text style={styles.stateTitle}>Group History unavailable</Text>
      <Text style={styles.muted}>
        You may no longer have access to this group.
      </Text>
      <Pressable style={styles.primaryButton} onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Return to previous screen">
        <Text style={styles.primaryButtonText}>Go back</Text>
      </Pressable>
    </View>
  </SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe}>
      <SectionList ref={listRef} style={styles.list}
        contentContainerStyle={[
          styles.content, {width: contentWidth, alignSelf: "center"},
        ]}
        sections={sections} keyExtractor={(item) => item.id}
        renderItem={({item}) => {
          const target = getGroupHistoryNavigationTarget(item, groupId);
          return <GroupHistoryEventRow event={item} timeZone={timeZone}
            theme={theme} onOpenEvent={target ? openEvent : undefined} />;
        }}
        renderSectionHeader={({section}) => (
          <Text style={styles.dayHeader} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={timelineLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>Loading group history…</Text>
          </View>
        ) : timelineError ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>Timeline unavailable</Text>
            <Text style={styles.muted}>
              Pull to refresh and try loading this category again.
            </Text>
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>{getGroupHistoryEmptyCopy(
              selectedFilter)}</Text>
            <Text style={styles.muted}>
              Group History contains newly recorded completions and does not
              include older activity.
            </Text>
          </View>
        )}
        ListFooterComponent={hasMore || paginationError ? (
          <View style={styles.footer}>
            {paginationError ? (
              <Text style={styles.muted}>
                Couldn’t load more. Existing entries remain visible.
              </Text>
            ) : null}
            <Pressable style={({pressed}) => [
              styles.loadMoreButton,
              (timelineLoadingMore || timelineRefreshing) &&
                styles.buttonDisabled,
              pressed && styles.pressed,
            ]} onPress={() => void loadMore()}
              disabled={timelineLoadingMore || timelineRefreshing}
              accessibilityRole="button"
              accessibilityLabel={paginationError ?
                "Retry loading more group history" :
                "Load more group history"}
              accessibilityState={{
                disabled: timelineLoadingMore || timelineRefreshing,
                busy: timelineLoadingMore,
              }}>
              {timelineLoadingMore ? (
                <>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text style={styles.loadMoreText}>Loading more…</Text>
                </>
              ) : (
                <Text style={styles.loadMoreText}>
                  {paginationError ? "Retry" : "Load More"}
                </Text>
              )}
            </Pressable>
          </View>
        ) : filteredEvents.length ? (
          <Text style={styles.endText}>
            End of this month’s recorded history.
          </Text>
        ) : null}
        refreshControl={<RefreshControl refreshing={timelineRefreshing}
          onRefresh={() => loadMonth("refresh")}
          tintColor={theme.colors.primary} />}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={9}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

const makeStyles = (theme: AppThemeTokens) => StyleSheet.create({
  safe: {flex: 1, backgroundColor: theme.colors.background},
  list: {flex: 1},
  content: {
    padding: UI_SIZES.spacing.lg,
    paddingBottom: UI_SIZES.spacing.xl,
    gap: UI_SIZES.spacing.sm,
  },
  headerContent: {gap: UI_SIZES.spacing.md, marginBottom: UI_SIZES.spacing.md},
  titleRow: {flexDirection: "row", alignItems: "center", gap: 10},
  titleText: {flex: 1, minWidth: 0},
  title: {color: theme.colors.text, fontSize: 26, fontWeight: "900"},
  subtitle: {color: theme.colors.textMuted, fontSize: 14, marginTop: 2},
  monthControls: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderWidth: 1,
    borderColor: theme.colors.border, borderRadius: UI_SIZES.radius.lg,
    backgroundColor: theme.colors.surface, padding: UI_SIZES.spacing.sm,
  },
  iconButton: {
    minWidth: 48, minHeight: 48, alignItems: "center",
    justifyContent: "center", borderRadius: UI_SIZES.radius.md,
  },
  pressed: {opacity: 0.72, backgroundColor: theme.colors.surfaceMuted},
  monthLabel: {
    color: theme.colors.text, fontSize: 18, fontWeight: "900",
    textAlign: "center", flexShrink: 1,
  },
  loadingCard: {
    minHeight: 112, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: UI_SIZES.spacing.sm, borderWidth: 1,
    borderColor: theme.colors.border, borderRadius: UI_SIZES.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  noticeCard: {
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.surfaceMuted,
    padding: UI_SIZES.cardPadding.sm, gap: 4,
  },
  noticeTitle: {color: theme.colors.text, fontWeight: "900"},
  muted: {color: theme.colors.textMuted, lineHeight: 20, textAlign: "center"},
  contributorCard: {
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: UI_SIZES.radius.lg, backgroundColor: theme.colors.surface,
    padding: UI_SIZES.cardPadding.sm, gap: UI_SIZES.spacing.sm,
  },
  contributorHeading: {
    color: theme.colors.text, fontSize: 18, fontWeight: "900",
  },
  contributorToggle: {
    minHeight: 48, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: UI_SIZES.spacing.sm,
  },
  contributorToggleText: {flex: 1, gap: 2},
  searchBox: {
    minHeight: 48, flexDirection: "row", alignItems: "center",
    gap: UI_SIZES.spacing.sm, borderWidth: 1,
    borderColor: theme.colors.border, borderRadius: UI_SIZES.radius.md,
    backgroundColor: theme.colors.background,
    paddingHorizontal: UI_SIZES.spacing.md,
  },
  searchInput: {flex: 1, color: theme.colors.text, fontSize: 16},
  chart: {gap: UI_SIZES.spacing.sm},
  chartRow: {
    flexDirection: "row", alignItems: "center", gap: UI_SIZES.spacing.sm,
  },
  chartLabel: {
    width: 112, color: theme.colors.text, fontSize: 13, fontWeight: "700",
  },
  chartTrack: {
    flex: 1, height: 18, overflow: "hidden",
    borderRadius: 9, backgroundColor: theme.colors.surfaceMuted,
  },
  chartBar: {
    height: "100%", borderRadius: 9, backgroundColor: theme.colors.primary,
  },
  chartValue: {
    minWidth: 28, color: theme.colors.text, textAlign: "right",
    fontWeight: "900",
  },
  filterSection: {gap: UI_SIZES.spacing.sm},
  filterHeading: {color: theme.colors.text, fontSize: 16, fontWeight: "900"},
  filterRow: {gap: UI_SIZES.spacing.sm, paddingRight: UI_SIZES.spacing.lg},
  filterChip: {
    minHeight: 48, minWidth: 72, paddingHorizontal: UI_SIZES.spacing.md,
    borderRadius: 24, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, alignItems: "center",
    justifyContent: "center",
  },
  filterChipSelected: {
    borderWidth: 2, borderColor: theme.colors.primary,
    backgroundColor: theme.colors.badge,
  },
  filterChipText: {color: theme.colors.text, fontWeight: "800"},
  filterChipTextSelected: {color: theme.colors.primary, fontWeight: "900"},
  centerState: {
    minHeight: 180, alignItems: "center", justifyContent: "center",
    padding: UI_SIZES.spacing.lg, gap: UI_SIZES.spacing.sm,
  },
  stateTitle: {
    color: theme.colors.text, fontSize: 18, lineHeight: 25,
    fontWeight: "900", textAlign: "center",
  },
  dayHeader: {
    color: theme.colors.text, fontSize: 15, fontWeight: "900",
    paddingTop: UI_SIZES.spacing.md, paddingBottom: UI_SIZES.spacing.xs,
    backgroundColor: theme.colors.background,
  },
  footer: {gap: UI_SIZES.spacing.sm, alignItems: "center"},
  loadMoreButton: {
    minHeight: 48, minWidth: 180, flexDirection: "row",
    alignItems: "center", justifyContent: "center",
    gap: UI_SIZES.spacing.sm, borderRadius: UI_SIZES.radius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  loadMoreText: {color: theme.colors.primary, fontWeight: "900"},
  buttonDisabled: {opacity: 0.55},
  endText: {
    color: theme.colors.textMuted, textAlign: "center",
    paddingVertical: UI_SIZES.spacing.lg,
  },
  primaryButton: {
    minHeight: 48, paddingHorizontal: UI_SIZES.spacing.lg,
    alignItems: "center", justifyContent: "center",
    borderRadius: UI_SIZES.radius.md, backgroundColor: theme.colors.primary,
  },
  primaryButtonText: {color: theme.colors.primaryText, fontWeight: "900"},
});
