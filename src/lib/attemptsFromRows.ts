import type { ProcessedDashboardData, RawCSVRow } from "./types";
import { normalizeSubmissionDate } from "./submissionDate";

/** Parse Attempts column; default 1 when missing or invalid. */
export function parseAttemptsField(row: RawCSVRow): number {
  const raw = (row["Attempts"] ?? "").trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return n;
  return 1;
}

function rowSubmissionIso(row: RawCSVRow): string | null {
  const raw = (
    row["Latest Submission Time"] ||
    row["LATEST_SUBMISSION_TIME"] ||
    ""
  ).trim();
  return normalizeSubmissionDate(raw) ?? (raw.length >= 10 ? raw.slice(0, 10) : null);
}

/**
 * Scan `_all_rows` for rows matching agent, module, and canonical completion date.
 * Returns null if no matching row (caller may fall back to `_raw_attempts`).
 */
export function scanAttemptsFromAllRows(
  rows: RawCSVRow[] | undefined,
  agent: string,
  mod: string,
  completionIso: string
): number | null {
  if (!rows?.length) return null;
  let maxA = 0;
  let found = false;
  for (const row of rows) {
    const name = (row["Full Name"] || row["FULL_NAME"] || "").trim();
    const m = (
      row["Content Week Name"] ||
      row["CONTENT_WEEK_NAME"] ||
      ""
    ).trim();
    if (name !== agent || m !== mod) continue;
    const d = rowSubmissionIso(row);
    if (!d || d !== completionIso) continue;
    found = true;
    const a = parseAttemptsField(row);
    if (a > maxA) maxA = a;
  }
  if (!found) return null;
  return Math.max(1, maxA);
}

/** Prefer live scan of `_all_rows`; fall back to `_raw_attempts`. */
export function getAttemptsFromAllRows(
  data: ProcessedDashboardData,
  agent: string,
  mod: string
): number {
  const completionDate = data.agent_modules[agent]?.[mod];
  if (!completionDate) return 1;
  const scanned = scanAttemptsFromAllRows(
    data._all_rows,
    agent,
    mod,
    completionDate
  );
  if (scanned !== null) return scanned;
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
    for (const [mod, date] of Object.entries(mods)) {
      const n =
        scanAttemptsFromAllRows(allRows, agent, mod, date) ?? 1;
      if (!out[agent]) out[agent] = {};
      out[agent][mod] = n;
    }
  }
  return out;
}
