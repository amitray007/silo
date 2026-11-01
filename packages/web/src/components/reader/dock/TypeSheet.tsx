import {
  MAX_READER_SIZE,
  MIN_READER_SIZE,
  type ReaderFont,
  type ReaderLeading,
  type ReaderTheme,
  useReaderType,
} from '../../../lib/readerPrefs';
import { type ReaderWidth, useReaderWidth } from '../../../lib/useReaderWidth';
import { ReaderIcon } from '../ReaderIcon';
import { SegmentedRow } from './Segmented';
import { Stepper } from './Stepper';

export const fonts: { value: ReaderFont; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'serif', label: 'Literata' },
  { value: 'mono', label: 'Mono' },
];
export const leadings: { value: ReaderLeading; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
];
export const widths: { value: ReaderWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];
export const themes: { value: ReaderTheme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'sepia', label: 'Sepia' },
];

/** A small or large "A" beside a minus or plus: the stepper makes the text smaller or larger. */
export function StepGlyph({ size, name }: { size: 'small' | 'large'; name: 'minus' | 'plus' }) {
  return (
    <>
      <span className="silo-stepper-a" data-size={size} aria-hidden="true">
        A
      </span>
      <ReaderIcon name={name} size={12} />
    </>
  );
}

/** Controls only: each change applies to the article at once and persists on this device. */
export function TypeSheet() {
  const { type, update } = useReaderType();
  const [width, setWidth] = useReaderWidth();
  return (
    <div className="silo-type-sheet-body">
      <SegmentedRow
        label="Font"
        value={type.font}
        options={fonts}
        onChange={(font) => update({ font })}
      />
      <div className="silo-reader-settings-row">
        <span>Size</span>
        <Stepper
          label="Size"
          value={type.size}
          min={MIN_READER_SIZE}
          max={MAX_READER_SIZE}
          valueText={`${type.size} pixels`}
          display={`${type.size}px`}
          lessGlyph={<StepGlyph size="small" name="minus" />}
          moreGlyph={<StepGlyph size="large" name="plus" />}
          onChange={(size) => update({ size })}
        />
      </div>
      <SegmentedRow
        label="Line height"
        value={type.leading}
        options={leadings}
        onChange={(leading) => update({ leading })}
      />
      <SegmentedRow label="Width" value={width} options={widths} onChange={setWidth} />
      <SegmentedRow
        label="Theme"
        value={type.theme}
        options={themes}
        onChange={(theme) => update({ theme })}
      />
    </div>
  );
}
