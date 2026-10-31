/**
 * `kokoro-js` loads each voice from a fixed Hugging Face address, outside the transformers.js
 * `env` settings that redirect the model files. This fetch wrapper, installed in the Kokoro
 * worker, sends those voice requests to silo's file route and refuses any other request to
 * Hugging Face, so the browser never calls it.
 */
const KOKORO_VOICES =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export function isHuggingFace(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'huggingface.co' ||
      host === 'hf.co' ||
      host.endsWith('.huggingface.co') ||
      host.endsWith('.hf.co')
    );
  } catch {
    return false;
  }
}

/** `filesBase` is silo's route for Kokoro files, without a trailing slash. */
export function siloFetch(filesBase: string, upstream: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = urlOf(input);
    if (url.startsWith(KOKORO_VOICES)) {
      return upstream(`${filesBase}/voices/${url.slice(KOKORO_VOICES.length)}`, init);
    }
    if (isHuggingFace(url)) {
      return Promise.reject(
        new TypeError('Requests to Hugging Face are blocked; silo serves the model files'),
      );
    }
    return upstream(input, init);
  };
}
