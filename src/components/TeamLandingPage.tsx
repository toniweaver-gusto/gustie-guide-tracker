import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearGgtActiveWorkspace,
  readGgtWorkspaceId,
  setGgtActiveWorkspace,
} from "@/lib/ggtStorage";
import { formatMT } from "@/lib/formatMT";
import { supabaseConfigured } from "@/lib/supabaseClient";
import {
  createWorkspace,
  deleteWorkspaceById,
  listWorkspacesWithStats,
  updateWorkspaceTeamName,
  type WorkspaceWithStats,
} from "@/lib/workspaceApi";

export function TeamLandingPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<WorkspaceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceWithStats | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const activeWorkspaceId = readGgtWorkspaceId();

  const refreshTeams = useCallback(async () => {
    if (!supabaseConfigured) {
      setLoadError("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setTeams([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      const list = await listWorkspacesWithStats();
      setTeams(list);
    } catch (e) {
      console.error(e);
      setLoadError("Could not load teams. Check Supabase and migration 004.");
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTeams();
  }, [refreshTeams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.team_name.toLowerCase().includes(q));
  }, [teams, search]);

  const openTeam = (t: WorkspaceWithStats) => {
    setGgtActiveWorkspace({ id: t.id, team_name: t.team_name });
    navigate("/dashboard");
  };

  const onCreateTeam = async () => {
    const name = createName.trim();
    if (!name) return;
    if (!supabaseConfigured) {
      alert("Configure Supabase environment variables first.");
      return;
    }
    setCreating(true);
    try {
      const ws = await createWorkspace(name);
      setGgtActiveWorkspace(ws);
      setCreateName("");
      await refreshTeams();
      navigate("/dashboard");
    } catch (e: unknown) {
      console.error(e);
      const msg =
        e && typeof e === "object" && "code" in e && e.code === "23505"
          ? "A team with a similar name already exists. Try a different name."
          : "Could not create team.";
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (t: WorkspaceWithStats) => {
    setEditingId(t.id);
    setEditDraft(t.team_name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async (id: string) => {
    const name = editDraft.trim();
    if (!name) return;
    setSavingEdit(true);
    try {
      await updateWorkspaceTeamName(id, name);
      if (readGgtWorkspaceId() === id) {
        try {
          localStorage.setItem("ggt_team", name);
        } catch {
          /* ignore */
        }
      }
      setEditingId(null);
      setEditDraft("");
      await refreshTeams();
    } catch (e) {
      console.error(e);
      alert("Could not update team name.");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWorkspaceById(deleteTarget.id);
      if (readGgtWorkspaceId() === deleteTarget.id) {
        clearGgtActiveWorkspace();
      }
      setDeleteTarget(null);
      await refreshTeams();
    } catch (e) {
      console.error(e);
      alert("Could not delete team.");
    } finally {
      setDeleting(false);
    }
  };

  const showEmpty = !loading && !loadError && teams.length === 0;
  const showLoadFailure = !loading && !!loadError && teams.length === 0;
  const createSection = (
    <section
      className={`landing-create${showEmpty ? " landing-create--prominent" : ""}`}
    >
      <h2 className="landing-create-heading">Create New Team</h2>
      <div className="landing-create-row">
        <input
          type="text"
          className="landing-create-input"
          placeholder="e.g. TaskUs Payroll, TP Benefits..."
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onCreateTeam()}
        />
        <button
          type="button"
          className="landing-btn landing-btn-primary"
          disabled={!createName.trim() || creating}
          onClick={() => void onCreateTeam()}
        >
          {creating ? "Creating…" : "Create Team →"}
        </button>
      </div>
    </section>
  );

  return (
    <div className="landing-page">
      {deleteTarget ? (
        <div
          className="landing-modal-overlay"
          role="presentation"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="landing-modal"
            role="dialog"
            aria-labelledby="delete-team-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-team-title" className="landing-modal-title">
              Delete team?
            </h2>
            <p className="landing-modal-body">
              Delete <strong>{deleteTarget.team_name}</strong>? This will
              permanently remove all snapshots. This cannot be undone.
            </p>
            <div className="landing-modal-actions">
              <button
                type="button"
                className="landing-btn landing-btn-secondary"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="landing-btn landing-btn-danger"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="landing-header">
        <div className="landing-brand">
          <div className="landing-logo">gusto</div>
          <div>
            <h1 className="landing-title">Gustie Guide Dashboard</h1>
            <p className="landing-subtitle">
              Select your team to view your dashboard or create a new one
            </p>
          </div>
        </div>
      </header>

      <main className="landing-main">
        {!showEmpty ? (
          <div className="landing-search-wrap">
            <label className="landing-search-label" htmlFor="team-search">
              Search teams
            </label>
            <input
              id="team-search"
              type="search"
              className="landing-search-input"
              placeholder="Filter by team name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : null}

        {loading ? (
          <p className="landing-loading">Loading teams…</p>
        ) : showLoadFailure ? (
          <>
            <p className="landing-error" role="alert">
              {loadError}
            </p>
            <div className="landing-create-sep" />
            {createSection}
          </>
        ) : showEmpty ? (
          <div className="landing-empty">
            <div className="landing-empty-icon" aria-hidden>
              👥
            </div>
            <h2 className="landing-empty-title">No teams yet</h2>
            <p className="landing-empty-desc">
              Create your first team workspace to upload training reports.
            </p>
            {createSection}
          </div>
        ) : (
          <>
            {filtered.length === 0 ? (
              <p className="landing-no-match">No teams match your search.</p>
            ) : (
              <section className="landing-grid" aria-label="Team workspaces">
                {filtered.map((t) => {
                  const isCurrent = activeWorkspaceId === t.id;
                  const isEditing = editingId === t.id;
                  return (
                    <article
                      key={t.id}
                      className={`landing-card${isCurrent ? " landing-card--current" : ""}`}
                    >
                      {isCurrent ? (
                        <span className="landing-card-badge">Current</span>
                      ) : null}
                      {isEditing ? (
                        <div className="landing-card-edit">
                          <input
                            type="text"
                            className="landing-card-edit-input"
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEdit(t.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <div className="landing-card-edit-actions">
                            <button
                              type="button"
                              className="landing-btn landing-btn-secondary landing-btn-sm"
                              disabled={savingEdit || !editDraft.trim()}
                              onClick={() => void saveEdit(t.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="landing-btn landing-btn-ghost landing-btn-sm"
                              disabled={savingEdit}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <h3 className="landing-card-name">{t.team_name}</h3>
                      )}
                      <dl className="landing-card-stats">
                        <div>
                          <dt>Snapshots</dt>
                          <dd>{t.snapshot_count}</dd>
                        </div>
                        <div>
                          <dt>Last upload</dt>
                          <dd>
                            {t.latest_uploaded_at != null
                              ? formatMT(t.latest_uploaded_at)
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Agents (latest)</dt>
                          <dd>
                            {t.latest_agent_count != null
                              ? t.latest_agent_count
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                      <div className="landing-card-actions">
                        <button
                          type="button"
                          className="landing-btn landing-btn-primary"
                          onClick={() => openTeam(t)}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="landing-btn landing-btn-secondary"
                          disabled={isEditing}
                          onClick={() => startEdit(t)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="landing-btn landing-btn-danger-subtle"
                          onClick={() => setDeleteTarget(t)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
            <div className="landing-create-sep" />
            {createSection}
          </>
        )}
      </main>
    </div>
  );
}
