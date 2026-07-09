/**
 * The toast — silo's primary capture-feedback surface (brief: "design it
 * properly, not a default browser notification"). Injected on-demand via
 * `chrome.scripting.executeScript` (not a persistent `content_scripts`
 * entry — the toast only needs to exist for a few seconds after a capture,
 * so there's no reason to run injection machinery on every page load for
 * every tab).
 *
 * The injected function/args below run in the PAGE's isolated world, so they
 * cannot reference anything from this module's closure — every value the
 * toast needs (kind/title/url/linkId/tags/theme) is passed through `args`,
 * and the function body is entirely self-contained (Oat tokens inlined, see
 * `docs/design/tokens.md`). Clicking the toast morphs the SAME shadow host,
 * in place, into an edit card (note + tag dropdown); saving posts the diff
 * back to the service worker via `chrome.runtime.sendMessage` (the injected
 * world can't call the API client directly — it doesn't hold the token).
 */

export type ToastKind = 'saved' | 'deduped' | 'error';

export type ToastTag = { name: string; count: number };

export type ToastPayload = {
  kind: ToastKind;
  title: string;
  url: string;
  linkId: string;
  tags: ToastTag[];
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
 * `prefers-color-scheme`, matching the "Oat" system's own light+dark tokens
 * (`docs/design/tokens.md`). Self-contained: no reference to any
 * module-closure value — everything needed crosses through `payload`.
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
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // "Oat" tokens (docs/design/tokens.md) — inlined since the injected world
  // has no access to tokens.css or any module import.
  const tokens = dark
    ? {
        bg: '#201A15',
        bg2: '#171310',
        line: '#2C251D',
        ink: '#EDE5D8',
        muted: '#A89A87',
        faint: '#8C7F6C',
        mark: '#D9A441',
        markMuted: '#6E6353',
      }
    : {
        bg: '#FBF7EF',
        bg2: '#F4EDE1',
        line: '#EBE2D2',
        ink: '#211B11',
        muted: '#6E6350',
        faint: '#8C8170',
        mark: '#C98F2D',
        markMuted: '#B3A78F',
      };

  const FONT = '"Geist Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  const AUTO_DISMISS_MS = 3000;

  // ---- the silo stack mark (three rounded bars; top bar the amber grain) ----
  function markSvg(muted: boolean): string {
    const topFill = muted ? tokens.markMuted : 'url(#silo-mark-grain)';
    return `
      <svg width="16" height="16" viewBox="0 0 32 32" role="img" aria-label="silo">
        <defs>
          <linearGradient id="silo-mark-grain" x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0%" stop-color="#E8B054" />
            <stop offset="100%" stop-color="#C98F2D" />
          </linearGradient>
        </defs>
        <rect x="7" y="19.5" width="18" height="5" rx="2.5" fill="${tokens.ink}" opacity="0.34" />
        <rect x="7" y="12.5" width="18" height="5" rx="2.5" fill="${tokens.ink}" opacity="0.62" />
        <rect x="7" y="5.5" width="18" height="5" rx="2.5" fill="${topFill}" />
      </svg>
    `;
  }

  function escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  // ---- shared card chrome ----
  const card = document.createElement('div');
  card.style.cssText = `
    font-family: ${FONT};
    background: ${tokens.bg};
    border: 1px solid ${tokens.line};
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,${dark ? '0.4' : '0.12'});
    min-width: 240px;
    max-width: 340px;
    opacity: 0;
    transform: ${reducedMotion ? 'translateX(0)' : 'translateX(12px)'};
    transition: opacity 200ms ease-out, transform 200ms ease-out;
    overflow: hidden;
  `;
  shadow.appendChild(card);

  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateX(0)';
  });

  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownStart = 0;
  let countdownRemaining = AUTO_DISMISS_MS;
  let editing = false;

  function removeHost(): void {
    if (dismissTimer) clearTimeout(dismissTimer);
    card.style.opacity = '0';
    card.style.transform = reducedMotion ? 'translateX(0)' : 'translateX(12px)';
    setTimeout(() => host.remove(), 200);
  }

  function armDismiss(ms: number): void {
    countdownStart = Date.now();
    countdownRemaining = ms;
    dismissTimer = setTimeout(removeHost, ms);
  }

  function pauseDismiss(bar: HTMLElement): void {
    if (editing) return;
    // Idempotent: a second pointerenter without an intervening pointerleave
    // (the browser can drop a pointerleave when the pointer exits into browser
    // chrome or a cross-origin overlay) must NOT re-subtract elapsed time
    // against a stale countdownStart — that double-counts and can collapse the
    // timer to 0, snapping the toast away early. If already paused (timer
    // cleared), do nothing.
    if (!dismissTimer) return;
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    const elapsed = Date.now() - countdownStart;
    countdownRemaining = Math.max(0, countdownRemaining - elapsed);
    bar.style.animationPlayState = 'paused';
  }

  function resumeDismiss(bar: HTMLElement): void {
    if (editing) return;
    bar.style.animationPlayState = 'running';
    armDismiss(countdownRemaining);
  }

  // ---- toast render ----
  function renderToastBody(): void {
    editing = false;
    card.innerHTML = '';

    const messages: Record<ToastKind, string> = {
      saved: 'Saved to silo',
      deduped: 'Already in silo (updated)',
      error: 'Could not save to silo',
    };

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-direction: column; cursor: pointer;';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;';

    const markWrap = document.createElement('div');
    markWrap.style.cssText = 'flex-shrink: 0; margin-top: 1px;';
    markWrap.innerHTML = markSvg(payload.kind === 'error');
    if (payload.kind === 'error') markWrap.querySelector('svg')?.setAttribute('opacity', '0.7');

    const textCol = document.createElement('div');
    textCol.style.cssText =
      'display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;';

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

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

    function iconButton(label: string, glyph: string): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.textContent = glyph;
      btn.style.cssText = `
        appearance: none;
        border: none;
        background: transparent;
        color: ${tokens.faint};
        font-size: 13px;
        line-height: 1;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        cursor: pointer;
        font-family: ${FONT};
      `;
      btn.addEventListener('pointerenter', () => {
        btn.style.background = tokens.bg2;
        btn.style.color = tokens.ink;
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = tokens.faint;
      });
      return btn;
    }

    // Editing is only meaningful once a link exists. An error toast carries no
    // saved link (linkId === ''), so opening an edit card on it is a guaranteed
    // dead-end (applyEdit('') can never resolve). Suppress the edit affordance
    // entirely in that case — only Dismiss is offered.
    const editable = payload.kind !== 'error' && payload.linkId !== '';
    const editBtn = iconButton('Edit details', '✎');
    const closeBtn = iconButton('Dismiss', '✕');
    if (editable) actions.append(editBtn, closeBtn);
    else actions.append(closeBtn);

    row.append(markWrap, textCol, actions);
    wrapper.appendChild(row);

    // Countdown bar — amber (a status indicator, which the tokens permit).
    const track = document.createElement('div');
    track.style.cssText = `height: 2px; background: ${tokens.line};`;
    const bar = document.createElement('div');
    bar.style.cssText = `
      height: 100%;
      width: 100%;
      background: ${payload.kind === 'error' ? tokens.markMuted : tokens.mark};
      transform-origin: left;
      animation: silo-countdown ${AUTO_DISMISS_MS}ms linear forwards;
    `;
    const styleTag = document.createElement('style');
    styleTag.textContent = `@keyframes silo-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }`;
    track.appendChild(bar);
    wrapper.appendChild(track);
    shadow.appendChild(styleTag);

    if (reducedMotion) {
      // Reduced motion: skip the animated shrink, keep the bar static — no
      // transform-based movement, matching the toast's own opacity-only rule.
      bar.style.animation = 'none';
    }

    card.appendChild(wrapper);

    const openEdit = (): void => renderEditCard();
    if (editable) {
      wrapper.style.cursor = 'pointer';
      wrapper.addEventListener('click', (event) => {
        if (event.target === closeBtn) return;
        openEdit();
      });
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openEdit();
      });
    } else {
      // No edit path on an error toast — it's not clickable, so drop the
      // pointer affordance the shared wrapper style applies.
      wrapper.style.cursor = 'default';
    }
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeHost();
    });

    card.addEventListener('pointerenter', () => pauseDismiss(bar));
    card.addEventListener('pointerleave', () => resumeDismiss(bar));

    armDismiss(AUTO_DISMISS_MS);
  }

  // ---- edit card render ----
  function renderEditCard(): void {
    editing = true;
    if (dismissTimer) clearTimeout(dismissTimer);
    card.innerHTML = '';

    // Fresh capture: the saved-state originals are empty note / no tags —
    // the in-page diff below mirrors edit-diff.ts's contract for THIS case
    // only (can't import edit-diff.ts into the page world). A future
    // non-empty-original edit path is governed by edit-diff.ts server-side.
    const selectedTags = new Set<string>();
    let query = '';
    let statusMessage = '';
    let saving = false;

    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'display: flex; flex-direction: column; padding: 14px; gap: 10px; width: 280px;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    const markWrap = document.createElement('div');
    markWrap.innerHTML = markSvg(false);
    const flag = document.createElement('div');
    flag.textContent = 'Saved · editing details';
    flag.style.cssText = `font-size: 12px; font-weight: 500; color: ${tokens.muted}; letter-spacing: -0.01em;`;
    header.append(markWrap, flag);

    const titleEl = document.createElement('div');
    titleEl.textContent = payload.title;
    titleEl.style.cssText = `font-size: 13px; font-weight: 500; color: ${tokens.ink}; letter-spacing: -0.01em;`;

    const urlEl = document.createElement('div');
    urlEl.textContent = payload.url;
    urlEl.style.cssText = `
      font-size: 11px;
      color: ${tokens.faint};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;

    const noteEl = document.createElement('textarea');
    noteEl.placeholder = 'Add a note (optional)';
    noteEl.rows = 2;
    noteEl.style.cssText = `
      font-family: ${FONT};
      font-size: 12px;
      color: ${tokens.ink};
      background: ${tokens.bg2};
      border: 1px solid ${tokens.line};
      border-radius: 8px;
      padding: 8px 10px;
      resize: none;
      outline: none;
    `;

    // ---- tag dropdown (Flow 3) ----
    const tagSection = document.createElement('div');
    tagSection.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    const tagInput = document.createElement('input');
    tagInput.placeholder = 'Filter or add a tag';
    tagInput.style.cssText = `
      font-family: ${FONT};
      font-size: 12px;
      color: ${tokens.ink};
      background: ${tokens.bg2};
      border: 1px solid ${tokens.line};
      border-radius: 8px;
      padding: 6px 10px;
      outline: none;
    `;

    const tagMenu = document.createElement('div');
    tagMenu.style.cssText = `
      display: flex;
      flex-direction: column;
      max-height: 120px;
      overflow-y: auto;
      border: 1px solid ${tokens.line};
      border-radius: 8px;
      background: ${tokens.bg2};
    `;

    const pillRow = document.createElement('div');
    pillRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    function renderPills(): void {
      pillRow.innerHTML = '';
      for (const name of selectedTags) {
        const pill = document.createElement('div');
        pill.style.cssText = `
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: ${tokens.ink};
          background: ${tokens.bg2};
          border: 1px solid ${tokens.line};
          border-radius: 999px;
          padding: 3px 8px 3px 6px;
        `;
        const dot = document.createElement('span');
        dot.style.cssText = `width: 5px; height: 5px; border-radius: 50%; background: ${tokens.mark}; flex-shrink: 0;`;
        const label = document.createElement('span');
        label.textContent = name;
        const remove = document.createElement('span');
        remove.textContent = '✕';
        remove.style.cssText = `cursor: pointer; color: ${tokens.faint}; font-size: 10px;`;
        remove.addEventListener('click', () => {
          selectedTags.delete(name);
          renderPills();
          renderMenu();
        });
        pill.append(dot, label, remove);
        pillRow.appendChild(pill);
      }
    }

    function renderMenu(): void {
      tagMenu.innerHTML = '';
      const q = query.trim().toLowerCase();
      const matches = payload.tags.filter((t) => t.name.toLowerCase().includes(q));

      for (const tag of matches) {
        const row = document.createElement('label');
        row.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
          color: ${tokens.ink};
          cursor: pointer;
        `;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedTags.has(tag.name);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedTags.add(tag.name);
          else selectedTags.delete(tag.name);
          renderPills();
        });
        const label = document.createElement('span');
        label.style.cssText = 'flex: 1;';
        label.textContent = tag.name;
        const count = document.createElement('span');
        count.textContent = String(tag.count);
        count.style.cssText = `color: ${tokens.faint}; font-size: 11px;`;
        row.append(checkbox, label, count);
        tagMenu.appendChild(row);
      }

      const trimmed = query.trim();
      const existsAlready = payload.tags.some(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (trimmed && !existsAlready) {
        const createRow = document.createElement('div');
        createRow.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
          color: ${tokens.muted};
          cursor: pointer;
          border-top: 1px dashed ${tokens.line};
        `;
        createRow.textContent = `Create "${escapeHtml(trimmed)}"`;
        createRow.addEventListener('click', () => {
          selectedTags.add(trimmed);
          query = '';
          tagInput.value = '';
          renderPills();
          renderMenu();
        });
        tagMenu.appendChild(createRow);
      }
    }

    tagInput.addEventListener('input', () => {
      query = tagInput.value;
      renderMenu();
    });

    tagSection.append(tagInput, tagMenu, pillRow);
    renderPills();
    renderMenu();

    const statusEl = document.createElement('div');
    statusEl.style.cssText = `font-size: 11px; color: ${tokens.mark};`;

    const actionsRow = document.createElement('div');
    actionsRow.style.cssText =
      'display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px;';

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.textContent = 'Discard edits';
    discardBtn.style.cssText = `
      appearance: none;
      border: none;
      background: transparent;
      color: ${tokens.muted};
      font-size: 12px;
      font-family: ${FONT};
      padding: 7px 10px;
      border-radius: 8px;
      cursor: pointer;
    `;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save details';
    // Primary action is ink-on-bg (never amber) — "Amber is a mark, never a fill".
    saveBtn.style.cssText = `
      appearance: none;
      border: none;
      background: ${tokens.ink};
      color: ${tokens.bg};
      font-size: 12px;
      font-weight: 500;
      font-family: ${FONT};
      padding: 7px 12px;
      border-radius: 8px;
      cursor: pointer;
    `;

    discardBtn.addEventListener('click', () => removeHost());

    function showSaveError(message: string): void {
      statusMessage = message;
      statusEl.textContent = statusMessage;
      statusEl.style.color = tokens.muted;
      saveBtn.textContent = 'Save details';
      saving = false;
    }

    async function sendEditDiff(diff: {
      note?: string;
      addedTags: string[];
      removedTags: string[];
    }): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        return (await chrome.runtime.sendMessage({
          type: 'silo-apply-edit',
          id: payload.linkId,
          diff,
        })) as { ok: true } | { ok: false; message: string };
      } catch {
        return { ok: false, message: 'Could not save details' };
      }
    }

    async function handleSave(): Promise<void> {
      if (saving) return;

      const note = noteEl.value.trim();
      const addedTags = [...selectedTags];
      if (!note && addedTags.length === 0) {
        removeHost();
        return;
      }

      saving = true;
      statusEl.textContent = '';
      saveBtn.textContent = 'Saving…';

      const diff = { ...(note ? { note } : {}), addedTags, removedTags: [] as string[] };
      const res = await sendEditDiff(diff);

      if (res?.ok) removeHost();
      else showSaveError(res?.message ?? 'Could not save details');
    }

    saveBtn.addEventListener('click', () => void handleSave());

    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        removeHost();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSave();
      }
    });

    actionsRow.append(discardBtn, saveBtn);
    wrapper.append(header, titleEl, urlEl, noteEl, tagSection, statusEl, actionsRow);
    card.appendChild(wrapper);

    noteEl.focus();
  }

  renderToastBody();
}
