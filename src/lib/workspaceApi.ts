import { supabase } from "./supabaseClient";
import type { ProcessedDashboardData } from "./types";
import { teamSlug } from "./teamSlug";

export type Workspace = {
  id: string;
  team_slug: string;
  team_name: string;
  created_at?: string;
};

export type WorkspaceWithStats = Workspace & {
  snapshot_count: number;
  latest_uploaded_at: string | null;
  latest_agent_count: number | null;
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

export async function fetchWorkspaceById(id: string): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, team_slug, team_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Workspace) ?? null;
}

export async function listWorkspacesWithStats(): Promise<WorkspaceWithStats[]> {
  const { data: workspaces, error: wErr } = await supabase
    .from("workspaces")
    .select("id, team_slug, team_name, created_at")
    .order("team_name");
  if (wErr) throw wErr;
  const { data: snaps, error: sErr } = await supabase
    .from("snapshots")
    .select("workspace_id, uploaded_at, agent_count");
  if (sErr) throw sErr;

  const byWs = new Map<
    string,
    Array<{ uploaded_at: string; agent_count: number | null }>
  >();
  for (const s of snaps ?? []) {
    const wid = s.workspace_id as string;
    const list = byWs.get(wid) ?? [];
    list.push({
      uploaded_at: s.uploaded_at as string,
      agent_count: s.agent_count as number | null,
    });
    byWs.set(wid, list);
  }

  return (workspaces ?? []).map((w) => {
    const row = w as Workspace;
    const list = byWs.get(row.id) ?? [];
    list.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    const latest = list[0];
    return {
      ...row,
      snapshot_count: list.length,
      latest_uploaded_at: latest?.uploaded_at ?? null,
      latest_agent_count: latest?.agent_count ?? null,
    };
  });
}

export async function createWorkspace(teamName: string): Promise<Workspace> {
  const team_name = teamName.trim();
  const team_slug = teamSlug(team_name);
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ team_slug, team_name })
    .select("id, team_slug, team_name, created_at")
    .single();
  if (error) throw error;
  if (!data) throw new Error("create workspace returned no row");
  return data as Workspace;
}

export async function updateWorkspaceTeamName(
  id: string,
  teamName: string
): Promise<void> {
  const team_name = teamName.trim();
  const { error } = await supabase
    .from("workspaces")
    .update({ team_name })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteWorkspaceById(id: string): Promise<void> {
  const { error } = await supabase.from("workspaces").delete().eq("id", id);
  if (error) throw error;
}

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
