/// <reference lib="webworker" />
// Runs Kokoro off the main thread. Messages in: load, generate. Messages out: progress, ready,
// audio, error. One request runs at a time; the main thread decides the order.
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { siloFetch } from './kokoroFetch';

// ONNX Runtime's WebAssembly files ship in the transformers.js package. Without these URLs it
// would fetch them from a CDN.
const ORT_MJS = new URL(
  '../../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
  import.meta.url,
).href;
const ORT_WASM = new URL(
  '../../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm',
  import.meta.url,
).href;

type Scope = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  navigator: Navigator & { gpu?: unknown };
};
const scope = self as unknown as Scope;
let tts: KokoroTTS | undefined;

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type LoadMessage = { type: 'load'; filesBase: string; webgpuDtype: 'fp32' | null };
type GenerateMessage = { type: 'generate'; id: number; text: string; voice: string; speed: number };

function route(filesBase: string) {
  // transformers.js builds `<remoteHost>/<template>/<file>` for every model file.
  const at = filesBase.lastIndexOf('/');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = filesBase.slice(0, at);
  env.remotePathTemplate = filesBase.slice(at + 1);
  const wasm = env.backends.onnx.wasm;
  if (wasm) wasm.wasmPaths = { mjs: ORT_MJS, wasm: ORT_WASM };
  self.fetch = siloFetch(filesBase, self.fetch.bind(self));
}

/** True when the browser hands out a real GPU adapter (the API alone can exist without one). */
async function hasGpu(): Promise<boolean> {
  const gpu = scope.navigator.gpu as { requestAdapter(): Promise<unknown> } | undefined;
  try {
    return Boolean(await gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function load(message: LoadMessage) {
  route(message.filesBase);
  const progress_callback = (info: unknown) => scope.postMessage({ type: 'progress', info });
  const gpu = message.webgpuDtype !== null && (await hasGpu());
  // A GPU start that fails is reported as an error: ONNX Runtime keeps the failure, so the main
  // thread retries on a fresh worker without WebGPU.
  tts = await KokoroTTS.from_pretrained(MODEL, {
    dtype: gpu ? (message.webgpuDtype as 'fp32') : 'q8',
    device: gpu ? 'webgpu' : 'wasm',
    progress_callback,
  });
  scope.postMessage({
    type: 'ready',
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? message.webgpuDtype : 'q8',
    voices: tts.voices,
  });
}

async function generate(message: GenerateMessage) {
  if (!tts) throw new Error('The voice model is not loaded');
  const audio = await tts.generate(message.text, {
    voice: (message.voice || 'af_heart') as 'af_heart',
    speed: message.speed,
  });
  const samples = audio.audio;
  scope.postMessage({ type: 'audio', id: message.id, samples, sampleRate: audio.sampling_rate }, [
    samples.buffer,
  ]);
}

scope.onmessage = async (event: MessageEvent<LoadMessage | GenerateMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'load') await load(message);
    else await generate(message);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: 'id' in message ? message.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
