import { vi } from 'vitest';

/**
 * A minimal stand-in for `@raycast/api` used ONLY as a vitest module alias
 * (see `vitest.config.ts`) — the real package ships no `main`/`exports`
 * field (it's types-only, resolved by Raycast's own bundler at runtime; see
 * `ray build`/`ray develop`), so it cannot be imported in a plain Vite/Node
 * test environment at all. Test files that need specific return values
 * (`getPreferenceValues`, `Clipboard.readText`, `showHUD`, ...) still use
 * `vi.mock('@raycast/api', ...)` per-file for those — this alias only
 * covers the parts every test transitively needs to import successfully
 * (e.g. `Icon`, used by `source-icon.ts` at module scope).
 */
export const Icon = {
  Link: 'link',
  Code: 'code',
  Bird: 'bird',
  Terminal: 'terminal',
  Play: 'play',
  CopyClipboard: 'copy-clipboard',
} as const;

export const Clipboard = { readText: vi.fn() };
export const getPreferenceValues = vi.fn(() => ({ baseUrl: 'http://localhost:8787' }));
export const showHUD = vi.fn();
export const showToast = vi.fn();
export const Toast = { Style: { Success: 'success', Failure: 'failure', Animated: 'animated' } };
