import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildExportCsv,
  exportFilename,
  type ExportFilters,
  type ExportType,
} from "@/lib/exportCsv";
import { processCSVTexts } from "@/lib/csvParse";
import { formatDate } from "@/lib/formatDate";
import {
  LOW_SCORE_THRESHOLD,
  daysSince,
  getWeekStart,
  progFillClass,
  scorePillClass,
} from "@/lib/dashboardHelpers";
import {
  normalizeRawScores,
  sanitizeForPostgres,
  sanitizeProcessedDataForPostgres,
} from "@/lib/sanitizeProcessedData";
import type { ProcessedDashboardData } from "@/lib/types";
import {
  createDashboard,
  fetchDashboardByToken,
  patchDashboard,
} from "@/lib/dashboardApi";
import { shareUrlForToken } from "@/lib/appPaths";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { FilterPicklist } from "@/components/FilterPicklist";
import {
  applyPicklistItemToggle,
  initialPicklistState,
  picklistButtonLabel,
  toggleAllPicklist,
  type PicklistId,
  type PicklistSelection,
} from "@/lib/picklistEngine";

const SESSION_KEY = "uplimit_dashboard_token";
const GGT_DATA_KEY = "ggt_data";
const GGT_TAB_KEY = "ggt_tab";

/** Multi-select: `null` = all, `[]` = none, `[...]` = subset */
export type DashboardFilters = {
  agents: PicklistSelection;
  months: PicklistSelection;
  modules: PicklistSelection;
  managers: PicklistSelection;
  teams: PicklistSelection;
};

function filterAgentsList(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  let list = [...data.agents];
  if (f.agents !== null) {
    if (f.agents.length === 0) return [];
    list = list.filter((a) => f.agents!.includes(a));
  }
  if (f.managers !== null) {
    if (f.managers.length === 0) return [];
    list = list.filter((a) =>
      f.managers!.some((pe) => data.agent_pe[a] === pe)
    );
  }
  if (f.teams !== null) {
    if (f.teams.length === 0) return [];
    list = list.filter((a) => {
      const gs = data.agent_groups[a] ?? [];
      return f.teams!.some((t) => gs.includes(t));
    });
  }
  return list;
}

function filterModulesForViews(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  let modules = [...data.modules];
  if (f.months !== null) {
    if (f.months.length === 0) return [];
    modules = modules.filter((m) => {
      const rd = data.module_dates[m];
      return Boolean(rd && f.months!.some((mo) => rd.startsWith(mo)));
    });
  }
  if (f.modules !== null) {
    if (f.modules.length === 0) return [];
    modules = modules.filter((m) => f.modules!.includes(m));
  }
  return modules;
}

function filterDatesForViews(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  if (f.months === null) return [...data.all_dates];
  if (f.months.length === 0) return [];
  return data.all_dates.filter((d) =>
    f.months!.some((mo) => d.startsWith(mo))
  );
}

