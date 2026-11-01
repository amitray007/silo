import { READ_ALOUD_SPEEDS } from '../../../lib/readerPrefs';
import { ReaderIcon } from '../ReaderIcon';
import { Spinner, useDelayed } from './Spinner';
import type { ReadAloudApi } from './useReadAloud';

/** The one-line state shown beside the player controls instead of the sentence. */
function statusLine(listen: ReadAloudApi): string | null {
  if (listen.status === 'loading') {
    return listen.progress === null
      ? 'Downloading voice...'
      : `Downloading voice · ${listen.progress}%`;
  }
  if (listen.status === 'error') return `Voice failed: ${listen.error}`;
  return null;
}

/** Step to the next speed, and wrap to the slowest after the fastest. */
function nextSpeed(rate: number): number {
  const at = READ_ALOUD_SPEEDS.findIndex((speed) => speed === rate);
  return READ_ALOUD_SPEEDS[(at + 1) % READ_ALOUD_SPEEDS.length] ?? 1;
}

/** The dock while Listen is open: transport, the sentence being read, speed, sheet and close. */
export function ListenPlayer({
  listen,
  sheetOpen,
  onSheet,
  onClose,
}: {
  listen: ReadAloudApi;
  sheetOpen: boolean;
  onSheet: () => void;
  onClose: () => void;
}) {
  const spin = useDelayed(listen.status === 'loading' || (listen.playing && listen.buffering));
  const line = statusLine(listen);
  return (
    <>
      <button
        type="button"
        className="silo-listen-step"
        aria-label="Previous sentence"
        title="Previous sentence (Left)"
        onClick={listen.prev}
      >
        <ReaderIcon name="prev" size={16} />
      </button>
      <button
        type="button"
        className="silo-listen-play"
        aria-label={listen.playing ? 'Pause' : 'Play'}
        title={listen.playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={listen.toggle}
      >
        {spin ? (
          <Spinner size={16} />
        ) : (
          <ReaderIcon name={listen.playing ? 'pause' : 'play'} size={16} />
        )}
      </button>
      <button
        type="button"
        className="silo-listen-step"
        aria-label="Next sentence"
        title="Next sentence (Right)"
        onClick={listen.next}
      >
        <ReaderIcon name="next" size={16} />
      </button>
      <span
        className="silo-listen-now"
        data-empty={!listen.current}
        data-state={listen.status === 'error' ? 'error' : undefined}
        role={listen.status === 'error' ? 'alert' : undefined}
      >
        {line ?? listen.current?.text ?? 'Ready'}
      </span>
      {listen.status === 'error' && (
        <button type="button" className="silo-listen-text" onClick={listen.retry}>
          Retry
        </button>
      )}
      <button
        type="button"
        className="silo-listen-text"
        aria-label={`Speed ${listen.rate}x`}
        title="Speed (+ / -)"
        onClick={() => listen.setRate(nextSpeed(listen.rate))}
      >
        {listen.rate}x
      </button>
      <button
        type="button"
        className="silo-listen-step"
        aria-label="Read aloud settings"
        title="Voice settings"
        aria-pressed={sheetOpen}
        onClick={onSheet}
      >
        <ReaderIcon name="list" size={16} />
      </button>
      <button
        type="button"
        className="silo-listen-step"
        aria-label="Stop reading aloud"
        title="Stop"
        onClick={onClose}
      >
        <ReaderIcon name="close" size={16} />
      </button>
    </>
  );
}
