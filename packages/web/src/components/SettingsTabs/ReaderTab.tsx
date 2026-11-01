import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  MAX_PENCIL_WPM,
  MAX_READER_SIZE,
  MIN_PENCIL_WPM,
  MIN_READER_SIZE,
  PENCIL_WPM_STEP,
  READ_ALOUD_SPEEDS,
  useHighlightPrefs,
  usePencilPrefs,
  useReadAloudPrefs,
  useReaderType,
} from '../../lib/readerPrefs';
import { useReaderWidth } from '../../lib/useReaderWidth';
import { Segmented } from '../reader/dock/Segmented';
import { Stepper } from '../reader/dock/Stepper';
import { fonts, leadings, StepGlyph, themes, widths } from '../reader/dock/TypeSheet';
import { ColorDots } from '../reader/highlights/ColorDots';
import { ENGINES, type EngineId, type Voice } from '../reader/listen/engines';
import { fetchTtsManifest } from '../reader/listen/engines/manifest';
import { manifestVoices } from '../reader/listen/engines/voices';
import { voiceGroups } from '../reader/listen/voiceGroups';
import { pencilStyles } from '../reader/pencil/PencilSheet';
import { ReaderIcon } from '../reader/ReaderIcon';
import { ReaderVoices } from './ReaderVoices';
import { rowDesc, rowLabel, settingsRowDivided } from './rowStyles';
import { SettingsSelect } from './SettingsSelect';

/** A row: label and description left, the control right. `labelId` names a radio group. */
function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div style={settingsRowDivided}>
      <div style={{ flex: 1 }}>
        <div id={labelId} style={rowLabel}>
          {label}
        </div>
        <div style={rowDesc}>{desc}</div>
      </div>
      {children(labelId)}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <h3 className="silo-plugin-section-label">{title}</h3>;
}

function TypeRows() {
  const { type, update } = useReaderType();
  const [width, setWidth] = useReaderWidth();
  return (
    <>
      <Row label="Font" desc="The typeface for article text.">
        {(labelId) => (
          <Segmented
            labelId={labelId}
            value={type.font}
            options={fonts}
            onChange={(font) => update({ font })}
          />
        )}
      </Row>
      <Row label="Size" desc="Text size in the reader.">
        {() => (
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
        )}
      </Row>
      <Row label="Line height" desc="Space between lines.">
        {(labelId) => (
          <Segmented
            labelId={labelId}
            value={type.leading}
            options={leadings}
            onChange={(leading) => update({ leading })}
          />
        )}
      </Row>
      <Row label="Width" desc="How wide the text column is.">
        {(labelId) => (
          <Segmented labelId={labelId} value={width} options={widths} onChange={setWidth} />
        )}
      </Row>
      <Row label="Reading theme" desc="Paper tone for articles.">
        {(labelId) => (
          <Segmented
            labelId={labelId}
            value={type.theme}
            options={themes}
            onChange={(theme) => update({ theme })}
          />
        )}
      </Row>
    </>
  );
}

function PencilRows() {
  const { prefs, update } = usePencilPrefs();
  return (
    <>
      <Row label="Style" desc="How the reading guide looks.">
        {(labelId) => (
          <Segmented
            labelId={labelId}
            value={prefs.style}
            options={pencilStyles}
            onChange={(style) => update({ style })}
          />
        )}
      </Row>
      <Row label="Speed" desc="How fast the guide moves.">
        {() => (
          <Stepper
            label="Pencil speed"
            value={prefs.wpm}
            min={MIN_PENCIL_WPM}
            max={MAX_PENCIL_WPM}
            step={PENCIL_WPM_STEP}
            valueText={`${prefs.wpm} words per minute`}
            display={
              <>
                {prefs.wpm}
                <small> wpm</small>
              </>
            }
            lessGlyph={<ReaderIcon name="minus" size={14} />}
            moreGlyph={<ReaderIcon name="plus" size={14} />}
            onChange={(wpm) => update({ wpm })}
          />
        )}
      </Row>
    </>
  );
}

function HighlightRows() {
  const { color, setColor } = useHighlightPrefs();
  return (
    <Row label="Default colour" desc="The colour new highlights start with.">
      {() => <ColorDots value={color} onPick={setColor} label="Default highlight colour" />}
    </Row>
  );
}

/** The engine's voices, from the manifest, so they can be chosen before the model loads. */
function useEngineVoices(engine: EngineId): Voice[] | null {
  const [voices, setVoices] = useState<{ engine: EngineId; list: Voice[] } | null>(null);
  useEffect(() => {
    let current = true;
    fetchTtsManifest()
      .then((manifest) => manifestVoices(manifest, engine))
      .catch(() => [])
      .then((list) => {
        if (current) setVoices({ engine, list });
      });
    return () => {
      current = false;
    };
  }, [engine]);
  return voices?.engine === engine ? voices.list : null;
}

function ReadAloudRows() {
  const { prefs, update } = useReadAloudPrefs();
  const voices = useEngineVoices(prefs.engine);
  const engineName = ENGINES.find((engine) => engine.id === prefs.engine)?.label ?? '';
  const speedAt = Math.max(
    0,
    READ_ALOUD_SPEEDS.findIndex((speed) => speed === prefs.rate),
  );
  return (
    <>
      <Row label="Engine" desc="The voice model that reads articles.">
        {() => (
          <SettingsSelect
            ariaLabel="Voice engine"
            value={prefs.engine}
            floating
            groups={[
              {
                options: ENGINES.map((engine) => ({
                  value: engine.id,
                  label: engine.label,
                  hint: engine.trait,
                })),
              },
            ]}
            onChange={(engine) => update({ engine })}
          />
        )}
      </Row>
      <Row label="Voice" desc={`Used with ${engineName}.`}>
        {() => (
          <SettingsSelect
            ariaLabel="Voice"
            value={prefs.voices[prefs.engine]}
            floating
            loading={voices === null}
            groups={voiceGroups(voices ?? [])}
            onChange={(voice) => update({ voice: [prefs.engine, voice] })}
          />
        )}
      </Row>
      <Row label="Speed" desc="How fast articles are read.">
        {() => (
          <Stepper
            label="Reading speed"
            value={speedAt}
            min={0}
            max={READ_ALOUD_SPEEDS.length - 1}
            valueText={`${prefs.rate} times`}
            display={`${prefs.rate}x`}
            lessGlyph={<ReaderIcon name="minus" size={14} />}
            moreGlyph={<ReaderIcon name="plus" size={14} />}
            onChange={(at) => {
              const rate = READ_ALOUD_SPEEDS[at];
              if (rate !== undefined) update({ rate });
            }}
          />
        )}
      </Row>
    </>
  );
}

/**
 * Settings → Reader: the same reader preferences the dock edits, in one place, plus the voice
 * downloads. Both read and write one store, so a change here shows in an open article at once
 * and the other way round.
 */
export function ReaderTab() {
  return (
    <>
      <Section title="Type" />
      <TypeRows />
      <Section title="Pencil" />
      <PencilRows />
      <Section title="Highlights" />
      <HighlightRows />
      <Section title="Read aloud" />
      <ReadAloudRows />
      <Section title="Voices" />
      <ReaderVoices />
    </>
  );
}
