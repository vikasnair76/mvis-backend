import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  getDefaultPlannerPreferences,
  subscribePlannerPreferences,
  updatePlannerPreferences,
  type PlannerPreferencesDoc,
} from "../../../services/plannerSuggestions";

export type PlannerPreferencePatch = Partial<
  Omit<PlannerPreferencesDoc, "updatedAtMs">
>;

/** Live planner preferences doc plus a merge-and-save. */
export function usePlannerPreferences(userId: string | null) {
  const [preferences, setPreferences] = useState<PlannerPreferencesDoc>(
    getDefaultPlannerPreferences()
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) {
      setPreferences(getDefaultPlannerPreferences());
      return;
    }
    return subscribePlannerPreferences(userId, setPreferences, () => undefined);
  }, [userId]);

  const save = useCallback(
    async (patch: PlannerPreferencePatch) => {
      if (!userId) {
        Alert.alert("Sign in required", "Sign in to update Planner settings.");
        return;
      }

      setSaving(true);
      try {
        await updatePlannerPreferences(userId, { ...preferences, ...patch });
      } catch {
        Alert.alert("Planner settings not saved", "Please try again in a moment.");
      } finally {
        setSaving(false);
      }
    },
    [userId, preferences]
  );

  return { preferences, saving, save };
}
