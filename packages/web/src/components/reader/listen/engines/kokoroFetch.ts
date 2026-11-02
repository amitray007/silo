/**
 * `kokoro-js` loads each voice from a fixed Hugging Face address, outside the transformers.js
 * `env` settings that redirect the model files. This fetch wrapper, installed in the Kokoro
 * worker, sends those voice requests to silo's file route and refuses any other request to
 * Hugging Face or a CDN, so the browser never calls them.
 */
const KOKORO_VOICES =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Hosts a model load might reach by default: Hugging Face, and the CDN ONNX Runtime uses. */
const BLOCKED = ['huggingface.co', 'hf.co', 'jsdelivr.net'];

export function isBlockedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return BLOCKED.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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
    if (isBlockedHost(url)) {
      return Promise.reject(
        new TypeError('Requests to Hugging Face and CDNs are blocked; silo serves the model files'),
      );
    }
    return upstream(input, init);
  };
}
