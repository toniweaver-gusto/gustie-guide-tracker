import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  filterAgentsList,
  filterDatesForViews,
} from "@/lib/dashboardFiltering";
import { formatDate } from "@/lib/formatDate";
import {
  applyPicklistItemToggle,
  picklistButtonLabel,
  toggleAllPicklist,
  type PicklistSelection,
} from "@/lib/picklistEngine";
import type { ProcessedDashboardData } from "@/lib/types";
import { FilterPicklist } from "@/components/FilterPicklist";

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
  onDayCellClick: (agent: string, date: string) => void;
};

export function DailySplitPane({
  data,
  filters,
  dailySelectedAgent,
  onSelectDailyAgent,
  onDayCellClick,
}: Props) {
  const agents = filterAgentsList(data, filters);
  const dates = filterDatesForViews(data, filters);

  const allAgentValues = useMemo(
    () => [...agents].sort((a, b) => a.localeCompare(b)),
    [agents]
  );

  const agentScopeKey = useMemo(
    () => allAgentValues.join("\0"),
    [allAgentValues]
  );

  const [pickOpen, setPickOpen] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickSelected, setPickSelected] = useState<PicklistSelection>(null);

  useEffect(() => {
    setPickSelected(null);
    setPickOpen(false);
    setPickSearch("");
  }, [agentScopeKey]);

  useEffect(() => {
    if (!pickOpen) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.(".daily-split-picklist")) return;
      setPickOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pickOpen]);

  const sortedAgents = useMemo(
    () => sortAgentsByCompletions(data, agents, dates),
    [data, agents, dates]
  );

  const narrowedAgents = useMemo(() => {
    if (pickSelected === null) return sortedAgents;
    if (pickSelected.length === 0) return [];
    return sortedAgents.filter((a) => pickSelected.includes(a));
  }, [sortedAgents, pickSelected]);

  const selectDailyAgent = useCallback(
    (agent: string | null) => {
      onSelectDailyAgent(agent);
    },
    [onSelectDailyAgent]
  );

  useEffect(() => {
    if (!narrowedAgents.length) {
      selectDailyAgent(null);
      return;
    }
    if (
      !dailySelectedAgent ||
      !narrowedAgents.includes(dailySelectedAgent)
    ) {
      selectDailyAgent(narrowedAgents[0]!);
    }
  }, [narrowedAgents, dailySelectedAgent, selectDailyAgent]);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!narrowedAgents.length || dailySelectedAgent == null) return;
      const idx = narrowedAgents.indexOf(dailySelectedAgent);
      if (idx < 0) return;
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? Math.min(idx + 1, narrowedAgents.length - 1)
          : Math.max(idx - 1, 0);
      selectDailyAgent(narrowedAgents[next]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrowedAgents, dailySelectedAgent, selectDailyAgent]);

  const togglePickOpen = useCallback(() => {
    setPickOpen((o) => !o);
  }, []);

  const togglePickAll = useCallback(
    (e: SyntheticEvent) => {
      e.stopPropagation();
      setPickSelected((s) => toggleAllPicklist(s, allAgentValues));
    },
    [allAgentValues]
  );

  const togglePickItem = useCallback(
    (val: string, checked: boolean) => {
      setPickSelected((s) =>
        applyPicklistItemToggle(s, val, checked, allAgentValues)
      );
    },
    [allAgentValues]
  );

  const pickButtonLabel = useMemo(
    () =>
      picklistButtonLabel(
        pickSelected,
        allAgentValues,
        "All Agents",
        "No agents"
      ),
    [pickSelected, allAgentValues]
  );

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
        <div className="daily-split-picklist">
          <FilterPicklist
            label="Agents"
            buttonLabel={pickButtonLabel}
            allValues={allAgentValues}
            selected={pickSelected}
            open={pickOpen}
            search={pickSearch}
            onToggleOpen={togglePickOpen}
            onSearchChange={setPickSearch}
            onToggleAll={togglePickAll}
            onToggleItem={togglePickItem}
          />
        </div>
        <div className="daily-split-list" role="listbox" aria-label="Agents">
          {pickSelected !== null && pickSelected.length === 0 ? (
            <div className="empty-state empty-state--in-split">
              <div className="empty-state-icon" aria-hidden>
                👤
              </div>
              <div className="empty-state-title">No agents selected</div>
              <div className="empty-state-msg">
                Use <strong>Select All</strong> in the Agents picklist above, or
                choose one or more agents.
              </div>
            </div>
          ) : null}
          {narrowedAgents.map((a) => {
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
