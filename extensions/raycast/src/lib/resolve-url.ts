import { Clipboard } from '@raycast/api';
import { runAppleScript } from '@raycast/utils';

/**
 * Resolves the URL to capture: the frontmost SUPPORTED browser's active tab
 * first, else the clipboard if it looks like a URL, else `undefined` (the
 * caller shows an error — brief: "if no supported browser is frontmost / the
 * env can't read it, fall back to clipboard").
 *
 * Browser support (brief: "explicitly Chrome, Brave, Arc, Dia, Helium —
 * all Chromium-based — plus Safari if trivial"): every Chromium browser
 * responds to the SAME `tell application "<Name>" to get URL of active tab
 * of front window` AppleScript shape as Chrome. Safari uses its own
 * `document 1`/`URL of current tab` dialect. `Dia` is newer and
 * unverified — treated as best-effort, degrading gracefully (a script
 * error there just falls through to the next browser / clipboard, never
 * throws into the caller).
 */

export type ResolvedUrl = {
  url: string;
  title?: string;
  source: 'browser' | 'clipboard';
};

type BrowserScript = { name: string; script: (appName: string) => string };

/** Chromium-family browsers — same AppleScript dialect as Chrome. */
const CHROMIUM_BROWSERS: BrowserScript[] = [
  { name: 'Google Chrome', script: chromiumScript },
  { name: 'Brave Browser', script: chromiumScript },
  { name: 'Arc', script: chromiumScript },
  { name: 'Dia', script: chromiumScript },
  { name: 'Helium', script: chromiumScript },
];

/** `␟` (the "unit separator" control-picture glyph) joins URL/title in the AppleScript result — chosen over a literal `", "` (ce-correctness finding: a URL whose query string itself contains `", "` corrupted the split) because no real page title or URL will ever contain this control-picture character, so the join is unambiguous to reverse in `parseUrlTitleResult`. */
const FIELD_SEPARATOR = '␟';

function chromiumScript(appName: string): string {
  return `tell application "${appName}" to set {theURL, theTitle} to {URL, title} of active tab of front window
return theURL & "${FIELD_SEPARATOR}" & theTitle`;
}

const SAFARI_SCRIPT = `tell application "Safari" to set {theURL, theTitle} to {URL, name} of current tab of front window
return theURL & "${FIELD_SEPARATOR}" & theTitle`;

/** Whether `appName` is currently the frontmost application (per System Events). Guards against querying a browser that isn't running/focused, which would otherwise throw or (worse) silently launch the app. */
async function isFrontmost(appName: string): Promise<boolean> {
  try {
    const frontApp = await runAppleScript(
      'tell application "System Events" to get name of first application process whose frontmost is true',
    );
    return frontApp.trim() === appName;
  } catch {
    return false;
  }
}

/** Parses the AppleScript result — `theURL & "${FIELD_SEPARATOR}" & theTitle`, e.g. `"https://example.com␟Example Site"`. Splits on `FIELD_SEPARATOR` rather than a comma (a URL's query string can itself contain `", "`, which previously corrupted the split — see `FIELD_SEPARATOR`'s doc comment). */
function parseUrlTitleResult(raw: string): { url: string; title?: string } | undefined {
  const trimmed = raw.trim();
  const sepIndex = trimmed.indexOf(FIELD_SEPARATOR);
  if (sepIndex === -1) return trimmed ? { url: trimmed } : undefined;
  const url = trimmed.slice(0, sepIndex).trim();
  const title = trimmed.slice(sepIndex + FIELD_SEPARATOR.length).trim();
  if (!url) return undefined;
  return title ? { url, title } : { url };
}

async function tryBrowser(appName: string, script: string): Promise<ResolvedUrl | undefined> {
  if (!(await isFrontmost(appName))) return undefined;
  try {
    const raw = await runAppleScript(script);
    const parsed = parseUrlTitleResult(raw);
    if (!parsed || !isHttpUrl(parsed.url)) return undefined;
    return parsed.title
      ? { url: parsed.url, title: parsed.title, source: 'browser' }
      : { url: parsed.url, source: 'browser' };
  } catch {
    // Best-effort: an AppleScript dictionary mismatch (e.g. Dia's surface
    // differs) degrades to "no result from this browser", never a throw.
    return undefined;
  }
}

/** Whether a URL string is http(s) — mirrors the API's own scheme guard so this extension never even attempts to capture a `javascript:`/internal URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Tries the frontmost browser (Chromium family, then Safari), falling back to the clipboard. */
export async function resolveUrl(): Promise<ResolvedUrl | undefined> {
  for (const browser of CHROMIUM_BROWSERS) {
    const result = await tryBrowser(browser.name, browser.script(browser.name));
    if (result) return result;
  }

  const safariResult = await tryBrowser('Safari', SAFARI_SCRIPT);
  if (safariResult) return safariResult;

  const clipboardText = await Clipboard.readText();
  if (clipboardText && isHttpUrl(clipboardText.trim())) {
    return { url: clipboardText.trim(), source: 'clipboard' };
  }

  return undefined;
}
