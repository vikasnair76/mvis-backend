import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, SafeAreaView, StyleSheet,
  Text, View,
} from "react-native";
import { PlannerSuggestionCard } from "../../components/planner/PlannerSuggestionCard";
import { auth } from "../../services/firebase";
import {
  archivePlannerSuggestion, dismissPlannerSuggestion,
  canExecutePlannerSuggestion, executePlannerSuggestion,
  getPlannerSuggestionHistoryPage, markPlannerSuggestionViewed,
  requestPlannerRefresh, snoozePlannerSuggestion,
  subscribeActivePlannerSuggestions, subscribePlannerPreferences,
  subscribeSnoozedPlannerSuggestions, type PlannerPreferencesDoc,
  type PlannerSuggestionDoc, type PlannerSuggestionHistoryPage,
} from "../../services/plannerSuggestions";
import {
  getPlannerSnoozePresets, resolvePlannerNavigationTarget,
} from "../../services/plannerPresentation";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

type Segment = "active" | "snoozed" | "history";
export default function PlannerScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [segment, setSegment] = useState<Segment>("active");
  const [active, setActive] = useState<PlannerSuggestionDoc[]>([]);
  const [snoozed, setSnoozed] = useState<PlannerSuggestionDoc[]>([]);
  const [history, setHistory] = useState<PlannerSuggestionDoc[]>([]);
  const [historyPage, setHistoryPage] = useState<PlannerSuggestionHistoryPage | null>(null);
  const [preferences, setPreferences] = useState<PlannerPreferencesDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const {themeId} = useCurrentAppTheme();
  const theme = useAppTheme(themeId);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    if (!user?.uid) {
      setActive([]); setSnoozed([]); setPreferences(null); setLoading(false); return;
    }
    setLoading(true); setError(false);
    let activeReady = false; let snoozedReady = false;
    const ready = () => { if (activeReady && snoozedReady) setLoading(false); };
    const onError = () => { setError(true); setLoading(false); };
    const unsubs = [
      subscribeActivePlannerSuggestions(user.uid, (items) => {
        setActive(items); activeReady = true; ready();
      }, onError),
      subscribeSnoozedPlannerSuggestions(user.uid, (items) => {
        setSnoozed(items); snoozedReady = true; ready();
      }, onError),
      subscribePlannerPreferences(user.uid, setPreferences, onError),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [user?.uid]);
  const loadHistory = useCallback(async (append = false) => {
    if (!user?.uid || historyLoading) return;
    setHistoryLoading(true);
    try {
      const page = await getPlannerSuggestionHistoryPage(
        user.uid, append ? historyPage?.cursor : null, 25);
      setHistory((current) => append ? [...current, ...page.items
        .filter((item) => !current.some((existing) => existing.id === item.id))] : page.items);
      setHistoryPage(page); setError(false);
    } catch {
      setError(true);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoading, historyPage?.cursor, user?.uid]);
  useEffect(() => { if (segment === "history" && historyPage == null) void loadHistory(); },
    [segment, historyPage, loadHistory]);
  const mutate = async (id: string, work: () => Promise<unknown>) => {
    setPendingIds((current) => new Set(current).add(id));
    try { await work(); }
    catch { Alert.alert("Planner action failed", "Please try again in a moment."); }
    finally { setPendingIds((current) => {
      const next = new Set(current); next.delete(id); return next;
    }); }
  };
  const dismiss = (item: PlannerSuggestionDoc) => Alert.alert(
    "Dismiss this suggestion?",
    "It will move to Planner history and will not be shown as active again.",
    [{text: "Cancel", style: "cancel"}, {text: "Dismiss", style: "destructive",
      onPress: () => void mutate(item.id, () => dismissPlannerSuggestion({
        ownerUid: user!.uid, suggestionId: item.id}))}],
  );
  const snooze = (item: PlannerSuggestionDoc) => {
    const presets = getPlannerSnoozePresets(Date.now(), timeZone)
      .filter((preset) => item.expiresAtMs == null || preset.atMs <= item.expiresAtMs);
    Alert.alert("Snooze until", presets.length ? "Choose when this suggestion should return." :
      "This suggestion expires too soon to snooze.", [
      ...presets.map((preset) => ({text: preset.label, onPress: () =>
        void mutate(item.id, () => snoozePlannerSuggestion({ownerUid: user!.uid,
          suggestionId: item.id, snoozedUntilMs: preset.atMs}))})),
      {text: "Cancel", style: "cancel"},
    ]);
  };
  const open = (item: PlannerSuggestionDoc) => {
    const target = resolvePlannerNavigationTarget(item.target.primary);
    if (!target) {
      Alert.alert("Related item unavailable", "This related item is no longer available.");
      return;
    }
    if (!item.viewedAtMs) void markPlannerSuggestionViewed({
      ownerUid: user!.uid, suggestionId: item.id}).catch(() => undefined);
    router.push(target as never);
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await requestPlannerRefresh();
      if (!result.accepted) Alert.alert("Planner is paused", "Enable Planner in Settings to request new suggestions.");
      else Alert.alert("Refresh requested", result.deduplicated ?
        "A recent refresh request is already queued. Your current suggestions remain available." :
        "Dayta will review your current planning data shortly. Your existing suggestions remain available.");
    } catch {
      Alert.alert("Refresh unavailable", "Dayta couldn’t request a refresh right now. Please try again.");
    } finally { setRefreshing(false); }
  };
  const apply = (item: PlannerSuggestionDoc) => {
    if (!canExecutePlannerSuggestion(item)) return;
    const description = item.proposedAction.type === "schedule_entity"
      ? `Create a private calendar block from ${new Date(item.proposedAction.proposedStartAtMs).toLocaleString()} to ${new Date(item.proposedAction.proposedEndAtMs!).toLocaleTimeString()}.`
      : "Apply this planning suggestion.";
    Alert.alert(
      "Apply this suggestion?",
      `${description}\n\nThis will not complete work, change a due date, move a board card, notify anyone, or modify shared group data.`,
      [
        {text: "Cancel", style: "cancel"},
        {text: "Create calendar block", onPress: () => void mutate(
          item.id,
          async () => {
            const result = await executePlannerSuggestion(item.id);
            if (result.status === "applied" || result.status === "already_applied") {
              Alert.alert(
                result.status === "applied" ? "Calendar block created" :
                  "Already applied",
                "The private work block is available in your calendar.",
                [
                  {text: "Done", style: "cancel"},
                  {text: "Open calendar", onPress: () => router.push("/calendar")},
                ]
              );
              return;
            }
            if (result.status === "already_processing") {
              Alert.alert("Still applying", "This suggestion is already being processed.");
            } else if (result.status === "permission_lost") {
              Alert.alert("Access changed", "You no longer have access to apply this suggestion.");
            } else if (["suggestion_expired", "suggestion_terminal",
              "suggestion_snoozed", "target_missing", "target_archived",
              "stale_evidence", "time_window_no_longer_available",
              "calendar_conflict_detected"].includes(result.status)) {
              Alert.alert("Suggestion is no longer current",
                "Your plans changed, so Dayta did not create the calendar block.");
            } else if (result.status === "planner_disabled") {
              Alert.alert("Planner is paused", "Enable Planner in Settings before applying suggestions.");
            } else {
              Alert.alert("Suggestion cannot be applied",
                "This action is not supported or could not be validated.");
            }
          }
        )},
      ]
    );
  };
  const items = segment === "active" ? active : segment === "snoozed" ? snoozed : history;
  const emptyCopy = segment === "active"
    ? "No active suggestions right now. You can request a refresh whenever your plans change."
    : segment === "snoozed" ? "Snoozed suggestions will appear here until they return."
      : "Dismissed, expired, invalidated, and archived suggestions will appear here.";
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<>
          <View style={styles.topRow}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}
              accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            </Pressable>
            <Pressable style={styles.settingsButton} onPress={() => router.push("/settings")}
              accessibilityRole="button" accessibilityLabel="Open Planner settings">
              <Ionicons name="settings-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.settingsText}>Settings</Text>
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">Planner</Text>
          <Text style={styles.subtitle}>Suggestions based on your goals, schedule, boards, and routines. You decide what to do.</Text>
          <View style={styles.segments} accessibilityRole="tablist">
            {(["active", "snoozed", "history"] as Segment[]).map((item) => (
              <Pressable key={item} onPress={() => setSegment(item)}
                style={[styles.segment, segment === item && styles.segmentActive]}
                accessibilityRole="tab" accessibilityState={{selected: segment === item}}
                accessibilityLabel={`${item} suggestions`}>
                <Text style={[styles.segmentText, segment === item && styles.segmentTextActive]}>
                  {item === "active" ? `Active (${active.length})` :
                    item === "snoozed" ? `Snoozed (${snoozed.length})` : "History"}
                </Text>
              </Pressable>
            ))}
          </View>
          {segment === "active" ? <Pressable style={styles.refreshButton} onPress={refresh}
            disabled={refreshing || preferences?.enabled === false}
            accessibilityRole="button" accessibilityLabel="Request Planner refresh">
            <Ionicons name="refresh" size={18} color={theme.colors.primaryText} />
            <Text style={styles.refreshText}>{refreshing ? "Requesting…" : "Refresh suggestions"}</Text>
          </Pressable> : null}
          {preferences?.enabled === false ? <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Planner is paused</Text>
            <Text style={styles.noticeText}>Your history is preserved. Enable Planner in Settings to generate new suggestions.</Text>
          </View> : null}
          {error ? <View style={styles.error}>
            <Text style={styles.errorText}>Some Planner information couldn’t be loaded.</Text>
            <Pressable onPress={() => segment === "history" ? void loadHistory() : setError(false)}
              accessibilityRole="button"><Text style={styles.retry}>Try again</Text></Pressable>
          </View> : null}
        </>}
        renderItem={({item}) => <PlannerSuggestionCard suggestion={item} theme={theme}
          timeZone={timeZone} pending={pendingIds.has(item.id)}
          onViewed={() => void markPlannerSuggestionViewed({ownerUid: user!.uid,
            suggestionId: item.id}).catch(() => undefined)}
          onOpen={() => open(item)}
          onApply={canExecutePlannerSuggestion(item) ? () => apply(item) : undefined}
          onDismiss={!["dismissed", "expired", "invalidated", "archived", "accepted"].includes(item.status)
            ? () => dismiss(item) : undefined}
          onSnooze={item.status === "active" ? () => snooze(item) : undefined}
          onArchive={segment === "history" && item.status !== "archived" ?
            () => void mutate(item.id, () => archivePlannerSuggestion({
              ownerUid: user!.uid, suggestionId: item.id})) : undefined}
        />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={theme.colors.primary}
          accessibilityLabel="Loading Planner suggestions" /> :
          <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>{emptyCopy}</Text></View>}
        ListFooterComponent={segment === "history" && historyPage?.hasMore ?
          <Pressable style={styles.loadMore} onPress={() => void loadHistory(true)}
            disabled={historyLoading} accessibilityRole="button">
            <Text style={styles.loadMoreText}>{historyLoading ? "Loading…" : "Load more"}</Text>
          </Pressable> : null}
      />
    </SafeAreaView>
  );
}
const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  safe: {flex: 1, backgroundColor: theme.colors.background},
  content: {width: "100%", maxWidth: 760, alignSelf: "center", padding: 18,
    paddingBottom: 60, flexGrow: 1},
  topRow: {flexDirection: "row", justifyContent: "space-between", alignItems: "center"},
  iconButton: {width: 44, height: 44, justifyContent: "center", alignItems: "center"},
  settingsButton: {minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6},
  settingsText: {color: theme.colors.primary, fontWeight: "800"},
  title: {color: theme.colors.text, fontSize: 32, fontWeight: "900", marginTop: 10},
  subtitle: {color: theme.colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: 6},
  segments: {flexDirection: "row", backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 14, padding: 4, marginTop: 20, marginBottom: 14},
  segment: {flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center",
    borderRadius: 11, paddingHorizontal: 4},
  segmentActive: {backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    borderWidth: 1},
  segmentText: {color: theme.colors.textMuted, fontSize: 12, fontWeight: "800"},
  segmentTextActive: {color: theme.colors.text},
  refreshButton: {minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.primary,
    flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", marginBottom: 14},
  refreshText: {color: theme.colors.primaryText, fontWeight: "900"},
  notice: {backgroundColor: theme.colors.warningBackground, borderColor: theme.colors.warningBorder,
    borderWidth: 1, borderRadius: 14, padding: 14, gap: 4, marginBottom: 14},
  noticeTitle: {color: theme.colors.warningText, fontWeight: "900"},
  noticeText: {color: theme.colors.warningText, lineHeight: 19},
  error: {backgroundColor: theme.colors.dangerBackground, borderColor: theme.colors.dangerBorder,
    borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14},
  errorText: {color: theme.colors.dangerText},
  retry: {color: theme.colors.dangerText, fontWeight: "900", marginTop: 8},
  separator: {height: 12},
  empty: {backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    borderWidth: 1, borderRadius: 18, padding: 22, alignItems: "center", gap: 7},
  emptyTitle: {color: theme.colors.text, fontSize: 18, fontWeight: "900"},
  emptyText: {color: theme.colors.textMuted, textAlign: "center", lineHeight: 20},
  loadMore: {minHeight: 48, justifyContent: "center", alignItems: "center", marginTop: 16},
  loadMoreText: {color: theme.colors.primary, fontWeight: "900"},
});
