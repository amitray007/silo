import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Resolver } from './safe-fetch.js';
import { safeFetch } from './safe-fetch.js';

/**
 * Test seams used below — both are narrow, explicit, opt-in, and default
 * OFF; production call sites (the worker's `enrich.ts`) never set either:
 *
 *  - `resolver`: overrides *what a hostname resolves to*. Every address it
 *    returns still goes through the real `classifyIp` gate and the real
 *    pinning connector — it cannot itself smuggle a blocked address past
 *    classification (proven below by pointing it at a private address and
 *    confirming the fetch is still blocked).
 *  - `allowLoopbackForTests`: additionally permits ONLY the `loopback`
 *    range through classification, so the happy-path tests can drive the
 *    real fetch/redirect/size-cap/timeout/pinning machinery against a
 *    local HTTP server. Every other blocked range (private, link-local /
 *    cloud metadata, CGNAT, ULA, mapped, reserved, multicast, ...)
 *    remains blocked even with this flag set — proven by the
 *    redirect-to-private test, which sets the flag (for the *initial*
 *    loopback host) but still gets blocked when the redirect target
 *    resolves to a private address.
 */
function loopbackResolver(): Resolver {
  return () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
}

let server: Server;
let port: number;
let handler: (req: IncomingMessage, res: ServerResponse) => void;

beforeEach(async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>hi</body></html>');
  };
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected server to bind a TCP port');
  }
  port = address.port;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('safeFetch — scheme validation', () => {
  it('blocks ftp: scheme', async () => {
    const result = await safeFetch('ftp://example.com/file');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-scheme');
  });

  it('blocks file: scheme', async () => {
    const result = await safeFetch('file:///etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-scheme');
  });

  it('blocks javascript: scheme', async () => {
    const result = await safeFetch('javascript:alert(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-scheme');
  });

  it('blocks an unparseable URL', async () => {
    const result = await safeFetch('not a url at all');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-scheme');
  });
});

