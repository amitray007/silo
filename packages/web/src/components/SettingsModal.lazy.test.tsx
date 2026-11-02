import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SettingsModal } from './SettingsModal';

const plugin = vi.hoisted(() => {
  let resolve = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve, loaded: false };
});
vi.mock('./SettingsTabs/PluginsTab', async () => {
  plugin.loaded = true;
  await plugin.ready;
  return { PluginsTab: () => <button type="button">Loaded plugins</button> };
});

it('loads a settings tab only on opening and keeps the modal shell while suspended', async () => {
  function Harness() {
    const { open, openSettings } = useSettings();
    return (
      <>
        <button type="button" onClick={() => openSettings()}>
          Open settings
        </button>
        {open && <SettingsModal />}
      </>
    );
  }
  render(
    <MemoryRouter>
      <SettingsProvider>
        <Harness />
      </SettingsProvider>
    </MemoryRouter>,
  );
  expect(plugin.loaded).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(screen.getByRole('status').textContent).toBe('Loading settings…');
  const shell = screen.getByRole('dialog', { name: 'Settings' });
  const panel = screen.getByRole('tabpanel');
  expect(shell.classList.contains('silo-modal-panel-settings')).toBe(true);
  expect(panel.classList.contains('silo-settings-panel')).toBe(true);
  await act(async () => {
    plugin.resolve();
  });
  expect(await screen.findByRole('button', { name: 'Loaded plugins' })).toBeDefined();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(shell);
  expect(screen.getByRole('tabpanel')).toBe(panel);
});