/** Stats strip — same agent/module semantics as `renderOverview`. */
function computeFilteredStatsStrip(
  data: ProcessedDashboardData,
  f: DashboardFilters
): {
  agents: number;
  completions: number;
  overallPct: number;
  overdue: number;
  lowScores: number;
} {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);
  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);
  const scoreMap = data._raw_scores ?? {};

  if (!agents.length || !modules.length) {
    return {
      agents: agents.length,
      completions: 0,
      overallPct: 0,
      overdue: 0,
      lowScores: 0,
    };
  }

  let completions = 0;
  let overdue = 0;
  let lowScores = 0;

  agents.forEach((a) => {
    const completed = new Set(Object.keys(data.agent_modules[a] || {}));
    modules.forEach((mod) => {
      if (completed.has(mod)) {
        completions++;
        const s = scoreMap[a]?.[mod];
        if (s !== undefined && s < LOW_SCORE_THRESHOLD) lowScores++;
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
    lowScores,
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
    lowScores: number;
  };
}) {
  const animAgents = useAnimatedInt(stats.agents);
  const animCompletions = useAnimatedInt(stats.completions);
  const animPct = useAnimatedInt(stats.overallPct);
  const animOverdue = useAnimatedInt(stats.overdue);
  const animLow = useAnimatedInt(stats.lowScores);

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
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--warn)" }}>
          {animLow.toLocaleString()}
        </div>
        <div className="stat-label">Low Scores</div>
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
  monthKeys: string[]
): string[] {
  switch (id) {
    case "agent":
      return [...data.agents];
    case "month":
      return monthKeys;
    case "module":
      return [...data.modules];
    case "team":
      return [...data.group_names];
    case "manager":
      return [...data.pe_names];
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

type TooltipSetter = (
  t: { text: string; x: number; y: number } | null
) => void;

/** Tab: Overview — mirrors `renderOverview` from gustie-guide-dashboard-v2.html */
function renderOverview(
  data: ProcessedDashboardData,
  f: DashboardFilters
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  const today = new Date().toISOString().slice(0, 10);
  const scoreMap = data._raw_scores ?? {};

  let totalAssignments = 0;
  let totalCompleted = 0;
  let totalOverdue = 0;
  let totalLowScore = 0;
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
          if (s < LOW_SCORE_THRESHOLD) totalLowScore++;
        }
      } else {
        const relDate = data.module_dates[mod];
        if (relDate && getWeekStart(relDate) < getWeekStart(today)) {
          totalOverdue++;
        }
      }
    });
  });

  const totalIncomplete = totalAssignments - totalCompleted;
  const avgScore = allScores.length
    ? Math.round(allScores.reduce((x, y) => x + y, 0) / allScores.length)
    : null;

  if (!modules.length) {
    return (
      <div className="overview-wrap">
        <div className="no-data">No modules match your filters.</div>
      </div>
    );
  }

  return (
    <div className="overview-wrap">
      <div className="overview-grid">
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
            {totalOverdue.toLocaleString()}
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

/** Tab: Day-over-Day — mirrors `renderDaily` */
function renderDaily(
  data: ProcessedDashboardData,
  f: DashboardFilters,
  setTooltip: TooltipSetter
): ReactNode {
  const agents = filterAgentsList(data, f);
  const dates = filterDatesForViews(data, f);

  const byMonth: Record<string, string[]> = {};
  dates.forEach((d) => {
    const mk = d.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = [];
    byMonth[mk].push(d);
  });

  const blocks: ReactNode[] = [];
  for (const [mk, mDates] of Object.entries(byMonth)) {
    const [y, mo] = mk.split("-");
    const mLabel = new Date(Number(y), Number(mo) - 1).toLocaleString(
      "default",
      { month: "long", year: "numeric" }
    );
    blocks.push(
      <div key={mk} className="month-group">
        <div className="month-label">{mLabel}</div>
        <table className="daily-table">
          <thead>
            <tr>
              <th style={{ minWidth: 140 }}>Agent</th>
              {mDates.map((d) => {
                const dt = new Date(d + "T12:00:00");
                const dayAbbr = dt
                  .toLocaleString("default", { weekday: "short" })
                  .slice(0, 2);
                const dayNum = dt.getDate();
                return (
                  <th key={d} className="date-th" title={d}>
                    {dayAbbr}
                    <br />
                    {dayNum}
                  </th>
                );
              })}
              <th style={{ textAlign: "right", paddingRight: 4 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const daily = data.agent_daily[a] || {};
              let rowTotal = 0;
              mDates.forEach((d) => {
                if (daily[d]) rowTotal += daily[d];
              });
              if (!rowTotal && f.agents === null) return null;
              return (
                <tr key={a}>
                  <td className="sticky-agent">
                    <span className="agent-cell">{a}</span>
                  </td>
                  {mDates.map((d) => {
                    const cnt = daily[d] || 0;
                    if (cnt) {
                      const tip = `${a} — ${formatDate(d)}: ${cnt} module${cnt > 1 ? "s" : ""} completed`;
                      return (
                        <td key={d} className="day-cell">
                          <span
                            className="day-dot has-activity"
                            onMouseEnter={(e) =>
                              setTooltip({
                                text: tip,
                                x: e.clientX + 12,
                                y: e.clientY + 12,
                              })
                            }
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {cnt}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={d} className="day-cell">
                        <span className="day-dot no-activity">·</span>
                      </td>
                    );
                  })}
                  <td className="tot-cell">
                    {rowTotal > 0 ? rowTotal : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (!dates.length) {
    return (
      <div className="daily-wrap">
        <div className="no-data">No activity data for the selected filters.</div>
      </div>
    );
  }
  return <div className="daily-wrap">{blocks}</div>;
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
      <div className="no-data">No modules match your filters.</div>
    );
  }

  if (!agents.length) {
    return (
      <div className="no-data">No agents match your filters.</div>
    );
  }

  return (
    <div className="module-wrap">
      <table className="module-table">
        <thead>
          <tr>
            <th className="sticky-agent" style={{ minWidth: 220 }}>
              Module
            </th>
            <th>Released</th>
            {agents.map((a) => (
              <th key={a} title={a}>
                {a.split(" ")[0]}
              </th>
            ))}
            <th style={{ textAlign: "right" }}>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((mod) => {
            const releaseDate = data.module_dates[mod] || "";
            let completedCount = 0;
            agents.forEach((a) => {
              if (data.agent_modules[a]?.[mod]) completedCount++;
            });
            const pct = Math.round(
              (completedCount / agents.length) * 100
            );
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
          })}
        </tbody>
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

  return (
    <div className="agent-wrap">
      <table className="agent-table agent-table-fixed">
        <thead>
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
        </thead>
        <tbody>
          {agentRows.map(
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
                      color:
                        missing > 0 ? "var(--danger)" : "var(--muted)",
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
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Tab: Overdue — mirrors `renderOverdue` */
function renderOverdue(
  data: ProcessedDashboardData,
  f: DashboardFilters
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);

  const overdueList: {
    agent: string;
    mod: string;
    relDate: string;
    daysOverdue: number;
    manager: string;
  }[] = [];

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

  return (
    <div className="overview-wrap">
      {!overdueList.length ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--kale)",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          ✓ No overdue trainings for the current filters.
        </div>
      ) : (
        <>
          <div
            style={{
              marginBottom: 16,
              fontSize: "0.78rem",
              color: "var(--muted)",
            }}
          >
            Showing{" "}
            <strong style={{ color: "var(--danger)" }}>
              {overdueList.length}
            </strong>{" "}
            overdue assignment
            {overdueList.length !== 1 ? "s" : ""} — modules from previous
            weeks not yet completed.
          </div>
          <table className="ov-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Manager</th>
                <th>Module</th>
                <th>Released</th>
                <th>Days Overdue</th>
              </tr>
            </thead>
            <tbody>
              {overdueList.map((row) => (
                <tr key={`${row.agent}-${row.mod}`}>
                  <td className="agent-name-cell">{row.agent}</td>
                  <td
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--muted)",
                    }}
                  >
                    {row.manager}
                  </td>
                  <td
                    style={{
                      maxWidth: 240,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
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
                    <span className="urgency-days">{row.daysOverdue}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Tab: Low Scores — mirrors `renderLowScores` */
function renderLowScores(
  data: ProcessedDashboardData,
  f: DashboardFilters
): ReactNode {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);

  const scoreMap = data._raw_scores ?? {};
  const lowList: {
    agent: string;
    mod: string;
    score: number;
    completedDate: string;
    manager: string;
  }[] = [];

  agents.forEach((a) => {
    modules.forEach((mod) => {
      if (!data.agent_modules[a]?.[mod]) return;
      const s = scoreMap[a]?.[mod];
      if (s === undefined || s >= LOW_SCORE_THRESHOLD) return;
      lowList.push({
        agent: a,
        mod,
        score: s,
        completedDate: data.agent_modules[a][mod],
        manager: data.agent_pe?.[a] || "—",
      });
    });
  });

  lowList.sort((x, y) => x.score - y.score);

  return (
    <div className="overview-wrap">
      {!lowList.length ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--kale)",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          ✓ No scores below 80% for the current filters.
        </div>
      ) : (
        <>
          <div
            style={{
              marginBottom: 16,
              fontSize: "0.78rem",
              color: "var(--muted)",
            }}
          >
            Showing{" "}
            <strong style={{ color: "var(--warn)" }}>{lowList.length}</strong>{" "}
            completion
            {lowList.length !== 1 ? "s" : ""} with score below 80% — these
            agents may need coaching.
          </div>
          <table className="ov-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Manager</th>
                <th>Module</th>
                <th>Score</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {lowList.map((row) => (
                <tr key={`${row.agent}-${row.mod}`}>
                  <td className="agent-name-cell">{row.agent}</td>
                  <td
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--muted)",
                    }}
                  >
                    {row.manager}
                  </td>
                  <td
                    style={{
                      maxWidth: 240,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.mod}
                  >
                    {row.mod}
                  </td>
                  <td>
                    <span className={`score-pill ${scorePillClass(row.score)}`}>
                      {row.score}%
                    </span>
                  </td>
                  <td
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: "0.62rem",
                      color: "var(--muted)",
                    }}
                  >
                    {row.completedDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            Use the multi-select picklists for <strong>Agent</strong>,{" "}
            <strong>Month</strong>, <strong>Module</strong>, and—when your export
            includes them—<strong>Team</strong> (<code>GROUP_NAME</code>) and{" "}
            <strong>Manager</strong> (<code>PE_NAME</code>). Search inside each
            list and use <strong>Select All</strong> to reset scope.
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
            <div className="howto-tab-card-icon">🟡</div>
            <h4>Low Scores</h4>
            <p>
              Completed modules with score below 80%, sorted lowest first for
              coaching follow-up.
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
        <p>💡 Weekly workflow: Every Monday, download your latest Uplimit export, click Load New Report, upload the file, and share the Overdue and Low Scores tabs with your team leads for follow-up. Takes less than 2 minutes.</p>
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
  | "lowscore"
  | "roster"
  | "howto";

const VALID_TAB_IDS: readonly TabId[] = [
  "overview",
  "daily",
  "modules",
  "agents",
  "overdue",
  "lowscore",
  "roster",
  "howto",
] as const;

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
  const [data, setData] = useState<ProcessedDashboardData | null>(() => {
    if (readOnly || initialToken) return null;
    try {
      const raw = sessionStorage.getItem(GGT_DATA_KEY);
      if (!raw) return null;
      return normalizeLoadedData(JSON.parse(raw));
    } catch {
      return null;
    }
  });
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(!!initialToken);
  const [remoteError, setRemoteError] = useState(false);

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
      if (!sessionStorage.getItem(GGT_DATA_KEY)) return "overview";
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
  /** Picklist engine: open/search/selected per filter id */
  const [_pl, setPl] = useState(() => initialPicklistState());
  const [rosterText, setRosterText] = useState("");
  const [rosterResults, setRosterResults] = useState<ReactNode>(null);

  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [saving, setSaving] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const setupReportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (readOnly || initialToken) return;
    try {
      const t = sessionStorage.getItem(SESSION_KEY);
      if (t) setShareToken(t);
    } catch {
      /* ignore */
    }
  }, [readOnly, initialToken]);

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
        const row = await fetchDashboardByToken(initialToken);
        if (!row) throw new Error("not found");
        if (!cancelled) {
          setData(normalizeLoadedData(row.processed_data));
          setShareToken(row.share_token);
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
    if (!data?.program_name) return;
    document.title = data.program_name + " Dashboard";
  }, [data?.program_name]);

  useEffect(() => {
    if (!data) return;
    setPl(initialPicklistState());
  }, [data]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.(".picklist-wrap")) return;
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

  const persist = useCallback(
    async (next: ProcessedDashboardData) => {
      if (readOnly) return;
      setSaving(true);
      try {
        if (!supabaseConfigured) {
          throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
        }
        const safe = sanitizeForPostgres({
          ...next,
          _raw_scores: normalizeRawScores(next._raw_scores),
        }) as ProcessedDashboardData;
        let token = shareToken;
        try {
          token = token || sessionStorage.getItem(SESSION_KEY);
        } catch {
          /* ignore */
        }

        if (token) {
          await patchDashboard(token, {
            program_name: safe.program_name,
            processed_data: safe,
          });
        } else {
          const newToken = await createDashboard({
            program_name: safe.program_name,
            processed_data: safe,
          });
          try {
            sessionStorage.setItem(SESSION_KEY, newToken);
          } catch {
            /* ignore */
          }
          setShareToken(newToken);
        }
      } catch (e) {
        console.error(e);
        alert(
          "Could not save to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, run migration 002 (RPC functions) in the SQL editor, then try again."
        );
      } finally {
        setSaving(false);
      }
    },
    [readOnly, shareToken]
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
      if (!readOnly) await persist(cleaned);
    },
    [readOnly, persist]
  );

  const launchDashboard = async () => {
    if (!setupTexts.length) return;
    const name = setupProgramName.trim() || "Training Dashboard";
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

  const monthKeys = useMemo(() => {
    if (!data?.all_dates.length) return [];
    return [...new Set(data.all_dates.map((d) => d.slice(0, 7)))].sort();
  }, [data]);

  const filters: DashboardFilters = useMemo(
    () => ({
      agents: _pl.agent.selected,
      months: _pl.month.selected,
      modules: _pl.module.selected,
      managers: _pl.manager.selected,
      teams: _pl.team.selected,
    }),
    [_pl]
  );

  const exportFilters: ExportFilters = useMemo(
    () => ({
      agents: filters.agents,
      months: filters.months,
      modules: filters.modules,
      managers: filters.managers,
      teams: filters.teams,
    }),
    [filters]
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
      const all = picklistAllValues(id, data, monthKeys);
      setPl((p) => {
        const cur = p[id].selected;
        const nextSel = toggleAllPicklist(cur, all);
        return { ...p, [id]: { ...p[id], selected: nextSel } };
      });
    },
    [data, monthKeys]
  );

  const togglePicklistItemHandler = useCallback(
    (id: PicklistId, val: string, checked: boolean) => {
      if (!data) return;
      const all = picklistAllValues(id, data, monthKeys);
      setPl((p) => {
        const cur = p[id].selected;
        const nextSel = applyPicklistItemToggle(cur, val, checked, all);
        return { ...p, [id]: { ...p[id], selected: nextSel } };
      });
    },
    [data, monthKeys]
  );

  const buildPicklist = (
    id: PicklistId,
    label: string,
    allLabel: string,
    noneLabel: string,
    format?: (v: string) => string
  ) => {
    if (!data) return null;
    const all = picklistAllValues(id, data, monthKeys);
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

  const overviewPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see overview.</div>
      );
    }
    return renderOverview(data, filters);
  }, [data, filters]);

  const dailyPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see day-over-day.</div>
      );
    }
    return renderDaily(data, filters, setTooltip);
  }, [data, filters]);

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
    return renderOverdue(data, filters);
  }, [data, filters]);

  const lowScoresPane = useMemo(() => {
    if (!data) {
      return (
        <div className="no-data">Upload a report to see low score alerts.</div>
      );
    }
    return renderLowScores(data, filters);
  }, [data, filters]);

  const howtoPane = useMemo(() => renderHowTo(), []);

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
    if (mf === null) {
      chips.push(
        <span key="m" className="scope-chip active">
          All Months
        </span>
      );
    } else if (mf.length === 0) {
      chips.push(
        <span key="m" className="scope-chip active">
          No months
        </span>
      );
    } else if (mf.length === 1) {
      chips.push(
        <span key="m" className="scope-chip active">
          {formatMonthKey(mf[0]!)}
        </span>
      );
    } else {
      chips.push(
        <span key="m" className="scope-chip active">
          {mf.length} months
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
    const pf = filters.managers;
    if (pf !== null && pf.length > 0) {
      chips.push(
        <span key="mgr" className="scope-chip active">
          {pf.length === 1 ? pf[0] : `${pf.length} managers`}
        </span>
      );
    }
    const modf = filters.modules;
    if (modf !== null && modf.length > 0 && modf.length < (data?.modules.length ?? 0)) {
      chips.push(
        <span key="mod" className="scope-chip active">
          {modf.length} modules
        </span>
      );
    }
    return chips;
  }, [data?.modules.length, filters]);

  const showSetup = !readOnly && !data;

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

  if (showSetup) {
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
            <h2>Gustie Guide Training Dashboard</h2>
            <p className="setup-intro">
              Upload your Uplimit CSV export (or several — they merge
              automatically). Completions are deduplicated by agent and module so
              group rows don&apos;t inflate counts.
            </p>
            <div className="setup-section">
              <label htmlFor="setupProgramName">Program name (optional)</label>
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
          <div className="date-range">{dateRangeLabel}</div>
          {!readOnly && (
            <>
              <button
                type="button"
                className="export-btn"
                onClick={() => copyShareLink()}
                title="Copy read-only link for managers"
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
            { id: "lowscore" as const, label: "🟡 Low Scores" },
            { id: "roster" as const, label: "👥 Roster Gaps" },
            { id: "howto" as const, label: "📖 How to Use" },
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
        {buildPicklist("month", "Month", "All Months", "No months", formatMonthKey)}
        <div className="filter-sep" />
        {buildPicklist("module", "Module", "All modules", "No modules")}
        {data.group_names.length > 0 && (
          <>
            <div className="filter-sep" />
            {buildPicklist("team", "Team", "All teams", "No teams")}
          </>
        )}
        {data.pe_names.length > 0 && (
          <>
            <div className="filter-sep" />
            {buildPicklist(
              "manager",
              "Manager",
              "All managers",
              "No managers"
            )}
          </>
        )}
      </div>

      <div className="content">
        <div
          className={`tab-pane${activeTab === "overview" ? " active" : ""}`}
          id="pane-overview"
        >
          {overviewPane}
        </div>
        <div
          className={`tab-pane${activeTab === "daily" ? " active" : ""}`}
          id="pane-daily"
        >
          {dailyPane}
        </div>
        <div
          className={`tab-pane${activeTab === "modules" ? " active" : ""}`}
          id="pane-modules"
        >
          {modulesPane}
        </div>
        <div
          className={`tab-pane${activeTab === "agents" ? " active" : ""}`}
          id="pane-agents"
        >
          {agentsPane}
        </div>
        <div
          className={`tab-pane${activeTab === "overdue" ? " active" : ""}`}
          id="pane-overdue"
        >
          {overduePane}
        </div>
        <div
          className={`tab-pane${activeTab === "lowscore" ? " active" : ""}`}
          id="pane-lowscore"
        >
          {lowScoresPane}
        </div>
        <div
          className={`tab-pane${activeTab === "roster" ? " active" : ""}`}
          id="pane-roster"
        >
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
          {howtoPane}
        </div>
      </div>

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
