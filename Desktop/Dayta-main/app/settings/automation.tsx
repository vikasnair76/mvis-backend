import { Link } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { auth, db } from "../../services/firebase";


type CalendarRuleType =
  | "auto_link"
  | "auto_apply_duration"
  | "suggest_subtask";

type CalendarRule = {
  id: string;
  userId: string;
  type: CalendarRuleType;
  matchText: string;
  goalId: string;
  subtaskId: string;
  createdAtMs?: number | null;
};



type Goal = {
  id: string;
  title: string;
};

type Subtask = {
  id: string;
  title: string;
};

type RuleRow = CalendarRule & {
  goalTitle: string;
  subtaskTitle: string;
};

type RuleInvalidReason =
  | "missing_goal"
  | "missing_subtask"
  | "missing_target_data";

type ValidatedRuleRow = RuleRow & {
  isValid: boolean;
  invalidReason: RuleInvalidReason | null;
};

export default function AutomationSettingsScreen() {
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [rules, setRules] = useState<CalendarRule[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subtasksByGoal, setSubtasksByGoal] = useState<Record<string, Subtask[]>>(
    {}
  );

  const [rulesLoading, setRulesLoading] = useState(true);
  const [goalsLoading, setGoalsLoading] = useState(true);

    const handleDeleteRule = (rule: RuleRow) => {
    Alert.alert(
      "Delete saved preference",
      `Remove this ${formatRuleTypeLabel(rule.type).toLowerCase()} rule?\n\n${rule.matchText}\n→ ${rule.goalTitle} / ${rule.subtaskTitle}`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "users", rule.userId, "calendarRules", rule.id));

              console.log("[AutomationSettings] rule deleted", {
                ruleId: rule.id,
                type: rule.type,
                matchText: rule.matchText,
                goalId: rule.goalId,
                subtaskId: rule.subtaskId,
              });
            } catch (error) {
              console.error("[AutomationSettings] failed to delete rule", error);
              Alert.alert(
                "Delete failed",
                error instanceof Error ? error.message : "Unknown error"
              );
            }
          },
        },
      ]
    );
  };

    const handleClearRuleCategory = (
    type: CalendarRuleType,
    rulesForType: RuleRow[]
  ) => {
    if (rulesForType.length === 0) {
      Alert.alert("Nothing to clear", "There are no saved rules in this section.");
      return;
    }

    Alert.alert(
      `Clear ${formatRuleTypeLabel(type)} rules`,
      `Remove all ${rulesForType.length} saved rule(s) in this section?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              await Promise.all(
                rulesForType.map((rule) =>
                  deleteDoc(doc(db, "users", rule.userId, "calendarRules", rule.id))
                )
              );

              console.log("[AutomationSettings] category cleared", {
                type,
                deletedCount: rulesForType.length,
              });
            } catch (error) {
              console.error("[AutomationSettings] failed to clear category", error);
              Alert.alert(
                "Clear failed",
                error instanceof Error ? error.message : "Unknown error"
              );
            }
          },
        },
      ]
    );
  };

    const handleClearAllRules = () => {
    if (ruleRows.length === 0) {
      Alert.alert("Nothing to clear", "There are no saved automation preferences.");
      return;
    }

    Alert.alert(
      "Clear all preferences",
      `Remove all ${ruleRows.length} saved automation preference(s)? This will clear auto-link, auto-apply, and suggestion rules.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              await Promise.all(
                ruleRows.map((rule) =>
                  deleteDoc(doc(db, "users", rule.userId, "calendarRules", rule.id))
                )
              );

              console.log("[AutomationSettings] all rules cleared", {
                deletedCount: ruleRows.length,
              });
            } catch (error) {
              console.error("[AutomationSettings] failed to clear all rules", error);
              Alert.alert(
                "Clear failed",
                error instanceof Error ? error.message : "Unknown error"
              );
            }
          },
        },
      ]
    );
  };

  const handleClearUnavailableRules = () => {
  if (invalidRuleRows.length === 0) {
    Alert.alert("Nothing to clear", "There are no unavailable preferences.");
    return;
  }

  Alert.alert(
    "Clear unavailable preferences",
    `Remove all ${invalidRuleRows.length} unavailable preference(s)?`,
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Clear All",
        style: "destructive",
        onPress: async () => {
          try {
            await Promise.all(
              invalidRuleRows.map((rule) =>
                deleteDoc(doc(db, "users", rule.userId, "calendarRules", rule.id))
              )
            );

            console.log("[AutomationSettings] unavailable rules cleared", {
              deletedCount: invalidRuleRows.length,
            });
          } catch (error) {
            console.error(
              "[AutomationSettings] failed to clear unavailable rules",
              error
            );
            Alert.alert(
              "Clear failed",
              error instanceof Error ? error.message : "Unknown error"
            );
          }
        },
      },
    ]
  );
};

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
      setAuthReady(true);
    });

    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !userId) {
      setRules([]);
      setRulesLoading(false);
      return;
    }

    setRulesLoading(true);

    const rulesRef = collection(db, "users", userId as string, "calendarRules");
    const q = query(
      rulesRef,
      where("userId", "==", userId),
      orderBy("matchText")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: CalendarRule[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as Omit<CalendarRule, "id">;
          return {
            id: docSnap.id,
            ...data,
          };
        });

        setRules(next);
        setRulesLoading(false);
      },
      (error) => {
        console.error("[AutomationSettings] rules load failed", error);
        setRules([]);
        setRulesLoading(false);
      }
    );

    return unsub;
  }, [authReady, userId]);

  useEffect(() => {
    if (!authReady || !userId) {
      setGoals([]);
      setSubtasksByGoal({});
      setGoalsLoading(false);
      return;
    }

    setGoalsLoading(true);

    const goalsRef = collection(db, "goals");
    const q = query(goalsRef, where("userId", "==", userId));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const nextGoals: Goal[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            title: typeof data.title === "string" ? data.title : "Untitled goal",
          };
        });

        setGoals(nextGoals);
        setGoalsLoading(false);
      },
      (error) => {
        console.error("[AutomationSettings] goals load failed", error);
        setGoals([]);
        setGoalsLoading(false);
      }
    );

    return unsub;
  }, [authReady, userId]);

  useEffect(() => {
  if (!authReady || !userId) {
    setSubtasksByGoal({});
    return;
  }

  if (goals.length === 0) {
    setSubtasksByGoal({});
    return;
  }

  setSubtasksByGoal((prev) => {
    const next: Record<string, Subtask[]> = {};

    for (const goal of goals) {
      if (prev[goal.id]) {
        next[goal.id] = prev[goal.id];
      }
    }

    return next;
  });

  const unsubscribers: Array<() => void> = [];

  for (const goal of goals) {
    const subtasksRef = collection(db, "goals", goal.id, "subtasks");

    const unsub = onSnapshot(
      subtasksRef,
      (snap) => {
        const nextSubtasks: Subtask[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;

          return {
            id: docSnap.id,
            title:
              typeof data.title === "string"
                ? data.title
                : "Untitled subtask",
          };
        });

        setSubtasksByGoal((prev) => ({
          ...prev,
          [goal.id]: nextSubtasks,
        }));
      },
      (error) => {
        console.error(
          "[AutomationSettings] subtasks load failed",
          goal.id,
          error
        );

        setSubtasksByGoal((prev) => ({
          ...prev,
          [goal.id]: [],
        }));
      }
    );

    unsubscribers.push(unsub);
  }

  return () => {
    unsubscribers.forEach((fn) => fn());
  };
}, [authReady, userId, goals]);

  const goalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const goal of goals) {
      map.set(goal.id, goal.title);
    }
    return map;
  }, [goals]);

  const subtaskIdsByGoalId = useMemo(() => {
  const map = new Map<string, Set<string>>();

  for (const goal of goals) {
    const subtasks = subtasksByGoal[goal.id] ?? [];
    map.set(
      goal.id,
      new Set(
        subtasks
          .map((subtask) => (typeof subtask?.id === "string" ? subtask.id : null))
          .filter((value): value is string => !!value)
      )
    );
  }

  return map;
}, [goals, subtasksByGoal]);

