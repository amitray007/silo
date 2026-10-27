import { BodyByteBudget } from '../fetch/body-budget.js';
import {
  type SafeFetchBytesResult,
  type SafeFetchOptions,
  safeFetchBytes,
} from '../fetch/safe-fetch.js';
import { BROWSER_USER_AGENT, browserAccept } from './profile.js';

export interface RoutePort {
  request(): { url(): string; method(): string; resourceType(): string };
  abort(): Promise<void>;
  fulfill(response: {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<void>;
}

export type BrowserFetch = (
  url: string,
  options: SafeFetchOptions,
) => Promise<SafeFetchBytesResult>;
const ALLOWED_TYPES = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);

function allowedRequest(request: ReturnType<RoutePort['request']>): boolean {
  if (request.method() !== 'GET' || !ALLOWED_TYPES.has(request.resourceType())) return false;
  try {
    const url = new URL(request.url());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** No continue/fallback: even a failed proxy request must never use Chromium's network. */
export class BrowserRoutes {
  private requests = 0;
  private fulfilledBytes = 0;
  private inFlight = 0;
  private lastActivity = Date.now();
  private readonly bodyBudget = new BodyByteBudget(20 * 1024 * 1024);

  constructor(
    private readonly signal: AbortSignal,
    private readonly fetch: BrowserFetch = safeFetchBytes,
  ) {}

  readonly handle = async (route: RoutePort): Promise<void> => {
    this.requests++;
    this.lastActivity = Date.now();
    if (this.signal.aborted || this.requests > 200 || !allowedRequest(route.request())) {
      await route.abort().catch(() => {});
      return;
    }
    this.inFlight++;
    try {
      const result = await this.fetch(route.request().url(), {
        signal: this.signal,
        bodyBudget: this.bodyBudget,
        maxBodyBytes: 5 * 1024 * 1024,
        userAgent: BROWSER_USER_AGENT,
        accept: browserAccept(route.request().resourceType()),
      });
      if (!result.ok || this.signal.aborted || !this.reserve(result.bytes.byteLength)) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: result.status,
        headers: result.contentType ? { 'content-type': result.contentType } : {},
        body: Buffer.from(result.bytes),
      });
    } catch {
      await route.abort().catch(() => {});
    } finally {
      this.inFlight--;
      this.lastActivity = Date.now();
    }
  };

  private reserve(bytes: number): boolean {
    if (bytes > 5 * 1024 * 1024 || this.fulfilledBytes + bytes > 20 * 1024 * 1024) return false;
    this.fulfilledBytes += bytes;
    return true;
  }

  async settle(): Promise<void> {
    // DOM readiness, not an early request, starts the quiet window.
    this.lastActivity = Date.now();
    const end = Date.now() + 6_000;
    while (!this.signal.aborted && Date.now() < end) {
      if (this.inFlight === 0 && Date.now() - this.lastActivity >= 800) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
}
