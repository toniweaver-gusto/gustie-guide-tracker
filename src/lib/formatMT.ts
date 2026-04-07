export function formatMT(dateInput: string | Date): string {
  const date =
    typeof dateInput === "string" ? new Date(dateInput) : dateInput;

  const formatted = date.toLocaleString("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });

  // formatted looks like "Apr 7, 2026, 3:57 PM MDT"
  // timeZoneName: 'short' already appends MDT/MST
  return formatted;
}
