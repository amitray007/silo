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
 * `GET`s `path` (resolved against `baseUrl`) and returns the JSON body typed
 * as `T`. Throws a typed `ApiError` — never a raw `fetch`/`Response` error —
 * on a non-2xx response, a malformed success body, or a network failure (e.g.
 * the dev proxy target being down), so every caller (the query hooks) can
 * treat "the request failed" as one shape regardless of cause.
 */
export async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`);
  } catch (cause) {
    throw new ApiError(
      0,
      'network_error',
      cause instanceof Error ? cause.message : 'Network request failed',
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ApiError(
      response.status,
      'invalid_response',
      cause instanceof Error ? cause.message : 'Response body was not valid JSON',
    );
  }
}
