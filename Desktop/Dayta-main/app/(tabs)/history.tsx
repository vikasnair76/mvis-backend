import React from "react";
import { HistoryScreen } from "../../features/history";

/**
 * Expo Router Navigation Destination for the History Tab.
 *
 * Architecture Rule: Keep route files thin (single responsibility: routing).
 * All UI, state management, and business logic live in @/features/history.
 */
export default function HistoryRoute() {
  return <HistoryScreen />;
}
