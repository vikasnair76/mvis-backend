import type { HistoryMonthValue } from "../../../components/history/PersonalHistoryTimeline";
import type { HistoryFilter } from "../types/history.types";

/**
 * Module-level, so it outlives the screen. The History tab unmounts when the
 * user switches tabs; this is what lets it come back to the same month,
 * filter, and scroll position. Cleared when the signed-in user changes.
 */
export const historySessionState: {
  ownerUid: string | null;
  month: HistoryMonthValue | null;
  timeZone: string | null;
  filter: HistoryFilter;
  scrollOffset: number;
} = {
  ownerUid: null,
  month: null,
  timeZone: null,
  filter: "all",
  scrollOffset: 0,
};

export function rememberHistorySession(next: {
  ownerUid: string | null;
  month: HistoryMonthValue;
  timeZone: string;
  filter: HistoryFilter;
  scrollOffset?: number;
}) {
  historySessionState.ownerUid = next.ownerUid;
  historySessionState.month = next.month;
  historySessionState.timeZone = next.timeZone;
  historySessionState.filter = next.filter;
  if (typeof next.scrollOffset === "number") {
    historySessionState.scrollOffset = next.scrollOffset;
  }
}

export function resetHistorySession(args: {
  ownerUid: string | null;
  month: HistoryMonthValue | null;
  timeZone: string | null;
}) {
  historySessionState.ownerUid = args.ownerUid;
  historySessionState.month = args.month;
  historySessionState.timeZone = args.timeZone;
  historySessionState.filter = "all";
  historySessionState.scrollOffset = 0;
}
