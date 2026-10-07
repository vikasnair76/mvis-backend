import React from "react";
import { GoalsScreen } from "../../features/goals";

/**
 * Expo Router Navigation Destination for the Goals Tab.
 *
 * Architecture Rule: Keep route files thin (single responsibility: routing).
 * All UI, state management, and business logic live in @/features/goals.
 */
export default function GoalsRoute() {
  return <GoalsScreen />;
}
