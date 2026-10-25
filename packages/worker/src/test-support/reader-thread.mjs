import { parentPort, threadId } from 'node:worker_threads';

// Deliberately exceed the tests' page deadline before declaring the thread ready.
await new Promise((resolve) => setTimeout(resolve, 250));
let pages = 0;
parentPort.on('message', async ({ html }) => {
  pages++;
  if (html === 'stuck') for (;;) {}
  if (html === 'exit') process.exit(1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  parentPort.postMessage({ result: { text: `${threadId}:${pages}:${html}` } });
});
parentPort.postMessage({ ready: true });
