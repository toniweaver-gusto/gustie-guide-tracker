/** Low score threshold (matches HTML dashboard). */
export const LOW_SCORE_THRESHOLD = 80;

/** Monday of the ISO week containing `dateStr` (YYYY-MM-DD). */
export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export function scorePillClass(
  score: number | null | undefined
): "pass" | "warn" | "fail" | "na" {
  if (score === null || score === undefined) return "na";
  if (score >= LOW_SCORE_THRESHOLD) return "pass";
  if (score >= 60) return "warn";
  return "fail";
}

export function progFillClass(pct: number): "full" | "high" | "mid" | "low" {
  if (pct >= 90) return "full";
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
}

export function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms =
    new Date().getTime() - new Date(dateStr + "T12:00:00").getTime();
  return Math.floor(ms / 86400000);
}
