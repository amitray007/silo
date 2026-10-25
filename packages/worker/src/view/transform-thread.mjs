import { parentPort } from 'node:worker_threads';
import { transformPage } from './transform.ts';

parentPort.on('message', ({ html, finalUrl }) => {
  try {
    parentPort.postMessage({ html: transformPage(html, finalUrl) });
  } catch {
    parentPort.postMessage({ error: 'transform-failed' });
  }
});
