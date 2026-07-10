import type {
  ApiErrorBody,
  CaptureRequest,
  CaptureResponse,
  HealthResponse,
  IngestRequest,
  LinkResponse,
  LinksResponse,
  SearchResponse,
} from './types.js';

/**
 * Thrown by every `Client` method below on a non-2xx response, a malformed
 * body, or a network failure — callers never see a raw `fetch` rejection.
 * `status` is the HTTP status (`0` for a network failure — there was no
 * response to read a status from). `hint` carries the CLI-specific
 * ACTIONABLE remediation text a command prints instead of a stack trace
 * (e.g. "Is silo running? Start it with `pnpm dev`."), distinct from
 * `message` (the server's own wording, when there was a server to ask).
 */
export class ClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | undefined;

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

/** Reads the API's `{ error, message }` envelope out of a non-2xx response, falling back to a generic message when the body isn't that shape (e.g. a proxy/500 HTML page). */
async function toClientError(response: Response): Promise<ClientError> {
  const fallback = () =>
    new ClientError(
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
    typeof (body as { error: unknown }).error === 'string' &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    const envelope = body as ApiErrorBody;
    if (response.status === 401) {
      return new ClientError(
        401,
        envelope.error,
        envelope.message,
        'Ingest requires a valid API token. Set SILO_API_TOKEN on the API process and run `silo config set token <t>`.',
      );
    }
    if (response.status === 400) {
      return new ClientError(
        400,
        envelope.error,
        envelope.message,
        'Check the input and try again — the server rejected it as invalid.',
      );
    }
    return new ClientError(response.status, envelope.error, envelope.message);
  }

  return fallback();
}

/** Reads a JSON `Response` body typed as `T`. A `204`/empty body resolves to `undefined as T` — mirrors `packages/web/src/api/client.ts`'s `readJson`. */
async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await response.text();
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ClientError(
      response.status,
      'invalid_response',
      cause instanceof Error ? cause.message : 'Response body was not valid JSON',
    );
  }
}

/**
 * A small typed HTTP client for `@silo/api` — the shared transport every CLI
 * command builds on (plan 022). Base URL + optional bearer token are
 * resolved once by the caller (`resolveConnection`, `config.ts`) and passed
 * in here; the client itself has no config-reading of its own, which keeps
 * it trivially testable with a mocked `fetch`.
 */
export class Client {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(connection: { baseUrl: string; token: string | undefined }) {
    this.baseUrl = connection.baseUrl;
    this.token = connection.token;
  }

  /**
   * Runs `fetch(path, init)` against `baseUrl`, turning a network failure
   * (silo not reachable at all — the common "forgot to run `pnpm dev`" case)
   * into an ACTIONABLE `ClientError` rather than letting a raw
   * `TypeError: fetch failed` reach the terminal.
   */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (cause) {
      throw new ClientError(
        0,
        'network_error',
        cause instanceof Error ? cause.message : 'Network request failed',
        `Is silo running? Start it with \`pnpm dev\`, or check --base-url (currently ${this.baseUrl}).`,
      );
    }

    if (!response.ok) {
      throw await toClientError(response);
    }
    return response;
  }

  private async get<T>(path: string): Promise<T> {
    return readJson<T>(await this.request(path));
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return readJson<T>(
      await this.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  /** `GET /health` — a lightweight reachability check. */
  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  /**
   * `POST /api/links` — public capture. No token required. `source: 'cli'`
   * is stamped HERE, centrally, so every command that captures through this
   * client inherits it without threading it through per-call (capture-source
   * design spec, U3).
   */
  capture(input: CaptureRequest): Promise<CaptureResponse> {
    return this.post<CaptureResponse>('/api/links', { ...input, source: 'cli' });
  }

  /**
   * `POST /api/ingest` — the trusted, token-gated ingest seam (plan 020). A
   * missing/wrong token surfaces as a `ClientError` with `status === 401`
   * and an ingest-specific `hint` (see `toClientError`) — callers (e.g.
   * `silo ingest x`) should catch that case and print the hint rather than a
   * raw stack trace. `source: 'cli'` is stamped HERE, centrally, same as
   * `capture` above.
   */
  ingest(input: IngestRequest): Promise<CaptureResponse> {
    return this.post<CaptureResponse>('/api/ingest', { ...input, source: 'cli' });
  }

  /** `GET /api/links?tag=&limit=&cursor=` — the day-grouped feed. */
  list(params: { tag?: string; limit?: number; cursor?: string } = {}): Promise<LinksResponse> {
    const qs = new URLSearchParams();
    if (params.tag) qs.set('tag', params.tag);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString();
    return this.get<LinksResponse>(`/api/links${suffix ? `?${suffix}` : ''}`);
  }

  /** `GET /api/links/search?q=` — ranked search. */
  search(query: string, params: { limit?: number; cursor?: string } = {}): Promise<SearchResponse> {
    const qs = new URLSearchParams({ q: query });
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    return this.get<SearchResponse>(`/api/links/search?${qs.toString()}`);
  }

  /** `GET /api/links/:id` — detail/poll (used by `capture --wait`). */
  getById(id: string): Promise<LinkResponse> {
    return this.get<LinkResponse>(`/api/links/${id}`);
  }
}
