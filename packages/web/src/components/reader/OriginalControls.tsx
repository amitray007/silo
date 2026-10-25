import { useState } from 'react';
import type { LinkJson } from '../../api/types';
import { MenuAction, MenuSurface } from '../MenuSurface';
import { ReaderIcon } from './ReaderIcon';
import type { OriginalState } from './useOriginal';

export function OriginalControls({
  state,
  link,
}: {
  state: OriginalState;
  link?: LinkJson | undefined;
}) {
  const [open, setOpen] = useState(false);
  const label = { direct: 'Live site', view: 'Silo view', player: 'Player', card: 'Link card' }[
    state.mode
  ];
  return (
    <div className="silo-original-controls">
      <div className="silo-original-mode">
        <button
          type="button"
          className="silo-mode-trigger"
          aria-label={`Original mode: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {label} <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <MenuSurface
            className="silo-original-mode-menu"
            link={link}
            onClose={() => setOpen(false)}
          >
            {(['view', 'direct'] as const).map((mode) => (
              <MenuAction
                key={mode}
                title={
                  (mode === 'view' ? state.canView : state.canDirect)
                    ? undefined
                    : mode === 'view'
                      ? 'A Silo view is unavailable for this content.'
                      : 'This site blocks framing or uses a player.'
                }
                icon={<ReaderIcon name={mode === 'view' ? 'sidebar' : 'external'} />}
                disabled={!(mode === 'view' ? state.canView : state.canDirect) || state.preparing}
                pressed={state.mode === mode}
                onClick={() => {
                  state.switchMode(mode);
                  setOpen(false);
                }}
              >
                {mode === 'view' ? 'Silo view' : 'Live site'}
              </MenuAction>
            ))}
          </MenuSurface>
        )}
      </div>
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
