import { parentPort } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
const { inlinePageStyles } = await import('./stylesheets.ts');

parentPort.on('message', async ({ html, finalUrl }) => {
  try {
    parentPort.postMessage(await inlinePageStyles(html, finalUrl));
  } catch {
    parentPort.postMessage({ error: 'transform-failed' });
  }
});
