import { getBaseUrl, getToken } from './preferences.js';
import type { ApiErrorEnvelope, CaptureRequest, CaptureResponse, SearchResponse } from './types.js';

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

/** `POST /api/links` — the one capture call both commands (instant + with-details) funnel through. */
export async function captureLink(input: CaptureRequest): Promise<CaptureResponse> {
  const response = await apiFetch('/api/links', {
    method: 'POST',
    body: JSON.stringify(input),
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
