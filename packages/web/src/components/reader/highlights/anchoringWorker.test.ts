import { afterEach, expect, it, vi } from 'vitest';
import { anchorHighlight } from './anchor';
import type { AnchorJob, AnchorRequest, AnchorResponse } from './anchoringWorker';

function job(key: string, quote: string): AnchorJob {
  return { key, input: { quote, prefix: '', suffix: '', startOffset: null, endOffset: null } };
}

async function worker() {
  const responses: AnchorResponse[] = [];
  const scope: {
    onmessage: ((event: { data: AnchorRequest }) => void) | null;
    postMessage: (response: AnchorResponse) => void;
  } = { onmessage: null, postMessage: (response) => responses.push(response) };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./anchoringWorker');
  return { responses, send: (data: AnchorRequest) => scope.onmessage?.({ data }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('reuses loaded text for exact, fuzzy, repeated and orphan batches', async () => {
  const { send, responses } = await worker();
  const text = 'The cat sat here. The cat sat there. A longer edited passage about books.';
  const jobs = [
    job('exact', 'sat here'),
    job('fuzzy', 'A longer editod passage about books'),
    job('repeated', 'The cat'),
    job('orphan', 'unrelated lost quote'),
  ];
  send({ type: 'text', version: 7, text });
  send({ type: 'batch', version: 7, batch: 1, jobs });
  await vi.waitFor(() => expect(responses).toHaveLength(1));
  expect(responses[0]).toEqual({
    version: 7,
    batch: 1,
    results: jobs.map(({ key, input }) => ({ key, found: anchorHighlight(text, input) })),
  });
  send({ type: 'batch', version: 7, batch: 2, jobs: [job('next', 'books')] });
  await vi.waitFor(() => expect(responses).toHaveLength(2));
  expect(responses[1]?.results[0]?.found).toEqual({
    start: text.indexOf('books'),
    end: text.indexOf('books') + 5,
    how: 'exact',
  });
});

it('discards a cancelled batch and a replaced text version after yielding', async () => {
  vi.stubGlobal('MessageChannel', undefined);
  const { send, responses } = await worker();
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 40));
  const jobs = [job('a', 'cat'), job('b', 'cat')];
  send({ type: 'text', version: 1, text: 'The cat sat.' });
  send({ type: 'batch', version: 1, batch: 1, jobs });
  send({ type: 'cancel' });
  await vi.runAllTimersAsync();
  expect(responses).toEqual([]);
  send({ type: 'batch', version: 1, batch: 2, jobs });
  send({ type: 'text', version: 2, text: 'The dog sat.' });
  await vi.runAllTimersAsync();
  expect(responses).toEqual([]);
  send({ type: 'batch', version: 2, batch: 3, jobs: [job('c', 'dog')] });
  await vi.runAllTimersAsync();
  expect(responses[0]).toMatchObject({
    version: 2,
    batch: 3,
    results: [{ key: 'c', found: { start: 4, end: 7, how: 'exact' } }],
  });
});
