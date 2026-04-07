import { getWeekStart } from "@/lib/dashboardHelpers";
import type { ProcessedDashboardData } from "@/lib/types";

/** Latest calendar date found in activity / release fields (YYYY-MM-DD). */
export function latestIsoDateInData(data: ProcessedDashboardData): string {
  let best = "";
  const consider = (s: string | undefined) => {
    if (!s) return;
    const d = s.slice(0, 10);
    if (d.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > best) best = d;
  };
  for (const x of data.all_dates) consider(x);
  for (const rd of Object.values(data.module_dates)) consider(rd);
  for (const am of Object.values(data.agent_modules)) {
    for (const dt of Object.values(am)) consider(dt);
  }
  return best || new Date().toISOString().slice(0, 10);
}

/** e.g. "Week of Mon Mar 24, 2026" from the week containing the latest data date. */
export function snapshotWeekLabel(data: ProcessedDashboardData): string {
  const iso = latestIsoDateInData(data);
  const weekStart = getWeekStart(iso);
  const d = new Date(weekStart + "T12:00:00");
  const wk = d.toLocaleString("default", { weekday: "short" });
  const mon = d.toLocaleString("default", { month: "short" });
  const day = d.getDate();
  const yr = d.getFullYear();
  return `Week of ${wk} ${mon} ${day}, ${yr}`;
}
