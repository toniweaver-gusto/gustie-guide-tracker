import { supabase } from "./supabaseClient";
import type { ProcessedDashboardData } from "./types";

export type DashboardRow = {
  share_token: string;
  program_name: string;
  processed_data: ProcessedDashboardData;
};

export async function fetchDashboardByToken(
  token: string
): Promise<DashboardRow | null> {
  const { data, error } = await supabase.rpc("get_uplimit_dashboard_by_token", {
    p_token: token,
  });
  if (error) throw error;
  if (data == null) return null;
  const row = data as {
    share_token: string;
    program_name: string;
    processed_data: ProcessedDashboardData;
  };
  if (!row.share_token || !row.processed_data) return null;
  return row;
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
