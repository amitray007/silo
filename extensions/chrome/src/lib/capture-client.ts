import { getSettings } from './settings.js';
import type {
  ApiErrorEnvelope,
  CaptureRequest,
  CaptureResponse,
  GetLinkResponse,
  TagWithCount,
} from './types.js';

/**
 * A typed, actionable error thrown by every function in this module —
 * `kind` lets callers (the toast, the popup) branch on the failure without
 * string-matching a message. `'unreachable'` covers both a network failure
 * (silo not running / wrong `baseUrl`) and a CORS rejection (the browser
 * throws the SAME generic `TypeError: Failed to fetch` for both — there is
 * no way to distinguish them from `fetch`'s result, see MDN's CORS error
 * docs), so the message stays actionable for either cause.
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

/** Every request gets a hard timeout (ce-reliability finding): without one, a hung (not down, just stuck) silo leaves the popup/service-worker capture — and the options page's "test connection" — waiting forever instead of surfacing an actionable error. */
const REQUEST_TIMEOUT_MS = 10_000;

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const settings = await getSettings();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  // Token is read fresh per-call from storage, never logged (ce-security:
  // don't console.log headers/settings anywhere in this module).
  if (settings.token) {
    headers.set('Authorization', `Bearer ${settings.token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CaptureError(
      'unreachable',
      `Could not reach silo at ${settings.baseUrl}. Is it running?`,
    );
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

/** `POST /api/links` — the one capture call every entry point (command, popup, context menu) funnels through. */
export async function captureLink(input: CaptureRequest): Promise<CaptureResponse> {
  const response = await apiFetch('/api/links', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return (await response.json()) as CaptureResponse;
}

/** `GET /api/links/:id` — used by the popup's recent-5 list to fetch each tracked id's current (post-enrichment) state. */
export async function getLink(id: string): Promise<GetLinkResponse> {
  const response = await apiFetch(`/api/links/${id}`, { method: 'GET' });
  return (await response.json()) as GetLinkResponse;
}

/** `GET /api/tags` — tag-autocomplete source for the popup. */
export async function listTags(): Promise<TagWithCount[]> {
  const response = await apiFetch('/api/tags', { method: 'GET' });
  const body = (await response.json()) as { tags: TagWithCount[] };
  return body.tags;
}

/** `GET /health` — a lightweight reachability probe (options page "test connection"). Bypasses `apiFetch` since `/health` is unauthenticated by design (see `general-auth.ts`) and outside the `/api` prefix. */
export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
