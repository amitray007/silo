import { type CSSProperties, useEffect, useState } from 'react';
import { ENGINES } from '../reader/listen/engines';
import {
  KOKORO_WEBGPU_DTYPE,
  type KokoroDtype,
  kokoroDtype,
  requiredBytes,
} from '../reader/listen/engines/files';
import { fetchTtsManifest } from '../reader/listen/engines/manifest';
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
function useDownloadSize(id: EngineId): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([fetchTtsManifest(), kokoroDtype()])
      .then(([manifest, dtype]) => {
        if (current) setSize({ bytes: requiredBytes(manifest, id, dtype), dtype });
      })
      // No size is shown when silo cannot be reached; the row still works.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [id]);
  return size;
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
    case 'downloaded':
      return state.loaded ? 'Downloaded, loaded in the open article' : 'Downloaded';
    case 'error':
      return `Download failed: ${state.error}`;
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
  if (state.phase === 'checking') return null;
  return (
    <button
      type="button"
      className="silo-settings-btn"
      aria-label={`${state.phase === 'error' ? 'Retry' : 'Download'} ${name}`}
      onClick={() => void downloadVoiceModel(id)}
    >
      {state.phase === 'error' ? 'Retry' : 'Download'}
    </button>
  );
}

function VoiceRow({ id, label }: { id: EngineId; label: string }) {
  const state = useVoiceModel(id);
  const size = useDownloadSize(id);
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
