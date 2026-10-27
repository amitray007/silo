import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
const { extractPageContent } = await import('./reader-page.ts');
const { sanitizeRenderedContent } = await import('./reader-content.ts');

parentPort.on('message', async ({ html, url, description, operation }) => {
  try {
    const result =
      operation === 'sanitize'
        ? sanitizeRenderedContent(html, url)
        : await extractPageContent(html, url, description);
    parentPort.postMessage({ result });
  } catch {
    parentPort.postMessage({ error: 'reader-failed' });
  }
});

parentPort.postMessage({ ready: true });
