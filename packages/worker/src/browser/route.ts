import { BodyByteBudget } from '../fetch/body-budget.js';
import {
  type SafeFetchBytesResult,
  type SafeFetchOptions,
  safeFetchBytes,
} from '../fetch/safe-fetch.js';
import { BROWSER_USER_AGENT, browserAccept } from './profile.js';

export interface RoutePort {
  request(): {
    url(): string;
    method(): string;
    resourceType(): string;
    isNavigationRequest(): boolean;
    frame(): { parentFrame(): unknown | null };
  };
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

function blockedReason(request: ReturnType<RoutePort['request']>): string | undefined {
  if (request.method() !== 'GET') return 'method';
  if (!ALLOWED_TYPES.has(request.resourceType())) return 'type';
  try {
    if (
      request.resourceType() === 'document' &&
      (!request.isNavigationRequest() || request.frame().parentFrame() !== null)
    )
      return 'subframe';
    const url = new URL(request.url());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? undefined
      : 'unsafe-url';
  } catch {
    return 'unsafe-url';
  }
}

/** No continue/fallback: even a failed proxy request must never use Chromium's network. */
export class BrowserRoutes {
  private readonly routed: Record<string, number> = {};
  private readonly aborted: Record<string, number> = {};
  private readonly ok: Record<string, number> = {};
  private readonly failed: Record<string, number> = {};
  stats() {
    return {
      routed: { ...this.routed },
      aborted: { ...this.aborted },
      ok: { ...this.ok },
      failed: { ...this.failed },
      fulfilledBytes: this.fulfilledBytes,
    };
  }
  private count(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  private requests = 0;
  private fulfilledBytes = 0;
  private reservedBytes = 0;
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
    this.count(this.routed, route.request().resourceType());
    const reason = this.signal.aborted
      ? 'cancelled'
      : this.requests > 200
        ? 'budget'
        : blockedReason(route.request());
    if (reason) {
      this.count(this.aborted, reason);
      await route.abort().catch(() => {});
      return;
    }
    this.inFlight++;
    try {
      const result = await this.fetch(route.request().url(), {
        signal: this.signal,
        bodyBudget: this.bodyBudget,
        responseHeaderNames: ['obs-status'],
        maxBodyBytes: 5 * 1024 * 1024,
        userAgent: BROWSER_USER_AGENT,
        accept: browserAccept(route.request().resourceType()),
      });
      const reason = this.fetchReason(result);
      if (reason) {
        this.count(this.aborted, reason);
        await route.abort();
        return;
      }
      if (!result.ok) return;
      await route.fulfill({
        status: result.status,
        headers: {
          ...(result.contentType ? { 'content-type': result.contentType } : {}),
          ...(result.responseHeaders?.['obs-status'] !== undefined
            ? {
                'obs-status': result.responseHeaders['obs-status'],
                'access-control-expose-headers': 'obs-status',
              }
            : {}),
        },
        body: Buffer.from(result.bytes),
      });
      this.fulfilledBytes += result.bytes.byteLength;
    } catch {
      this.count(this.failed, 'exception');
      await route.abort().catch(() => {});
    } finally {
      this.inFlight--;
      this.lastActivity = Date.now();
    }
  };

  private fetchReason(result: SafeFetchBytesResult): string | undefined {
    if (!result.ok) {
      this.count(this.failed, result.reason);
      return result.reason.startsWith('blocked-') ? 'unsafe-url' : 'fetch';
    }
    this.count(this.ok, String(result.status));
    if (this.signal.aborted) return 'cancelled';
    if (!this.reserve(result.bytes.byteLength)) return 'budget';
    return undefined;
  }

  private reserve(bytes: number): boolean {
    if (bytes > 5 * 1024 * 1024 || this.reservedBytes + bytes > 20 * 1024 * 1024) return false;
    this.reservedBytes += bytes;
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
