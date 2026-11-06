import { useChatAppearance } from '../../lib/chatAppearance';
import { SegmentedRow } from '../reader/dock/Segmented';
import { Stepper } from '../reader/dock/Stepper';
import { ReaderIcon } from '../reader/ReaderIcon';

export function ChatAppearanceSettings() {
  const { prefs, update, reset } = useChatAppearance();
  return (
    <section className="silo-chat-settings" aria-label="Chat appearance">
      <h3 className="silo-plugin-section-label">Chat appearance</h3>
      <p className="silo-reader-settings-helper">Applies to every chat on this device.</p>
      <SegmentedRow
        label="Width"
        value={prefs.width}
        options={[
          { value: 'narrow', label: 'Narrow' },
          { value: 'standard', label: 'Standard' },
          { value: 'wide', label: 'Wide' },
        ]}
        onChange={(width) => update({ width })}
      />
      <div className="silo-reader-settings-row">
        <span>Text size</span>
        <Stepper
          label="Chat text size"
          value={prefs.size}
          min={14}
          max={22}
          valueText={`${prefs.size} pixels`}
          display={`${prefs.size}px`}
          lessGlyph={<ReaderIcon name="minus" size={14} />}
          moreGlyph={<ReaderIcon name="plus" size={14} />}
          onChange={(size) => update({ size })}
        />
      </div>
      <SegmentedRow
        label="Font"
        value={prefs.font}
        options={[
          { value: 'inter', label: 'Inter' },
          { value: 'serif', label: 'Literata' },
          { value: 'mono', label: 'Mono' },
        ]}
        onChange={(font) => update({ font })}
      />
      <SegmentedRow
        label="Weight"
        value={prefs.weight}
        options={[
          { value: 'regular', label: 'Regular' },
          { value: 'medium', label: 'Medium' },
        ]}
        onChange={(weight) => update({ weight })}
      />
      <button type="button" className="silo-settings-btn" onClick={reset}>
        Reset chat appearance
      </button>
    </section>
  );
}