useEffect(() => {
  console.log("[AutomationSettings][SubtasksByGoal]", {
    goalIds: Object.keys(subtasksByGoal),
    subtaskIdsByGoal: Object.fromEntries(
      Object.entries(subtasksByGoal).map(([goalId, subtasks]) => [
        goalId,
        subtasks.map((subtask) => subtask.id),
      ])
    ),
  });
}, [subtasksByGoal]);

  const ruleRows = useMemo<RuleRow[]>(() => {
    return rules.map((rule) => {
      const goalTitle = goalTitleById.get(rule.goalId) ?? "Deleted goal";
      const subtaskTitle =
        subtasksByGoal[rule.goalId]?.find((subtask) => subtask.id === rule.subtaskId)
          ?.title ?? "Deleted subtask";

      return {
        ...rule,
        goalTitle,
        subtaskTitle,
      };
    });
  }, [rules, goalTitleById, subtasksByGoal]);

  const validatedRuleRows = useMemo<ValidatedRuleRow[]>(() => {
  return ruleRows.map((rule) => {
    const goalId =
      typeof rule.goalId === "string" && rule.goalId.trim().length > 0
        ? rule.goalId.trim()
        : null;

    const subtaskId =
      typeof rule.subtaskId === "string" && rule.subtaskId.trim().length > 0
        ? rule.subtaskId.trim()
        : null;

    if (!goalId || !subtaskId) {
      return {
        ...rule,
        isValid: false,
        invalidReason: "missing_target_data",
      };
    }

    const goalExists = goalTitleById.has(goalId);
    if (!goalExists) {
      return {
        ...rule,
        isValid: false,
        invalidReason: "missing_goal",
      };
    }

    const subtaskIds = subtaskIdsByGoalId.get(goalId) ?? new Set<string>();
    if (!subtaskIds.has(subtaskId)) {
      return {
        ...rule,
        isValid: false,
        invalidReason: "missing_subtask",
      };
    }

    return {
      ...rule,
      isValid: true,
      invalidReason: null,
    };
  });
}, [ruleRows, goalTitleById, subtaskIdsByGoalId]);

