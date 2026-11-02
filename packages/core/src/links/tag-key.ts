/** Shared tag key: trim and lowercase, matching the migration for ASCII names. */
export function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase();
}
