import React from "react";
import { HomeScreen } from "../../features/home";

/**
 * Expo Router Navigation Destination for the Home Tab.
 *
 * Architecture Rule: Keep route files thin (single responsibility: routing).
 * All UI, state management, and business logic live in @/features/home.
 */
export default function HomeRoute() {
  return <HomeScreen />;
}
