import { supabase } from "./supabaseClient";
import type { ProcessedDashboardData } from "./types";
import { teamSlug } from "./teamSlug";

export type Workspace = {
  id: string;
  team_slug: string;
  team_name: string;
};

export type SnapshotSummary = {
  id: string;
  workspace_id: string;
  label: string | null;
  agent_count: number | null;
  module_count: number | null;
  share_token: string;
  uploaded_at: string;
  processed_data: ProcessedDashboardData;
};

/** History list only — avoids loading every snapshot’s JSON. */
export type SnapshotMeta = Omit<SnapshotSummary, "processed_data">;

export async function getOrCreateWorkspace(teamName: string): Promise<Workspace> {
  const team_name = teamName.trim();
  const team_slug = teamSlug(team_name);
  const { data, error } = await supabase
    .from("workspaces")
    .upsert({ team_slug, team_name }, { onConflict: "team_slug" })
    .select("id, team_slug, team_name")
    .single();
  if (error) throw error;
  if (!data) throw new Error("workspace upsert returned no row");
  return data as Workspace;
}

export async function listSnapshotMetas(
  workspaceId: string
): Promise<SnapshotMeta[]> {
  const { data, error } = await supabase
    .from("snapshots")
    .select(
      "id, workspace_id, label, agent_count, module_count, share_token, uploaded_at"
    )
    .eq("workspace_id", workspaceId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SnapshotMeta[];
}

export async function fetchSnapshotById(
  id: string
): Promise<SnapshotSummary | null> {
  const { data, error } = await supabase
    .from("snapshots")
    .select(
      "id, workspace_id, label, agent_count, module_count, share_token, uploaded_at, processed_data"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as SnapshotSummary;
}

export async function insertSnapshot(
  workspaceId: string,
  payload: {
    label: string;
    agent_count: number;
    module_count: number;
    processed_data: ProcessedDashboardData;
  }
): Promise<{ id: string; share_token: string; uploaded_at: string }> {
  const { data, error } = await supabase
    .from("snapshots")
    .insert({
      workspace_id: workspaceId,
      label: payload.label,
      agent_count: payload.agent_count,
      module_count: payload.module_count,
      processed_data: payload.processed_data as unknown as Record<string, unknown>,
    })
    .select("id, share_token, uploaded_at")
    .single();
  if (error) throw error;
  if (!data) throw new Error("insert snapshot returned no row");
  return data as { id: string; share_token: string; uploaded_at: string };
}

export async function fetchSnapshotByShareToken(
  shareToken: string
): Promise<SnapshotSummary | null> {
  const { data, error } = await supabase
    .from("snapshots")
    .select(
      "id, workspace_id, label, agent_count, module_count, share_token, uploaded_at, processed_data"
    )
    .eq("share_token", shareToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as SnapshotSummary;
}
