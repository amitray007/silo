/// <reference lib="webworker" />
// Runs Kokoro off the main thread. Messages in: load, generate. Messages out: progress, ready,
// audio, error. One request runs at a time; the main thread decides the order.
import { KokoroTTS } from 'kokoro-js';

type Scope = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  navigator: Navigator & { gpu?: unknown };
};
const scope = self as unknown as Scope;
// biome-ignore lint/suspicious/noExplicitAny: kokoro-js types are loose
let tts: any;

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

scope.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      const progress_callback = (info: unknown) => scope.postMessage({ type: 'progress', info });
      let device = 'wasm';
      let dtype = 'q8';
      if (scope.navigator.gpu && message.webgpuDtype) {
        try {
          device = 'webgpu';
          dtype = message.webgpuDtype;
          tts = await KokoroTTS.from_pretrained(MODEL, {
            dtype: dtype as 'fp32',
            device: device as 'webgpu',
            progress_callback,
          });
        } catch {
          tts = undefined;
          device = 'wasm (webgpu failed)';
          dtype = 'q8';
        }
      }
      if (!tts)
        tts = await KokoroTTS.from_pretrained(MODEL, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback,
        });
      scope.postMessage({ type: 'ready', device, dtype, voices: tts.voices });
    } else if (message.type === 'generate') {
      const audio = await tts.generate(message.text, {
        voice: message.voice || 'af_heart',
        speed: message.speed,
      });
      const samples = audio.audio as Float32Array;
      scope.postMessage(
        { type: 'audio', id: message.id, samples, sampleRate: audio.sampling_rate },
        [samples.buffer],
      );
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
