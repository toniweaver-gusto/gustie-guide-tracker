const MONTHS_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDate(d: string | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const mi = Number(m);
  const di = Number(day);
  if (!y || !Number.isFinite(mi) || !Number.isFinite(di)) return "—";
  return `${MONTHS_ABBR[mi - 1]} ${di}, ${y}`;
}

/** Short label for a Monday week-start date, e.g. "Mar 9" (for tooltips: "Week of Mar 9: …"). */
export function formatWeekOfLabel(iso: string | undefined): string {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-");
  const mi = Number(m);
  const di = Number(day);
  if (!y || !Number.isFinite(mi) || !Number.isFinite(di)) return "—";
  return `${MONTHS_ABBR[mi - 1]} ${di}`;
}
