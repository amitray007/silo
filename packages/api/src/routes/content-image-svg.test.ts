import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { registerContentImageRoutes } from './content-image.js';

vi.mock('./reader.js', () => ({
  loadReader: vi.fn(async () => ({ contentImages: ['https://example.test/icon.svg'] })),
}));
vi.mock('../ssrf-safe-image-fetch.js', () => ({
  fetchImageSafely: vi.fn(async () => ({
    ok: true,
    bytes: new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"/>',
    ),
    contentType: 'image/svg+xml',
  })),
}));

it('serves a viewBox-only Reader SVG with intrinsic dimensions and security headers', async () => {
  const app = new Hono();
  registerContentImageRoutes(app);
  const response = await app.request('/links/6f1c1b0e-6f55-4d1c-9a55-1b0f4a3d2e10/content-image/0');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(
    '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"/>',
  );
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  expect(response.headers.get('content-security-policy')).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="image.svg"');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
