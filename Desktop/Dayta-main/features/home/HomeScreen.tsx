import React, { useCallback, useMemo } from "react";
import { Animated, Text } from "react-native";
import { router } from "expo-router";
import type { HomeTaskItem } from "../../services/nowDecision";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";
import {
  DoneTodaySection,
  HomeLogo,
  HomeStateScreen,
  NeedsTimeSection,
  NowDecisionCard,
  RecoveryHintCard,
  TodayStatsCard,
  UpcomingSection,
} from "./components";
import { useHomeAuth, useHomeDecision, useHomeEntrance, useHomeTasks } from "./hooks";
import { createHomeStyles } from "./styles/home.styles";
import { getTimeOfDayGreeting } from "./utils";

export function HomeScreen() {
  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => createHomeStyles(theme), [theme]);

  const { uid, authHydrated } = useHomeAuth();
  const tasks = useHomeTasks(uid);
  const view = useHomeDecision(tasks.items, tasks.completedTodayKeys);

  // Ready only once auth has settled AND the loaded data belongs to *this* uid.
  // Comparing uids (not a boolean) is what prevents a one-render flash of the
  // previous account's tasks after sign-in or an account switch.
  const isHydratedForUid = !uid || tasks.hydratedUid === uid;
  const isHomeLoading = !authHydrated || !isHydratedForUid;
  const isSignedOut = authHydrated && !uid;
  const entrance = useHomeEntrance(authHydrated && isHydratedForUid);

  const openGoal = useCallback((item: HomeTaskItem) => {
    router.push({ pathname: "/goal/[id]", params: { id: item.goalId } });
  }, []);

  if (isHomeLoading) {
    return (
      <HomeStateScreen
        styles={styles}
        theme={theme}
        eyebrow="Loading"
        title="Getting your day ready…"
        body="Checking your goals, tasks, and progress for today."
      />
    );
  }

  if (isSignedOut) {
    return (
      <HomeStateScreen
        styles={styles}
        theme={theme}
        eyebrow="Welcome"
        title="Welcome to Dayta"
        body="Sign in to see what needs your attention, what’s coming up, and what you’ve already finished."
      />
    );
  }

  return (
    <Animated.ScrollView
      style={[
        styles.screen,
        { opacity: entrance.opacity, transform: [{ translateY: entrance.translateY }] },
      ]}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <HomeLogo theme={theme} />

      <Text style={styles.greeting}>Good {getTimeOfDayGreeting()}</Text>

      {/* 1. What to do right now */}
      <NowDecisionCard
        styles={styles}
        decision={view.decision}
        pendingCompleteKey={tasks.pendingCompleteKey}
        onComplete={(item) => void tasks.completeTask(item)}
        onOpenGoal={openGoal}
        onQuickPlan={(item, option) => void tasks.quickPlanTask(item, option)}
      />

      {/* 2. Today's counts */}
      <TodayStatsCard styles={styles} stats={view.todayStats} />

      {/* 3. Overdue / unscheduled nudge */}
      {view.recoveryHint ? <RecoveryHintCard styles={styles} hint={view.recoveryHint} /> : null}

      {/* 4–6. Mini lists */}
      <UpcomingSection styles={styles} items={view.upcomingItems} onOpenGoal={openGoal} />
      <NeedsTimeSection
        styles={styles}
        items={view.needsTimeItems}
        onOpenGoal={openGoal}
        onQuickPlan={(item, option) => void tasks.quickPlanTask(item, option)}
      />
      <DoneTodaySection styles={styles} items={view.doneTodayItems} onOpenGoal={openGoal} />
    </Animated.ScrollView>
  );
}
