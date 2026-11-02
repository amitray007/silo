const RELOAD_KEY = 'silo:chunk-reload';

/** Persist across reloads; a second failure must leave the reload prompt visible. */
export function handlePreloadError(event: Event) {
  // Offline, a reload cannot fetch the new build; let the surface's fallback handle it.
  if (!navigator.onLine) return;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {
    // Without storage, the one-reload limit cannot be enforced.
    return;
  }
  event.preventDefault();
  window.location.reload();
}
