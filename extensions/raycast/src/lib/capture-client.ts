import { getBaseUrl, getToken } from './preferences.js';
import type {
  ApiErrorEnvelope,
  BrowseResponse,
  CapturedLink,
  CaptureRequest,
  CaptureResponse,
  Counts,
  LinkResponse,
  SearchResponse,
  TagsResponse,
  TagWithCount,
  TrashResponse,
} from './types.js';

/**
 * A typed, actionable error thrown by every function in this module —
 * `kind` lets callers (the commands) branch on the failure without
 * string-matching a message. Raycast's Node runtime has NO CORS constraint
 * (see `extensions/INTERFACES.md`), so `'unreachable'` here means only a
 * real network failure (silo not running / wrong `baseUrl`), unlike the
 * Chrome extension where the same generic fetch failure can also mean a
 * CORS rejection.
 */
export class CaptureError extends Error {
  constructor(
    public readonly kind: 'unreachable' | 'unauthorized' | 'invalid' | 'server' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** Every request gets a hard timeout (ce-reliability finding): without one, a hung (not down, just stuck) silo leaves `showHUD` waiting forever instead of surfacing an actionable error — the instant-capture command's whole point is to never hang the fast path. */
const REQUEST_TIMEOUT_MS = 10_000;

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  // Token is read fresh per-call from preferences, never logged (ce-security:
  // don't console.log headers/preferences anywhere in this module).
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CaptureError('unreachable', `Could not reach silo at ${baseUrl}. Is it running?`);
  }

  if (response.status === 401) {
    throw new CaptureError('unauthorized', 'silo rejected the request (check your API token).');
  }
  if (response.status === 400) {
    const body = await safeErrorBody(response);
    throw new CaptureError('invalid', body?.message ?? 'silo rejected the request.');
  }
  if (!response.ok) {
    const body = await safeErrorBody(response);
    throw new CaptureError('server', body?.message ?? `silo returned ${response.status}.`);
  }
  return response;
}

async function safeErrorBody(response: Response): Promise<ApiErrorEnvelope | undefined> {
  try {
    return (await response.json()) as ApiErrorEnvelope;
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/links` — the one capture call both commands (instant +
 * with-details) funnel through. `source: 'raycast'` is stamped HERE,
 * centrally, so both commands inherit it without having to pass it
 * themselves (capture-source design spec, U3).
 */
export async function captureLink(input: CaptureRequest): Promise<CaptureResponse> {
  const response = await apiFetch('/api/links', {
    method: 'POST',
    body: JSON.stringify({ ...input, source: 'raycast' }),
  });
  return (await response.json()) as CaptureResponse;
}

/** `GET /api/links/search?q=` — the search command's data source. */
export async function searchLinks(query: string): Promise<SearchResponse> {
  const response = await apiFetch(`/api/links/search?q=${encodeURIComponent(query)}`, {
    method: 'GET',
  });
  return (await response.json()) as SearchResponse;
}

/** `GET /api/links[?tag=]` — Browse's whole-library / by-tag data source. */
export async function browseLinks(filter: { tag?: string } = {}): Promise<BrowseResponse> {
  const qs = filter.tag ? `?tag=${encodeURIComponent(filter.tag)}` : '';
  const response = await apiFetch(`/api/links${qs}`, { method: 'GET' });
  return (await response.json()) as BrowseResponse;
}

/** `GET /api/trash` — Browse's Trash scope. */
export async function listTrash(): Promise<TrashResponse> {
  const response = await apiFetch('/api/trash', { method: 'GET' });
  return (await response.json()) as TrashResponse;
}

/** `PATCH /api/links/:id { note }` — replaces the note (not a merge). */
export async function editNote(id: string, note: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  return ((await response.json()) as LinkResponse).link;
}

/** `POST /api/links/:id/tags { tag }`. */
export async function addTag(id: string, tag: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  });
  return ((await response.json()) as LinkResponse).link;
}

/** `DELETE /api/links/:id/tags/:tag` — the tag is a path segment, so it must be encoded. */
export async function removeTag(id: string, tag: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
  return ((await response.json()) as LinkResponse).link;
}

/** `POST /api/links/:id/trash` — soft-delete; guarded by `confirmAlert` at the call site. */
export async function trashLink(id: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/trash`, { method: 'POST' });
  return ((await response.json()) as LinkResponse).link;
}

/** `POST /api/links/:id/restore` — moves a trashed link back to the library. */
export async function restoreLink(id: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/restore`, { method: 'POST' });
  return ((await response.json()) as LinkResponse).link;
}

/** `POST /api/links/:id/retry` — re-runs enrichment for a partial/bare link. */
export async function retryLink(id: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/retry`, { method: 'POST' });
  return ((await response.json()) as LinkResponse).link;
}

/** `DELETE /api/trash` — empties the whole trash (204, no body). Guarded by `confirmAlert` at the call site. */
export async function emptyTrash(): Promise<void> {
  await apiFetch('/api/trash', { method: 'DELETE' });
}

/** `DELETE /api/trash/:id` — permanently deletes one trashed link (204, no body). Guarded by `confirmAlert` at the call site. */
export async function deleteTrashed(id: string): Promise<void> {
  await apiFetch(`/api/trash/${id}`, { method: 'DELETE' });
}

/** `GET /api/tags` — unwraps `.tags` for the tag picker + Browse's scope dropdown. */
export async function listTags(): Promise<TagWithCount[]> {
  const response = await apiFetch('/api/tags', { method: 'GET' });
  const body = (await response.json()) as TagsResponse;
  return body.tags;
}

/** `GET /api/counts` — used by Browse's Trash purge-countdown header. */
export async function getCounts(): Promise<Counts> {
  const response = await apiFetch('/api/counts', { method: 'GET' });
  return (await response.json()) as Counts;
}
