import type { ProcessedDashboardData, RawCSVRow } from "./types";

/**
 * Scan `_all_rows`: match agent + module, pick row with highest Total Points,
 * then read Total Attempts (defaults to 1).
 */
export function getCellAttemptsFromAllRows(
  rows: RawCSVRow[] | undefined,
  agentName: string,
  moduleName: string
): number {
  if (!rows?.length) return 1;
  let best: RawCSVRow | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const n =
      (r["full name"] as string | undefined) ||
      (r["FULL_NAME"] as string | undefined) ||
      (r["Full Name"] as string | undefined) ||
      "";
    const m =
      (r["content week name"] as string | undefined) ||
      (r["CONTENT_WEEK_NAME"] as string | undefined) ||
      (r["Content Week Name"] as string | undefined) ||
      "";
    if (n !== agentName || m !== moduleName) continue;
    const s = parseFloat(
      (r["total points"] as string | undefined) ||
        (r["TOTAL_POINTS"] as string | undefined) ||
        (r["Total Points"] as string | undefined) ||
        "0"
    );
    if (s >= bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (!best) return 1;
  const att = parseFloat(
    (best["total attempts"] as string | undefined) ||
      (best["TOTAL_ATTEMPTS"] as string | undefined) ||
      (best["Total Attempts"] as string | undefined) ||
      "1"
  );
  return Number.isNaN(att) || att < 1 ? 1 : att;
}

/** Prefer live scan of `_all_rows`; fall back to `_raw_attempts`. */
export function getAttemptsFromAllRows(
  data: ProcessedDashboardData,
  agent: string,
  mod: string
): number {
  if (!data.agent_modules[agent]?.[mod]) return 1;
  if (data._all_rows?.length) {
    return getCellAttemptsFromAllRows(data._all_rows, agent, mod);
  }
  const c = data._raw_attempts?.[agent]?.[mod];
  if (typeof c === "number" && c >= 1) return c;
  return 1;
}

/** Average attempts among agents in `agents` who completed `mod`. */
export function getAvgAttemptsForModule(
  data: ProcessedDashboardData,
  mod: string,
  agents: string[]
): number {
  let sum = 0;
  let n = 0;
  for (const a of agents) {
    if (!data.agent_modules[a]?.[mod]) continue;
    sum += getAttemptsFromAllRows(data, a, mod);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Average attempts for `agentName` across completed modules in `mods`. */
export function getAvgAttemptsForAgent(
  data: ProcessedDashboardData,
  agentName: string,
  mods: string[]
): number {
  let sum = 0;
  let n = 0;
  for (const m of mods) {
    if (!data.agent_modules[agentName]?.[m]) continue;
    sum += getAttemptsFromAllRows(data, agentName, m);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export function buildRawAttemptsMap(
  allRows: RawCSVRow[],
  compMap: Record<string, Record<string, string>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [agent, mods] of Object.entries(compMap)) {
    for (const mod of Object.keys(mods)) {
      const n = getCellAttemptsFromAllRows(allRows, agent, mod);
      if (!out[agent]) out[agent] = {};
      out[agent][mod] = n;
    }
  }
  return out;
}
