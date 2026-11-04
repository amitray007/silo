import { smoothStream, type TextStreamPart, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { reasoningTimer, reasoningTiming } from './reasoning-time.js';

const part = (type: string) => ({ type }) as unknown as TextStreamPart<ToolSet>;

describe('reasoningTimer', () => {
  it('sums each step from its first reasoning delta to its first non-reasoning part', () => {
    let clock = 0;
    const metadata = reasoningTimer(() => clock);
    const feed = (type: string, at: number) => {
      clock = at;
      return metadata({ part: part(type) });
    };
    expect(feed('start-step', 0)).toBeUndefined();
    expect(feed('reasoning-start', 100)).toBeUndefined();
    expect(feed('reasoning-delta', 1000)).toBeUndefined();
    expect(feed('reasoning-delta', 2500)).toBeUndefined();
    expect(feed('reasoning-end', 3000)).toBeUndefined();
    expect(feed('tool-input-start', 4000)).toEqual({ reasoningMs: 3000 });
    expect(feed('text-delta', 5000)).toBeUndefined();
    expect(feed('reasoning-delta', 6000)).toBeUndefined();
    expect(feed('text-start', 6500)).toEqual({ reasoningMs: 3500 });
  });

  it('reports nothing for a step without reasoning', () => {
    const metadata = reasoningTimer(() => 1);
    expect(metadata({ part: part('text-delta') })).toBeUndefined();
    expect(metadata({ part: part('finish') })).toBeUndefined();
  });
});

it('adds resumed assistant reasoning time', () => {
  let clock = 10;
  const timer = reasoningTimer(() => clock, 500);
  timer({ part: part('reasoning-delta') });
  clock = 60;
  expect(timer({ part: part('text-start') })).toEqual({ reasoningMs: 550 });
});

it('excludes smoothing delays from reasoning time', async () => {
  let clock = 0;
  const timing = reasoningTiming(0, () => clock);
  const end = part('text-start');
  const source = new ReadableStream<TextStreamPart<ToolSet>>({
    start(c) {
      c.enqueue({
        type: 'reasoning-delta',
        id: 'r',
        text: 'one two three ',
      } as TextStreamPart<ToolSet>);
      c.enqueue(end);
      c.close();
    },
  });
  const smoothed = source.pipeThrough(timing.transform()).pipeThrough(
    smoothStream({
      delayInMs: 10,
      _internal: {
        delay: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          clock += 100;
        },
      },
    })({ tools: {} }),
  );
  await smoothed.pipeTo(new WritableStream({ write() {} }));
  expect(clock).toBeGreaterThan(0);
  expect(timing.messageMetadata({ part: end })).toEqual({ reasoningMs: 0 });
});

it('streams CJK words before the text ends', async () => {
  const source = new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>();
  const writer = source.writable.getWriter();
  const reader = source.readable
    .pipeThrough(
      smoothStream({
        delayInMs: null,
        chunking: new Intl.Segmenter(undefined, { granularity: 'word' }),
      })({ tools: {} }),
    )
    .getReader();
  await writer.write({
    type: 'text-delta',
    id: 't',
    text: '你好世界今天',
  } as TextStreamPart<ToolSet>);
  const next = await reader.read();
  expect(next.value).toMatchObject({ type: 'text-delta', text: '你好' });
  await reader.cancel();
});
