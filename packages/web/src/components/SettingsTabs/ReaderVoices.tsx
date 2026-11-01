import type { CSSProperties } from 'react';
import { useKokoroDtype, useTtsManifest } from '../../api/hooks';
import { ENGINES } from '../reader/listen/engines';
import {
  KOKORO_WEBGPU_DTYPE,
  type KokoroDtype,
  requiredBytes,
} from '../reader/listen/engines/files';
import type { EngineId } from '../reader/listen/engines/types';
import { Spinner } from '../reader/listen/Spinner';
import { megabytes } from '../reader/listen/voiceGroups';
import {
  cancelVoiceModel,
  downloadVoiceModel,
  removeVoiceModel,
  useVoiceModel,
  type VoiceModelState,
} from '../reader/listen/voiceModels';
import { rowDesc, rowLabel, settingsRowDivided } from './rowStyles';

const GOOD_FOR: Record<EngineId, string> = {
  phonon: 'Fast, streams as it speaks',
  kokoro: 'More voices, native speed control',
};

type Size = { bytes: number; dtype: KokoroDtype };

/** The download size for this browser: Kokoro is bigger on WebGPU (fp32) than on the CPU (q8). */
function useDownloadSize(id: EngineId, variant: VoiceModelState['variant']): Size | null {
  const { data: manifest } = useTtsManifest();
  const { data: preferred } = useKokoroDtype();
  const dtype = variant && variant !== 'phonon' ? variant : preferred;
  return manifest && dtype ? { bytes: requiredBytes(manifest, id, dtype), dtype } : null;
}

function details(id: EngineId, size: Size | null): string {
  const parts = ['English'];
  if (size && size.bytes > 0) {
    const where =
      id === 'kokoro' ? (size.dtype === KOKORO_WEBGPU_DTYPE ? ' on WebGPU' : ' on the CPU') : '';
    parts.push(`${megabytes(size.bytes)} MB${where}`);
  }
  parts.push(GOOD_FOR[id]);
  return parts.join(' · ');
}

function statusText(state: VoiceModelState): string {
  switch (state.phase) {
    case 'checking':
      return 'Checking...';
    case 'absent':
      return state.loaded ? 'Loaded in the open article, not stored' : 'Not downloaded';
    case 'downloading':
      return `Downloading${state.progress === null ? '' : ` ${state.progress}%`}${
        state.by === 'reader' ? ' for the open article' : ''
      }`;
    case 'finishing':
      return 'Finishing…';
    case 'downloaded': {
      const variant = state.variant && state.variant !== 'phonon' ? ` (${state.variant})` : '';
      return `Downloaded${variant}${state.loaded ? ', loaded in the open article' : ''}`;
    }
    case 'error':
      return state.failedAction === 'remove'
        ? `Couldn't remove: ${state.error}`
        : `Download failed: ${state.error}`;
  }
}

const statusLine: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 6,
  fontSize: 'var(--text-sm)',
  color: 'var(--mut)',
  fontVariantNumeric: 'tabular-nums',
};

function Actions({ id, state }: { id: EngineId; state: VoiceModelState }) {
  const name = ENGINES.find((engine) => engine.id === id)?.label ?? id;
  if (state.phase === 'downloading') {
    return state.by === 'settings' ? (
      <button
        type="button"
        className="silo-settings-btn"
        aria-label={`Cancel ${name} download`}
        onClick={() => cancelVoiceModel(id)}
      >
        Cancel
      </button>
    ) : null;
  }
  if (state.phase === 'downloaded') {
    return (
      <button
        type="button"
        className="silo-settings-btn"
        aria-label={`Remove ${name}`}
        onClick={() => void removeVoiceModel(id)}
      >
        Remove
      </button>
    );
  }
  if (state.phase === 'finishing')
    return (
      <button type="button" className="silo-settings-btn" disabled>
        Finishing…
      </button>
    );
  if (state.phase === 'checking') return null;
  return (
    <button
      type="button"
      className="silo-settings-btn"
      aria-label={`${state.phase === 'error' ? 'Retry' : 'Download'} ${name}`}
      onClick={() =>
        void (state.failedAction === 'remove' ? removeVoiceModel(id) : downloadVoiceModel(id))
      }
    >
      {state.phase === 'error' ? 'Retry' : 'Download'}
    </button>
  );
}

function VoiceRow({ id, label }: { id: EngineId; label: string }) {
  const state = useVoiceModel(id);
  const size = useDownloadSize(id, state.variant);
  const downloading = state.phase === 'downloading';
  return (
    <div style={settingsRowDivided} data-voice-engine={id}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={rowLabel}>{label}</div>
        <div style={rowDesc}>{details(id, size)}</div>
        <div style={statusLine} role="status">
          {downloading && <Spinner size={14} />}
          <span>{statusText(state)}</span>
        </div>
        {downloading && (
          <div className="silo-listen-progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${state.progress ?? 0}%` }} />
          </div>
        )}
      </div>
      <Actions id={id} state={state} />
    </div>
  );
}

/** One row per engine: what it is, whether this browser holds its files, and the actions. */
export function ReaderVoices() {
  return ENGINES.map((engine) => <VoiceRow key={engine.id} id={engine.id} label={engine.label} />);
}
