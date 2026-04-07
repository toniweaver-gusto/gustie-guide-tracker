/** Active team context for dashboard (no auth). */
export const GGT_TEAM_KEY = "ggt_team";
export const GGT_WORKSPACE_ID_KEY = "ggt_workspace_id";

export function readGgtTeam(): string | null {
  try {
    const t = localStorage.getItem(GGT_TEAM_KEY);
    return t?.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function readGgtWorkspaceId(): string | null {
  try {
    const id = localStorage.getItem(GGT_WORKSPACE_ID_KEY)?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export function setGgtActiveWorkspace(workspace: {
  id: string;
  team_name: string;
}): void {
  try {
    localStorage.setItem(GGT_TEAM_KEY, workspace.team_name);
    localStorage.setItem(GGT_WORKSPACE_ID_KEY, workspace.id);
  } catch {
    /* ignore */
  }
}

export function clearGgtActiveWorkspace(): void {
  try {
    localStorage.removeItem(GGT_TEAM_KEY);
    localStorage.removeItem(GGT_WORKSPACE_ID_KEY);
  } catch {
    /* ignore */
  }
}
