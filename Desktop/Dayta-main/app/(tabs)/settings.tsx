import React from "react";
import { SettingsScreen } from "../../features/settings";

/**
 * Expo Router Navigation Destination for the Settings Tab.
 *
 * Architecture Rule: Keep route files thin (single responsibility: routing).
 * All UI, state management, and business logic live in @/features/settings.
 */
export default function SettingsRoute() {
  return <SettingsScreen />;
}
