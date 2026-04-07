/** Stable URL/workspace key from a display team name. */
export function teamSlug(displayName: string): string {
  const s = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "team";
}
