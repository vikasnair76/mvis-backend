import React from "react";
import { CalendarScreen } from "../../features/calendar";

/**
 * Expo Router Navigation Destination for the Calendar Tab.
 *
 * Architecture Rule: Keep route files thin (single responsibility: routing).
 * All UI, state management, and business logic live in @/features/calendar.
 */
export default function CalendarRoute() {
  return <CalendarScreen />;
}
