/**
 * The hover-preview footer's `pvMeta` (plan 011, V3-8) — a short relative-time
 * string derived from `LinkJson.createdAt`. Mirrors v3's own phrasing exactly
 * (`Silo-v3.html:1002`: `pvLink.time === 'now' ? 'just now' : pvLink.time +
 * ' ago'`), but computed from the REAL ISO timestamp `@silo/web` actually has
 * — v3's mock data pre-baked a `time` string (`'2h'`, `'3d'`, …) per link;
 * there is no such field on `LinkJson`, so this derives the same shape from
 * `createdAt` instead of faking plugin/mock data.
 *
 * Granularity matches the mock's own vocabulary (minutes under an hour, hours
 * under a day, days under a month, otherwise months) — coarse on purpose,
 * this is a glance-metric in a 288px popover, not a precise timestamp.
 */
export function relativeTimeFromNow(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const deltaMs = now.getTime() - then;
  const minutes = Math.floor(deltaMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
