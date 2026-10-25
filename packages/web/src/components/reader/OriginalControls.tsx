import { ReaderIcon } from './ReaderIcon';
import type { OriginalState } from './useOriginal';

export function OriginalControls({ state }: { state: OriginalState }) {
  const label = { direct: 'Live site', view: 'Silo view', player: 'Player', card: 'Link card' }[
    state.mode
  ];
  return (
    <div className="silo-original-controls">
      <details className="silo-original-mode">
        <summary aria-label={`Original mode: ${label}`}>
          {label} <span aria-hidden="true">⌄</span>
        </summary>
        <div className="silo-original-mode-menu">
          {(['view', 'direct'] as const).map((mode) => {
            const enabled = mode === 'view' ? state.canView : state.canDirect;
            const reason =
              mode === 'view'
                ? 'A Silo view is unavailable for this content.'
                : 'This site blocks framing or uses a player.';
            return (
              <span key={mode} title={enabled ? undefined : reason}>
                <button
                  type="button"
                  disabled={!enabled || state.preparing}
                  aria-pressed={state.mode === mode}
                  onClick={(event) => {
                    state.switchMode(mode);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  {mode === 'view' ? 'Silo view' : 'Live site'}
                </button>
              </span>
            );
          })}
        </div>
      </details>
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="Refresh Original"
        title="Refresh Original"
        disabled={state.preparing}
        onClick={() => state.refresh.mutate()}
      >
        <ReaderIcon name="refresh" />
      </button>
      {state.refresh.isError && (
        <span role="alert" className="silo-reader-hint">
          Refresh failed
        </span>
      )}
    </div>
  );
}
