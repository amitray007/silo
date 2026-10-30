import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
const { extractPageContent } = await import('./reader-page.ts');
const { sanitizeRenderedContent } = await import('./reader-content.ts');

parentPort.on('message', async ({ html, url, description, operation, codeEditors }) => {
  try {
    const result =
      operation === 'sanitize'
        ? await sanitizeRenderedContent(html, url, codeEditors)
        : await extractPageContent(html, url, description);
    parentPort.postMessage({ result });
  } catch {
    parentPort.postMessage({ error: 'reader-failed' });
  }
});

parentPort.postMessage({ ready: true });
