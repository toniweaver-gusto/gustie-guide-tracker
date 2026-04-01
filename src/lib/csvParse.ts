import type { ProcessedDashboardData } from "./types";
import { normalizeRawScores } from "./sanitizeProcessedData";

export type RawCSVRow = Record<string, string>;

export function stripBom(text: string): string {
  if (!text.length) return text;
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/**
 * Normalizes CSV header labels: trim, strip quotes, lowercase, underscores → spaces.
 * Collapses whitespace so multi-space headers still resolve (e.g. "Full  Name").
 */
export function normalizeHeader(h: string): string {
  return stripBom(h)
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

/** RFC4180-style: commas split fields; quotes wrap fields; "" is an escaped quote. */
export function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      result.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  result.push(cur.trim());
  return result;
}

/**
 * Split a CSV file into row strings without splitting on newlines inside quoted fields.
 */
export function splitCsvFileIntoLineStrings(text: string): string[] {
  const s = stripBom(text);
  const lines: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      if (inQuotes && s[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      cur += c;
      i += 1;
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && s[i + 1] === "\n") i += 1;
      const tline = cur.trimEnd();
      if (tline.length > 0) lines.push(tline);
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  const end = cur.trimEnd();
  if (end.length > 0) lines.push(end);
  return lines.filter((l) => l.trim().length > 0);
}

type ColumnIndices = {
  fullName: number;
  contentWeek: number;
  latestSub: number;
  peName: number;
  totalPoints: number;
  groupName: number;
};

function resolveColumnIndices(headers: string[]): ColumnIndices | null {
  const norm = headers.map((h) => normalizeHeader(h));
  const want = (label: string) => norm.indexOf(label);
  const fullName = want("full name");
  const contentWeek = want("content week name");
  const latestSub = want("latest submission time");
  if (fullName < 0 || contentWeek < 0 || latestSub < 0) return null;
  const peName = want("pe name");
  const totalPoints = want("total points");
  const groupName = want("group name");
  return { fullName, contentWeek, latestSub, peName, totalPoints, groupName };
}

/**
 * Normalize Latest Submission Time to YYYY-MM-DD for sorting and grouping.
 */
export function normalizeSubmissionDate(raw: string): string | null {
  const ts = raw.trim();
  if (!ts) return null;
  const iso = ts.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(ts);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const mdy = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const mm = mdy[1].padStart(2, "0");
    const dd = mdy[2].padStart(2, "0");
    return `${mdy[3]}-${mm}-${dd}`;
  }
  return null;
}

export function parseCSVRows(text: string): RawCSVRow[] {
  const lines = splitCsvFileIntoLineStrings(text);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]).map((h) => stripBom(h).trim());
  const colIx = resolveColumnIndices(headers);
  if (!colIx) return [];

  const rows: RawCSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]);
    const row: RawCSVRow = {};
    headers.forEach((h, j) => {
      row[h] = (vals[j] ?? "").trim().replace(/^"|"$/g, "");
    });
    // Canonical keys (matches HTML `row['Full Name']` etc.); supports FULL_NAME / Full Name via indices
    row["Full Name"] = (vals[colIx.fullName] ?? "")
      .trim()
      .replace(/^"|"$/g, "");
    row["Content Week Name"] = (vals[colIx.contentWeek] ?? "")
      .trim()
      .replace(/^"|"$/g, "");
    row["Latest Submission Time"] = (vals[colIx.latestSub] ?? "")
      .trim()
      .replace(/^"|"$/g, "");
    row["PE Name"] =
      colIx.peName >= 0
        ? (vals[colIx.peName] ?? "").trim().replace(/^"|"$/g, "")
        : "";
    row["Total Points"] =
      colIx.totalPoints >= 0
        ? (vals[colIx.totalPoints] ?? "").trim().replace(/^"|"$/g, "")
        : "";
    row["Group Name"] =
      colIx.groupName >= 0
        ? (vals[colIx.groupName] ?? "").trim().replace(/^"|"$/g, "")
        : "";
    // Aliases for underscore-heavy exports (same values as canonical keys above)
    row["FULL_NAME"] = row["Full Name"];
    row["CONTENT_WEEK_NAME"] = row["Content Week Name"];
    row["LATEST_SUBMISSION_TIME"] = row["Latest Submission Time"];
    row["TOTAL_POINTS"] = row["Total Points"];
    row["PE_NAME"] = row["PE Name"];
    row["GROUP_NAME"] = row["Group Name"];
    rows.push(row);
  }
  return rows;
}

