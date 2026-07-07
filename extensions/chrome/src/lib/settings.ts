/**
 * Extension config, persisted in `chrome.storage.local` — the options page
 * (`options/options.ts`) writes it, everything else (background, popup)
 * reads it. Two independent settings per `extensions/INTERFACES.md`'s
 * capture-contract note: `baseUrl` (which silo this extension talks to) and
 * `token` (optional bearer, sent only once set — the prod seam over
 * `general-auth.ts`).
 */

export const DEFAULT_BASE_URL = 'http://localhost:8787';

export type Settings = {
  baseUrl: string;
  token: string;
};

const STORAGE_KEY = 'silo.settings';

const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  token: '',
};

/** Reads settings from `chrome.storage.local`, falling back to defaults for any unset field. */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return {
    baseUrl: raw?.baseUrl?.trim() || DEFAULT_SETTINGS.baseUrl,
    token: raw?.token ?? DEFAULT_SETTINGS.token,
  };
}

/** Persists settings to `chrome.storage.local`. */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