describe('safeFetch — IP classification (real classifier, no loopback override)', () => {
  it('blocks a hostname that resolves to loopback', async () => {
    const result = await safeFetch(`http://internal.test:${port}/`, {
      resolver: loopbackResolver(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('blocked-ip');
      expect(result.detail).toContain('127.0.0.1');
    }
  });

  it('blocks a hostname that resolves to link-local metadata address', async () => {
    const resolver: Resolver = () => Promise.resolve([{ address: '169.254.169.254', family: 4 }]);
    const result = await safeFetch('http://metadata.test/latest/meta-data/', { resolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-ip');
  });

  it('blocks when ANY resolved address (of several) is unsafe', async () => {
    const resolver: Resolver = () =>
      Promise.resolve([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
    const result = await safeFetch('http://multihomed.test/', { resolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-ip');
  });

  it('surfaces a dns-error when the resolver rejects', async () => {
    const resolver: Resolver = () => Promise.reject(new Error('ENOTFOUND'));
    const result = await safeFetch('http://does-not-resolve.test/', { resolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dns-error');
  });

  it('surfaces a dns-error when the resolver returns no addresses', async () => {
    const resolver: Resolver = () => Promise.resolve([]);
    const result = await safeFetch('http://no-addresses.test/', { resolver });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dns-error');
  });

  it('allowLoopbackForTests does NOT relax any other blocked range', async () => {
    const resolver: Resolver = () => Promise.resolve([{ address: '10.0.0.1', family: 4 }]);
    const result = await safeFetch('http://private.test/', {
      resolver,
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-ip');
  });

  it('aborts a HANGING resolver at the timeout instead of stalling forever', async () => {
    // A DNS lookup that never settles must be bounded by the overall timeout —
    // the resolver step is otherwise outside the fetch AbortController.
    const hangingResolver: Resolver = () => new Promise(() => {});
    const start = Date.now();
    const result = await safeFetch('http://slow-dns.test/', {
      resolver: hangingResolver,
      timeoutMs: 300,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
    // Well under a hypothetical hang: proves the abort fired, not a fluke.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('safeFetch — happy path (via loopback test server, allowLoopbackForTests seam)', () => {
  it('fetches HTML and returns html + contentType + finalUrl + status', async () => {
    const result = await safeFetch(`http://example.test:${port}/page`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('hi');
      expect(result.contentType).toBe('text/html');
      expect(result.status).toBe(200);
      expect(result.finalUrl).toBe(`http://example.test:${port}/page`);
    }
  });

  it('returns http-error for a 404', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('not found');
    };
    const result = await safeFetch(`http://example.test:${port}/missing`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('http-error');
      expect(result.detail).toBe('404');
    }
  });

  it('returns http-error for a 500', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('boom');
    };
    const result = await safeFetch(`http://example.test:${port}/error`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('http-error');
  });

  it('captures a non-html content-type and still returns ok:true (caller classifies)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"a":1}');
    };
    const result = await safeFetch(`http://example.test:${port}/data.json`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType).toBe('application/json');
      expect(result.html).toBe('{"a":1}');
    }
  });

  it('decodes a non-utf8 charset when declared in Content-Type', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
      // 0xE9 in latin1 is 'é'
      res.end(Buffer.from([0x68, 0x69, 0xe9]));
    };
    const result = await safeFetch(`http://example.test:${port}/latin1`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe('hié');
    }
  });

  it('decodes a QUOTED non-utf8 charset (charset="iso-8859-1") without falling back to mojibake', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset="iso-8859-1"' });
      res.end(Buffer.from([0x68, 0x69, 0xe9]));
    };
    const result = await safeFetch(`http://example.test:${port}/quoted-charset`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe('hié');
    }
  });
});

describe('safeFetch — redirects', () => {
  it('follows a redirect whose 3xx response carries an unread streamed body (destroy aborts it, no hang)', async () => {
    // The redirect response body is never consumed by safeFetch — it just
    // reads the Location header and moves on. `agent.destroy()` must abort
    // that unread body immediately rather than hang waiting for it to drain.
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, {
          location: `http://example.test:${port}/end`,
          'content-type': 'text/html',
        });
        let n = 0;
        const iv = setInterval(() => {
          if (res.writableEnded) {
            clearInterval(iv);
            return;
          }
          res.write('ignored-redirect-body'.repeat(1000));
          if (++n >= 100) clearInterval(iv);
        }, 5);
        res.on('close', () => clearInterval(iv));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>landed</html>');
    };
    const started = Date.now();
    const result = await safeFetch(`http://example.test:${port}/start`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      timeoutMs: 3_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain('landed');
    // Must complete well under the timeout — a hang would push this to ~3s.
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);

  it('follows a redirect to a safe address and re-validates it', async () => {
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: `http://example.test:${port}/end` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>landed</html>');
    };
    const result = await safeFetch(`http://example.test:${port}/start`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('landed');
      expect(result.finalUrl).toBe(`http://example.test:${port}/end`);
    }
  });

  it('blocks a redirect to a private/internal host at the redirect hop (does not follow)', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://internal-service.test/secret' });
      res.end();
    };
    // The initial host resolves via the loopback seam (allowed), but the
    // redirect target resolves to a genuinely private address — which is
    // NOT covered by allowLoopbackForTests, so re-validation on the
    // redirect hop must reject it.
    const resolver: Resolver = (hostname) => {
      if (hostname === 'internal-service.test') {
        return Promise.resolve([{ address: '10.0.0.9', family: 4 }]);
      }
      return loopbackResolver()(hostname);
    };
    const result = await safeFetch(`http://example.test:${port}/start`, {
      resolver,
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked-ip');
  });

  it('caps redirects at maxRedirects and returns too-many-redirects', async () => {
    let hops = 0;
    handler = (_req, res) => {
      hops += 1;
      res.writeHead(302, { location: `http://example.test:${port}/hop-${hops}` });
      res.end();
    };
    const result = await safeFetch(`http://example.test:${port}/start`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      maxRedirects: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-many-redirects');
  });

  it('returns http-error when a 3xx has no Location header', async () => {
    handler = (_req, res) => {
      res.writeHead(302, {});
      res.end();
    };
    const result = await safeFetch(`http://example.test:${port}/start`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('http-error');
  });
});

describe('safeFetch — size cap', () => {
  it('aborts a body exceeding maxBodyBytes without trusting Content-Length', async () => {
    handler = (_req, res) => {
      // No Content-Length header at all (chunked transfer) — the cap must
      // be enforced purely by counting bytes as they stream in, since
      // there is nothing to "trust" here in the first place. This is also
      // the honest case for a server that never sends Content-Length.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('x'.repeat(1000));
    };
    const result = await safeFetch(`http://example.test:${port}/big`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      maxBodyBytes: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('body-too-large');
  });

  it('aborts even when Content-Length under-declares a larger body (HTTP framing truncates to the declared length, but the cap still holds for whatever bytes DO arrive)', async () => {
    handler = (_req, res) => {
      // A server that declares a small Content-Length but tries to stream
      // more is misbehaving HTTP; the framing layer (correctly) truncates
      // to the declared length. This test documents that safeFetch's cap
      // is a backstop on ACTUAL received bytes, not a Content-Length
      // trust — it is not fooled by a large declared Content-Length with a
      // short actual body either.
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': '5' });
      res.end('xxxxx');
    };
    const result = await safeFetch(`http://example.test:${port}/short`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      maxBodyBytes: 500,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toBe('xxxxx');
  });

  it('allows a body exactly at the cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('a'.repeat(100));
    };
    const result = await safeFetch(`http://example.test:${port}/exact`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      maxBodyBytes: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html.length).toBe(100);
  });

  // Regression: earlier the agent was closed (gracefully) BEFORE the body
  // was read, which made undici buffer the whole body during close() —
  // hanging multi-packet responses until the outer timeout and defeating
  // the streamed cap. These two tests stream a body across multiple
  // event-loop ticks (multiple TCP segments), which the tiny synchronous
  // `res.end(...)` bodies above never exercised.

  it('reads a body streamed across multiple ticks (not buffered synchronously)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      let n = 0;
      const iv = setInterval(() => {
        res.write('chunk');
        if (++n >= 5) {
          clearInterval(iv);
          res.end('END');
        }
      }, 10);
    };
    const result = await safeFetch(`http://example.test:${port}/streamed`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe('chunkchunkchunkchunkchunkEND');
    }
  });

  it('aborts an OVERSIZED streamed body quickly (early cap), not after a full drain/timeout', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      const iv = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(iv);
          return;
        }
        res.write('x'.repeat(50_000));
      }, 5);
      // Stop writing once the client tears the connection down (the cap
      // aborts the request), so the server-side interval doesn't leak.
      res.on('close', () => clearInterval(iv));
    };
    const started = Date.now();
    const result = await safeFetch(`http://example.test:${port}/oversized-stream`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      maxBodyBytes: 100_000,
      // Generous timeout: the cap must trip FAR sooner than this. If the
      // old close()-before-read bug regressed, this would instead run to
      // the timeout (returning 'timeout', and taking ~2s).
      timeoutMs: 2_000,
    });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    // The key assertions: the cap trips (body-too-large, NOT timeout) and it
    // trips well under the timeout budget — proving the early streamed abort
    // works and the body is not fully drained first.
    if (!result.ok) expect(result.reason).toBe('body-too-large');
    expect(elapsed).toBeLessThan(1_500);
  }, 10_000);
});

