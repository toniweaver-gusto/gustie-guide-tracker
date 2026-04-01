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
  program_name: string;
  /** Per agent, per module: best Total Points (0–100). Nested so JSONB has no \\0 in keys. */
  _raw_scores: Record<string, Record<string, number>>;
};

export type DashboardRow = {
  share_token: string;
  program_name: string;
  processed_data: ProcessedDashboardData;
};
