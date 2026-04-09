import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { addDays } from "@/lib/periodMode";
import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  completionIsoMatchesDashboardFilters,
  filterAgentsList,
  filterModulesForViews,
} from "@/lib/dashboardFiltering";
import { getWeekStart } from "@/lib/dashboardHelpers";
import { formatDate, formatWeekOfLabel } from "@/lib/formatDate";
import {
  applyPicklistItemToggle,
  picklistButtonLabel,
  toggleAllPicklist,
  type PicklistSelection,
} from "@/lib/picklistEngine";
import type { ProcessedDashboardData } from "@/lib/types";
import {
  computeTeamCompletionTrend,
  getManagerViewTrendWeekStarts,
} from "@/lib/overviewMetrics";
import { buildCoachingAlerts } from "@/lib/coachingAlerts";
import { FilterPicklist } from "@/components/FilterPicklist";

type MgrSlice = {
  open: boolean;
  search: string;
  selected: PicklistSelection;
};

function inIsoRange(iso: string, from: string, to: string): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

function normAgentKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Minimal CSV row split (handles quoted fields). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === "," && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseLeadRosterCsv(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return new Map();
  const header = splitCsvLine(lines[0]!).map((c) =>
    c.replace(/^"|"$/g, "").trim()
  );
  const ai = header.findIndex((h) => h.toLowerCase() === "agent name");
  const li = header.findIndex((h) => h.toLowerCase() === "lead name");
  if (ai < 0 || li < 0) return new Map();
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i]!);
    const agent = row[ai]?.replace(/^"|"$/g, "").trim() ?? "";
    const lead = row[li]?.replace(/^"|"$/g, "").trim() ?? "";
    if (agent) map.set(normAgentKey(agent), lead || "—");
  }
  return map;
}

