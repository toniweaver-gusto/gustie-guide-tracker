import type { ProcessedDashboardData, RawCSVRow } from "./types";

/**
 * By Module matrix: pick the row with highest Total Points for this agent+module,
 * then read Total Attempts (matches legacy HTML dashboard logic).
 */
export function getModuleMatrixCellAttempts(
  rows: RawCSVRow[] | undefined | null,
  agentName: string,
  moduleName: string
): number {
  if (!rows?.length) return 1;
  let best: RawCSVRow | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const n =
      r["full name"] ||
      r["FULL_NAME"] ||
      r["Full Name"] ||
      "";
    const m =
      r["content week name"] ||
      r["CONTENT_WEEK_NAME"] ||
      r["Content Week Name"] ||
      "";
    if (n !== agentName || m !== moduleName) continue;
    const s = parseFloat(
      r["total points"] ||
        r["TOTAL_POINTS"] ||
        r["Total Points"] ||
        "0"
    );
    const score = Number.isNaN(s) ? -1 : s;
    if (score >= bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return 1;
  const att = parseFloat(
    best["total attempts"] ||
      best["TOTAL_ATTEMPTS"] ||
      best["Total Attempts"] ||
      "1"
  );
  if (Number.isNaN(att) || att < 1) return 1;
  return att;
}

export function moduleMatrixAttemptClass(
  attempts: number
): "done-1" | "done-2" | "done-3" {
  return attempts >= 3 ? "done-3" : attempts >= 2 ? "done-2" : "done-1";
}

/** Prefer `_all_rows` matrix scan; fall back to `_raw_attempts` when no rows. */
export function getAttemptsFromAllRows(
  data: ProcessedDashboardData,
  agent: string,
  mod: string
): number {
  if (!data.agent_modules[agent]?.[mod]) return 1;
  if (data._all_rows?.length) {
    return getModuleMatrixCellAttempts(data._all_rows, agent, mod);
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
      const n = getModuleMatrixCellAttempts(allRows, agent, mod);
      if (!out[agent]) out[agent] = {};
      out[agent][mod] = n;
    }
  }
  return out;
}
