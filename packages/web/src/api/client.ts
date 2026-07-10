import { clearToken, emitAuthCleared, getToken } from './auth';
import type { ApiErrorBody } from './types';

/**
 * The base URL every API call is resolved against. Defaults to `''` so
 * `apiGet('/api/counts')` resolves same-origin — in dev that's Vite's
 * `server.proxy` (`vite.config.ts`: `/api` -> `http://127.0.0.1:8787`), and in
 * a production deploy the API is expected to be served from the same origin
 * as the SPA. Overridable (rather than hardcoded) so a future deploy shape
 * (a separately-hosted API) doesn't require touching every call site.
 */
let baseUrl = '';

/** Overrides the base URL every `apiGet`/`apiPost`/... call resolves against. Exposed for tests and for a future cross-origin deploy. */
export function setApiBaseUrl(url: string): void {
  baseUrl = url;
}

/**
 * Resolves `path` against `baseUrl` and returns the absolute-or-relative URL
 * string, WITHOUT fetching it. For call sites that need the URL itself rather
 * than its JSON body — e.g. a file download navigated to via an `<a href>`
 * (`ImportExportTab`'s Export button hits `/api/export`, which the browser
 * must download, not `apiGet`-and-parse-as-JSON). `baseUrl` is module-local
 * (set via `setApiBaseUrl`), so this is the one clean way to read it from
 * outside the module rather than duplicating the variable at each call site.
 */
export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}

/**
 * Thrown by every helper below on any non-2xx response, a non-JSON body, or a
 * network failure — callers never see a raw `fetch` rejection or an untyped
 * error. `status` is the HTTP status (`0` for a network failure — there was
 * no response to read a status from); `error`/`message`/`details` mirror the
 * API's `ErrorEnvelope` (`packages/api/src/app.ts`) when the server sent one,
 * or a generic fallback when it didn't (e.g. a 500 with an HTML body, or the
 * request never reached the server at all).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly details?: unknown;

  constructor(status: number, error: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

/**
 * Reads the API's error envelope out of a non-2xx response, falling back to a
 * generic `ApiError` when the body isn't the JSON shape the API promises
 * (e.g. a proxy/500 page returning HTML, or an empty body). Never throws in a
 * way that leaks a raw parse error — this function's whole job is to turn
 * "anything the server sent back" into a well-formed `ApiError`.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const fallback = () =>
    new ApiError(
      response.status,
      'unknown_error',
      `Request failed with status ${response.status} ${response.statusText}`.trim(),
    );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback();
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    'message' in body &&
    typeof (body as ApiErrorBody).error === 'string' &&
    typeof (body as ApiErrorBody).message === 'string'
  ) {
    const envelope = body as ApiErrorBody;
    return new ApiError(response.status, envelope.error, envelope.message, envelope.details);
  }

  return fallback();
}

/**
 * Reads a JSON `Response` body typed as `T`, or throws a typed `ApiError` —
 * never a raw parse error — when the body isn't valid JSON. A `204 No
 * Content` (or any genuinely empty body — checked via `content-length: 0`
 * OR an empty text body, since some responses omit `content-length`
 * entirely) resolves to `undefined as T` rather than attempting
 * `response.json()`: an empty body is not malformed JSON, it's simply no
 * body, and the API legitimately returns exactly this shape (e.g. `DELETE
 * /api/trash/:id`'s `c.body(null, 204)`) — a future `apiDelete` caller must
 * see that as success, not an `invalid_response` error. Shared tail for
 * every verb below (`apiGet`/`apiRequest`) so "how do we turn a `Response`
 * into `T`" has exactly one implementation.
 */
async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const text = await response.text();
  if (text === '') return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ApiError(
      response.status,
      'invalid_response',
      cause instanceof Error ? cause.message : 'Response body was not valid JSON',
    );
  }
}

/**
 * Runs `fetch(path, init)` (resolved against `baseUrl`), turning a network
 * failure into a typed `network_error` `ApiError` and a non-2xx response into
 * the API's own error envelope (via `toApiError`) — the shared error-handling
 * core behind both `apiGet` and every write verb (`apiPost`/`apiPatch`/
 * `apiDelete`), so "the request failed" has exactly one meaning regardless of
 * which verb triggered it.
 */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const requestInit: RequestInit | undefined = token
    ? { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }
    : init;

  let response: Response;
  try {
    response = requestInit
      ? await fetch(`${baseUrl}${path}`, requestInit)
      : await fetch(`${baseUrl}${path}`);
  } catch (cause) {
    throw new ApiError(
      0,
      'network_error',
      cause instanceof Error ? cause.message : 'Network request failed',
    );
  }

  if (response.status === 401) {
    // A stale/invalid token must be dropped regardless of how the caller
    // handles the resulting ApiError below, so the app doesn't keep
    // resending a dead token — clear it and signal AuthContext to bounce to
    // the login gate before falling through to the normal error handling.
    clearToken();
    emitAuthCleared();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  return response;
}

/**
 * `GET`s `path` (resolved against `baseUrl`) and returns the JSON body typed
 * as `T`. Throws a typed `ApiError` — never a raw `fetch`/`Response` error —
 * on a non-2xx response, a malformed success body, or a network failure (e.g.
 * the dev proxy target being down), so every caller (the query hooks) can
 * treat "the request failed" as one shape regardless of cause.
 */
export async function apiGet<T>(path: string): Promise<T> {
  return readJson<T>(await apiFetch(path));
}

/**
 * Shared body for every non-GET verb below: `fetch`es `path` with a JSON
 * `body` (when given) and the given HTTP `method`, returning the JSON
 * response typed as `T`. Mirrors `apiGet`'s error handling exactly (both
 * route through `apiFetch`/`readJson`) — a network failure, a non-2xx
 * response, and a malformed success body all become a typed `ApiError`,
 * never a raw `fetch`/`Response`/parse error. A `void` request body
 * (`undefined`) omits the `body`/`content-type` entirely (used by e.g. a
 * no-body `DELETE`); most callers pass a JSON-serializable object.
 */
async function apiRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return readJson<T>(response);
}

/**
 * `POST`s `body` as JSON to `path` (resolved against `baseUrl`) and returns
 * the JSON response typed as `T`. The web mutation layer's first write verb
 * (plan 011, V3-3) — `useCaptureLink` is its first caller
 * (`POST /api/links`). Same `ApiError` contract as `apiGet`.
 */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, 'POST', body);
}

/**
 * `PATCH`es `body` as JSON to `path` — added alongside `apiPost` for later
 * mutation slices (e.g. V3-4's edit-link `PATCH /api/links/:id`) since it's
 * trivial given `apiRequest` and keeps every write verb's error handling
 * identical. Unused by this slice.
 */
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, 'PATCH', body);
}

/**
 * `DELETE`s `path` with no request body — added alongside `apiPost` for later
 * mutation slices (e.g. trash/purge). Unused by this slice.
 */
export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, 'DELETE');
}
