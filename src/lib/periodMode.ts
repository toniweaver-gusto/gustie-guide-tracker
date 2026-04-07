import { getWeekStart } from "@/lib/dashboardHelpers";
import type { ProcessedDashboardData } from "@/lib/types";

export type PeriodMode = "month" | "week";

export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Week of Mon Jan 6" style label for a Monday ISO date. */
export function formatWeekPeriodLabel(weekStart: string): string {
  const d = new Date(weekStart + "T12:00:00");
  const wk = d.toLocaleString("default", { weekday: "short" });
  const mon = d.toLocaleString("default", { month: "short" });
  const day = d.getDate();
  return `Week of ${wk} ${mon} ${day}`;
}

export function collectMonthKeys(data: ProcessedDashboardData): string[] {
  const set = new Set<string>();
  data.all_dates.forEach((d) => set.add(d.slice(0, 7)));
  Object.values(data.module_dates).forEach((rd) => {
    if (rd) set.add(rd.slice(0, 7));
  });
  return [...set].sort();
}

export function collectWeekKeys(data: ProcessedDashboardData): string[] {
  const set = new Set<string>();
  data.all_dates.forEach((d) => set.add(getWeekStart(d)));
  Object.values(data.module_dates).forEach((rd) => {
    if (rd) set.add(getWeekStart(rd));
  });
  return [...set].sort();
}

export function moduleMatchesPeriod(
  releaseIso: string | undefined,
  selected: string[] | null,
  mode: PeriodMode
): boolean {
  if (!releaseIso) return false;
  if (selected === null) return true;
  if (selected.length === 0) return false;
  if (mode === "month") {
    return selected.some((mo) => releaseIso.startsWith(mo));
  }
  const wk = getWeekStart(releaseIso);
  return selected.includes(wk);
}

export function dateMatchesPeriod(
  dateIso: string,
  selected: string[] | null,
  mode: PeriodMode
): boolean {
  if (selected === null) return true;
  if (selected.length === 0) return false;
  if (mode === "month") {
    return selected.some((mo) => dateIso.startsWith(mo));
  }
  return selected.includes(getWeekStart(dateIso));
}
