import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const SPEEDS = [1, 1.5, 2] as const;
const IDLE_MS = 2200;
const SEEK_STEP = 5;

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

const paths = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
} as const;

function Icon({ name }: { name: keyof typeof paths }) {
  const solid = name === 'play' || name === 'pause';
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

type State = {
  playing: boolean;
  started: boolean;
  waiting: boolean;
  failed: boolean;
  time: number;
  duration: number;
  buffered: number;
  muted: boolean;
  speed: number;
  fullscreen: boolean;
  ratio: number;
};

const INITIAL: State = {
  playing: false,
  started: false,
  waiting: false,
  failed: false,
  time: 0,
  duration: 0,
  buffered: 0,
  muted: false,
  speed: 1,
  fullscreen: false,
  ratio: 16 / 9,
};

/** Mirror the media element's state; the element stays the single source of truth. */
function useMediaState(video: HTMLVideoElement | null) {
  const [state, setState] = useState<State>(INITIAL);
  useEffect(() => {
    if (!video) return;
    const sync = (patch: Partial<State> = {}) =>
      setState((current) => ({
        ...current,
        playing: !video.paused,
        time: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : current.duration,
        buffered: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
        muted: video.muted,
        speed: video.playbackRate,
        ...patch,
      }));
    const handlers: Record<string, () => void> = {
      play: () => sync({ started: true, failed: false }),
      pause: () => sync(),
      timeupdate: () => sync(),
      progress: () => sync(),
      durationchange: () => sync(),
      volumechange: () => sync(),
      ratechange: () => sync(),
      waiting: () => sync({ waiting: true }),
      seeking: () => sync({ waiting: true }),
      playing: () => sync({ waiting: false }),
      seeked: () => sync({ waiting: false }),
      canplay: () => sync({ waiting: false }),
      ended: () => sync({ waiting: false }),
      error: () => sync({ waiting: false, failed: true }),
      loadedmetadata: () =>
        sync({
          ratio:
            video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
        }),
    };
    for (const [event, handler] of Object.entries(handlers)) video.addEventListener(event, handler);
    const fullscreen = () =>
      sync({ fullscreen: document.fullscreenElement === video.parentElement });
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      for (const [event, handler] of Object.entries(handlers))
        video.removeEventListener(event, handler);
      document.removeEventListener('fullscreenchange', fullscreen);
    };
  }, [video]);
  return state;
}

/** Controls fade while playing and the pointer rests; any movement or focus brings them back. */
function useIdle(playing: boolean) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(timer.current);
    if (playing) timer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, [playing]);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(timer.current);
  }, [wake]);
  return { idle: playing && idle, wake };
}

/**
 * A quiet player for post video: poster with one play button until started,
 * a spinner while buffering, and a slim control bar with a buffered seek track.
 * Built on the native element, so range requests, captions-free playback and
 * picture-in-picture behave as the browser expects.
 */
export function VideoPlayer({
  src,
  poster,
  label,
}: {
  src: string;
  poster?: string | undefined;
  label: string;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const shell = useRef<HTMLElement>(null);
  const state = useMediaState(video);
  const { idle, wake } = useIdle(state.playing);

  const toggle = () => {
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  const seek = (time: number) => {
    if (video) video.currentTime = Math.min(Math.max(0, time), video.duration || 0);
  };
  const mute = () => {
    if (video) video.muted = !video.muted;
  };
  const cycleSpeed = () => {
    if (!video) return;
    const next = SPEEDS[(SPEEDS.indexOf(video.playbackRate as 1) + 1) % SPEEDS.length] ?? 1;
    video.playbackRate = next;
  };
  const fullscreen = () => {
    const element = shell.current;
    if (!element || !video) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element.requestFullscreen) void element.requestFullscreen();
    else
      (
        video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
      ).webkitEnterFullscreen?.();
  };
  const retry = () => {
    if (!video) return;
    video.load();
    void video.play().catch(() => {});
  };

  const keys: Record<string, () => void> = {
    ' ': toggle,
    k: toggle,
    ArrowLeft: () => seek((video?.currentTime ?? 0) - SEEK_STEP),
    ArrowRight: () => seek((video?.currentTime ?? 0) + SEEK_STEP),
    m: mute,
    f: fullscreen,
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    wake();
    action();
  };

  const progress = state.duration ? (state.time / state.duration) * 100 : 0;
  const buffered = state.duration ? (state.buffered / state.duration) * 100 : 0;
  return (
    <figure
      ref={shell}
      className="silo-player"
      aria-label={label}
      data-started={state.started}
      data-idle={idle}
      data-fullscreen={state.fullscreen}
      style={{ '--player-ratio': state.ratio } as CSSProperties}
      onPointerMove={wake}
      onFocusCapture={wake}
      onKeyDown={onKeyDown}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: X serves no caption tracks for post video. */}
      <video
        ref={setVideo}
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={toggle}
        onDoubleClick={fullscreen}
      />
      {!state.started && !state.failed && (
        <>
          <button
            type="button"
            className="silo-player-start"
            aria-label="Play video"
            onClick={toggle}
          >
            <Icon name="play" />
          </button>
          {state.duration > 0 && (
            <span className="silo-player-length">{clock(state.duration)}</span>
          )}
        </>
      )}
      {state.waiting && state.started && (
        <span className="silo-player-spinner" aria-hidden="true" />
      )}
      {state.failed && (
        <div className="silo-player-error" role="alert">
          <span>Couldn't load this video.</span>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {state.started && (
        <div className="silo-player-bar">
          <button
            type="button"
            className="silo-player-button"
            aria-label={state.playing ? 'Pause' : 'Play'}
            onClick={toggle}
          >
            <Icon name={state.playing ? 'pause' : 'play'} />
          </button>
          <span className="silo-player-time">
            {clock(state.time)} / {clock(state.duration)}
          </span>
          <input
            className="silo-player-seek"
            type="range"
            min={0}
            max={state.duration || 0}
            step={0.1}
            value={state.time}
            aria-label="Seek"
            aria-valuetext={`${clock(state.time)} of ${clock(state.duration)}`}
            style={{ '--progress': `${progress}%`, '--buffered': `${buffered}%` } as CSSProperties}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <button
            type="button"
            className="silo-player-speed"
            aria-label={`Playback speed ${state.speed}x`}
            onClick={cycleSpeed}
          >
            {state.speed}x
          </button>
          <button
            type="button"
            className="silo-player-button"
            aria-label={state.muted ? 'Unmute' : 'Mute'}
            onClick={mute}
          >
            <Icon name={state.muted ? 'muted' : 'sound'} />
          </button>
          <button
            type="button"
            className="silo-player-button"
            aria-label={state.fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={fullscreen}
          >
            <Icon name={state.fullscreen ? 'shrink' : 'expand'} />
          </button>
        </div>
      )}
    </figure>
  );
}
