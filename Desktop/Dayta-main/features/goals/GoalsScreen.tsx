import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../../services/firebase";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";
import {
  CreateGoalSection,
  GoalsListSection,
  GroupPlanningSection,
  PersonalPlanningSection,
} from "./components";
import {
  useCreateGoalForm,
  useGoals,
  useGroupPlanningBoards,
  usePersonalPlanningBoards,
} from "./hooks";
import { createGoalsStyles } from "./styles/goals.styles";

export function GoalsScreen() {
  const [user, setUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);

  const { theme } = useCurrentAppTheme();
  const styles = useMemo(() => createGoalsStyles(theme), [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const uid = user?.uid ?? null;

  // Feature hooks
  const {
    goals,
    activeGoals,
    completedGoals,
    loading,
    activeGroupMemberships,
    loadingGroupMemberships,
    groupMembershipsError,
  } = useGoals(uid, authReady);

  const {
    planningBoards,
    showCreateBoardForm,
    setShowCreateBoardForm,
    boardTitleInput,
    setBoardTitleInput,
    savingBoard,
    handleCreatePersonalBoard,
    handleArchivePersonalBoard,
  } = usePersonalPlanningBoards(uid, authReady);

  const { groupPlanningBoards, loadingGroupPlanning, groupPlanningError } =
    useGroupPlanningBoards(
      uid,
      authReady,
      activeGroupMemberships,
      loadingGroupMemberships,
      groupMembershipsError
    );

  const createGoalForm = useCreateGoalForm(uid, user);

  if (!authReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Planning Hub</Text>
        <Text style={styles.muted}>Loading account…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Planning Hub</Text>
        <Text style={styles.muted}>
          UID: {uid ?? "none"}
          {"\n"}
          Please sign in on the Settings tab to create and view goals.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Planning Hub</Text>

      {/* 1. Create Goal Card */}
      <CreateGoalSection
        styles={styles}
        showCreateGoal={createGoalForm.showCreateGoal}
        setShowCreateGoal={createGoalForm.setShowCreateGoal}
        title={createGoalForm.title}
        setTitle={createGoalForm.setTitle}
        description={createGoalForm.description}
        setDescription={createGoalForm.setDescription}
        metricType={createGoalForm.metricType}
        setMetricType={createGoalForm.setMetricType}
        metricUnitInput={createGoalForm.metricUnitInput}
        setMetricUnitInput={createGoalForm.setMetricUnitInput}
        metricTargetValueInput={createGoalForm.metricTargetValueInput}
        setMetricTargetValueInput={createGoalForm.setMetricTargetValueInput}
        submitting={createGoalForm.submitting}
        isMetricEnabled={createGoalForm.isMetricEnabled}
        isWeightMetric={createGoalForm.isWeightMetric}
        isCustomMetric={createGoalForm.isCustomMetric}
        lockedMetricUnitLabel={createGoalForm.lockedMetricUnitLabel}
        createGoal={createGoalForm.createGoal}
      />

      {/* 2. Personal Planning Boards */}
      <PersonalPlanningSection
        styles={styles}
        uid={uid}
        planningBoards={planningBoards}
        showCreateBoardForm={showCreateBoardForm}
        setShowCreateBoardForm={setShowCreateBoardForm}
        boardTitleInput={boardTitleInput}
        setBoardTitleInput={setBoardTitleInput}
        savingBoard={savingBoard}
        handleCreatePersonalBoard={handleCreatePersonalBoard}
        handleArchivePersonalBoard={handleArchivePersonalBoard}
      />

      {/* 3. Group Planning Boards */}
      <GroupPlanningSection
        styles={styles}
        loadingGroupPlanning={loadingGroupPlanning}
        groupPlanningError={groupPlanningError}
        groupPlanningBoards={groupPlanningBoards}
      />

      {/* 4. Goals List */}
      <GoalsListSection
        styles={styles}
        goals={goals}
        activeGoals={activeGoals}
        completedGoals={completedGoals}
        loading={loading}
      />
    </ScrollView>
  );
}
