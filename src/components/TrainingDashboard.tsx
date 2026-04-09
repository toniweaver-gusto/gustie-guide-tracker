import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  buildExportCsv,
  exportFilename,
  type ExportFilters,
  type ExportType,
} from "@/lib/exportCsv";
import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  filterAgentsList,
  filterModulesForViews,
} from "@/lib/dashboardFiltering";
import { processCSVTexts } from "@/lib/csvParse";
import { formatDate } from "@/lib/formatDate";
import { formatMT } from "@/lib/formatMT";
import {
  countOverdueAssignments,
  teamCompletionTrendLast10Weeks,
  type TeamTrendWeek,
} from "@/lib/overviewMetrics";
import {
  LOW_SCORE_THRESHOLD,
  daysSince,
  getWeekStart,
  progFillClass,
  scorePillClass,
} from "@/lib/dashboardHelpers";
import {
  collectMonthKeys,
  collectWeekKeys,
  formatWeekPeriodLabel,
  type PeriodMode,
} from "@/lib/periodMode";
import { DailySplitPane } from "@/components/DailySplitPane";
import { EmptyState } from "@/components/EmptyState";
import { ManagerViewPane } from "@/components/ManagerView";
import {
  normalizeRawScores,
  sanitizeProcessedDataForPostgres,
} from "@/lib/sanitizeProcessedData";
import type { ProcessedDashboardData } from "@/lib/types";
import { shareUrlForToken } from "@/lib/appPaths";
import { snapshotWeekLabel } from "@/lib/snapshotLabel";
import {
  clearGgtActiveWorkspace,
  readGgtTeam,
  readGgtWorkspaceId,
  setGgtActiveWorkspace,
} from "@/lib/ggtStorage";
import {
  fetchSnapshotById,
  fetchSnapshotByShareToken,
  fetchWorkspaceById,
  getOrCreateWorkspace,
  insertSnapshot,
  listSnapshotMetas,
  type SnapshotMeta,
  type Workspace,
} from "@/lib/workspaceApi";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { FilterPicklist } from "@/components/FilterPicklist";
import {
  applyPicklistItemToggle,
  initialPicklistState,
  picklistButtonLabel,
  toggleAllPicklist,
  type PicklistId,
} from "@/lib/picklistEngine";

const GGT_DATA_KEY = "ggt_data";
const GGT_TAB_KEY = "ggt_tab";

export type { DashboardFilters };

/** Stats strip — same agent/module semantics as `renderOverview`. */
function computeFilteredStatsStrip(
  data: ProcessedDashboardData,
  f: DashboardFilters
): {
  agents: number;
  completions: number;
  overallPct: number;
  overdue: number;
} {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);
  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);

  if (!agents.length || !modules.length) {
    return {
      agents: agents.length,
      completions: 0,
      overallPct: 0,
      overdue: 0,
    };
  }

  let completions = 0;
  let overdue = 0;

  agents.forEach((a) => {
    const completed = new Set(Object.keys(data.agent_modules[a] || {}));
    modules.forEach((mod) => {
      if (completed.has(mod)) {
        completions++;
      } else {
        const relDate = data.module_dates[mod];
        if (relDate && getWeekStart(relDate) < todayWeek) overdue++;
      }
    });
  });

  const slots = agents.length * modules.length;
  const overallPct =
    slots > 0 ? Math.round((completions / slots) * 100) : 0;

  return {
    agents: agents.length,
    completions,
    overallPct,
    overdue,
  };
}

function useAnimatedInt(target: number, duration = 320) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (target === displayRef.current) return;
    const start = displayRef.current;
    let raf = 0;
    let cancelled = false;
    const t0 = performance.now();

    const step = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      const next = Math.round(start + (target - start) * eased);
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(step);
      else setDisplay(target);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, duration]);

  return display;
}

function StatsStripAnimated({
  stats,
}: {
  stats: {
    agents: number;
    completions: number;
    overallPct: number;
    overdue: number;
  };
}) {
  const animAgents = useAnimatedInt(stats.agents);
  const animCompletions = useAnimatedInt(stats.completions);
  const animPct = useAnimatedInt(stats.overallPct);
  const animOverdue = useAnimatedInt(stats.overdue);

  return (
    <>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--guava)" }}>
          {animAgents}
        </div>
        <div className="stat-label">Agents</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--ink)" }}>
          {animCompletions.toLocaleString()}
        </div>
        <div className="stat-label">Completions</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--kale)" }}>
          {animPct}%
        </div>
        <div className="stat-label">Overall Coverage</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--danger)" }}>
          {animOverdue.toLocaleString()}
        </div>
        <div className="stat-label">Overdue</div>
      </div>
    </>
  );
}

function formatMonthKey(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

function picklistAllValues(
  id: PicklistId,
  data: ProcessedDashboardData,
  periodKeys: string[]
): string[] {
  switch (id) {
    case "agent":
      return [...data.agents];
    case "month":
      return periodKeys;
    case "team":
      return [...data.group_names];
    default:
      return [];
  }
}

function readFilesAsText(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsText(f);
        })
    )
  );
}

function ProgramHeading({ programName }: { programName: string }) {
  const parts = programName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return (
      <h1>
        Training <span>Dashboard</span>
      </h1>
    );
  }
  const last = parts.pop()!;
  const rest = parts.join(" ");
  return (
    <h1>
      {rest ? `${rest} ` : ""}
      <span>{last}</span>
    </h1>
  );
}

function formatWeekTickLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Tab: Overview — mirrors `gustie-guide-dashboard-v2.html` + weekly banner & trend */
function renderOverview(
  data: ProcessedDashboardData,
  f: DashboardFilters,
  opts: {
    onViewOverdue: () => void;
    overdueCount: number;
    trendWeeks: TeamTrendWeek[];
  }
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  const scoreMap = data._raw_scores ?? {};

  let totalAssignments = 0;
  let totalCompleted = 0;
  const allScores: number[] = [];

  agents.forEach((a) => {
    const completed = new Set(Object.keys(data.agent_modules[a] || {}));
    modules.forEach((mod) => {
      totalAssignments++;
      if (completed.has(mod)) {
        totalCompleted++;
        const s = scoreMap[a]?.[mod];
        if (s !== undefined) {
          allScores.push(s);
        }
      }
    });
  });

  const totalIncomplete = totalAssignments - totalCompleted;
  const avgScore = allScores.length
    ? Math.round(allScores.reduce((x, y) => x + y, 0) / allScores.length)
    : null;

  const maxTrend = Math.max(
    1,
    ...opts.trendWeeks.map((t) => t.completions)
  );

  if (!modules.length) {
    return (
      <div className="overview-wrap">
        <EmptyState icon="🔍" title="No results for current filters">
          Try adjusting agent, period, module search, or team filters — or load a
          report that includes more activity.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="overview-wrap">
      {opts.overdueCount > 0 ? (
        <div
          className="weekly-action-banner weekly-action-banner--danger"
          role="status"
        >
          <span>
            <strong>{opts.overdueCount}</strong> overdue assignment
            {opts.overdueCount !== 1 ? "s" : ""} — modules from previous weeks not
            yet completed.
          </span>
          <button
            type="button"
            className="weekly-action-btn"
            onClick={opts.onViewOverdue}
          >
            View Overdue →
          </button>
        </div>
      ) : (
        <div className="weekly-action-banner weekly-action-banner--ok" role="status">
          All caught up! No overdue assignments for the current filters.
        </div>
      )}

      <div className="overview-grid overview-grid--5">
        <div className="ov-card">
          <div className="ov-card-val" style={{ color: "var(--ink)" }}>
            {totalAssignments.toLocaleString()}
          </div>
          <div className="ov-card-label">Total Assignments</div>
        </div>
        <div className="ov-card">
          <div className="ov-card-val" style={{ color: "var(--kale)" }}>
            {totalCompleted.toLocaleString()}
          </div>
          <div className="ov-card-label">Completed</div>
        </div>
        <div className="ov-card">
          <div className="ov-card-val" style={{ color: "var(--muted)" }}>
            {totalIncomplete.toLocaleString()}
          </div>
          <div className="ov-card-label">Incomplete</div>
        </div>
        <div className="ov-card">
          <div className="ov-card-val" style={{ color: "var(--danger)" }}>
            {opts.overdueCount.toLocaleString()}
          </div>
          <div className="ov-card-label">Overdue</div>
        </div>
        <div className="ov-card">
          <div className="ov-card-val" style={{ color: "var(--warn)" }}>
            {avgScore !== null ? `${avgScore}%` : "—"}
          </div>
          <div className="ov-card-label">Avg Score</div>
        </div>
      </div>

      <div className="section-block team-trend-section">
        <div className="ov-section-title">Team completion trend</div>
        <p className="team-trend-subtitle">Completions per week (last 10 weeks)</p>
        <div className="team-trend-chart">
          {opts.trendWeeks.map((t) => (
            <div
              key={t.weekStart}
              className={`team-trend-col${t.isCurrentWeek ? " current-week" : ""}`}
              title={`${t.weekStart}: ${t.completions} completions`}
            >
              <div
                className="team-trend-bar"
                style={{
                  height: `${Math.max(6, (t.completions / maxTrend) * 100)}%`,
                }}
              />
              <div className="team-trend-label">{formatWeekTickLabel(t.weekStart)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-block">
        <div className="ov-section-title">By Training Module</div>
        <table className="ov-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Released</th>
              <th>Completion Rate</th>
              <th>Avg Score</th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => {
              const relDate = data.module_dates[mod] || "";
              let modCompleted = 0;
              const modScores: number[] = [];
              agents.forEach((a) => {
                if (data.agent_modules[a]?.[mod]) {
                  modCompleted++;
                  const s = scoreMap[a]?.[mod];
                  if (s !== undefined) modScores.push(s);
                }
              });
              const modPct =
                agents.length > 0
                  ? Math.round((modCompleted / agents.length) * 100)
                  : 0;
              const modAvg = modScores.length
                ? Math.round(
                    modScores.reduce((x, y) => x + y, 0) / modScores.length
                  )
                : null;
              const missing = agents.length - modCompleted;
              const fillCls = progFillClass(modPct);
              return (
                <tr key={mod}>
                  <td
                    style={{
                      maxWidth: 260,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={mod}
                  >
                    {mod}
                  </td>
                  <td
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: "0.62rem",
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {relDate}
                  </td>
                  <td>
                    <div className="prog-bar-wrap">
                      <div className="prog-bar">
                        <div
                          className={`prog-fill ${fillCls}`}
                          style={{ width: `${modPct}%` }}
                        />
                      </div>
                      <span className="prog-pct">{modPct}%</span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`score-pill ${
                        modAvg !== null ? scorePillClass(modAvg) : "na"
                      }`}
                    >
                      {modAvg !== null ? `${modAvg}%` : "—"}
                    </span>
                  </td>
                  <td
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: "0.68rem",
                      color:
                        missing > 0 ? "var(--danger)" : "var(--muted)",
                    }}
                  >
                    {missing > 0 ? missing : "✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Day-over-Day uses `DailySplitPane` in the main component. */

function splitAgentName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/** Tab: By Module — mirrors `renderModules` */
function renderModules(
  data: ProcessedDashboardData,
  f: DashboardFilters
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  if (!modules.length) {
    return (
      <div className="module-wrap">
        <EmptyState icon="📚" title="No modules match your filters">
          Clear module search or widen your month / agent scope.
        </EmptyState>
      </div>
    );
  }

  if (!agents.length) {
    return (
      <div className="module-wrap">
        <EmptyState icon="👤" title="No agents match your filters">
          Adjust the agent or team picklists to include agents.
        </EmptyState>
      </div>
    );
  }

  const moduleTableHeader = (
    <tr>
      <th className="sticky-agent" style={{ minWidth: 220 }}>
        Module
      </th>
      <th>Released</th>
      {agents.map((a) => {
        const { first, last } = splitAgentName(a);
        return (
          <th key={a} title={a} className="module-agent-th">
            <span className="module-agent-th-first">{first}</span>
            {last ? (
              <span className="module-agent-th-last">{last}</span>
            ) : null}
          </th>
        );
      })}
      <th style={{ textAlign: "right" }}>Coverage</th>
    </tr>
  );

  const moduleTableBodyRows = modules.map((mod) => {
    const releaseDate = data.module_dates[mod] || "";
    let completedCount = 0;
    agents.forEach((a) => {
      if (data.agent_modules[a]?.[mod]) completedCount++;
    });
    const pct = Math.round((completedCount / agents.length) * 100);
    const pctCls =
      pct === 100
        ? "full"
        : pct >= 75
          ? "high"
          : pct >= 40
            ? "mid"
            : "low";
    return (
      <tr key={mod}>
        <td className="sticky-agent mod-name-cell" title={mod}>
          {mod}
        </td>
        <td className="mod-date-cell">
          {releaseDate ? formatDate(releaseDate) : "—"}
        </td>
        {agents.map((a) => {
          const completedOn = data.agent_modules[a]?.[mod];
          if (completedOn) {
            return (
              <td key={a}>
                <span
                  className="mod-check done"
                  title={`${a} completed on ${formatDate(completedOn)}`}
                >
                  ✓
                </span>
              </td>
            );
          }
          return (
            <td key={a}>
              <span
                className="mod-check miss"
                title={`${a} has not completed this`}
              >
                ·
              </span>
            </td>
          );
        })}
        <td className="mod-pct-cell">
          <span className={`pct-pill ${pctCls}`}>
            {completedCount}/{agents.length}
          </span>
        </td>
      </tr>
    );
  });

  return (
    <div className="module-wrap">
      <table className="module-table">
        <thead>{moduleTableHeader}</thead>
        <tbody>{moduleTableBodyRows}</tbody>
      </table>
    </div>
  );
}

/** Tab: Agent Summary — mirrors `renderAgents` */
function renderAgents(
  data: ProcessedDashboardData,
  f: DashboardFilters
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  if (!agents.length) {
    return (
      <div className="agent-wrap">
        <EmptyState icon="👤" title="No agents match your filters">
          Adjust the agent or team picklists, or clear module search.
        </EmptyState>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const scoreMap = data._raw_scores ?? {};

  type Row = {
    a: string;
    pct: number;
    completed: number;
    missing: number;
    overdue: number;
    avgScore: number | null;
    lastDate: string | null;
    daysAgo: number | null;
    managerName: string;
  };

  const agentRows: Row[] = agents
    .map((a) => {
      const completed = modules.filter((m) => data.agent_modules[a]?.[m]);
      const missing = modules.filter((m) => !data.agent_modules[a]?.[m]);
      const overdue = missing.filter((m) => {
        const rel = data.module_dates[m];
        return rel && getWeekStart(rel) < getWeekStart(today);
      });
      const scores = completed
        .map((m) => scoreMap[a]?.[m])
        .filter((s): s is number => s !== undefined);
      const avgScore = scores.length
        ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
        : null;
      const pct =
        modules.length > 0
          ? Math.round((completed.length / modules.length) * 100)
          : 0;
      const dates = Object.values(data.agent_modules[a] || {});
      const lastDate = dates.length ? dates.sort().slice(-1)[0]! : null;
      const daysAgo = lastDate ? daysSince(lastDate) : null;
      const managerName = data.agent_pe?.[a] || "—";
      return {
        a,
        pct,
        completed: completed.length,
        missing: missing.length,
        overdue: overdue.length,
        avgScore,
        lastDate,
        daysAgo,
        managerName,
      };
    })
    .sort((x, y) => x.pct - y.pct);

  const agentTableHeader = (
    <tr>
      <th>Agent</th>
      <th>Manager</th>
      <th>% Complete</th>
      <th>Completed</th>
      <th>Missing</th>
      <th>Avg Score</th>
      <th>Last Activity</th>
      <th>Status</th>
    </tr>
  );

  const agentTableBodyRows = agentRows.map(
    ({
      a,
      pct,
      completed,
      missing,
      overdue,
      avgScore,
      lastDate,
      daysAgo,
      managerName,
    }) => {
      let statusLabel: string;
      let statusCls: string;
      if (pct === 100) {
        statusLabel = "Complete";
        statusCls = "complete";
      } else if (overdue > 0) {
        statusLabel = `${overdue} Overdue`;
        statusCls = "overdue";
      } else if (
        avgScore !== null &&
        avgScore < LOW_SCORE_THRESHOLD
      ) {
        statusLabel = "Low Score";
        statusCls = "low-score";
      } else {
        statusLabel = "In Progress";
        statusCls = "in-progress";
      }
      const fillCls = progFillClass(pct);
      return (
        <tr key={a}>
          <td className="agent-name-cell">{a}</td>
          <td
            style={{
              fontSize: "0.68rem",
              color: "var(--muted)",
            }}
          >
            {managerName}
          </td>
          <td>
            <div className="prog-bar-wrap">
              <div className="prog-bar">
                <div
                  className={`prog-fill ${fillCls}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="prog-pct">{pct}%</span>
            </div>
          </td>
          <td
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: "0.68rem",
              color: "var(--kale)",
            }}
          >
            {completed}
          </td>
          <td
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: "0.68rem",
              color: missing > 0 ? "var(--danger)" : "var(--muted)",
            }}
          >
            {missing > 0 ? missing : "✓"}
          </td>
          <td>
            <span
              className={`score-pill ${
                avgScore !== null ? scorePillClass(avgScore) : "na"
              }`}
            >
              {avgScore !== null ? `${avgScore}%` : "—"}
            </span>
          </td>
          <td>
            <span
              className={`days-badge ${
                daysAgo !== null && daysAgo > 14 ? "stale" : ""
              }`}
            >
              {lastDate
                ? `${formatDate(lastDate)}${daysAgo !== null ? ` (${daysAgo}d ago)` : ""}`
                : "—"}
            </span>
          </td>
          <td>
            <span className={`status-badge ${statusCls}`}>
              {statusLabel}
            </span>
          </td>
        </tr>
      );
    }
  );

  return (
    <div className="agent-wrap">
      <table className="agent-table agent-table-fixed">
        <thead>{agentTableHeader}</thead>
        <tbody>{agentTableBodyRows}</tbody>
      </table>
    </div>
  );
}

type OverdueRow = {
  agent: string;
  mod: string;
  relDate: string;
  daysOverdue: number;
  manager: string;
};

/** Tab: Overdue — grouped by agent with expand/collapse */
function renderOverdue(
  data: ProcessedDashboardData,
  f: DashboardFilters,
  expanded: Set<string>,
  toggleOverdueRow: (rowId: string) => void
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);

  const overdueList: OverdueRow[] = [];

  agents.forEach((a) => {
    modules.forEach((mod) => {
      if (data.agent_modules[a]?.[mod]) return;
      const relDate = data.module_dates[mod];
      if (!relDate) return;
      const relWeek = getWeekStart(relDate);
      if (relWeek >= todayWeek) return;
      const daysOverdue = Math.floor(
        (new Date(today).getTime() - new Date(relWeek).getTime()) /
          86400000
      );
      overdueList.push({
        agent: a,
        mod,
        relDate,
        daysOverdue,
        manager: data.agent_pe?.[a] || "—",
      });
    });
  });

  overdueList.sort((x, y) => y.daysOverdue - x.daysOverdue);

  const byAgent = new Map<string, OverdueRow[]>();
  overdueList.forEach((row) => {
    const list = byAgent.get(row.agent) ?? [];
    list.push(row);
    byAgent.set(row.agent, list);
  });

  const agentOrder = [...byAgent.keys()].sort((a, b) => {
    const maxA = Math.max(...(byAgent.get(a) ?? []).map((r) => r.daysOverdue));
    const maxB = Math.max(...(byAgent.get(b) ?? []).map((r) => r.daysOverdue));
    return maxB - maxA;
  });

  return (
    <div className="overview-wrap overdue-grouped-wrap">
      {!overdueList.length ? (
        <div className="weekly-action-banner weekly-action-banner--ok" role="status">
          ✓ No overdue trainings for the current filters.
        </div>
      ) : (
        <>
          <div className="overdue-intro">
            Showing{" "}
            <strong style={{ color: "var(--danger)" }}>
              {overdueList.length}
            </strong>{" "}
            overdue assignment
            {overdueList.length !== 1 ? "s" : ""} — modules from previous weeks
            not yet completed.
          </div>
          <div className="overdue-agent-groups">
            {agentOrder.map((agent) => {
              const rows = byAgent.get(agent) ?? [];
              const rowId = agent;
              const open = expanded.has(rowId);
              const maxDays = Math.max(...rows.map((r) => r.daysOverdue));
              return (
                <div key={agent} className="overdue-agent-block">
                  <button
                    type="button"
                    className="overdue-agent-header"
                    onClick={() => toggleOverdueRow(rowId)}
                    aria-expanded={open}
                  >
                    <span className="overdue-chevron" aria-hidden>
                      {open ? "▼" : "▶"}
                    </span>
                    <span className="overdue-agent-name">{agent}</span>
                    <span className="overdue-agent-meta">
                      {rows.length} module{rows.length !== 1 ? "s" : ""} · max{" "}
                      <span className="urgency-days">{maxDays}d</span>
                    </span>
                  </button>
                  {open ? (
                    <table className="ov-table overdue-detail-table">
                      <thead>
                        <tr>
                          <th>Manager</th>
                          <th>Module</th>
                          <th>Released</th>
                          <th>Days Overdue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={`${row.agent}-${row.mod}`}>
                            <td
                              style={{
                                fontSize: "0.68rem",
                                color: "var(--muted)",
                              }}
                            >
                              {row.manager}
                            </td>
                            <td
                              className="mod-ellipsis"
                              title={row.mod}
                            >
                              {row.mod}
                            </td>
                            <td
                              style={{
                                fontFamily: "'DM Mono',monospace",
                                fontSize: "0.62rem",
                                color: "var(--muted)",
                              }}
                            >
                              {row.relDate}
                            </td>
                            <td>
                              <span className="urgency-days">
                                {row.daysOverdue}d
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** How to Use tab — static content (matches HTML design system + app features). */
function renderHowTo(): ReactNode {
  return (
    <div className="howto-wrap">
      <div className="howto-hero">
        <div className="howto-hero-icon" aria-hidden>
          📊
        </div>
        <div className="howto-hero-body">
          <h2>Gustie Guide Training Dashboard</h2>
          <p>
            Track Uplimit training completion, pacing, scores, and roster
            alignment in one place. Upload your cohort export, then explore tabs
            and filters—no spreadsheet gymnastics required.
          </p>
        </div>
      </div>

      <section className="howto-section">
        <h3 className="howto-section-title">Getting Started</h3>
        <div className="howto-step">
          <span className="howto-step-num">1</span>
          <h4>Upload your report</h4>
          <p>
            On first launch, enter an optional <strong>Program name</strong>, then
            upload one or more Uplimit CSV exports. Files merge automatically;
            duplicate rows from group memberships are deduplicated by agent and
            module.
          </p>
        </div>
        <div className="howto-step">
          <span className="howto-step-num">2</span>
          <h4>Filter and explore</h4>
          <p>
            Use <strong>Agent</strong>, the <strong>Month / Week</strong> period
            toggle and period picklist, <strong>Search Module</strong>, and—when
            your export includes it—<strong>Team</strong> (
            <code>GROUP_NAME</code>). Use <strong>Manager View</strong> for{" "}
            <code>PE_NAME</code> manager scope. Use <strong>Select All</strong>{" "}
            in picklists to reset scope.
          </p>
        </div>
        <div className="howto-step">
          <span className="howto-step-num">3</span>
          <h4>Share or refresh</h4>
          <p>
            Use <strong>Export CSV</strong> for filtered downloads. After the first
            save, <strong>Copy share link</strong> gives managers a read-only
            view. Use <strong>Load New Report</strong> anytime to replace data.
          </p>
        </div>
      </section>

      <section className="howto-section">
        <h3 className="howto-section-title">What Each Tab Shows</h3>
        <div className="howto-tabs-grid">
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">📊</div>
            <h4>Overview</h4>
            <p>
              Assignment totals, completion rate by module with progress bars,
              average score pills, and missing counts.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">📅</div>
            <h4>Day-over-Day</h4>
            <p>
              Calendar-style activity: how many modules each agent completed per
              day, grouped by month.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">📚</div>
            <h4>By Module</h4>
            <p>
              Module × agent matrix with release dates, checkmarks for done, and a
              coverage pill per row.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">👤</div>
            <h4>Agent Summary</h4>
            <p>
              Agents sorted worst-to-best by % complete, with done/missing counts,
              avg score, last activity, manager, and status badge.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">🔴</div>
            <h4>Overdue</h4>
            <p>
              Open assignments where the module was released in a prior week—
              sorted by most days overdue first.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">👥</div>
            <h4>Roster Gaps</h4>
            <p>
              Paste a roster (one name per line) to find who is missing from the
              report, who is extra, and who has zero activity.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">📖</div>
            <h4>How to Use</h4>
            <p>
              This reference: how the dashboard works and how to get the most from
              each view.
            </p>
          </div>
          <div className="howto-tab-card">
            <div className="howto-tab-card-icon">🏆</div>
            <h4>Manager View</h4>
            <p>
              Manager-scoped KPIs, weekly completion trend, activity heatmap, most
              missed modules, and per-agent cards—with definitions in the sidebar.
            </p>
          </div>
        </div>
      </section>

      <section className="howto-section">
        <h3 className="howto-section-title">Tips &amp; Common Questions</h3>
        <div className="howto-tabs-grid howto-faq-grid">
          <div className="howto-tab-card">
            <h4>Why do row counts differ from raw CSV rows?</h4>
            <p>
              Uplimit repeats completions per group. The parser keeps the{" "}
              <strong>earliest</strong> submission per agent + module so daily
              totals and coverage are not inflated.
            </p>
          </div>
          <div className="howto-tab-card">
            <h4>Which columns are required?</h4>
            <p>
              At minimum: <code>Full Name</code> (or <code>FULL_NAME</code>),{" "}
              <code>Content Week Name</code>, <code>Latest Submission Time</code>.
              Optional: <code>PE_NAME</code>, <code>GROUP_NAME</code>,{" "}
              <code>Total Points</code> for manager/team filters and scores.
            </p>
          </div>
          <div className="howto-tab-card">
            <h4>How does Team filtering work?</h4>
            <p>
              If <code>GROUP_NAME</code> is present, an agent matches when{" "}
              <em>any</em> of their groups is selected—useful when someone sits on
              multiple teams.
            </p>
          </div>
          <div className="howto-tab-card">
            <h4>What does “Overdue” mean?</h4>
            <p>
              A module is overdue if its release week (Monday-based) is before the
              current week and the agent has not completed it yet.
            </p>
          </div>
        </div>
      </section>

      <div className="howto-tip">
        <p>💡 Weekly workflow: Every Monday, download your latest Uplimit export, click Load New Report, upload the file, and share the Overdue tab and Manager View with your team leads for follow-up. Takes less than 2 minutes.</p>
      </div>
    </div>
  );
}

type TabId =
  | "overview"
  | "daily"
  | "modules"
  | "agents"
  | "overdue"
  | "roster"
  | "howto"
  | "manager";

const VALID_TAB_IDS: readonly TabId[] = [
  "overview",
  "daily",
  "modules",
  "agents",
  "overdue",
  "roster",
  "howto",
  "manager",
] as const;

function TabDescRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="tab-desc">
      <span className="tab-desc-icon" aria-hidden>
        {icon}
      </span>
      <span className="tab-desc-text">{text}</span>
    </div>
  );
}

function TabDescRowWithExport({
  icon,
  text,
  exportType: tabExportType,
  onExport,
}: {
  icon: string;
  text: string;
  exportType: ExportType;
  onExport: (type: ExportType) => void;
}) {
  return (
    <div className="tab-desc-with-export">
      <TabDescRow icon={icon} text={text} />
      <button
        type="button"
        className="tab-inline-export"
        onClick={() => onExport(tabExportType)}
      >
        ⬇ Export
      </button>
    </div>
  );
}

const TAB_DESC: Record<
  TabId,
  { icon: string; text: string }
> = {
  overview: {
    icon: "📊",
    text: "Roll-up of assignments, completion, and module-level performance for the current filters.",
  },
  daily: {
    icon: "📅",
    text: "Per-day completion counts by agent, grouped by calendar month.",
  },
  modules: {
    icon: "📚",
    text: "Matrix of modules vs agents with release dates and completion checkmarks.",
  },
  agents: {
    icon: "👤",
    text: "Agents ranked by completion % with manager, scores, last activity, and status.",
  },
  overdue: {
    icon: "🔴",
    text: "Assignments past their release week that are still incomplete.",
  },
  roster: {
    icon: "👥",
    text: "Compare a pasted roster to the report to find gaps, extras, and inactive agents.",
  },
  howto: {
    icon: "📖",
    text: "How filters, tabs, and exports work—plus answers to common questions.",
  },
  manager: {
    icon: "🏆",
    text: "Leadership view: coverage, adherence, trends, heatmap, and missed modules for selected managers.",
  },
};

type TooltipState = { text: string; x: number; y: number } | null;

type Props = {
  readOnly?: boolean;
  initialToken?: string;
};

function normalizeLoadedData(raw: unknown): ProcessedDashboardData {
  const d = raw as Partial<ProcessedDashboardData>;
  return sanitizeProcessedDataForPostgres({
    program_name: d.program_name ?? "Training Dashboard",
    agents: d.agents ?? [],
    modules: d.modules ?? [],
    module_dates: d.module_dates ?? {},
    agent_modules: d.agent_modules ?? {},
    agent_daily: d.agent_daily ?? {},
    all_dates: d.all_dates ?? [],
    pe_names: d.pe_names ?? [],
    agent_pe: d.agent_pe ?? {},
    group_names: d.group_names ?? [],
    agent_groups: d.agent_groups ?? {},
    _raw_scores: normalizeRawScores(d._raw_scores),
  });
}

export function TrainingDashboard({
  readOnly = false,
  initialToken,
}: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<ProcessedDashboardData | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(!!initialToken);
  const [remoteError, setRemoteError] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [setupProgramName, setSetupProgramName] = useState("");
  const [setupTexts, setSetupTexts] = useState<string[]>([]);
  const [setupLoadedLabel, setSetupLoadedLabel] = useState("");
  const [setupDrag, setSetupDrag] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDrag, setUploadDrag] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState<ExportType>("daily");

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (readOnly || initialToken) return "overview";
    try {
      const s = sessionStorage.getItem(GGT_TAB_KEY);
      if (s && (VALID_TAB_IDS as readonly string[]).includes(s)) {
        return s as TabId;
      }
    } catch {
      /* ignore */
    }
    return "overview";
  });

  const switchTab = useCallback((id: TabId) => {
    setActiveTab(id);
    try {
      sessionStorage.setItem(GGT_TAB_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const goToOverdue = useCallback(() => switchTab("overdue"), [switchTab]);
  const goToTab = useCallback((id: TabId) => switchTab(id), [switchTab]);
  const runTabExport = useCallback((type: ExportType) => {
    setExportType(type);
    setExportOpen(true);
  }, []);
  const toggleOverdueRow = useCallback((rowId: string) => {
    setOverdueExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  /** Picklist engine: open/search/selected per filter id */
  const [_pl, setPl] = useState(() => initialPicklistState());
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [moduleSearch, setModuleSearch] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [rosterResults, setRosterResults] = useState<ReactNode>(null);

  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [saving, setSaving] = useState(false);

  const [dailySelectedAgent, setDailySelectedAgent] = useState<string | null>(
    null
  );
  const [slideout, setSlideout] = useState<{
    agent: string;
    date: string;
  } | null>(null);
  const [overdueExpanded, setOverdueExpanded] = useState<Set<string>>(
    () => new Set()
  );

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const setupReportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (readOnly || initialToken) return;
    const wsId = readGgtWorkspaceId();
    const teamName = readGgtTeam();
    if (!wsId && !teamName) {
      navigate("/", { replace: true });
      return;
    }
    if (!supabaseConfigured) {
      setBootstrapLoading(false);
      return;
    }
    let cancelled = false;
    setBootstrapLoading(true);
    (async () => {
      try {
        let ws: Workspace | null = null;
        if (wsId) {
          ws = await fetchWorkspaceById(wsId);
        }
        if (!ws && teamName) {
          ws = await getOrCreateWorkspace(teamName);
        }
        if (!ws) {
          if (!cancelled) navigate("/", { replace: true });
          return;
        }
        if (!cancelled) {
          setGgtActiveWorkspace(ws);
          setWorkspace(ws);
        }
        const metas = await listSnapshotMetas(ws.id);
        if (cancelled) return;
        setSnapshots(metas);
        if (metas.length > 0) {
          const full = await fetchSnapshotById(metas[0]!.id);
          if (cancelled || !full) return;
          setData(normalizeLoadedData(full.processed_data));
          setActiveSnapshotId(full.id);
          setShareToken(full.share_token);
          setLastSavedAt(full.uploaded_at);
        } else {
          setData(null);
          setActiveSnapshotId(null);
          setShareToken(null);
          setLastSavedAt(null);
        }
      } catch (e) {
        console.error(e);
        alert(
          "Could not load your team workspace. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and run migration 004 in Supabase."
        );
        if (!cancelled) {
          setWorkspace(null);
          setSnapshots([]);
          setData(null);
          setActiveSnapshotId(null);
          setShareToken(null);
          setLastSavedAt(null);
          navigate("/", { replace: true });
        }
      } finally {
        if (!cancelled) setBootstrapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readOnly, initialToken, navigate]);

  useEffect(() => {
    if (readOnly || initialToken || !data) return;
    try {
      sessionStorage.setItem(GGT_DATA_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, [readOnly, initialToken, data]);

  useEffect(() => {
    if (!initialToken) return;
    let cancelled = false;
    (async () => {
      setRemoteLoading(true);
      setRemoteError(false);
      try {
        if (!supabaseConfigured) throw new Error("not configured");
        const row = await fetchSnapshotByShareToken(initialToken);
        if (!row) throw new Error("not found");
        if (!cancelled) {
          setData(normalizeLoadedData(row.processed_data));
          setShareToken(row.share_token);
          setActiveSnapshotId(row.id);
          setLastSavedAt(row.uploaded_at);
        }
      } catch {
        if (!cancelled) setRemoteError(true);
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialToken]);

  useEffect(() => {
    if (readOnly || initialToken) return;
    if (!workspace || bootstrapLoading || data) return;
    if (snapshots.length === 0) {
      setSetupProgramName((prev) => prev || workspace.team_name);
    }
  }, [readOnly, initialToken, workspace, bootstrapLoading, data, snapshots.length]);

  useEffect(() => {
    if (!data?.program_name) return;
    document.title = data.program_name + " Dashboard";
  }, [data?.program_name]);

  useEffect(() => {
    if (!data) return;
    const keys = collectMonthKeys(data);
    const base = initialPicklistState();
    if (keys.length > 0) {
      const monthLabels = keys.map((k) => formatMonthKey(k));
      const nowLabel = new Date().toLocaleString("default", {
        month: "long",
        year: "numeric",
      });
      const matchIdx = monthLabels.indexOf(nowLabel);
      const defaultKey =
        matchIdx >= 0 ? keys[matchIdx]! : keys[keys.length - 1]!;
      base.month = { ...base.month, selected: [defaultKey] };
    }
    setPl(base);
  }, [data]);

  useEffect(() => {
    setDailySelectedAgent(null);
    setOverdueExpanded(new Set());
  }, [data?.program_name]);

  useEffect(() => {
    if (!slideout) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSlideout(null);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [slideout]);

  useEffect(() => {
    setPl((p) => ({
      ...p,
      month: { ...p.month, selected: null, open: false },
    }));
  }, [periodMode]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.(".picklist-wrap")) return;
      if (el.closest?.(".history-dropdown-wrap")) return;
      setHistoryOpen(false);
      setPl((p) => {
        let changed = false;
        const n = { ...p };
        (Object.keys(n) as PicklistId[]).forEach((k) => {
          if (n[k].open) changed = true;
          n[k] = { ...n[k], open: false };
        });
        return changed ? n : p;
      });
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!tooltip) return;
      setTooltip((t) =>
        t ? { ...t, x: e.clientX + 12, y: e.clientY + 12 } : null
      );
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [tooltip]);

  const saveSnapshot = useCallback(
    async (next: ProcessedDashboardData) => {
      if (readOnly) return;
      if (!workspace?.id) {
        alert(
          "Workspace not ready. Check Supabase configuration and migration 004, or use Switch Team."
        );
        return;
      }
      setSaving(true);
      try {
        if (!supabaseConfigured) {
          throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
        }
        const safe = sanitizeProcessedDataForPostgres({
          ...next,
          _raw_scores: normalizeRawScores(next._raw_scores),
        });
        const row = await insertSnapshot(workspace.id, {
          label: snapshotWeekLabel(safe),
          agent_count: safe.agents.length,
          module_count: safe.modules.length,
          processed_data: safe,
        });
        const metas = await listSnapshotMetas(workspace.id);
        setSnapshots(metas);
        setActiveSnapshotId(row.id);
        setShareToken(row.share_token);
        setLastSavedAt(row.uploaded_at);
      } catch (e) {
        console.error(e);
        alert(
          "Could not save snapshot. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and run migration 004 (workspaces + snapshots) in Supabase."
        );
      } finally {
        setSaving(false);
      }
    },
    [readOnly, workspace]
  );

  const processAndApply = useCallback(
    async (texts: string[], programName: string) => {
      const d = processCSVTexts(texts, programName);
      if (!d) {
        alert(
          "No data could be loaded from that file.\n\n" +
            "Use a comma-separated CSV with these columns: Full Name (or FULL_NAME), Content Week Name, Latest Submission Time; optional PE Name, GROUP_NAME, and Total Points.\n\n" +
            "If you exported from Excel, use “CSV UTF-8”. A UTF-8 BOM at the start of the file is fine."
        );
        return;
      }
      const cleaned = sanitizeProcessedDataForPostgres({
        ...d,
        _raw_scores: normalizeRawScores(d._raw_scores),
      });
      setData(cleaned);
      if (!readOnly) await saveSnapshot(cleaned);
    },
    [readOnly, saveSnapshot]
  );

  const launchDashboard = async () => {
    if (!setupTexts.length) return;
    const name =
      setupProgramName.trim() ||
      workspace?.team_name ||
      "Training Dashboard";
    await processAndApply(setupTexts, name);
  };

  const onSetupFiles = async (files: File[]) => {
    if (!files.length) return;
    const texts = await readFilesAsText(files);
    setSetupTexts(texts);
    setSetupLoadedLabel(
      `✓ ${files.length} file${files.length > 1 ? "s" : ""} loaded: ${files.map((f) => f.name).join(", ")}`
    );
  };

  const onSetupReportChange = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    await onSetupFiles(list);
  };

  const onUploadFiles = async (files: File[] | FileList | null) => {
    const arr = files ? Array.from(files) : [];
    if (!arr.length) return;
    const list = arr.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!list.length) return;
    const texts = await readFilesAsText(list);
    const programName = data?.program_name ?? "Training Dashboard";
    await processAndApply(texts, programName);
  };

  const periodKeys = useMemo(() => {
    if (!data) return [];
    return periodMode === "month"
      ? collectMonthKeys(data)
      : collectWeekKeys(data);
  }, [data, periodMode]);

  const filters: DashboardFilters = useMemo(
    () => ({
      agents: _pl.agent.selected,
      months: _pl.month.selected,
      moduleSearch,
      managers: null,
      teams: _pl.team.selected,
      periodMode,
    }),
    [_pl, moduleSearch, periodMode]
  );

  const exportFilters: ExportFilters = useMemo(
    () => ({
      agents: filters.agents,
      months: filters.months,
      moduleSearch: filters.moduleSearch,
      teams: filters.teams,
      periodMode: filters.periodMode,
    }),
    [filters]
  );

  const formatPeriodOption = useCallback(
    (v: string) =>
      periodMode === "week" ? formatWeekPeriodLabel(v) : formatMonthKey(v),
    [periodMode]
  );

  const togglePicklist = useCallback((id: PicklistId) => {
    setPl((p) => {
      const willOpen = !p[id].open;
      const n = { ...p };
      (Object.keys(n) as PicklistId[]).forEach((k) => {
        n[k] = { ...n[k], open: k === id ? willOpen : false };
      });
      return n;
    });
  }, []);

  const setPicklistSearchField = useCallback((id: PicklistId, search: string) => {
    setPl((p) => ({ ...p, [id]: { ...p[id], search } }));
  }, []);

  const toggleAllPicklistHandler = useCallback(
    (id: PicklistId) => (e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (!data) return;
      const all = picklistAllValues(id, data, periodKeys);
      setPl((p) => {
        const cur = p[id].selected;
        const nextSel = toggleAllPicklist(cur, all);
        return { ...p, [id]: { ...p[id], selected: nextSel } };
      });
    },
    [data, periodKeys]
  );

  const togglePicklistItemHandler = useCallback(
    (id: PicklistId, val: string, checked: boolean) => {
      if (!data) return;
      const all = picklistAllValues(id, data, periodKeys);
      setPl((p) => {
        const cur = p[id].selected;
        const nextSel = applyPicklistItemToggle(cur, val, checked, all);
        return { ...p, [id]: { ...p[id], selected: nextSel } };
      });
    },
    [data, periodKeys]
  );

  const buildPicklist = (
    id: PicklistId,
    label: string,
    allLabel: string,
    noneLabel: string,
    format?: (v: string) => string
  ) => {
    if (!data) return null;
    const all = picklistAllValues(id, data, periodKeys);
    const slice = _pl[id];
    return (
      <FilterPicklist
        label={label}
        buttonLabel={picklistButtonLabel(
          slice.selected,
          all,
          allLabel,
          noneLabel,
          format
        )}
        allValues={all}
        selected={slice.selected}
        open={slice.open}
        search={slice.search}
        onToggleOpen={() => togglePicklist(id)}
        onSearchChange={(s) => setPicklistSearchField(id, s)}
        onToggleAll={toggleAllPicklistHandler(id)}
        onToggleItem={(val, checked) =>
          togglePicklistItemHandler(id, val, checked)
        }
        formatOption={format}
      />
    );
  };

  const dateRangeLabel = useMemo(() => {
    if (!data?.all_dates.length) return "—";
    const minD = data.all_dates[0];
    const maxD = data.all_dates[data.all_dates.length - 1];
    return `${formatDate(minD)} → ${formatDate(maxD)}`;
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    return computeFilteredStatsStrip(data, filters);
  }, [data, filters]);

  const overdueCount = useMemo(
    () => (data ? countOverdueAssignments(data, filters) : 0),
    [data, filters]
  );

  const trendWeeks = useMemo(
    () => (data ? teamCompletionTrendLast10Weeks(data, filters) : []),
    [data, filters]
  );

  const slideoutModules = useMemo(() => {
    if (!slideout || !data) return [];
    const mods = filterModulesForViews(data, filters);
    return mods
      .filter((m) => data.agent_modules[slideout.agent]?.[m] === slideout.date)
      .map((m) => ({
        mod: m,
        score: data._raw_scores?.[slideout.agent]?.[m],
      }));
  }, [slideout, data, filters]);

  const handleSlideoutClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) setSlideout(null);
    },
    []
  );

  const overviewPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see overview.</div>
      );
    }
    return renderOverview(data, filters, {
      onViewOverdue: goToOverdue,
      overdueCount,
      trendWeeks,
    });
  }, [data, filters, goToOverdue, overdueCount, trendWeeks]);

  const dailyPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see day-over-day.</div>
      );
    }
    return (
      <DailySplitPane
        data={data}
        filters={filters}
        dailySelectedAgent={dailySelectedAgent}
        onSelectDailyAgent={setDailySelectedAgent}
        onDayCellClick={(agent, date) => setSlideout({ agent, date })}
      />
    );
  }, [data, filters, dailySelectedAgent]);

  const modulesPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see modules.</div>
      );
    }
    return renderModules(data, filters);
  }, [data, filters]);

  const agentsPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see agent summary.</div>
      );
    }
    return renderAgents(data, filters);
  }, [data, filters]);

  const overduePane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see overdue trainings.</div>
      );
    }
    return renderOverdue(data, filters, overdueExpanded, toggleOverdueRow);
  }, [data, filters, overdueExpanded, toggleOverdueRow]);

  const howtoPane = useMemo(() => renderHowTo(), []);

  const managerPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see Manager View.</div>
      );
    }
    return <ManagerViewPane data={data} filters={filters} />;
  }, [data, filters]);

  const applyRoster = () => {
    if (!data) return;
    const raw = rosterText.trim();
    if (!raw) return;
    const roster = raw.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
    const reportNames = new Set(
      data.agents.map((n) => n.toLowerCase().trim())
    );
    const rosterNormed = roster.map((n) => ({
      orig: n,
      norm: n.toLowerCase().trim(),
    }));
    const missing = rosterNormed.filter((r) => !reportNames.has(r.norm));
    const extra = data.agents.filter(
      (a) => !rosterNormed.find((r) => r.norm === a.toLowerCase().trim())
    );
    const inactive = data.agents.filter((a) => {
      const daily = data.agent_daily[a] || {};
      return Object.keys(daily).length === 0;
    });

    setRosterResults(
      <>
        <div className="gap-card">
          <h3 style={{ color: "var(--danger)" }}>
            🔴 On Roster, Not in Report ({missing.length})
          </h3>
          <p>
            These agents are on your roster but have zero activity in the loaded
            Uplimit data.
          </p>
          {missing.length === 0 ? (
            <p className="gap-none">
              ✓ All roster members appear in the report.
            </p>
          ) : (
            <div className="chip-grid">
              {missing.map((m) => (
                <div key={m.norm} className="chip missing">
                  {m.orig}
                </div>
              ))}
            </div>
          )}
        </div>
        {extra.length > 0 && (
          <div className="gap-card">
            <h3 style={{ color: "var(--warn)" }}>
              🟡 In Report, Not on Roster ({extra.length})
            </h3>
            <p>
              These agents have Uplimit activity but weren&apos;t on the roster
              you provided.
            </p>
            <div className="chip-grid">
              {extra.map((e) => (
                <div key={e} className="chip extra">
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
        {inactive.length > 0 && (
          <div className="gap-card">
            <h3 style={{ color: "var(--muted)" }}>
              ⚪ In Report, Zero Activity
            </h3>
            <p>
              These agents appear in the Uplimit export but have no completions
              recorded.
            </p>
            <div className="chip-grid">
              {inactive.map((e) => (
                <div key={e} className="chip inactive">
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  };

  const runExport = () => {
    if (!data) return;
    const csv = buildExportCsv(data, exportFilters, exportType);
    const filename = exportFilename(data, exportType, filters.months);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  const copyShareLink = async () => {
    const t = shareToken || initialToken;
    if (!t) return;
    const url = shareUrlForToken(t);
    try {
      await navigator.clipboard.writeText(url);
      alert("Share link copied:\n" + url);
    } catch {
      prompt("Copy this link:", url);
    }
  };

  const exportScopeChips = useMemo(() => {
    const chips: ReactNode[] = [];
    const af = filters.agents;
    if (af === null) {
      chips.push(
        <span key="a" className="scope-chip active">
          All Agents
        </span>
      );
    } else if (af.length === 0) {
      chips.push(
        <span key="a" className="scope-chip active">
          No agents
        </span>
      );
    } else if (af.length === 1) {
      chips.push(
        <span key="a" className="scope-chip active">
          {af[0]}
        </span>
      );
    } else {
      chips.push(
        <span key="a" className="scope-chip active">
          {af.length} agents
        </span>
      );
    }
    const mf = filters.months;
    const periodWord = filters.periodMode === "week" ? "Weeks" : "Months";
    if (mf === null) {
      chips.push(
        <span key="m" className="scope-chip active">
          All {periodWord}
        </span>
      );
    } else if (mf.length === 0) {
      chips.push(
        <span key="m" className="scope-chip active">
          No {periodWord.toLowerCase()}
        </span>
      );
    } else if (mf.length === 1) {
      chips.push(
        <span key="m" className="scope-chip active">
          {filters.periodMode === "week"
            ? formatWeekPeriodLabel(mf[0]!)
            : formatMonthKey(mf[0]!)}
        </span>
      );
    } else {
      chips.push(
        <span key="m" className="scope-chip active">
          {mf.length} {filters.periodMode === "week" ? "weeks" : "months"}
        </span>
      );
    }
    const tf = filters.teams;
    if (tf !== null && tf.length > 0) {
      chips.push(
        <span key="team" className="scope-chip active">
          {tf.length === 1 ? tf[0] : `${tf.length} teams`}
        </span>
      );
    }
    if (filters.moduleSearch.trim()) {
      chips.push(
        <span key="q" className="scope-chip active">
          Module search
        </span>
      );
    }
    return chips;
  }, [filters]);

  const showCsvSetup =
    !readOnly &&
    !initialToken &&
    !!workspace &&
    !bootstrapLoading &&
    !data;

  const goToTeamManager = () => {
    navigate("/");
  };

  const switchTeam = () => {
    clearGgtActiveWorkspace();
    try {
      sessionStorage.removeItem(GGT_DATA_KEY);
      sessionStorage.removeItem(GGT_TAB_KEY);
    } catch {
      /* ignore */
    }
    navigate("/");
  };

  const headerSubtitle = data
    ? readOnly
      ? "Shared view · Gustie Guide Completion Tracker"
      : `${data.program_name} · Gustie Guide Completion Tracker`
    : "";

  if (readOnly && remoteLoading) {
    return (
      <div className="setup-overlay" style={{ display: "flex" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Loading dashboard…
        </p>
      </div>
    );
  }

  if (!readOnly && !initialToken && bootstrapLoading) {
    return (
      <div className="setup-overlay" style={{ display: "flex" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Loading dashboard…
        </p>
      </div>
    );
  }

  if (readOnly && remoteError) {
    return (
      <div className="setup-overlay" style={{ display: "flex" }}>
        <div className="setup-card">
          <h2>Dashboard not found</h2>
          <p className="setup-intro">
            This link may be wrong or the saved dashboard was removed.
          </p>
        </div>
      </div>
    );
  }

  if (showCsvSetup) {
    return (
      <>
        <div
          className="setup-overlay"
          style={{
            display: "flex",
            overflow: "hidden",
          }}
        >
          <div className="setup-card">
            <div className="setup-logo">gusto</div>
            <h2>Upload your report</h2>
            <p className="setup-intro">
              Upload your Uplimit CSV export (or several — they merge
              automatically). Completions are deduplicated by agent and module so
              group rows don&apos;t inflate counts.
            </p>
            <div className="setup-section">
              <label htmlFor="setupProgramName">Program name</label>
              <input
                id="setupProgramName"
                type="text"
                placeholder="e.g. CX Foundations Cohort 12"
                value={setupProgramName}
                onChange={(e) => setSetupProgramName(e.target.value)}
              />
            </div>
            <div className="setup-section">
              <label>Uplimit Report CSV</label>
              <div
                className={`setup-drop${setupDrag ? " drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setSetupDrag(true);
                }}
                onDragLeave={() => setSetupDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setSetupDrag(false);
                  const files = Array.from(e.dataTransfer.files).filter((f) =>
                    f.name.toLowerCase().endsWith(".csv")
                  );
                  if (files.length) void onSetupFiles(files);
                }}
                onClick={() => setupReportInputRef.current?.click()}
                role="presentation"
              >
                <div className="setup-drop-label">
                  <strong>Click to upload</strong> or drag CSV files here
                </div>
                <div className="setup-drop-sub">
                  Full Name, Content Week Name, Latest Submission Time, PE Name,
                  GROUP_NAME, Total Points
                </div>
              </div>
              <p className="setup-hint">
                Expected columns include <code>Full Name</code> (or{" "}
                <code>FULL_NAME</code>), <code>Content Week Name</code>,{" "}
                <code>Latest Submission Time</code>; optional{" "}
                <code>PE_NAME</code>, <code>GROUP_NAME</code>,{" "}
                <code>Total Points</code>. Use CSV UTF-8 from Excel if applicable.
              </p>
              <input
                ref={setupReportInputRef}
                type="file"
                accept=".csv"
                multiple
                style={{ display: "none" }}
                onChange={(e) => void onSetupReportChange(e.target.files)}
              />
              {setupLoadedLabel ? (
                <div className="setup-file-loaded">{setupLoadedLabel}</div>
              ) : null}
            </div>
            <div className="setup-footer">
              <span
                className="setup-step"
                style={{
                  color: setupTexts.length ? "var(--kale)" : undefined,
                }}
              >
                {setupTexts.length
                  ? "Ready — click Build Dashboard"
                  : "Upload a report to get started"}
              </span>
              <button
                type="button"
                className="setup-start-btn"
                disabled={!setupTexts.length}
                onClick={() => void launchDashboard()}
              >
                Build Dashboard →
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  return (
    <>
      <div
        className={`upload-overlay${uploadOpen ? " open" : ""}`}
        role="presentation"
      >
        <div className="upload-modal">
          <h2>Load New Report</h2>
          <p>
            Upload one or two Uplimit CSV exports. Multiple files are combined
            automatically. The dashboard will refresh instantly.
          </p>
          <div
            className={`drop-zone${uploadDrag ? " drag-over" : ""}`}
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setUploadDrag(true);
            }}
            onDragLeave={() => setUploadDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setUploadDrag(false);
              const csvs = Array.from(e.dataTransfer.files).filter((f) =>
                f.name.toLowerCase().endsWith(".csv")
              );
              if (csvs.length) {
                void onUploadFiles(csvs).then(() => setUploadOpen(false));
              }
            }}
            role="presentation"
          >
            📂 Click to choose files, or drag & drop CSVs here
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".csv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void onUploadFiles(e.target.files);
              setUploadOpen(false);
              e.target.value = "";
            }}
          />
          <div className="modal-footer">
            <button
              type="button"
              className="modal-cancel"
              onClick={() => setUploadOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div
        className={`export-overlay${exportOpen ? " open" : ""}`}
        role="presentation"
      >
        <div className="export-modal">
          <h2>Export to CSV</h2>
          <p className="export-intro">
            Download data matching your current filters. Scope chips mirror the
            Agent and Month dropdowns above.
          </p>
          <div className="export-options">
            {(
              [
                {
                  id: "daily" as const,
                  label: "Day-over-day summary",
                  desc: "Agents as rows; each date column shows modules completed that day.",
                },
                {
                  id: "modules" as const,
                  label: "Module matrix",
                  desc: "Modules as rows; agent columns show completion dates.",
                },
                {
                  id: "log" as const,
                  label: "Flat completion log",
                  desc: "One row per agent–module completion with days-to-complete.",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.id}
                className={`export-option${exportType === opt.id ? " selected" : ""}`}
              >
                <input
                  type="radio"
                  name="exportType"
                  value={opt.id}
                  checked={exportType === opt.id}
                  onChange={() => setExportType(opt.id)}
                />
                <div>
                  <div className="export-option-label">{opt.label}</div>
                  <div className="export-option-desc">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="export-scope">
            <label>Export scope (from filters)</label>
            <div className="scope-row">{exportScopeChips}</div>
          </div>
          <div className="export-footer">
            <span className="export-filename">
              {exportFilename(data, exportType, filters.months)}
            </span>
            <button
              type="button"
              className="export-cancel-btn"
              onClick={() => setExportOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="export-confirm-btn"
              onClick={runExport}
            >
              Download
            </button>
          </div>
        </div>
      </div>

      <header>
        <div className="logo">
          <div className="logo-mark">gusto</div>
          {!readOnly && workspace ? (
            <div className="header-team-block">
              <span className="header-team-label">Team</span>
              <button
                type="button"
                className="header-team-name header-team-name--link"
                onClick={() => goToTeamManager()}
                title="Back to team workspaces"
              >
                {workspace.team_name}
              </button>
              <button
                type="button"
                className="header-switch-team"
                onClick={() => switchTeam()}
              >
                Switch Team
              </button>
            </div>
          ) : null}
          <div className="logo-text">
            <ProgramHeading programName={data.program_name} />
            <div className="header-sub">{headerSubtitle}</div>
          </div>
        </div>
        <div className="header-meta">
          {saving ? (
            <span className="date-range" style={{ borderStyle: "dashed" }}>
              Saving…
            </span>
          ) : null}
          {!readOnly && lastSavedAt ? (
            <span className="last-saved-chip" title={formatMT(lastSavedAt)}>
              Last saved: {formatMT(lastSavedAt)}
            </span>
          ) : null}
          {!readOnly && workspace && snapshots.length > 0 ? (
            <div className="history-dropdown-wrap">
              <button
                type="button"
                className="export-btn"
                aria-expanded={historyOpen}
                aria-haspopup="listbox"
                onClick={() => setHistoryOpen((o) => !o)}
              >
                History ▾
              </button>
              {historyOpen ? (
                <div className="history-panel" role="listbox">
                  {snapshots.map((s, idx) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={activeSnapshotId === s.id}
                      className={`history-item${
                        activeSnapshotId === s.id ? " active" : ""
                      }`}
                      onClick={() => {
                        void (async () => {
                          try {
                            const full = await fetchSnapshotById(s.id);
                            if (!full) return;
                            setData(normalizeLoadedData(full.processed_data));
                            setActiveSnapshotId(full.id);
                            setShareToken(full.share_token);
                            setLastSavedAt(full.uploaded_at);
                            setHistoryOpen(false);
                          } catch (e) {
                            console.error(e);
                            alert("Could not load that snapshot.");
                          }
                        })();
                      }}
                    >
                      <div className="history-item-row">
                        <span className="history-item-label">
                          {s.label ?? "Snapshot"}
                        </span>
                        {idx === 0 ? (
                          <span className="history-badge-current">Current</span>
                        ) : null}
                      </div>
                      <div className="history-item-meta">
                        {formatMT(s.uploaded_at)} ·{" "}
                        {s.agent_count ?? 0} agents
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="date-range">{dateRangeLabel}</div>
          {!readOnly && (
            <>
              <button
                type="button"
                className="export-btn"
                onClick={() => copyShareLink()}
                title="Copy read-only link for managers"
                disabled={!shareToken}
              >
                Copy share link
              </button>
              <button
                type="button"
                className="upload-btn"
                onClick={() => setUploadOpen(true)}
              >
                Load New Report
              </button>
            </>
          )}
        </div>
      </header>

      {readOnly && data ? (
        <div className="shared-view-banner" role="status">
          Read-only shared view — you can&apos;t upload new reports from this
          link.
        </div>
      ) : null}

      <div className="stats-strip">
        {stats ? <StatsStripAnimated stats={stats} /> : null}
      </div>

      <div className="tab-bar">
        {(
          [
            { id: "overview" as const, label: "📊 Overview" },
            { id: "daily" as const, label: "📅 Day-over-Day" },
            { id: "modules" as const, label: "📚 By Module" },
            { id: "agents" as const, label: "👤 Agent Summary" },
            { id: "overdue" as const, label: "🔴 Overdue" },
            { id: "roster" as const, label: "👥 Roster Gaps" },
            { id: "howto" as const, label: "📖 How to Use" },
            { id: "manager" as const, label: "🏆 Manager View" },
          ] as const
        ).map(({ id, label }) => (
          <div
            key={id}
            className={`tab${activeTab === id ? " active" : ""}`}
            onClick={() => switchTab(id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && switchTab(id)}
          >
            {label}
          </div>
        ))}
        <div className="tab-spacer" />
        <button
          type="button"
          className="export-btn"
          onClick={() => setExportOpen(true)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </div>

      <div className="filter-bar">
        {buildPicklist("agent", "Agent", "All Agents", "No agents")}
        <div className="filter-sep" />
        <div className="period-toggle-group" role="group" aria-label="Period mode">
          <button
            type="button"
            className={`period-toggle-btn${periodMode === "month" ? " active" : ""}`}
            onClick={() => setPeriodMode("month")}
          >
            Month
          </button>
          <button
            type="button"
            className={`period-toggle-btn${periodMode === "week" ? " active" : ""}`}
            onClick={() => setPeriodMode("week")}
          >
            Week
          </button>
        </div>
        <div className="filter-sep" />
        {buildPicklist(
          "month",
          periodMode === "week" ? "Week" : "Month",
          periodMode === "week" ? "All weeks" : "All months",
          periodMode === "week" ? "No weeks" : "No months",
          formatPeriodOption
        )}
        <div className="filter-sep" />
        <label htmlFor="moduleSearchInp">Search Module</label>
        <input
          id="moduleSearchInp"
          type="text"
          placeholder="e.g. W-2, Payroll…"
          value={moduleSearch}
          onChange={(e) => setModuleSearch(e.target.value)}
          style={{ width: 180 }}
        />
        {data.group_names.length > 0 && (
          <>
            <div className="filter-sep" />
            {buildPicklist("team", "Team", "All teams", "No teams")}
          </>
        )}
      </div>

      <div className="content">
        <div
          className={`tab-pane${activeTab === "overview" ? " active" : ""}`}
          id="pane-overview"
        >
          <TabDescRowWithExport
            {...TAB_DESC.overview}
            exportType="modules"
            onExport={runTabExport}
          />
          {overviewPane}
        </div>
        <div
          className={`tab-pane${activeTab === "daily" ? " active" : ""}`}
          id="pane-daily"
        >
          <TabDescRow {...TAB_DESC.daily} />
          {dailyPane}
        </div>
        <div
          className={`tab-pane${activeTab === "modules" ? " active" : ""}`}
          id="pane-modules"
        >
          <TabDescRow {...TAB_DESC.modules} />
          {modulesPane}
        </div>
        <div
          className={`tab-pane${activeTab === "agents" ? " active" : ""}`}
          id="pane-agents"
        >
          <TabDescRowWithExport
            {...TAB_DESC.agents}
            exportType="daily"
            onExport={runTabExport}
          />
          {agentsPane}
        </div>
        <div
          className={`tab-pane${activeTab === "overdue" ? " active" : ""}`}
          id="pane-overdue"
        >
          <TabDescRowWithExport
            {...TAB_DESC.overdue}
            exportType="log"
            onExport={runTabExport}
          />
          {overduePane}
        </div>
        <div
          className={`tab-pane${activeTab === "roster" ? " active" : ""}`}
          id="pane-roster"
        >
          <TabDescRow {...TAB_DESC.roster} />
          <div className="roster-wrap">
            <div className="gap-card">
              <h3>🗂 Paste Your Agent Roster</h3>
              <p>
                Enter one name per line — exactly as they appear in Uplimit
                (First Last). The dashboard will compare the roster against the
                report and highlight anyone missing.
              </p>
              <div className="roster-input-area">
                <textarea
                  id="rosterText"
                  placeholder={
                    "Abegail Oval\nAllan Asia\nAmiela Edilloran\n..."
                  }
                  value={rosterText}
                  onChange={(e) => setRosterText(e.target.value)}
                />
                <button
                  type="button"
                  className="roster-apply-btn"
                  onClick={applyRoster}
                >
                  Apply Roster
                </button>
              </div>
            </div>
            <div id="rosterResults">{rosterResults}</div>
          </div>
        </div>
        <div
          className={`tab-pane${activeTab === "howto" ? " active" : ""}`}
          id="pane-howto"
        >
          <TabDescRow {...TAB_DESC.howto} />
          {howtoPane}
        </div>
        <div
          className={`tab-pane${activeTab === "manager" ? " active" : ""}`}
          id="pane-manager"
        >
          <TabDescRow {...TAB_DESC.manager} />
          {managerPane}
        </div>
      </div>

      {slideout && data ? (
        <div
          className="slideout-overlay"
          role="presentation"
          onClick={handleSlideoutClick}
        >
          <aside
            className="slideout-panel"
            role="dialog"
            aria-label="Day detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="slideout-panel-head">
              <div>
                <div className="slideout-panel-date">
                  {formatDate(slideout.date)}
                </div>
                <div className="slideout-panel-agent">{slideout.agent}</div>
              </div>
              <button
                type="button"
                className="slideout-close"
                aria-label="Close"
                onClick={() => setSlideout(null)}
              >
                ✕
              </button>
            </div>
            {slideoutModules.length === 0 ? (
              <p className="slideout-empty">No module completions recorded for this day.</p>
            ) : (
              <ul className="slideout-list">
                {slideoutModules.map(({ mod, score }) => (
                  <li key={mod} className="slideout-item">
                    <span className="slideout-mod" title={mod}>
                      {mod}
                    </span>
                    <span
                      className={`score-pill slideout-score ${
                        score !== undefined ? scorePillClass(score) : "na"
                      }`}
                    >
                      {score !== undefined ? `${score}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="slideout-footer">
              <button
                type="button"
                className="slideout-link-tab"
                onClick={() => {
                  setSlideout(null);
                  goToTab("agents");
                }}
              >
                Open Agent Summary tab
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div
        className={`tooltip-box${tooltip ? " visible" : ""}`}
        style={
          tooltip
            ? { left: tooltip.x, top: tooltip.y, display: "block" }
            : undefined
        }
      >
        {tooltip?.text}
      </div>
    </>
  );
}

/** HTML-aligned helpers (also in `@/lib/dashboardHelpers`). */
export {
  daysSince,
  getWeekStart,
  progFillClass,
  scorePillClass,
} from "@/lib/dashboardHelpers";
