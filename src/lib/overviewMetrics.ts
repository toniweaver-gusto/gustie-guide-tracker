import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  filterAgentsList,
  filterModulesForViews,
} from "@/lib/dashboardFiltering";
import { getWeekStart } from "@/lib/dashboardHelpers";
import type { ProcessedDashboardData } from "@/lib/types";

/** Count modules whose release week is on or before `weekStart` (Monday ISO). */
export function countModulesReleasedByWeekStart(
  modules: string[],
  moduleDates: Record<string, string>,
  weekStart: string
): number {
  let n = 0;
  for (const mod of modules) {
    const rd = moduleDates[mod];
    if (!rd) continue;
    if (getWeekStart(rd) <= weekStart) n++;
  }
  return n;
}

/** Last N Monday week starts ending at the week containing `todayIso`. */
export function buildLastNWeekStarts(todayIso: string, n: number): string[] {
  const currentWeekStart = getWeekStart(todayIso);
  const weekStarts: string[] = [];
  let w = currentWeekStart;
  for (let i = 0; i < n; i++) {
    weekStarts.unshift(w);
    const d = new Date(w + "T12:00:00");
    d.setDate(d.getDate() - 7);
    w = getWeekStart(d.toISOString().slice(0, 10));
  }
  return weekStarts;
}

export function getLast10WeekStarts(): {
  weekStarts: string[];
  currentWeekStart: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const currentWeekStart = getWeekStart(today);
  return {
    weekStarts: buildLastNWeekStarts(today, 10),
    currentWeekStart,
  };
}

export type TeamTrendWeek = {
  weekStart: string;
  /** Completions recorded this week (scoped modules × agents). */
  completions: number;
  /** agents × modules released this week or earlier. */
  assigned: number;
  /** 0–100: completions / assigned. */
  pct: number;
  isCurrentWeek: boolean;
};

/**
 * Completions = counts of (agent, module) with completion date in that week.
 * Assigned = agents × modules whose release week ≤ that week.
 */
export function computeTeamCompletionTrend(
  weekStarts: string[],
  data: ProcessedDashboardData,
  agents: string[],
  modules: string[],
  options: {
    currentWeekStart: string;
    completionIsoOk?: (iso: string) => boolean;
  }
): TeamTrendWeek[] {
  const completionIsoOk = options.completionIsoOk ?? (() => true);
  const counts = new Map<string, number>();
  weekStarts.forEach((wk) => counts.set(wk, 0));

  agents.forEach((a) => {
    for (const mod of modules) {
      const iso = data.agent_modules[a]?.[mod];
      if (!iso) continue;
      if (!completionIsoOk(iso)) continue;
      const wk = getWeekStart(iso);
      if (counts.has(wk)) {
        counts.set(wk, (counts.get(wk) || 0) + 1);
      }
    }
  });

  return weekStarts.map((weekStart) => {
    const modReleased = countModulesReleasedByWeekStart(
      modules,
      data.module_dates,
      weekStart
    );
    const completions = counts.get(weekStart) || 0;
    const assigned = agents.length * modReleased;
    const pct =
      assigned > 0 ? Math.round((completions / assigned) * 100) : 0;
    return {
      weekStart,
      completions,
      assigned,
      pct,
      isCurrentWeek: weekStart === options.currentWeekStart,
    };
  });
}

/** Last 10 weeks through current week; rates vs cumulative assignments due by each week. */
export function teamCompletionTrendLast10Weeks(
  data: ProcessedDashboardData,
  f: DashboardFilters
): TeamTrendWeek[] {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);
  const { weekStarts, currentWeekStart } = getLast10WeekStarts();
  return computeTeamCompletionTrend(weekStarts, data, agents, modules, {
    currentWeekStart,
  });
}

/** Count incomplete assignments whose module release week is before the current week. */
export function countOverdueAssignments(
  data: ProcessedDashboardData,
  f: DashboardFilters
): number {
  const agents = filterAgentsList(data, f);
  const modules = filterModulesForViews(data, f);
  const today = new Date().toISOString().slice(0, 10);
  const todayWeek = getWeekStart(today);
  let n = 0;
  agents.forEach((a) => {
    modules.forEach((mod) => {
      if (data.agent_modules[a]?.[mod]) return;
      const relDate = data.module_dates[mod];
      if (!relDate) return;
      if (getWeekStart(relDate) < todayWeek) n++;
    });
  });
  return n;
}
