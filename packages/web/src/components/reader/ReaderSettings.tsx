import { useId, useState } from 'react';
import { useReaderWidth } from '../../lib/useReaderWidth';
import { MenuPresence } from '../MenuPresence';
import { MenuSurface } from '../MenuSurface';
import { ReaderIcon } from './ReaderIcon';

const widths = ['narrow', 'medium', 'wide'] as const;

export function ReaderSettings() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useReaderWidth();
  const id = useId();
  return (
    <div className="silo-reader-more">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="Reader settings"
        title="Reader settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <ReaderIcon name="textSize" />
      </button>
      <MenuPresence>
        {open && (
          <MenuSurface
            className="silo-reader-more-menu silo-reader-settings"
            role="dialog"
            label="Reader settings"
            sheet={false}
            onClose={() => setOpen(false)}
          >
            <div id={id}>
              <h3 id={`${id}-width`}>Width</h3>
              <div
                className="silo-reader-segment"
                role="radiogroup"
                aria-labelledby={`${id}-width`}
              >
                {widths.map((value, index) => (
                  // biome-ignore lint/a11y/useSemanticElements: segmented buttons implement the radio keyboard pattern.
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={width === value}
                    tabIndex={width === value ? 0 : -1}
                    onClick={() => setWidth(value)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      const delta =
                        event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
                      const next = (index + delta + widths.length) % widths.length;
                      setWidth(widths[next] ?? 'medium');
                      event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
                    }}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </MenuSurface>
        )}
      </MenuPresence>
    </div>
  );
}
