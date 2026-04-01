import type { ProcessedDashboardData } from "./types";

/**
 * Strips null bytes, literal `\\x00`, problematic C0 controls, Unicode noncharacters,
 * and lone UTF-16 surrogates (invalid for JSONB text in Postgres).
 */
export function sanitizePostgresString(s: string): string {
  let out = s
    .replace(/\u0000/g, "")
    .replace(/\\x00/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\uFFFE/g, "")
    .replace(/\uFFFF/g, "");
  try {
    out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
    out = out.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  } catch {
    /* lookbehind unsupported — skip lone-surrogate strip */
  }
  return out;
}

/** @deprecated alias for sanitizePostgresString */
export const stripNullBytes = sanitizePostgresString;

/**
 * Recursively removes null bytes and other invalid Unicode from every string
 * (object keys and values). Use on payloads before Supabase insert/update.
 */
export function sanitizeForPostgres<T>(obj: T): T {
  if (typeof obj === "string") {
    return sanitizePostgresString(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForPostgres(item)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        sanitizePostgresString(k),
        sanitizeForPostgres(v),
      ])
    ) as T;
  }
  return obj;
}

/**
 * Converts legacy `_raw_scores` (flat keys `agent + "\\0" + module`) to
 * nested `Record<agent, Record<module, score>>` before sanitizing keys.
 */
export function normalizeRawScores(
  raw: unknown
): Record<string, Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) return {};
  const firstVal = o[keys[0]!];
  if (typeof firstVal === "number") {
    const out: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "number") continue;
      const i = k.indexOf("\0");
      if (i >= 0) {
        const agent = k.slice(0, i);
        const mod = k.slice(i + 1);
        if (!out[agent]) out[agent] = {};
        out[agent][mod] = v;
      }
    }
    return out;
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [agent, mods] of Object.entries(o)) {
    if (!mods || typeof mods !== "object" || Array.isArray(mods)) continue;
    out[agent] = {};
    for (const [mod, score] of Object.entries(mods as Record<string, unknown>)) {
      if (typeof score === "number") out[agent][mod] = score;
    }
  }
  return out;
}

/** Typed helper: normalize scores then deep-sanitize for Postgres. */
export function sanitizeProcessedDataForPostgres(
  data: ProcessedDashboardData
): ProcessedDashboardData {
  return sanitizeForPostgres({
    ...data,
    _raw_scores: normalizeRawScores(data._raw_scores),
  }) as ProcessedDashboardData;
}