const invalidRuleRows = useMemo(
  () => validatedRuleRows.filter((rule) => !rule.isValid),
  [validatedRuleRows]
);

  const autoLinkRules = useMemo(
  () =>
    validatedRuleRows.filter(
      (rule) => rule.isValid && rule.type === "auto_link"
    ),
  [validatedRuleRows]
);

const autoApplyRules = useMemo(
  () =>
    validatedRuleRows.filter(
      (rule) => rule.isValid && rule.type === "auto_apply_duration"
    ),
  [validatedRuleRows]
);

const suggestRules = useMemo(
  () =>
    validatedRuleRows.filter(
      (rule) => rule.isValid && rule.type === "suggest_subtask"
    ),
  [validatedRuleRows]
);

  useEffect(() => {
  if (!authReady || !userId) return;

  console.log("[AutomationSettings][Validation]", {
    totalRules: ruleRows.length,
    invalidRules: invalidRuleRows.length,
    invalidBreakdown: invalidRuleRows.map((rule) => ({
      id: rule.id,
      type: rule.type,
      matchText: rule.matchText,
      goalId: rule.goalId,
      subtaskId: rule.subtaskId,
      invalidReason: rule.invalidReason,
    })),
  });
}, [authReady, userId, ruleRows, invalidRuleRows]);

  const loading = rulesLoading || goalsLoading;

  return (
    <ScrollView contentContainerStyle={styles.container}>
           <Text style={styles.title}>Automation Preferences</Text>
      <Text style={styles.subtitle}>
        Review what the app has learned for linking, suggestions, and duration
        automation.
      </Text>

      <View style={styles.topActionsRow}>
        <Link href="/settings" asChild>
          <Pressable style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back to Settings</Text>
          </Pressable>
        </Link>

        <Pressable
          onPress={handleClearAllRules}
          style={styles.clearAllBtn}
        >
          <Text style={styles.clearAllBtnText}>Clear All Preferences</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading preferences...</Text>
        </View>
      ) : (
        <>
                              <RuleSection
            title="Auto-link Rules"
            description="Events with these titles can auto-link to the saved subtask."
            rules={autoLinkRules}
            emptyText="No auto-link rules saved yet."
            onDeleteRule={handleDeleteRule}
            onClearSection={() =>
              handleClearRuleCategory("auto_link", autoLinkRules)
            }
          />

          <RuleSection
            title="Auto-apply Duration"
            description="Event duration can automatically add progress to these subtasks."
            rules={autoApplyRules}
            emptyText="No auto-apply duration rules saved yet."
            onDeleteRule={handleDeleteRule}
            onClearSection={() =>
              handleClearRuleCategory("auto_apply_duration", autoApplyRules)
            }
          />

          <RuleSection
            title="Suggestion Preferences"
            description="These saved preferences boost future event-to-task suggestions."
            rules={suggestRules}
            emptyText="No suggestion preferences saved yet."
            onDeleteRule={handleDeleteRule}
            onClearSection={() =>
              handleClearRuleCategory("suggest_subtask", suggestRules)
            }
          />
            <UnavailableRuleSection
  rules={invalidRuleRows}
  onDeleteRule={handleDeleteRule}
  onClearSection={handleClearUnavailableRules}
/>
          
        </>
        
      )}
    </ScrollView>
    
  );
}

