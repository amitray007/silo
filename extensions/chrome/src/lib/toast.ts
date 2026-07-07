/**
 * The toast — silo's primary capture-feedback surface (brief: "design it
 * properly, not a default browser notification"). Injected on-demand via
 * `chrome.scripting.executeScript` (not a persistent `content_scripts`
 * entry — the toast only needs to exist for ~2s after a capture, so there's
 * no reason to run injection machinery on every page load for every tab).
 *
 * The injected function/args below run in the PAGE's isolated world, so they
 * cannot reference anything from this module's closure — every value the
 * toast needs (kind/title/theme) is passed through `args`, and the function
 * body is entirely self-contained (Oat tokens inlined, see `docs/design/
 * tokens.md`).
 */

export type ToastKind = 'saved' | 'deduped' | 'error';

export type ToastPayload = {
  kind: ToastKind;
  title: string;
};

/** Injects the toast into `tabId`. Failures (e.g. a tab that navigated away, a page chrome.scripting can't inject into) are swallowed — the toast is a nice-to-have confirmation, never allowed to throw into the capture flow itself. */
export async function showToast(tabId: number, payload: ToastPayload): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: renderToast,
      args: [payload],
    });
  } catch {
    // Can't inject (e.g. chrome://, a page that blocks scripting) — the
    // capture itself already succeeded; a missed toast is not an error.
  }
}

/**
 * Runs IN THE PAGE. Builds and animates the toast entirely with inline
 * styles (no external stylesheet/CDN — the artifact/extension CSP + "no
 * third-party calls" discipline). Light/dark follows the page's
 * `prefers-color-scheme`, matching the "Oat" system's own light+dark
 * tokens (`docs/design/tokens.md`).
 */
function renderToast(payload: ToastPayload): void {
  const HOST_ID = 'silo-capture-toast-host';
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.top = '16px';
  host.style.right = '16px';
  host.style.zIndex = '2147483647';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const tokens = dark
    ? { bg: '#201A15', line: '#2C251D', ink: '#EDE5D8', muted: '#A89A87', mark: '#D9A441' }
    : { bg: '#FBF7EF', line: '#EBE2D2', ink: '#211B11', muted: '#6E6350', mark: '#C98F2D' };

  const messages: Record<ToastPayload['kind'], string> = {
    saved: 'Link saved in silo',
    deduped: 'Already in silo (updated)',
    error: 'Could not save to silo',
  };

  // "Motion" (docs/design/tokens.md): `prefers-reduced-motion` removes
  // movement while keeping gentle opacity fades — the slide-in transform is
  // skipped entirely for a reduced-motion user, opacity still fades.
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const restingTransform = reducedMotion ? 'translateX(0)' : 'translateX(12px)';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    font-family: "Geist Sans", -apple-system, BlinkMacSystemFont, sans-serif;
    background: ${tokens.bg};
    border: 1px solid ${tokens.line};
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,${dark ? '0.4' : '0.12'});
    padding: 12px 16px;
    min-width: 220px;
    max-width: 320px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    opacity: 0;
    transform: ${restingTransform};
    transition: opacity 200ms ease-out, transform 200ms ease-out;
  `;

  const dot = document.createElement('div');
  const dotColor = payload.kind === 'error' ? tokens.muted : tokens.mark;
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, ${dotColor}, ${dotColor});
    margin-top: 5px;
    flex-shrink: 0;
  `;

  const textCol = document.createElement('div');
  textCol.style.cssText = 'display: flex; flex-direction: column; gap: 2px; min-width: 0;';

  const heading = document.createElement('div');
  heading.textContent = messages[payload.kind];
  heading.style.cssText = `font-size: 13px; font-weight: 500; color: ${tokens.ink}; letter-spacing: -0.01em;`;

  const subtitle = document.createElement('div');
  subtitle.textContent = payload.title;
  subtitle.style.cssText = `
    font-size: 12px;
    color: ${tokens.muted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  textCol.append(heading, subtitle);
  wrapper.append(dot, textCol);
  shadow.appendChild(wrapper);

  requestAnimationFrame(() => {
    wrapper.style.opacity = '1';
    wrapper.style.transform = 'translateX(0)';
  });

  const dismiss = (): void => {
    wrapper.style.opacity = '0';
    wrapper.style.transform = restingTransform;
    setTimeout(() => host.remove(), 220);
  };

  setTimeout(dismiss, 2000);
}
