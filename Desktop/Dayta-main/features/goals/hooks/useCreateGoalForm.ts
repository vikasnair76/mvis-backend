import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { db } from "../../../services/firebase";
import { normalizeGoalInput } from "../../../services/goalNormalization";
import type { GoalFormInput, MetricType } from "../types/goals.types";

export function useCreateGoalForm(uid: string | null, user: FirebaseUser | null) {
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metricType, setMetricType] = useState<MetricType>("none");
  const [metricUnitInput, setMetricUnitInput] = useState("");
  const [metricTargetValueInput, setMetricTargetValueInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const metricTypeLabel = useMemo(() => metricType, [metricType]);
  const isMetricEnabled = metricType !== "none";
  const isWeightMetric = metricType === "weight";
  const isCustomMetric = metricType === "custom";

  const lockedMetricUnitLabel = useMemo(() => {
    switch (metricType) {
      case "hours":
        return "hours";
      case "pages":
        return "pages";
      case "reps":
        return "reps";
      default:
        return null;
    }
  }, [metricType]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setMetricType("none");
    setMetricUnitInput("");
    setMetricTargetValueInput("");
  };

  const createGoal = async () => {
    if (!user || !uid) {
      Alert.alert("Sign in required", "Please sign in on the Settings tab first.");
      return;
    }

    const formInput: GoalFormInput = {
      title,
      description,
      metricType,
      metricUnitInput,
      metricTargetValueInput,
    };

    let normalized;
    try {
      normalized = normalizeGoalInput(formInput);
    } catch (e: any) {
      Alert.alert("Invalid goal", e?.message ?? "Please review your goal details.");
      return;
    }

    const goalDoc = {
      userId: uid,
      ...normalized,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    };

    try {
      setSubmitting(true);
      await addDoc(collection(db, "goals"), goalDoc);
      resetForm();
      Alert.alert("Created!", "Your goal was added.");
    } catch (e: any) {
      Alert.alert("Create failed", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    showCreateGoal,
    setShowCreateGoal,
    title,
    setTitle,
    description,
    setDescription,
    metricType,
    setMetricType,
    metricUnitInput,
    setMetricUnitInput,
    metricTargetValueInput,
    setMetricTargetValueInput,
    submitting,
    metricTypeLabel,
    isMetricEnabled,
    isWeightMetric,
    isCustomMetric,
    lockedMetricUnitLabel,
    resetForm,
    createGoal,
  };
}
