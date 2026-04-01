import type { ProcessedDashboardData } from "./types";

export type ExportFilters = {
  agent: string;
  month: string;
  search: string;
  pe: string;
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
  if (f.agent) return [f.agent];
  if (f.pe) return data.agents.filter((a) => data.agent_pe[a] === f.pe);
  return data.agents;
}

export function buildExportCsv(
  data: ProcessedDashboardData,
  f: ExportFilters,
  type: ExportType
): string {
  const agents = agentsForFilters(data, f);
  let modules = data.modules;
  if (f.month)
    modules = modules.filter((m) =>
      data.module_dates[m]?.startsWith(f.month)
    );
  if (f.search)
    modules = modules.filter((m) =>
      m.toLowerCase().includes(f.search.toLowerCase())
    );

  if (type === "daily") {
    let dates = data.all_dates;
    if (f.month) dates = dates.filter((d) => d.startsWith(f.month));
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

  // log
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
      if (f.month && !completedDate.startsWith(f.month)) return;
      if (
        f.search &&
        !mod.toLowerCase().includes(f.search.toLowerCase())
      )
        return;
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
  month: string
): string {
  const prog = data.program_name.toLowerCase().replace(/\s+/g, "-");
  const names: Record<ExportType, string> = {
    daily: prog + "-daily-summary",
    modules: prog + "-module-matrix",
    log: prog + "-completion-log",
  };
  const suffix = month ? "-" + month : "";
  return names[type] + suffix + ".csv";
}
