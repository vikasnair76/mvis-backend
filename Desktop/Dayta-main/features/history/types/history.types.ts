import type { PersonalHistoryCategory } from "../../../services/personalHistory";

/** Timeline category chip. "all" = no category filter on the query. */
export type HistoryFilter =
  | "all"
  | Exclude<PersonalHistoryCategory, "routine" | "system">;

export type HistoryFilterOption = {
  value: HistoryFilter;
  label: string;
  emptyLabel: string;
};

/** The two failure states the UI distinguishes. */
export type HistoryUiError = "permission_denied" | "query_failed";
