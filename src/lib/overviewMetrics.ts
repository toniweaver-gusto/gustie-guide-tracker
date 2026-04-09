import type { DashboardFilters } from "@/lib/dashboardFilters";
import {
  filterAgentsList,
  filterModulesForViews,
} from "@/lib/dashboardFiltering";
import { getWeekStart } from "@/lib/dashboardHelpers";
import type { ProcessedDashboardData } from "@/lib/types";

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

export type TeamTrendWeek = {
  weekStart: string;
  completions: number;
  isCurrentWeek: boolean;
};

/** Last 10 Monday week starts ending at current week; completion counts from agent_modules dates. */
export function teamCompletionTrendLast10Weeks(
  data: ProcessedDashboardData,
  f: DashboardFilters
): TeamTrendWeek[] {
  const agents = filterAgentsList(data, f);
  const today = new Date().toISOString().slice(0, 10);
  const currentWeekStart = getWeekStart(today);

  const weekStarts: string[] = [];
  let w = currentWeekStart;
  for (let i = 0; i < 10; i++) {
    weekStarts.unshift(w);
    const d = new Date(w + "T12:00:00");
    d.setDate(d.getDate() - 7);
    w = getWeekStart(d.toISOString().slice(0, 10));
  }

  const counts = new Map<string, number>();
  weekStarts.forEach((wk) => counts.set(wk, 0));

  agents.forEach((a) => {
    Object.values(data.agent_modules[a] || {}).forEach((iso) => {
      const wk = getWeekStart(iso);
      if (counts.has(wk)) {
        counts.set(wk, (counts.get(wk) || 0) + 1);
      }
    });
  });

  return weekStarts.map((weekStart) => ({
    weekStart,
    completions: counts.get(weekStart) || 0,
    isCurrentWeek: weekStart === currentWeekStart,
  }));
}
