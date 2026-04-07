import { getWeekStart } from "@/lib/dashboardHelpers";
import type { DashboardFilters } from "@/lib/dashboardFilters";
import type { ProcessedDashboardData } from "@/lib/types";

export function filterAgentsList(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  let list = [...data.agents];
  if (f.agents !== null) {
    if (f.agents.length === 0) return [];
    list = list.filter((a) => f.agents!.includes(a));
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

export function filterModulesForViews(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  let modules = [...data.modules];
  const q = f.moduleSearch.trim().toLowerCase();
  if (q) modules = modules.filter((m) => m.toLowerCase().includes(q));
  if (f.months !== null) {
    if (f.months.length === 0) return [];
    if (f.periodMode === "week") {
      modules = modules.filter((m) => {
        const rd = data.module_dates[m];
        if (!rd) return false;
        return f.months!.includes(getWeekStart(rd));
      });
    } else {
      modules = modules.filter((m) => {
        const rd = data.module_dates[m];
        return Boolean(rd && f.months!.some((mo) => rd.startsWith(mo)));
      });
    }
  }
  return modules;
}

export function filterDatesForViews(
  data: ProcessedDashboardData,
  f: DashboardFilters
): string[] {
  if (f.months === null) return [...data.all_dates];
  if (f.months.length === 0) return [];
  if (f.periodMode === "week") {
    return data.all_dates.filter((d) => f.months!.includes(getWeekStart(d)));
  }
  return data.all_dates.filter((d) =>
    f.months!.some((mo) => d.startsWith(mo))
  );
}
