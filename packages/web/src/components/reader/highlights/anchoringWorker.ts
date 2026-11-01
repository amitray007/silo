import { type Anchored, type AnchorInput, anchorHighlight } from './anchor';

export type AnchorJob = { key: string; input: AnchorInput };
export type AnchorResult = { key: string; found: Anchored | null };
export type AnchorRequest =
  | { type: 'text'; version: number; text: string }
  | { type: 'batch'; version: number; batch: number; jobs: readonly AnchorJob[] }
  | { type: 'cancel' };
export type AnchorResponse = { version: number; batch: number; results: AnchorResult[] };

let text = '';
let version = 0;
let generation = 0;

/** Message tasks yield without the nested-timer delay on a long batch. */
function yieldToMessages(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((done) => setTimeout(done, 0));
  }
  return new Promise((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      done();
    };
    channel.port2.postMessage(null);
  });
}

/** Yield between anchors so a superseding batch can cancel work without resending the text. */
async function resolve(request: Extract<AnchorRequest, { type: 'batch' }>, token: number) {
  const results: AnchorResult[] = [];
  let slice = performance.now();
  for (const job of request.jobs) {
    if (token !== generation) return;
    results.push({ key: job.key, found: anchorHighlight(text, job.input) });
    if (performance.now() - slice >= 32) {
      await yieldToMessages();
      slice = performance.now();
    }
  }
  if (token === generation) {
    self.postMessage({ version, batch: request.batch, results } satisfies AnchorResponse);
  }
}

self.onmessage = (event: MessageEvent<AnchorRequest>) => {
  const request = event.data;
  generation += 1;
  if (request.type === 'text') {
    text = request.text;
    version = request.version;
  } else if (request.type === 'batch' && request.version === version) {
    void resolve(request, generation);
  }
};
