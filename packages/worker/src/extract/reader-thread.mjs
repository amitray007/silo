import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
const { extractPageContent } = await import('./reader-page.ts');

parentPort.on('message', async ({ html, url, description }) => {
  try {
    parentPort.postMessage({ result: await extractPageContent(html, url, description) });
  } catch {
    parentPort.postMessage({ error: 'reader-failed' });
  }
});

parentPort.postMessage({ ready: true });
