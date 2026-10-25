import { parentPort } from 'node:worker_threads';

parentPort.on('message', () => {
  // Simulate a parser that never yields. Only termination can stop this thread.
  for (;;) {}
});