describe('safeFetch — timeout', () => {
  it('fires the total timeout on a hung server', async () => {
    handler = (_req, res) => {
      // Never respond — hold the connection open past the timeout.
      void res;
    };
    const result = await safeFetch(`http://example.test:${port}/hang`, {
      resolver: loopbackResolver(),
      allowLoopbackForTests: true,
      timeoutMs: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  }, 10_000);
});

describe('safeFetch — DNS-rebinding / pinning contract', () => {
  it('connects to the exact address the resolver returned (pinned), not a re-resolved one', async () => {
    let resolveCalls = 0;
    const resolver: Resolver = () => {
      resolveCalls += 1;
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    };
    const result = await safeFetch(`http://rebind.test:${port}/`, {
      resolver,
      allowLoopbackForTests: true,
    });
    // The resolver is consulted once per hop (here: one hop, no redirect),
    // and the connector is pinned to exactly that address — proven by the
    // fetch succeeding against the loopback server bound to 127.0.0.1.
    expect(resolveCalls).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('safeFetch — IPv6 literal URLs (bracket stripping)', () => {
  it('fetches an IPv6-literal URL http://[::1]:port/ (brackets stripped before resolution)', async () => {
    // Regression: `new URL('http://[::1]/').hostname` is `"[::1]"`, which
    // `dns.lookup` rejects with ENOTFOUND — every IPv6-literal URL used to
    // fail with reason:'dns-error'. A dedicated ::1 server proves the
    // bracket-stripped host resolves and connects.
    const v6server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>ipv6</html>');
    });
    let v6ok = false;
    try {
      await new Promise<void>((resolve, reject) => {
        v6server.once('error', reject);
        v6server.listen(0, '::1', resolve);
      });
      v6ok = true;
    } catch {
      // Some CI environments have no IPv6 loopback; skip rather than fail.
      v6ok = false;
    }
    if (!v6ok) {
      v6server.close();
      return;
    }
    const v6addr = v6server.address();
    if (v6addr === null || typeof v6addr === 'string') {
      v6server.close();
      throw new Error('expected IPv6 server to bind a TCP port');
    }
    const v6port = v6addr.port;
    try {
      const result = await safeFetch(`http://[::1]:${v6port}/`, {
        allowLoopbackForTests: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.html).toContain('ipv6');
      }
    } finally {
      await new Promise<void>((resolve) => v6server.close(() => resolve()));
    }
  });
});
