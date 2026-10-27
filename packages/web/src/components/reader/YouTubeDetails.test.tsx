import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { embedFor } from './embedFor';
import { seekChapter, YouTubeStats } from './YouTubeDetails';

describe('YouTube Reader details', () => {
  it('shows channel, views, duration and date', () => {
    render(
      <YouTubeStats
        source={{
          kind: 'youtube',
          channel: 'Channel',
          thumbnailUrl: 'https://img.test/thumbnail',
          views: 1234567,
          duration: 3723,
          publishedAt: '2026-01-02T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByText('Channel · 1,234,567 views · 1:02:03 · 2026-01-02')).toBeDefined();
  });
  it('seeks only its own video and leaves other URLs and modified clicks alone', () => {
    const embed = embedFor('https://www.youtube.com/watch?v=abcdefghijk', { kind: 'link' });
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: native anchors dispatch click on keyboard activation.
      <article onClick={(event) => seekChapter(event, embed)}>
        <iframe title="player" data-provider="youtube" />
        <a href="https://www.youtube.com/watch?v=abcdefghijk&t=3723s">1:02:03</a>
        <a href="https://www.youtube.com/watch?v=lmnopqrstuv&t=1s">Other video</a>
      </article>,
    );
    const frame = screen.getByTitle<HTMLIFrameElement>('player');
    if (!frame.contentWindow) throw new Error('Missing frame window');
    const post = vi.spyOn(frame.contentWindow, 'postMessage');
    fireEvent.click(screen.getByText('1:02:03'));
    expect(post).toHaveBeenCalledWith(
      '{"event":"command","func":"seekTo","args":[3723,true]}',
      'https://www.youtube-nocookie.com',
    );
    fireEvent.click(screen.getByText('Other video'));
    fireEvent.click(screen.getByText('1:02:03'), { ctrlKey: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
