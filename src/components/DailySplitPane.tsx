import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  filterAgentsList,
  filterDatesForViews,
} from "@/lib/dashboardFiltering";
import { formatDate } from "@/lib/formatDate";
import type { ProcessedDashboardData } from "@/lib/types";

function filterDailyList(
  agents: string[],
  search: string
): string[] {
  const q = search.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter((a) => a.toLowerCase().includes(q));
}

/** Sort agents by total completions (desc), then name. */
function sortAgentsByCompletions(
  data: ProcessedDashboardData,
  agents: string[],
  dates: string[]
): string[] {
  const score = (a: string) => {
    const daily = data.agent_daily[a] || {};
    let t = 0;
    dates.forEach((d) => {
      t += daily[d] || 0;
    });
    return t;
  };
  return [...agents].sort((x, y) => {
    const cx = score(x);
    const cy = score(y);
    if (cy !== cx) return cy - cx;
    return x.localeCompare(y);
  });
}

function lastActiveDate(
  data: ProcessedDashboardData,
  agent: string
): string | null {
  const vals = Object.values(data.agent_modules[agent] || {});
  if (!vals.length) return null;
  return vals.sort().slice(-1)[0] ?? null;
}

type Props = {
  data: ProcessedDashboardData;
  filters: DashboardFilters;
  dailySelectedAgent: string | null;
  onSelectDailyAgent: (agent: string | null) => void;
  dailySearch: string;
  onDailySearchChange: (s: string) => void;
  onDayCellClick: (agent: string, date: string) => void;
};

export function DailySplitPane({
  data,
  filters,
  dailySelectedAgent,
  onSelectDailyAgent,
  dailySearch,
  onDailySearchChange,
  onDayCellClick,
}: Props) {
  const agents = filterAgentsList(data, filters);
  const dates = filterDatesForViews(data, filters);

  const sortedAgents = useMemo(
    () => sortAgentsByCompletions(data, agents, dates),
    [data, agents, dates]
  );

  const filteredAgents = useMemo(
    () => filterDailyList(sortedAgents, dailySearch),
    [sortedAgents, dailySearch]
  );

  const selectDailyAgent = useCallback(
    (agent: string | null) => {
      onSelectDailyAgent(agent);
    },
    [onSelectDailyAgent]
  );

  useEffect(() => {
    if (!filteredAgents.length) {
      selectDailyAgent(null);
      return;
    }
    if (
      !dailySelectedAgent ||
      !filteredAgents.includes(dailySelectedAgent)
    ) {
      selectDailyAgent(filteredAgents[0]!);
    }
  }, [filteredAgents, dailySelectedAgent, selectDailyAgent]);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!filteredAgents.length || dailySelectedAgent == null) return;
      const idx = filteredAgents.indexOf(dailySelectedAgent);
      if (idx < 0) return;
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? Math.min(idx + 1, filteredAgents.length - 1)
          : Math.max(idx - 1, 0);
      selectDailyAgent(filteredAgents[next]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredAgents, dailySelectedAgent, selectDailyAgent]);

  const byMonth: Record<string, string[]> = {};
  dates.forEach((d) => {
    const mk = d.slice(0, 7);
    if (!byMonth[mk]) byMonth[mk] = [];
    byMonth[mk].push(d);
  });

  const activeAgent = dailySelectedAgent;
  const daily = activeAgent ? data.agent_daily[activeAgent] || {} : {};

  if (!dates.length) {
    return (
      <div className="daily-wrap">
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden>
            📅
          </div>
          <div className="empty-state-title">No activity in range</div>
          <div className="empty-state-msg">
            Try widening your month filter or clearing module search.
          </div>
        </div>
      </div>
    );
  }

  if (!sortedAgents.length) {
    return (
      <div className="daily-wrap">
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden>
            👤
          </div>
          <div className="empty-state-title">No agents match your filters</div>
          <div className="empty-state-msg">
            Adjust agent or team picklists to include agents with activity.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-split-wrap">
      <div className="daily-split-left" ref={listRef}>
        <div className="daily-split-search">
          <label htmlFor="daily-agent-search">Search agents</label>
          <input
            id="daily-agent-search"
            type="search"
            placeholder="Filter list…"
            value={dailySearch}
            onChange={(e) => onDailySearchChange(e.target.value)}
          />
        </div>
        <div className="daily-split-list" role="listbox" aria-label="Agents">
          {filteredAgents.length === 0 && sortedAgents.length > 0 ? (
            <div className="empty-state empty-state--in-split">
              <div className="empty-state-icon" aria-hidden>
                🔍
              </div>
              <div className="empty-state-title">No agents match search</div>
              <div className="empty-state-msg">
                Clear the search box or type a different name.
              </div>
            </div>
          ) : null}
          {filteredAgents.map((a) => {
            const tot = dates.reduce(
              (s, d) => s + (data.agent_daily[a]?.[d] || 0),
              0
            );
            const max = dates.length * 5;
            const pct = max > 0 ? Math.min(100, Math.round((tot / max) * 100)) : 0;
            const last = lastActiveDate(data, a);
            const isSel = activeAgent === a;
            return (
              <button
                key={a}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`daily-split-row${isSel ? " selected" : ""}`}
                onClick={() => selectDailyAgent(a)}
              >
                <div className="daily-split-row-name">{a}</div>
                <div className="daily-split-row-bar">
                  <div className="prog-bar">
                    <div
                      className="prog-fill mid"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="daily-split-row-count">{tot}</span>
                </div>
                <div className="daily-split-row-last">
                  {last ? formatDate(last) : "—"}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="daily-split-right">
        {activeAgent ? (
          <>
            <div className="daily-split-right-head">
              <h3 className="daily-split-detail-title">{activeAgent}</h3>
              <p className="daily-split-hint">
                Click a day with activity for details. Use ↑↓ to change agent.
              </p>
            </div>
            {Object.entries(byMonth).map(([mk, mDates]) => {
              const [y, mo] = mk.split("-");
              const mLabel = new Date(Number(y), Number(mo) - 1).toLocaleString(
                "default",
                { month: "long", year: "numeric" }
              );
              return (
                <div key={mk} className="month-group">
                  <div className="month-label">{mLabel}</div>
                  <table className="daily-table">
                    <thead>
                      <tr>
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
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {mDates.map((d) => {
                          const cnt = daily[d] || 0;
                          if (cnt) {
                            return (
                              <td key={d} className="day-cell">
                                <button
                                  type="button"
                                  className="day-dot has-activity day-dot-btn"
                                  onClick={() =>
                                    onDayCellClick(activeAgent, d)
                                  }
                                >
                                  {cnt}
                                </button>
                              </td>
                            );
                          }
                          return (
                            <td key={d} className="day-cell">
                              <span className="day-dot no-activity">·</span>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </>
        ) : (
          <div className="daily-split-placeholder">
            Select an agent to view their calendar.
          </div>
        )}
      </div>
    </div>
  );
}

export { filterDailyList };
