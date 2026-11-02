/// <reference lib="webworker" />
import { stretch } from './stretch';

export type StretchRequest = { id: number; input: Float32Array; rate: number };
export type StretchReply = { id: number } & ({ pcm: Float32Array } | { error: string });

type Scope = {
  onmessage: ((event: MessageEvent<StretchRequest>) => void) | null;
  postMessage(reply: StretchReply, transfer?: Transferable[]): void;
};
const scope = self as unknown as Scope;
scope.onmessage = ({ data: { id, input, rate } }) => {
  try {
    // WSOLA returns a view with window padding. Own only the audible samples in the cache.
    const pcm = stretch(input, rate).slice();
    scope.postMessage({ id, pcm }, [pcm.buffer]);
  } catch (reason) {
    scope.postMessage({ id, error: reason instanceof Error ? reason.message : String(reason) });
  }
};
