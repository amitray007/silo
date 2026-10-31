import { READ_ALOUD_SPEEDS } from '../../../lib/readerPrefs';
import { SettingsSelect, type SettingsSelectGroup } from '../../SettingsTabs/SettingsSelect';
import { Stepper } from '../dock/Stepper';
import { ReaderIcon } from '../ReaderIcon';
import type { EngineId } from './engines';
import { Spinner, useDelayed } from './Spinner';
import type { ReadAloudApi } from './useReadAloud';

const LOCALES: Record<string, string> = {
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  en: 'English',
};

function localeName(code: string): string {
  return LOCALES[code.toLowerCase()] ?? code;
}

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(bytes > 10 * 1_048_576 ? 0 : 1);
}

/** The voice list: a default, then the engine's voices grouped by locale in engine order. */
function voiceGroups(voices: ReadAloudApi['voices']): SettingsSelectGroup<string>[] {
  const byLocale = new Map<string, SettingsSelectGroup<string>['options']>();
  for (const voice of voices) {
    const name = localeName(voice.language);
    const options = byLocale.get(name) ?? [];
    options.push({
      value: voice.id,
      label: voice.label,
      ...(voice.trait ? { hint: voice.trait } : {}),
      triggerHint: voice.language.toUpperCase(),
    });
    byLocale.set(name, options);
  }
  return [
    { options: [{ value: '', label: 'Default voice' }] },
    ...[...byLocale].map(([label, options]) => ({ label, options })),
  ];
}

/** "Downloading voice - 42%" with the bytes and a slim bar, or the failure with Retry. */
function DownloadState({ listen }: { listen: ReadAloudApi }) {
  const show = useDelayed(listen.status === 'loading');
  if (listen.status === 'error') {
    return (
      <p className="silo-listen-status" role="status">
        Voice failed: {listen.error}
        <button type="button" onClick={listen.retry}>
          Retry
        </button>
      </p>
    );
  }
  if (!show) return null;
  const { loaded, total } = listen.bytes;
  return (
    <div className="silo-listen-download" role="status">
      <div className="silo-listen-download-line">
        <Spinner size={14} />
        <span>Downloading voice{listen.progress === null ? '' : ` · ${listen.progress}%`}</span>
        {total > 0 && (
          <small>
            {megabytes(loaded)} / {megabytes(total)} MB
          </small>
        )}
      </div>
      <div className="silo-listen-progress">
        <div style={{ width: `${listen.progress ?? 0}%` }} />
      </div>
    </div>
  );
}

/** Controls only: engine, voice, speed, and the state of the voice download. */
export function ListenSheet({ listen }: { listen: ReadAloudApi }) {
  const device = listen.stats.device;
  const detail = device
    ? `On ${device}, loaded in ${listen.stats.loadMs} ms${
        listen.stats.firstAudioMs ? `, first audio ${listen.stats.firstAudioMs} ms` : ''
      }`
    : 'Loads when you press play';
  const slow = listen.engineId === 'kokoro' && device === 'wasm';
  const speedAt = Math.max(
    0,
    READ_ALOUD_SPEEDS.findIndex((speed) => speed === listen.rate),
  );
  return (
    <div className="silo-type-sheet-body silo-listen-sheet">
      <DownloadState listen={listen} />
      <div className="silo-reader-settings-row">
        <span>Engine</span>
        <span title={detail}>
          <SettingsSelect
            ariaLabel="Voice engine"
            value={listen.engineId}
            floating
            groups={[
              {
                options: listen.engines.map((engine) => ({
                  value: engine.id,
                  label: engine.label,
                  ...(engine.id === 'kokoro' && slow ? { triggerHint: 'slower here' } : {}),
                })),
              },
            ]}
            onChange={(value) => listen.setEngine(value as EngineId)}
          />
        </span>
      </div>
      <div className="silo-reader-settings-row">
        <span>Voice</span>
        <SettingsSelect
          ariaLabel="Voice"
          value={listen.voiceId}
          floating
          loading={listen.voices.length === 0 && listen.status !== 'error'}
          groups={voiceGroups(listen.voices)}
          onChange={listen.setVoice}
        />
      </div>
      <div className="silo-reader-settings-row">
        <span>Speed</span>
        <Stepper
          label="Speed"
          value={speedAt}
          min={0}
          max={READ_ALOUD_SPEEDS.length - 1}
          valueText={`${listen.rate} times`}
          display={`${listen.rate}x`}
          lessTitle="Slower (-)"
          moreTitle="Faster (+)"
          lessGlyph={<ReaderIcon name="minus" size={14} />}
          moreGlyph={<ReaderIcon name="plus" size={14} />}
          onChange={(at) => {
            const speed = READ_ALOUD_SPEEDS[at];
            if (speed !== undefined) listen.setRate(speed);
          }}
        />
      </div>
    </div>
  );
}
