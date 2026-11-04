import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { speakAnswer, spokenAnswer, stopAnswerSpeech, useAnswerSpeech } from './answerSpeech';
import { takeSpeech } from './speechFocus';
import { useVoiceModel } from './voiceModels';

const fake = vi.hoisted(() => ({
  loads: [] as string[],
  started: [] as string[],
  halted: 0,
}));

vi.mock('./voiceModels', () => ({ useVoiceModel: vi.fn() }));
vi.mock('./engines', () => ({
  createEngine: (id: string) => ({
    id,
    voices: () => [{ id: 'v1', label: 'One', language: 'en-us' }],
    load: async () => {
      fake.loads.push(id);
    },
    dispose: () => {},
  }),
}));
vi.mock('./player', () => ({
  Player: class {
    constructor(private deps: { segments: () => { text: string }[] }) {}
    start() {
      fake.started.push(
        this.deps
          .segments()
          .map((item) => item.text)
          .join(' '),
      );
    }
    halt() {
      fake.halted += 1;
    }
  },
}));

const prefs = { engine: 'phonon', rate: 1, pauses: 'relaxed', voice: 'v1' } as const;

beforeEach(() => {
  fake.loads.length = 0;
  fake.started.length = 0;
  fake.halted = 0;
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = async () => {};
      close = async () => {};
    },
  );
  vi.mocked(useVoiceModel).mockReturnValue({ phase: 'downloaded' } as ReturnType<
    typeof useVoiceModel
  >);
});
afterEach(() => {
  stopAnswerSpeech('a');
  stopAnswerSpeech('b');
  vi.unstubAllGlobals();
});

it('turns markdown into spoken sentences without links, markers or code', () => {
  const spoken = spokenAnswer(
    '## Summary\nSee [the post](https://x.test) for **more**. It is `short`.\n\n```js\nskip()\n```\n- First point\n- Second point',
  );
  expect(spoken.map((item) => item.text)).toEqual([
    'Summary.',
    'See the post for more.',
    'It is short.',
    'First point.',
    'Second point.',
  ]);
  expect(spoken[0]?.kind).toBe('heading');
  expect(spoken[3]?.block).not.toBe(spoken[4]?.block);
});

it('plays one answer at a time: a second answer stops the first', async () => {
  const { result: first } = renderHook(() => useAnswerSpeech('a', 'First answer here.'));
  const { result: second } = renderHook(() => useAnswerSpeech('b', 'Second answer here.'));
  await act(async () => first.current.toggle());
  expect(first.current.phase).toBe('playing');
  expect(fake.started).toEqual(['First answer here.']);
  await act(async () => second.current.toggle());
  expect(first.current.phase).toBe('idle');
  expect(second.current.phase).toBe('playing');
});

it('stops when the same button is pressed again and when the answer unmounts', async () => {
  const view = renderHook(() => useAnswerSpeech('a', 'First answer here.'));
  await act(async () => view.result.current.toggle());
  act(() => view.result.current.toggle());
  expect(view.result.current.phase).toBe('idle');
  await act(async () => view.result.current.toggle());
  const halted = fake.halted;
  view.unmount();
  expect(fake.halted).toBeGreaterThan(halted);
  const again = renderHook(() => useAnswerSpeech('a', 'First answer here.'));
  expect(again.result.current.phase).toBe('idle');
});

it('stops when another source of speech, such as the article, takes the speakers', async () => {
  const view = renderHook(() => useAnswerSpeech('a', 'First answer here.'));
  await act(async () => view.result.current.toggle());
  act(() => {
    takeSpeech(() => {});
  });
  expect(view.result.current.phase).toBe('idle');
});

it('is unavailable until the voice model is downloaded', () => {
  vi.mocked(useVoiceModel).mockReturnValue({ phase: 'absent' } as ReturnType<typeof useVoiceModel>);
  const view = renderHook(() => useAnswerSpeech('a', 'First answer here.'));
  expect(view.result.current.available).toBe(false);
});

it('speaks nothing for an answer with no sentences', async () => {
  await speakAnswer('a', '```js\nonly()\n```', prefs);
  expect(fake.started).toEqual([]);
});
