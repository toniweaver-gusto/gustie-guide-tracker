import { supabase } from "./supabaseClient";
import type { ProcessedDashboardData } from "./types";

export type DashboardRow = {
  share_token: string;
  program_name: string;
  processed_data: ProcessedDashboardData;
  /** ISO-like timestamp string from Supabase JSON (if RPC returns it). */
  updated_at?: string | null;
};

function parseRpcRow(raw: unknown): DashboardRow | null {
  if (raw == null || typeof raw !== "object") return null;
  const row = raw as {
    share_token?: string;
    program_name?: string;
    processed_data?: ProcessedDashboardData;
    updated_at?: string | null;
  };
  if (!row.share_token || !row.processed_data) return null;
  const ua = row.updated_at;
  const updated_at = typeof ua === "string" ? ua : null;
  return {
    share_token: row.share_token,
    program_name: row.program_name ?? "Training Dashboard",
    processed_data: row.processed_data,
    updated_at,
  };
}

export async function fetchDashboardByToken(
  token: string
): Promise<DashboardRow | null> {
  const { data, error } = await supabase.rpc("get_uplimit_dashboard_by_token", {
    p_token: token,
  });
  if (error) throw error;
  return parseRpcRow(data);
}

/** Most recently updated row (single-tenant / demo use). */
export async function fetchLatestDashboard(): Promise<DashboardRow | null> {
  const { data, error } = await supabase.rpc("get_latest_uplimit_dashboard");
  if (error) throw error;
  return parseRpcRow(data);
}

export async function createDashboard(payload: {
  program_name: string;
  processed_data: ProcessedDashboardData;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_uplimit_dashboard", {
    p_program_name: payload.program_name,
    p_processed_data: payload.processed_data as unknown as Record<
      string,
      unknown
    >,
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("create_uplimit_dashboard returned no token");
  }
  return data;
}

export async function patchDashboard(
  token: string,
  payload: { program_name: string; processed_data: ProcessedDashboardData }
): Promise<void> {
  const { error } = await supabase.rpc("patch_uplimit_dashboard_by_token", {
    p_token: token,
    p_program_name: payload.program_name,
    p_processed_data: payload.processed_data as unknown as Record<
      string,
      unknown
    >,
  });
  if (error) throw error;
}
