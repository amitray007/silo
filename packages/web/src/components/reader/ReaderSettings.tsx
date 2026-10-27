import { type ReactNode, useId } from 'react';
import { useReaderWidth } from '../../lib/useReaderWidth';
import { MenuPresence } from '../MenuPresence';
import { MenuSurface } from '../MenuSurface';
import { ToggleSwitch } from '../SettingsTabs/ToggleSwitch';
import { ReaderIcon } from './ReaderIcon';
import type { OriginalState } from './useOriginal';

const widths = ['narrow', 'medium', 'wide'] as const;

function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="silo-reader-settings-section" aria-label={label}>
      <h3>{label}</h3>
      {children}
    </section>
  );
}

function SettingsRow({
  label,
  labelId,
  children,
  helper,
}: {
  label: string;
  labelId?: string;
  children: ReactNode;
  helper?: string;
}) {
  return (
    <div>
      <div className="silo-reader-settings-row">
        <span id={labelId}>{label}</span>
        {children}
      </div>
      {helper && <p className="silo-reader-settings-helper">{helper}</p>}
    </div>
  );
}

function ReaderWidth() {
  const [width, setWidth] = useReaderWidth();
  const id = useId();
  return (
    <SettingsRow label="Width" labelId={id}>
      <div className="silo-reader-segment" role="radiogroup" aria-labelledby={id}>
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
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
              const next = (index + delta + widths.length) % widths.length;
              setWidth(widths[next] ?? 'medium');
              event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
            }}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
    </SettingsRow>
  );
}

export function ReaderSettings({
  original,
  open,
  setOpen,
}: {
  original: OriginalState | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const id = useId();
  if (original && (original.theme !== 'dark' || !['direct', 'view'].includes(original.mode)))
    return null;
  return (
    <div className="silo-reader-more">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="View settings"
        title="View settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <ReaderIcon name="sliders" />
      </button>
      <MenuPresence>
        {open && (
          <MenuSurface
            className="silo-reader-more-menu silo-reader-settings"
            role="dialog"
            label="View settings"
            sheet={false}
            onClose={() => setOpen(false)}
          >
            <div id={id}>
              {original ? (
                <SettingsSection label="Live page">
                  <SettingsRow label="Dark page" helper="Recolour this site to match silo.">
                    <ToggleSwitch
                      label="Dark page"
                      on={original.darkPage}
                      onToggle={original.toggleDarkPage}
                    />
                  </SettingsRow>
                </SettingsSection>
              ) : (
                <SettingsSection label="Reader">
                  <ReaderWidth />
                </SettingsSection>
              )}
            </div>
          </MenuSurface>
        )}
      </MenuPresence>
    </div>
  );
}
