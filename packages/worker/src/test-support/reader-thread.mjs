import { parentPort, threadId } from 'node:worker_threads';

// Deliberately exceed the tests' page deadline before declaring the thread ready.
await new Promise((resolve) => setTimeout(resolve, 250));
let pages = 0;
let active = 0;
parentPort.on('message', async ({ html }) => {
  pages++;
  // `title` reports how many pages this thread held at once when this one arrived.
  const held = active++;
  if (html === 'stuck') for (;;) {}
  if (html === 'exit') process.exit(1);
  await new Promise((resolve) => setTimeout(resolve, html.startsWith('slow') ? 150 : 30));
  active--;
  parentPort.postMessage({ result: { text: `${threadId}:${pages}:${html}`, title: String(held) } });
});
parentPort.postMessage({ ready: true });
