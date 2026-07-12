import { checkHealth } from '../lib/capture-client.js';
import { DEFAULT_BASE_URL, getSettings, saveSettings } from '../lib/settings.js';

/**
 * The options page: base URL + optional API token (the extension-side half
 * of the CORS/token seam — see `extensions/INTERFACES.md`). Requests the
 * matching `host_permissions` for a custom base URL via
 * `chrome.permissions.request` (MV3 lets an already-installed extension add
 * optional host permissions at runtime, no re-publish needed) — without this,
 * `fetch` to a non-`localhost:8787` origin would be silently blocked by
 * Chrome's own extension host-permission model, independent of the API's own
 * CORS allowlist.
 */

const rootMaybe = document.getElementById('root');
if (!rootMaybe) throw new Error('options: #root missing');
// Narrowed to a non-null local so the `init()` closure below doesn't re-widen
// it back to `HTMLElement | null` (which forced a `root!` non-null assertion —
// biome's noNonNullAssertion). `const` guarantees this stays the guarded value.
const root: HTMLElement = rootMaybe;

async function init(): Promise<void> {
  const settings = await getSettings();

  // Static shell only — NO stored value is interpolated into this template
  // (`settings.baseUrl`/`settings.token` are set via the `.value` DOM
  // property below, never via `innerHTML`). `innerHTML`-interpolating a
  // stored string here would be a stored-XSS gap: `chrome.storage.local` is
  // writable by any code holding this extension's storage permission, so a
  // value written by something other than this page (or containing `">`
  // to escape the `value="..."` attribute) would execute in the options
  // page's chrome-extension:// origin on next open.
  root.innerHTML = `
    <div class="header">
      <div class="dot"></div>
      <div class="wordmark">silo — options</div>
    </div>
    <div class="section">
      <div class="row">
        <label for="base-url">Base URL</label>
        <input id="base-url" placeholder="${DEFAULT_BASE_URL}" />
        <div class="hint">The silo API this extension captures to. For a non-localhost silo,
          add its origin to <code>SILO_ALLOWED_ORIGINS</code> on the server (see the README).</div>
      </div>
      <div class="row">
        <label for="token">API token (optional)</label>
        <input id="token" type="password" placeholder="Only needed if the server sets SILO_API_TOKEN" />
      </div>
      <button class="save" id="save-btn">Save</button>
      <div class="status" id="status"></div>
    </div>
  `;

  const baseUrlInput = document.getElementById('base-url') as HTMLInputElement;
  const tokenInput = document.getElementById('token') as HTMLInputElement;
  baseUrlInput.value = settings.baseUrl;
  tokenInput.value = settings.token;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  saveBtn.addEventListener('click', () => {
    void (async () => {
      const baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL;
      statusEl.textContent = 'Requesting permission…';
      statusEl.className = 'status';

      const origin = `${new URL(baseUrl).origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        statusEl.textContent = 'Permission denied — capture will not work for this URL.';
        statusEl.className = 'status error';
        return;
      }

      await saveSettings({ baseUrl, token: tokenInput.value });

      statusEl.textContent = 'Checking connection…';
      const reachable = await checkHealth(baseUrl);
      statusEl.textContent = reachable
        ? 'Saved — connected to silo.'
        : 'Saved, but silo is not reachable at this URL.';
      statusEl.className = reachable ? 'status' : 'status error';
    })();
  });
}

void init();