/**
 * Deduplicate by Full Name + Content Week Name; keep earliest Latest Submission Time.
 */
export function processCSVTexts(
  texts: string[],
  programName: string
): ProcessedDashboardData | null {
  const allRows = texts.flatMap((t) => parseCSVRows(t));
  if (!allRows.length) return null;

  const peMap: Record<string, string> = {};
  const groupSets: Record<string, Set<string>> = {};
  allRows.forEach((row) => {
    const name = row["Full Name"];
    const pe = row["PE Name"];
    if (name && pe) peMap[name] = pe;
    const g = row["Group Name"]?.trim();
    if (name && g) {
      if (!groupSets[name]) groupSets[name] = new Set();
      groupSets[name].add(g);
    }
  });

  // Deduplicate by Full Name + Content Week Name — keep earliest submission date (HTML: ts.slice(0,10))
  const compMap: Record<string, Record<string, string>> = {};
  allRows.forEach((row) => {
    const name = row["Full Name"];
    const mod = row["Content Week Name"];
    const ts = row["Latest Submission Time"];
    if (!name || !mod || !ts) return;
    const date = ts.trim().slice(0, 10);
    if (!date) return;
    if (!compMap[name]) compMap[name] = {};
    if (!compMap[name][mod] || date < compMap[name][mod]) {
      compMap[name][mod] = date;
    }
  });

  const agents = Object.keys(compMap).sort();
  if (!agents.length) return null;

  const modDateMap: Record<string, string> = {};
  Object.values(compMap).forEach((mods) => {
    Object.entries(mods).forEach(([m, d]) => {
      if (!modDateMap[m] || d < modDateMap[m]) modDateMap[m] = d;
    });
  });
  const modules = Object.keys(modDateMap).sort((a, b) =>
    modDateMap[a].localeCompare(modDateMap[b])
  );

  const agentDaily: Record<string, Record<string, number>> = {};
  agents.forEach((a) => {
    agentDaily[a] = {};
    Object.values(compMap[a]).forEach((d) => {
      agentDaily[a][d] = (agentDaily[a][d] || 0) + 1;
    });
  });

  const allDates = [
    ...new Set(Object.values(agentDaily).flatMap((o) => Object.keys(o))),
  ].sort();

  const peNames = [...new Set(Object.values(peMap))].filter(Boolean).sort();

  const groupNameSet = new Set<string>();
  Object.values(groupSets).forEach((s) => {
    s.forEach((g) => groupNameSet.add(g));
  });
  const group_names = [...groupNameSet].sort();

  const agent_groups: Record<string, string[]> = {};
  agents.forEach((a) => {
    agent_groups[a] = groupSets[a] ? [...groupSets[a]].sort() : [];
  });

  // Score map: agent+module → best score (0–100), same keys as HTML (`name + '\0' + mod`)
  const rawScoresFlat: Record<string, number> = {};
  allRows.forEach((row) => {
    const name = row["Full Name"];
    const mod = row["Content Week Name"];
    const score = parseFloat(row["Total Points"] || "0");
    if (!name || !mod || Number.isNaN(score)) return;
    const key = name + "\0" + mod;
    if (rawScoresFlat[key] === undefined || score > rawScoresFlat[key]) {
      rawScoresFlat[key] = score;
    }
  });

  return {
    agents,
    modules,
    module_dates: modDateMap,
    agent_modules: compMap,
    agent_daily: agentDaily,
    all_dates: allDates,
    pe_names: peNames,
    agent_pe: peMap,
    group_names,
    agent_groups,
    program_name: programName || "Training Dashboard",
    _raw_scores: normalizeRawScores(rawScoresFlat),
  };
}

export function parseRosterFromText(text: string): string {
  const raw = stripBom(text);
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 1) {
    const header = lines[0].toLowerCase();
    const nameIdx = header.split(",").findIndex((h) =>
      /name|agent|employee|user/i.test(h.trim().replace(/"/g, ""))
    );
    if (nameIdx >= 0) {
      return lines
        .slice(1)
        .map((l) => {
          const vals = splitCSVLine(l);
          return (vals[nameIdx] ?? "").trim();
        })
        .filter(Boolean)
        .join("\n");
    }
  }
  return lines
    .map((l) => l.split(",")[0].trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .join("\n");
}
