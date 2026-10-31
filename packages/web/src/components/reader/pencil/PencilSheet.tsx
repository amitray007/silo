import {
  MAX_PENCIL_WPM,
  MIN_PENCIL_WPM,
  PENCIL_WPM_STEP,
  type PencilStyle,
} from '../../../lib/readerPrefs';
import { SegmentedRow } from '../dock/Segmented';
import { Stepper } from '../dock/Stepper';
import { ReaderIcon } from '../ReaderIcon';
import type { PencilApi } from './usePencil';

const styles: { value: PencilStyle; label: string }[] = [
  { value: 'underline', label: 'Underline' },
  { value: 'highlighter', label: 'Highlighter' },
];

/** Controls only: play or pause, the pace, how far along the article, and the guide's style. */
export function PencilSheet({ pencil }: { pencil: PencilApi }) {
  return (
    <div className="silo-type-sheet-body">
      <div className="silo-pencil-transport">
        <button
          type="button"
          className="silo-pencil-play"
          aria-label={pencil.playing ? 'Pause pencil' : 'Start pencil'}
          title={pencil.playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={pencil.togglePlay}
        >
          <ReaderIcon name={pencil.playing ? 'pause' : 'play'} size={16} />
        </button>
        <Stepper
          label="Speed"
          value={pencil.wpm}
          min={MIN_PENCIL_WPM}
          max={MAX_PENCIL_WPM}
          step={PENCIL_WPM_STEP}
          valueText={`${pencil.wpm} words per minute`}
          display={
            <>
              {pencil.wpm}
              <small> wpm</small>
            </>
          }
          lessTitle="Slower (-)"
          moreTitle="Faster (+)"
          lessGlyph={<ReaderIcon name="minus" size={14} />}
          moreGlyph={<ReaderIcon name="plus" size={14} />}
          onChange={pencil.setWpm}
        />
        <div
          className="silo-pencil-progress"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuenow={pencil.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${pencil.progress}%` }} />
        </div>
        <output className="silo-pencil-percent" aria-label="Progress">
          {pencil.progress}%
        </output>
      </div>
      <SegmentedRow
        label="Style"
        value={pencil.style}
        options={styles}
        onChange={pencil.setStyle}
      />
    </div>
  );
}
