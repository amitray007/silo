import { describe, expect, it, vi } from 'vitest';
import { isHuggingFace, siloFetch } from './kokoroFetch';

const BASE = 'https://silo.test/api/tts/files/kokoro';
const HF_VOICE =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';

function setup() {
  const upstream = vi.fn(async () => new Response('ok'));
  return { upstream, fetch: siloFetch(BASE, upstream as unknown as typeof fetch) };
}

describe('siloFetch', () => {
  it("sends kokoro-js's hard-coded voice address to silo's file route", async () => {
    const { upstream, fetch } = setup();
    await fetch(HF_VOICE);
    expect(upstream).toHaveBeenCalledWith(`${BASE}/voices/af_heart.bin`, undefined);
  });

  it('accepts a URL object and a Request', async () => {
    const { upstream, fetch } = setup();
    await fetch(new URL(HF_VOICE));
    await fetch(new Request(HF_VOICE));
    expect(upstream).toHaveBeenNthCalledWith(1, `${BASE}/voices/af_heart.bin`, undefined);
    expect(upstream).toHaveBeenNthCalledWith(2, `${BASE}/voices/af_heart.bin`, undefined);
  });

  it('never lets any other request to Hugging Face out', async () => {
    const { upstream, fetch } = setup();
    for (const url of [
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/config.json',
      'https://cdn-lfs.huggingface.co/repos/x/y/model.onnx',
      'https://huggingface.co/api/models/x',
      'https://hf.co/x',
    ]) {
      await expect(fetch(url)).rejects.toThrow(/blocked/);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes silo's own requests through untouched", async () => {
    const { upstream, fetch } = setup();
    await fetch(`${BASE}/onnx/model.onnx`, { headers: { range: 'bytes=0-9' } });
    expect(upstream).toHaveBeenCalledWith(`${BASE}/onnx/model.onnx`, {
      headers: { range: 'bytes=0-9' },
    });
  });
});

describe('isHuggingFace', () => {
  it('matches Hugging Face hosts only', () => {
    expect(isHuggingFace('https://huggingface.co/a')).toBe(true);
    expect(isHuggingFace('https://cdn-lfs.huggingface.co/a')).toBe(true);
    expect(isHuggingFace('https://example.com/huggingface.co')).toBe(false);
    expect(isHuggingFace('not a url')).toBe(false);
  });
});
