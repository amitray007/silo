import { chromium } from 'playwright-core';

// Route interception is not a boundary for SharedWorkers or WebRTC. Fail closed
// at launch too, including Chromium's otherwise implicit loopback proxy bypass.
const server = await chromium.launchServer({
  host: process.env.SILO_BROWSER_HOST ?? '127.0.0.1',
  port: Number(process.env.SILO_BROWSER_PORT ?? 3000),
  wsPath: '/silo-browser',
  chromiumSandbox: false,
  args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
});
console.log(`Listening on ${server.wsEndpoint()}`);

async function stop() {
  const force = setTimeout(() => process.exit(1), 2_000);
  await server.close().catch(() => {});
  clearTimeout(force);
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
