/** Origin + base path without trailing slash (for share links). */
export function appOriginWithBase(): string {
  const base = import.meta.env.BASE_URL;
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${window.location.origin}${trimmed}`;
}

export function shareUrlForToken(token: string): string {
  return `${appOriginWithBase()}/d/${token}`;
}
