import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { embedFor } from './embedFor';
import { ReaderPlayer } from './ReaderPlayer';

const tweet = {
  provider: 'twitter',
  src: 'https://platform.twitter.com/embed/Tweet.html?id=1886192184808149383&theme=dark',
  title: 'X post',
  aspect: 'auto',
  height: 250,
  video: false,
} as const;

describe('Reader player', () => {
  it('resizes only from its own Twitter frame and resets when the source changes', () => {
    const { rerender } = render(<ReaderPlayer embed={tweet} />);
    const frame = screen.getByTitle<HTMLIFrameElement>('X post');
    const send = (
      data: unknown,
      origin = 'https://platform.twitter.com',
      source = frame.contentWindow,
    ) => act(() => window.dispatchEvent(new MessageEvent('message', { data, origin, source })));
    const payload = {
      'twttr.embed': { method: 'twttr.private.resize', params: [{ height: 345 }] },
    };
    expect(frame.style.height).toBe('250px');
    send(payload, 'https://attacker.test');
    send(payload, undefined, window);
    send({ 'twttr.embed': { method: 'twttr.private.initialized', params: [{ height: 900 }] } });
    expect(frame.style.height).toBe('250px');
    send(payload);
    expect(frame.style.height).toBe('345px');
    for (const height of [-1, 0, '600', Number.NaN, Number.POSITIVE_INFINITY, 10_001])
      send({ type: 'resize', height });
    expect(frame.style.height).toBe('345px');
    send({ type: 'resize', height: 210 });
    expect(frame.style.height).toBe('210px');
    rerender(<ReaderPlayer embed={{ ...tweet, src: `${tweet.src}&lang=en` }} />);
    expect(frame.style.height).toBe('250px');
  });

  it('keeps Spotify track height at 152px', () => {
    const embed = embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', {
      kind: 'link',
    });
    if (!embed) throw new Error('Expected Spotify embed');
    render(<ReaderPlayer embed={embed} />);
    expect(screen.getByTitle('Spotify player').style.height).toBe('152px');
  });
});
