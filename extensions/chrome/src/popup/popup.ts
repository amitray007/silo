import { CaptureError, captureLink, getLink, listTags } from '../lib/capture-client.js';
import { getRecentIds, trackCapturedId } from '../lib/recent.js';
import { isCapturableUrl, tabDisplayTitle } from '../lib/tab-payload.js';
import {
  addTag as addTagToState,
  createTagListState,
  renderTagList as renderTagListState,
  setSuggestions,
} from '../lib/tag-list.js';
import type { CapturedLink, CaptureRequest } from '../lib/types.js';

/**
 * The popup — the brief's SECONDARY "enrich-at-capture" surface (title +
 * note + tag autocomplete), plus the recent-5 list. Kept deliberately
 * minimal: the quiet one-keystroke path (toolbar-click-with-no-popup isn't
 * possible once a popup is registered, so the popup itself doubles as that
 * path's landing UI — but saving still requires an explicit button press
 * here, unlike the keyboard/context-menu paths which save immediately).
 */

const root = document.getElementById('root');
if (!root) throw new Error('popup: #root missing');

// Tag selection + suggestion state lives in `lib/tag-list.ts` (extracted so
// it's independently testable — see that module's doc comment for the bug
// this fixed: a manually-typed tag used to wipe the suggestion list).
const tagListState = createTagListState();

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const capturable = isCapturableUrl(tab?.url);

  root!.innerHTML = `
    <div class="header">
      <svg class="mark" width="16" height="16" viewBox="0 0 32 32" role="img" aria-label="silo">
        <defs>
          <linearGradient id="silo-mark-grain" x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0%" stop-color="#e8b054" />
            <stop offset="100%" stop-color="#c98f2d" />
          </linearGradient>
        </defs>
        <rect x="7" y="19.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.34" />
        <rect x="7" y="12.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.62" />
        <rect x="7" y="5.5" width="18" height="5" rx="2.5" fill="url(#silo-mark-grain)" />
      </svg>
      <div class="wordmark">silo</div>
    </div>
    <div class="section">
      <div class="page-title">${capturable ? escapeHtml(tabDisplayTitle(tab!)) : 'This page cannot be saved'}</div>
      ${
        capturable
          ? `
        <textarea id="note" rows="2" placeholder="Add a note (optional)"></textarea>
        <div class="tag-list" id="tag-list"></div>
        <input id="tag-input" placeholder="Add a tag and press enter" />
        <button class="save" id="save-btn">Save to silo</button>
        <div class="status" id="status"></div>
      `
          : ''
      }
    </div>
    <div class="section" id="recent-section">
      <div class="recent-header">Recently saved</div>
      <div id="recent-list" class="empty">Loading…</div>
    </div>
  `;

  if (capturable && tab) {
    wireCaptureForm(tab);
    void loadTagSuggestions();
  }
  void loadRecent();
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function wireCaptureForm(tab: chrome.tabs.Tab): void {
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const noteEl = document.getElementById('note') as HTMLTextAreaElement;
  const tagInput = document.getElementById('tag-input') as HTMLInputElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  tagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && tagInput.value.trim()) {
      event.preventDefault();
      addTag(tagInput.value.trim());
      tagInput.value = '';
    }
  });

  saveBtn.addEventListener('click', () => {
    void handleSaveClick(tab, saveBtn, noteEl, statusEl);
  });
}

/** The save-button click handler — extracted from `wireCaptureForm` so the async try/catch/finally doesn't push that closure's cognitive complexity over the lint budget. */
async function handleSaveClick(
  tab: chrome.tabs.Tab,
  saveBtn: HTMLButtonElement,
  noteEl: HTMLTextAreaElement,
  statusEl: HTMLDivElement,
): Promise<void> {
  saveBtn.disabled = true;
  statusEl.textContent = 'Saving…';
  statusEl.className = 'status';
  try {
    const note = noteEl.value.trim();
    const tags = tagListState.selected.size > 0 ? [...tagListState.selected] : undefined;
    const request: CaptureRequest = { url: tab.url! };
    if (note) request.note = note;
    if (tags) request.tags = tags;
    const { link, deduped } = await captureLink(request);
    await trackCapturedId(link.id);
    statusEl.textContent = deduped ? 'Already in silo (updated)' : 'Saved to silo';
    void loadRecent();
  } catch (error) {
    statusEl.textContent = error instanceof CaptureError ? error.message : 'Could not save to silo';
    statusEl.className = 'status error';
  } finally {
    saveBtn.disabled = false;
  }
}

function addTag(tag: string): void {
  addTagToState(tagListState, tag);
  renderTagPills();
}

function renderTagPills(): void {
  const list = document.getElementById('tag-list');
  if (!list) return;
  renderTagListState(list, tagListState, renderTagPills);
}

async function loadTagSuggestions(): Promise<void> {
  try {
    const tags = await listTags();
    setSuggestions(
      tagListState,
      tags.slice(0, 8).map((t) => t.name),
    );
    renderTagPills();
  } catch {
    // Tag autocomplete is best-effort — a failed fetch just leaves the list empty; capture still works.
  }
}

/** Loads the recent-5 list: reads tracked ids from storage, fetches each fresh from the API (so enrichment progress shows), renders. */
async function loadRecent(): Promise<void> {
  const listEl = document.getElementById('recent-list');
  if (!listEl) return;

  const ids = await getRecentIds();
  if (ids.length === 0) {
    listEl.className = 'empty';
    listEl.textContent = 'Nothing saved yet';
    return;
  }

  const links = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await getLink(id)).link;
      } catch {
        return undefined;
      }
    }),
  );

  const resolved = links.filter((link): link is CapturedLink => link !== undefined);
  if (resolved.length === 0) {
    listEl.className = 'empty';
    listEl.textContent = 'Could not load recent captures';
    return;
  }

  listEl.className = '';
  listEl.innerHTML = resolved
    .map((link) => {
      const title = link.title?.trim() || link.url;
      const enriching = link.captureStatus === 'enriching';
      return `
        <a class="recent-item" data-url="${escapeHtml(link.url)}">
          <div class="recent-title">${escapeHtml(title)}</div>
          <div class="recent-meta">
            ${enriching ? '<span class="pulse">◌ capturing</span>' : ''}
            ${link.tags.length > 0 ? `<span>${link.tags.map(escapeHtml).join(', ')}</span>` : ''}
          </div>
          ${link.notes ? `<div class="recent-note">${escapeHtml(link.notes)}</div>` : ''}
        </a>
      `;
    })
    .join('');

  for (const el of listEl.querySelectorAll<HTMLElement>('.recent-item')) {
    el.addEventListener('click', () => {
      const url = el.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  }
}

void init();