export function ManagerViewPane({
  data,
  filters,
}: {
  data: ProcessedDashboardData;
  filters: DashboardFilters;
}): ReactNode {
  const [mgrSlice, setMgrSlice] = useState<MgrSlice>({
    open: false,
    search: "",
    selected: null,
  });
  const [mgrFrom, setMgrFrom] = useState("");
  const [mgrTo, setMgrTo] = useState("");
  const [leadRoster, setLeadRoster] = useState<Map<string, string> | null>(
    null
  );
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const leadFileRef = useRef<HTMLInputElement>(null);

  const peAll = useMemo(() => [...data.pe_names].sort(), [data.pe_names]);

  const agentsTop = useMemo(
    () => filterAgentsList(data, filters),
    [data, filters]
  );

  const agentsAfterPe = useMemo(() => {
    const sel = mgrSlice.selected;
    if (sel === null) return agentsTop;
    if (sel.length === 0) return [];
    return agentsTop.filter((a) =>
      sel.includes(data.agent_pe[a] || "—")
    );
  }, [agentsTop, mgrSlice.selected, data.agent_pe]);

  const agents = useMemo(() => {
    if (!leadRoster || selectedLead === null) return agentsAfterPe;
    return agentsAfterPe.filter((a) => {
      const lead = leadRoster.get(normAgentKey(a));
      return lead === selectedLead;
    });
  }, [agentsAfterPe, leadRoster, selectedLead]);

  const leadNames = useMemo(() => {
    if (!leadRoster) return [];
    return [...new Set(leadRoster.values())].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [leadRoster]);

  const loadLeadRoster = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const map = parseLeadRosterCsv(text);
        setLeadRoster(map.size ? map : null);
        setSelectedLead(null);
        if (!map.size) {
          alert(
            'Could not parse roster. Expected header row with columns "Agent Name" and "Lead Name".'
          );
        }
      };
      reader.readAsText(f);
      e.target.value = "";
    },
    []
  );

  const filterByLead = useCallback((lead: string | null) => {
    setSelectedLead(lead);
  }, []);

  const clearLeadRoster = useCallback(() => {
    setLeadRoster(null);
    setSelectedLead(null);
    if (leadFileRef.current) leadFileRef.current.value = "";
  }, []);

  const modulesBase = useMemo(
    () => filterModulesForViews(data, filters),
    [data, filters]
  );

  const modules = useMemo(() => {
    if (!mgrFrom && !mgrTo) return modulesBase;
    return modulesBase.filter((m) => {
      const rd = data.module_dates[m];
      if (!rd) return false;
      return inIsoRange(rd, mgrFrom, mgrTo);
    });
  }, [modulesBase, data.module_dates, mgrFrom, mgrTo]);

  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);

  const kpis = useMemo(() => {
    let slots = 0;
    let completions = 0;
    let onTime = 0;
    let completedTracked = 0;
    let overdue = 0;
    const lastDates: string[] = [];
    const rangeOn = Boolean(mgrFrom || mgrTo);

    agents.forEach((a) => {
      const done = data.agent_modules[a] || {};
      modules.forEach((mod) => {
        slots++;
        const rel = data.module_dates[mod];
        const comp = done[mod];
        if (comp) {
          if (rangeOn && !inIsoRange(comp, mgrFrom, mgrTo)) {
            if (rel && getWeekStart(rel) < todayWeek) overdue++;
            return;
          }
          completions++;
          lastDates.push(comp);
          if (rel) {
            completedTracked++;
            const due = addDays(rel, 7);
            if (comp <= due) onTime++;
          }
        } else if (rel && getWeekStart(rel) < todayWeek) {
          overdue++;
        }
      });
    });

    const coverage =
      slots > 0 ? Math.round((completions / slots) * 100) : 0;
    const adherence =
      completedTracked > 0
        ? Math.round((onTime / completedTracked) * 100)
        : 0;
    const lastActive =
      lastDates.length > 0
        ? lastDates.sort().slice(-1)[0]!
        : null;

    return { coverage, adherence, overdue, lastActive };
  }, [agents, modules, data, mgrFrom, mgrTo, todayWeek]);

  const mgrChartWeeks = useMemo(
    () => getManagerViewTrendWeekStarts(data, filters, mgrFrom, mgrTo),
    [data, filters, mgrFrom, mgrTo]
  );

  const trend = useMemo(() => {
    if (!agents.length || !modules.length || !mgrChartWeeks.length) return [];
    const currentWeekStart = getWeekStart(
      new Date().toISOString().slice(0, 10)
    );
    return computeTeamCompletionTrend(
      mgrChartWeeks,
      data,
      agents,
      modules,
      {
        currentWeekStart,
        completionIsoOk: (iso) =>
          inIsoRange(iso, mgrFrom, mgrTo) &&
          completionIsoMatchesDashboardFilters(filters, iso),
      }
    );
  }, [agents, modules, data, mgrFrom, mgrTo, filters, mgrChartWeeks]);

  const heatRows = useMemo(() => {
    return agents.slice(0, 40).map((a) => {
      const cells = mgrChartWeeks.map((wk) => {
        let n = 0;
        modules.forEach((m) => {
          const comp = data.agent_modules[a]?.[m];
          if (!comp || getWeekStart(comp) !== wk) return;
          if (!inIsoRange(comp, mgrFrom, mgrTo)) return;
          if (!completionIsoMatchesDashboardFilters(filters, comp)) return;
          n++;
        });
        const intensity =
          n === 0 ? 0 : n === 1 ? 1 : n < 3 ? 2 : 3;
        return { wk, n, intensity };
      });
      return { a, cells };
    });
  }, [agents, mgrChartWeeks, modules, data.agent_modules, mgrFrom, mgrTo, filters]);

  const missedModules = useMemo(() => {
    const rows: { mod: string; gap: number }[] = [];
    modules.forEach((mod) => {
      let gap = 0;
      agents.forEach((a) => {
        if (!data.agent_modules[a]?.[mod]) gap++;
      });
      if (gap > 0) rows.push({ mod, gap });
    });
    rows.sort((x, y) => y.gap - x.gap);
    return rows.slice(0, 15);
  }, [modules, agents, data.agent_modules]);

  const agentCards = useMemo(() => {
    return agents.slice(0, 24).map((a) => {
      const done = modules.filter((m) => data.agent_modules[a]?.[m]).length;
      const pct =
        modules.length > 0 ? Math.round((done / modules.length) * 100) : 0;
      let od = 0;
      modules.forEach((m) => {
        if (data.agent_modules[a]?.[m]) return;
        const rel = data.module_dates[m];
        if (rel && getWeekStart(rel) < todayWeek) od++;
      });
      const dates = Object.values(data.agent_modules[a] || {});
      const last = dates.length ? dates.sort().slice(-1)[0]! : null;
      return { a, pct, od, last, mgr: data.agent_pe[a] || "—" };
    });
  }, [agents, modules, data, todayWeek]);

  const toggleMgrOpen = useCallback(() => {
    setMgrSlice((s) => ({ ...s, open: !s.open }));
  }, []);
  const setMgrSearch = useCallback((search: string) => {
    setMgrSlice((s) => ({ ...s, search }));
  }, []);
  const toggleAllMgr = useCallback(
    (e: React.SyntheticEvent) => {
      e.stopPropagation();
      setMgrSlice((s) => ({
        ...s,
        selected: toggleAllPicklist(s.selected, peAll),
      }));
    },
    [peAll]
  );
  const toggleMgrItem = useCallback(
    (val: string, checked: boolean) => {
      setMgrSlice((s) => ({
        ...s,
        selected: applyPicklistItemToggle(
          s.selected,
          val,
          checked,
          peAll
        ),
      }));
    },
    [peAll]
  );

  const clearMgrDates = useCallback(() => {
    setMgrFrom("");
    setMgrTo("");
  }, []);

  if (!peAll.length) {
    return (
      <div className="manager-view-wrap">
        <div className="no-data">
          No manager (PE) column in this export — Manager View needs PE_NAME
          data.
        </div>
      </div>
    );
  }

  return (
    <div className="manager-view-wrap">
      <div className="manager-view-main">
        <div className="mgr-toolbar">
          <FilterPicklist
            label="Managers"
            buttonLabel={picklistButtonLabel(
              mgrSlice.selected,
              peAll,
              "All managers",
              "No managers"
            )}
            allValues={peAll}
            selected={mgrSlice.selected}
            open={mgrSlice.open}
            search={mgrSlice.search}
            onToggleOpen={toggleMgrOpen}
            onSearchChange={setMgrSearch}
            onToggleAll={toggleAllMgr}
            onToggleItem={toggleMgrItem}
          />
          <div className="filter-sep" />
          <label className="mgr-date-label">From</label>
          <input
            type="date"
            className="mgr-date-input"
            value={mgrFrom}
            onChange={(e) => setMgrFrom(e.target.value)}
          />
          <label className="mgr-date-label">To</label>
          <input
            type="date"
            className="mgr-date-input"
            value={mgrTo}
            onChange={(e) => setMgrTo(e.target.value)}
          />
          <button
            type="button"
            className="mgr-date-clear"
            onClick={clearMgrDates}
          >
            Clear
          </button>
          <div className="filter-sep" />
          <input
            ref={leadFileRef}
            type="file"
            accept=".csv,text/csv"
            className="mgr-lead-file-input"
            onChange={loadLeadRoster}
            aria-label="Upload lead roster CSV"
          />
          <button
            type="button"
            className="mgr-lead-upload-btn"
            onClick={() => leadFileRef.current?.click()}
          >
            Lead roster (CSV)
          </button>
          {leadRoster && leadRoster.size > 0 ? (
            <>
              <label className="mgr-lead-label" htmlFor="mgr-lead-select">
                Lead
              </label>
              <select
                id="mgr-lead-select"
                className="mgr-lead-select"
                value={selectedLead ?? ""}
                onChange={(e) =>
                  filterByLead(e.target.value ? e.target.value : null)
                }
              >
                <option value="">All leads</option>
                {leadNames.map((ln) => (
                  <option key={ln} value={ln}>
                    {ln}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mgr-lead-clear"
                onClick={clearLeadRoster}
              >
                Clear roster
              </button>
            </>
          ) : null}
        </div>

        <div className="mgr-kpi-grid">
          <div className="mgr-kpi-card">
            <div className="mgr-kpi-val" style={{ color: "var(--kale)" }}>
              {kpis.coverage}%
            </div>
            <div className="mgr-kpi-label">Overall Coverage</div>
          </div>
          <div className="mgr-kpi-card">
            <div className="mgr-kpi-val" style={{ color: "var(--guava)" }}>
              {kpis.adherence}%
            </div>
            <div className="mgr-kpi-label">On-Time Adherence</div>
          </div>
          <div className="mgr-kpi-card">
            <div className="mgr-kpi-val" style={{ color: "var(--danger)" }}>
              {kpis.overdue}
            </div>
            <div className="mgr-kpi-label">Overdue Assignments</div>
          </div>
          <div className="mgr-kpi-card">
            <div className="mgr-kpi-val" style={{ color: "var(--ink)" }}>
              {kpis.lastActive ? formatDate(kpis.lastActive) : "—"}
            </div>
            <div className="mgr-kpi-label">Team Last Active</div>
          </div>
        </div>

        <div className="mgr-section">
          <div className="mgr-section-title">Completion trend by week</div>
          <p className="mgr-trend-subtitle">
            % of assigned work completed each week (last 10 weeks). Assigned = agents ×
            modules released that week or earlier.
          </p>
          <div className="mgr-trend-chart">
            {trend.length === 0 ? (
              <div className="no-data-inline">
                Add agents and modules in scope to see weekly completion rates.
              </div>
            ) : (
              trend.map((t) => (
                <div
                  key={t.weekStart}
                  className={`mgr-trend-col${t.isCurrentWeek ? " mgr-trend-col--current" : ""}`}
                  title={`Week of ${formatWeekOfLabel(t.weekStart)}: ${t.completions} completed out of ${t.assigned} assigned (${t.pct}%)`}
                >
                  <div className="mgr-trend-pct-above">
                    {t.completions}/{t.assigned}
                  </div>
                  <div className="mgr-trend-bar-track">
                    <div
                      className="mgr-trend-bar"
                      style={{ height: `${t.pct}%` }}
                    />
                  </div>
                  <div className="mgr-trend-label">{formatDate(t.weekStart)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mgr-section">
          <div className="mgr-section-title">Activity heatmap</div>
          <div className="mgr-heatmap-scroll">
            <table className="mgr-heatmap">
              <thead>
                <tr>
                  <th className="mgr-heatmap-agent">Agent</th>
                  {mgrChartWeeks.map((w) => (
                    <th key={w} className="mgr-heatmap-wk">
                      {w.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatRows.map(({ a, cells }) => (
                  <tr key={a}>
                    <td className="mgr-heatmap-agent" title={a}>
                      {a}
                    </td>
                    {cells.map(({ wk, n, intensity }) => (
                      <td key={wk} className="mgr-heatmap-cell-wrap">
                        <div
                          className={`mgr-heat-cell i${intensity}`}
                          title={`${n} in week ${wk}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mgr-section">
          <div className="mgr-section-title">Most missed modules</div>
          <table className="ov-table mgr-missed-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Team gap</th>
              </tr>
            </thead>
            <tbody>
              {missedModules.length === 0 ? (
                <tr>
                  <td colSpan={2} className="no-data-inline">
                    No gaps for current filters.
                  </td>
                </tr>
              ) : (
                missedModules.map(({ mod, gap }) => (
                  <tr key={mod}>
                    <td title={mod}>{mod}</td>
                    <td
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        color: "var(--danger)",
                      }}
                    >
                      {gap}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {(() => {
          const { alertsHtml, nextStepsHtml, hasAlerts } = buildCoachingAlerts(
            data,
            agents,
            modules
          );
          if (!hasAlerts) return null;
          return (
            <>
              {alertsHtml ? (
                <div
                  className="section-block upskill-alerts-section"
                  dangerouslySetInnerHTML={{ __html: alertsHtml }}
                />
              ) : null}
              {nextStepsHtml ? (
                <div
                  className="section-block next-steps-section"
                  dangerouslySetInnerHTML={{ __html: nextStepsHtml }}
                />
              ) : null}
            </>
          );
        })()}

        <div className="mgr-section">
          <div className="mgr-section-title">Agent breakdown</div>
          <div className="mgr-agent-cards">
            {agentCards.map(({ a, pct, od, last, mgr }) => (
              <div key={a} className="mgr-agent-card">
                <div className="mgr-agent-card-name">{a}</div>
                <div className="mgr-agent-card-meta">{mgr}</div>
                <div className="mgr-agent-card-stats">
                  <span>{pct}% done</span>
                  <span className={od > 0 ? "od" : ""}>
                    {od} overdue
                  </span>
                </div>
                <div className="mgr-agent-card-last">
                  {last ? formatDate(last) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="mgr-definitions">
        <div className="mgr-def-sticky">
          <h3>Definitions</h3>
          <dl>
            <dt>Overall coverage</dt>
            <dd>
              Share of agent×module assignments completed for agents and
              modules in scope (top bar + manager picker + date range).
            </dd>
            <dt>On-time adherence</dt>
            <dd>
              Among completions with a release date, share completed within 7
              days of module release.
            </dd>
            <dt>Overdue</dt>
            <dd>
              Incomplete assignments whose module release week is before the
              current week.
            </dd>
            <dt>Team last active</dt>
            <dd>
              Latest completion date across agents in scope (respecting From/To
              when set).
            </dd>
          </dl>
        </div>
      </aside>
    </div>
  );
}