function formatRuleTypeLabel(type: CalendarRuleType) {
  switch (type) {
    case "auto_link":
      return "Auto-link";
    case "auto_apply_duration":
      return "Auto-apply Duration";
    case "suggest_subtask":
      return "Suggestion Preference";
    default:
      return "Rule";
  }
}

function formatInvalidReasonLabel(reason: RuleInvalidReason | null) {
  switch (reason) {
    case "missing_goal":
      return "Goal no longer exists";
    case "missing_subtask":
      return "Subtask no longer exists";
    case "missing_target_data":
      return "Missing target data";
    default:
      return "Unavailable target";
  }
}

function UnavailableRuleSection({
  rules,
  onDeleteRule,
  onClearSection,
}: {
  rules: ValidatedRuleRow[];
  onDeleteRule: (rule: RuleRow) => void;
  onClearSection: () => void;
}) {
  if (rules.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
  Unavailable Preferences ({rules.length})
</Text>

        <Pressable
  onPress={onClearSection}
  style={styles.clearSectionBtn}
>
  <Text style={styles.clearSectionBtnText}>Clear unavailable</Text>
</Pressable>
      </View>

      <Text style={styles.sectionDescription}>
        These saved preferences reference goals or subtasks that no longer exist.
      </Text>

      {rules.map((rule) => (
        <View key={rule.id} style={[styles.ruleCard, styles.unavailableRuleCard]}>
          <View style={styles.ruleTopRow}>
            <Text style={styles.ruleMatchText}>{rule.matchText}</Text>

            <Pressable
              onPress={() => onDeleteRule(rule)}
              style={styles.deleteBtn}
            >
              <Text style={styles.deleteBtnText}>Delete</Text>
            </Pressable>
          </View>

          <Text style={styles.ruleArrow}>→</Text>

          <Text style={styles.ruleTarget}>
            {rule.goalTitle} / {rule.subtaskTitle}
          </Text>

          <Text style={styles.unavailableRuleTypeText}>
            {formatRuleTypeLabel(rule.type)}
          </Text>

          <View style={styles.unavailableReasonBadgeRow}>
            <Text style={styles.unavailableReasonBadge}>
              {formatInvalidReasonLabel(rule.invalidReason)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function RuleSection({
  title,
  description,
  rules,
  emptyText,
  onDeleteRule,
  onClearSection,
}: {
  title: string;
  description: string;
  rules: RuleRow[];
  emptyText: string;
  onDeleteRule: (rule: RuleRow) => void;
  onClearSection: () => void;
}) {
  return (
        <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{title}</Text>

        <Pressable
          onPress={onClearSection}
          style={styles.clearSectionBtn}
        >
          <Text style={styles.clearSectionBtnText}>Clear All</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionDescription}>{description}</Text>

      {rules.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
                rules.map((rule) => (
          <View key={rule.id} style={styles.ruleCard}>
            <View style={styles.ruleTopRow}>
              <Text style={styles.ruleMatchText}>{rule.matchText}</Text>

              <Pressable
                onPress={() => onDeleteRule(rule)}
                style={styles.deleteBtn}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>

            <Text style={styles.ruleArrow}>→</Text>
            <Text style={styles.ruleTarget}>
              {rule.goalTitle} / {rule.subtaskTitle}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#eee",
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  sectionDescription: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
  emptyCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f3f3f3",
  },
  emptyText: {
    fontSize: 14,
    color: "#777",
  },
  ruleCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e6e6",
    gap: 4,
  },
  ruleMatchText: {
    fontSize: 15,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  ruleArrow: {
    fontSize: 14,
    color: "#666",
  },
  ruleTarget: {
    fontSize: 14,
    color: "#333",
  },
    ruleTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  deleteBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#b91c1c",
  },
    sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  clearSectionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  clearSectionBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#b91c1c",
    textAlign: "center",
  },
    topActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  clearAllBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
  },
  clearAllBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#b91c1c",
  },
  unavailableRuleCard: {
  backgroundColor: "#fff7ed",
  borderColor: "#fed7aa",
},

unavailableRuleTypeText: {
  marginTop: 4,
  fontSize: 12,
  fontWeight: "700",
  color: "#9a3412",
},

unavailableReasonBadgeRow: {
  flexDirection: "row",
  marginTop: 8,
},

unavailableReasonBadge: {
  fontSize: 11,
  fontWeight: "800",
  color: "#9a3412",
  backgroundColor: "#ffedd5",
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  overflow: "hidden",
},
});