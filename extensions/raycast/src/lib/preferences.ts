import { getPreferenceValues } from '@raycast/api';

/** Raycast's typed preferences, per `package.json`'s `preferences` array. Not exported — only read within this module. */
type Preferences = {
  baseUrl: string;
  token?: string;
};

export const DEFAULT_BASE_URL = 'http://localhost:8787';

/** Reads the extension's configured base URL, falling back to the default when unset/blank. */
export function getBaseUrl(): string {
  const prefs = getPreferenceValues<Preferences>();
  return prefs.baseUrl?.trim() || DEFAULT_BASE_URL;
}

/** Reads the extension's configured API token, if any. */
export function getToken(): string | undefined {
  const prefs = getPreferenceValues<Preferences>();
  return prefs.token?.trim() || undefined;
}
