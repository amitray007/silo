import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

let paused = true;
beforeEach(() => {
  paused = true;
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(35);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function show() {
  const view = render(<VideoPlayer src="/clip.mp4" poster="/poster.jpg" label="Video" />);
  const video = view.container.querySelector('video') as HTMLVideoElement;
  return { ...view, video };
}

describe('VideoPlayer', () => {
  it('starts from the poster button, then shows the control bar', () => {
    const { video } = show();
    expect(video.getAttribute('poster')).toBe('/poster.jpg');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    act(() => video.dispatchEvent(new Event('durationchange')));
    expect(screen.getByText('0:35')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
  });

  it('seeks, mutes, changes speed and reacts to keys', () => {
    const { video, container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '12' } });
    expect(video.currentTime).toBe(12);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1x' }));
    expect(video.playbackRate).toBe(1.5);
    const figure = container.querySelector('figure') as HTMLElement;
    fireEvent.keyDown(figure, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(17);
    fireEvent.keyDown(figure, { key: 'k' });
    expect(video.pause).toHaveBeenCalled();
  });

  it('leaves Space to a focused control button and toggles playback from the player itself', () => {
    const { container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const figure = container.querySelector('figure') as HTMLElement;
    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Mute' }), { key: ' ' })).toBe(
      true,
    );
    expect(pause).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(figure, { key: ' ' })).toBe(false);
    expect(pause).toHaveBeenCalledOnce();
  });

  it('shows a spinner while buffering and a retry when loading fails', () => {
    const { video, container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    act(() => video.dispatchEvent(new Event('waiting')));
    expect(container.querySelector('.silo-player-spinner')).not.toBeNull();
    act(() => video.dispatchEvent(new Event('playing')));
    expect(container.querySelector('.silo-player-spinner')).toBeNull();
    act(() => video.dispatchEvent(new Event('error')));
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load this video.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(video.load).toHaveBeenCalled();
  });

  it('sets, remembers and nudges the volume', () => {
    localStorage.removeItem('silo.playerVolume');
    const { video, container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    const level = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(level, { target: { value: '0.4' } });
    expect(video.volume).toBe(0.4);
    expect(localStorage.getItem('silo.playerVolume')).toBe('0.4');
    const figure = container.querySelector('figure') as HTMLElement;
    fireEvent.keyDown(figure, { key: 'ArrowUp' });
    expect(video.volume).toBe(0.5);
    fireEvent.change(level, { target: { value: '0' } });
    expect(video.muted).toBe(true);
    // Browsers fire volumechange here; jsdom does not.
    act(() => video.dispatchEvent(new Event('volumechange')));
    // Unmuting from zero restores a usable level instead of silence.
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.5);
    localStorage.removeItem('silo.playerVolume');
  });

  it('starts at the remembered volume', () => {
    localStorage.setItem('silo.playerVolume', '0.3');
    const { video } = show();
    expect(video.volume).toBe(0.3);
    localStorage.removeItem('silo.playerVolume');
  });
});
