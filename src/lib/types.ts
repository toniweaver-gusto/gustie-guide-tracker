/** Single parsed CSV row (all header keys preserved). */
export type RawCSVRow = Record<string, string>;

/** Mirrors the HTML template `DATA` object after CSV processing */
export type ProcessedDashboardData = {
  agents: string[];
  modules: string[];
  module_dates: Record<string, string>;
  agent_modules: Record<string, Record<string, string>>;
  agent_daily: Record<string, Record<string, number>>;
  all_dates: string[];
  pe_names: string[];
  agent_pe: Record<string, string>;
  /** Distinct group labels from GROUP_NAME (sorted). */
  group_names: string[];
  /** Per agent: unique groups they appear in (any row); agent in Team filter if any group matches. */
  agent_groups: Record<string, string[]>;
  program_name: string;
  /** Per agent, per module: best Total Points (0–100). Nested so JSONB has no \\0 in keys. */
  _raw_scores: Record<string, Record<string, number>>;
  /** Full merged raw rows from CSV uploads (for attempt scans, auditing). */
  _all_rows: RawCSVRow[];
  /** Cached attempts per completion (built at import; display helpers prefer `_all_rows`). */
  _raw_attempts: Record<string, Record<string, number>>;
};

export type DashboardRow = {
  share_token: string;
  program_name: string;
  processed_data: ProcessedDashboardData;
};
