import { type ReactNode, useId } from 'react';
import { MenuPresence } from '../MenuPresence';
import { MenuSurface } from '../MenuSurface';
import { ToggleSwitch } from '../SettingsTabs/ToggleSwitch';
import { ReaderIcon } from './ReaderIcon';
import type { OriginalState } from './useOriginal';

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
  children,
  helper,
}: {
  label: string;
  children: ReactNode;
  helper?: string;
}) {
  return (
    <div>
      <div className="silo-reader-settings-row">
        <span>{label}</span>
        {children}
      </div>
      {helper && <p className="silo-reader-settings-helper">{helper}</p>}
    </div>
  );
}

export function ReaderSettings({
  original,
  open,
  setOpen,
}: {
  original: OriginalState;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const id = useId();
  if (original.theme !== 'dark' || !['direct', 'view'].includes(original.mode)) return null;
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
              <SettingsSection label="Live page">
                <SettingsRow label="Dark page" helper="Recolour this site to match silo.">
                  <ToggleSwitch
                    label="Dark page"
                    on={original.darkPage}
                    onToggle={original.toggleDarkPage}
                  />
                </SettingsRow>
              </SettingsSection>
            </div>
          </MenuSurface>
        )}
      </MenuPresence>
    </div>
  );
}
