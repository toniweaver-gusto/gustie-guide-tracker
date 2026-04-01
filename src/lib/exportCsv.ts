import type { ProcessedDashboardData } from "./types";

export type ExportFilters = {
  agents: string[] | null;
  months: string[] | null;
  modules: string[] | null;
  managers: string[] | null;
  teams: string[] | null;
};

export type ExportType = "daily" | "modules" | "log";

function escapeCSV(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n"))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildCSV(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCSV).join(",")).join("\r\n");
}

function agentsForFilters(
  data: ProcessedDashboardData,
  f: ExportFilters
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

function modulesForFilters(
  data: ProcessedDashboardData,
  f: ExportFilters
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

function datesForFilters(
  data: ProcessedDashboardData,
  f: ExportFilters
): string[] {
  if (f.months === null) return [...data.all_dates];
  if (f.months.length === 0) return [];
  return data.all_dates.filter((d) =>
    f.months!.some((mo) => d.startsWith(mo))
  );
}

export function buildExportCsv(
  data: ProcessedDashboardData,
  f: ExportFilters,
  type: ExportType
): string {
  const agents = agentsForFilters(data, f);
  const modules = modulesForFilters(data, f);

  if (type === "daily") {
    const dates = datesForFilters(data, f);
    const header = ["Agent", ...dates, "Total Modules Completed"];
    const rows: string[][] = [header];
    agents.forEach((a) => {
      const daily = data.agent_daily[a] || {};
      let total = 0;
      const dayCells = dates.map((d) => {
        const n = daily[d] || 0;
        total += n;
        return n > 0 ? String(n) : "";
      });
      rows.push([a, ...dayCells, String(total)]);
    });
    return buildCSV(rows);
  }

  if (type === "modules") {
    const header = ["Module", "Release Date", ...agents, "Completion Rate"];
    const rows: string[][] = [header];
    modules.forEach((mod) => {
      const releaseDate = data.module_dates[mod] || "";
      let completed = 0;
      const agentCells = agents.map((a) => {
        const date = data.agent_modules[a]?.[mod];
        if (date) {
          completed++;
          return date;
        }
        return "";
      });
      const rate =
        agents.length > 0
          ? Math.round((completed / agents.length) * 100) + "%"
          : "0%";
      rows.push([mod, releaseDate, ...agentCells, rate]);
    });
    return buildCSV(rows);
  }

  const header = [
    "Agent",
    "Module",
    "Completion Date",
    "Module Release Date",
    "Days to Complete",
  ];
  const rows: string[][] = [header];
  agents.forEach((a) => {
    const completions = data.agent_modules[a] || {};
    Object.entries(completions).forEach(([mod, completedDate]) => {
      if (!modules.includes(mod)) return;
      if (f.months !== null) {
        if (f.months.length === 0) return;
        if (!f.months.some((mo) => completedDate.startsWith(mo))) return;
      }
      const releaseDate = data.module_dates[mod] || "";
      let daysDiff = "";
      if (releaseDate && completedDate) {
        const ms =
          new Date(completedDate).getTime() -
          new Date(releaseDate).getTime();
        daysDiff = String(Math.max(0, Math.round(ms / 86400000)));
      }
      rows.push([a, mod, completedDate, releaseDate, daysDiff]);
    });
  });
  const body = rows.slice(1).sort(
    (a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2])
  );
  return buildCSV([rows[0], ...body]);
}

export function exportFilename(
  data: ProcessedDashboardData,
  type: ExportType,
  months: string[] | null
): string {
  const prog = data.program_name.toLowerCase().replace(/\s+/g, "-");
  const names: Record<ExportType, string> = {
    daily: prog + "-daily-summary",
    modules: prog + "-module-matrix",
    log: prog + "-completion-log",
  };
  const suffix =
    months && months.length === 1 ? "-" + months[0] : "";
  return names[type] + suffix + ".csv";
}
