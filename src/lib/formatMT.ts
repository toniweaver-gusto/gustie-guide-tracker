const DENVER_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
};

/**
 * Formats a date string or ISO timestamp in America/Denver.
 * Appends the correct abbreviation (MDT or MST) from Intl for that instant.
 */
export function formatMT(dateStr: string | null | undefined): string {
  if (dateStr == null || String(dateStr).trim() === "") return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);

  const formatter = new Intl.DateTimeFormat("en-US", DENVER_OPTIONS);
  const parts = formatter.formatToParts(d);
  const tzAbbrev =
    parts.find((p) => p.type === "timeZoneName")?.value?.trim() || "MT";
  const dateTime = parts
    .filter((p) => p.type !== "timeZoneName")
    .map((p) => p.value)
    .join("")
    .replace(/\s+$/, "");

  return `${dateTime} ${tzAbbrev}`;
}
