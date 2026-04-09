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
