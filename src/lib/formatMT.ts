const MT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/**
 * Formats a date string or ISO timestamp in America/Denver with an " MT" suffix
 * (Mountain Time; observes DST like the rest of the app UI).
 */
export function formatMT(dateStr: string | null | undefined): string {
  if (dateStr == null || String(dateStr).trim() === "") return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const formatted = d.toLocaleString("en-US", MT_OPTIONS);
  return `${formatted} MT`;
}
