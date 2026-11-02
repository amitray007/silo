import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from '../ModalShell';
import { SettingsSelect } from './SettingsSelect';

const groups = [
  {
    label: 'First provider',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
  },
  { label: 'Empty provider', options: [] },
  {
    label: 'Last provider',
    options: [
      { value: 'c', label: 'Gamma' },
      { value: 'd', label: 'Delta' },
    ],
  },
];

function press(key: string) {
  fireEvent.keyDown(document.activeElement as HTMLElement, { key });
}

function expectActive(name: string) {
  const option = screen.getByRole('option', { name });
  expect(document.activeElement).toBe(option);
  expect(option.tabIndex).toBe(0);
  expect(screen.getAllByRole('option').filter((item) => item.tabIndex === 0)).toEqual([option]);
}

function select(onChange = vi.fn()) {
  return <SettingsSelect ariaLabel="Model" value="b" groups={groups} onChange={onChange} />;
}

describe('SettingsSelect', () => {
  it('focuses the selection on open and moves across groups without changing the value', () => {
    const onChange = vi.fn();
    render(select(onChange));
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expectActive('Beta');
    expect(screen.queryByRole('img')).toBeNull();
    press('ArrowDown');
    expectActive('Gamma');
    press('ArrowUp');
    expectActive('Beta');
    press('ArrowUp');
    expectActive('Alpha');
    press('ArrowUp');
    expectActive('Alpha');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
  });

  it('moves to the first and last option with Home and End', () => {
    render(select());
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    press('End');
    expectActive('Delta');
    press('ArrowDown');
    expectActive('Delta');
    press('Home');
    expectActive('Alpha');
  });

  it.each(['ArrowUp', 'ArrowDown', 'Home', 'End'])('opens from the trigger with %s', (key) => {
    render(select());
    screen.getByRole('button', { name: 'Model' }).focus();
    press(key);
    expectActive(key === 'Home' ? 'Alpha' : key === 'End' ? 'Delta' : 'Beta');
  });

  it.each(['Enter', ' '])('selects with %s and returns focus to the trigger', (key) => {
    const onChange = vi.fn();
    render(select(onChange));
    const trigger = screen.getByRole('button', { name: 'Model' });
    fireEvent.click(trigger);
    press('ArrowDown');
    press(key);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the trigger after a pointer selection', () => {
    const onChange = vi.fn();
    render(select(onChange));
    const trigger = screen.getByRole('button', { name: 'Model' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Delta' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('d');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('uses one Escape per layer and restores trigger focus without closing Settings', () => {
    const onClose = vi.fn();
    function Settings() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ModalShell
          width={400}
          ariaLabel="Settings"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          {select()}
        </ModalShell>
      ) : null;
    }
    render(<Settings />);
    const trigger = screen.getByRole('button', { name: 'Model' });
    fireEvent.click(trigger);
    press('ArrowDown');
    press('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives a modal opened above a dropdown Escape priority', () => {
    function Settings() {
      const [inner, setInner] = useState(false);
      return (
        <>
          <ModalShell width={400} ariaLabel="Settings" onClose={() => {}}>
            {select()}
            <button type="button" onClick={() => setInner(true)}>
              Open confirmation
            </button>
          </ModalShell>
          {inner && (
            <ModalShell width={300} ariaLabel="Confirmation" onClose={() => setInner(false)}>
              Confirm
            </ModalShell>
          )}
        </>
      );
    }
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    press('Escape');
    expect(screen.queryByRole('dialog', { name: 'Confirmation' })).toBeNull();
    expect(screen.getByRole('listbox')).toBeDefined();
    press('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
  });

  describe('floating', () => {
    const voices = [
      {
        label: 'English (US)',
        options: [
          { value: 'z', label: 'Zoey', hint: 'female', triggerHint: 'EN-US' },
          { value: 'e', label: 'Easton', hint: 'male', triggerHint: 'EN-US' },
        ],
      },
      { label: 'English (UK)', options: [{ value: 'm', label: 'Maeve', hint: 'female' }] },
    ];

    function floating(extra: { loading?: boolean } = {}) {
      return (
        <SettingsSelect
          ariaLabel="Voice"
          value="z"
          groups={voices}
          floating
          onChange={() => {}}
          {...extra}
        />
      );
    }

    it('draws the menu in the page body, fixed, with hints beside the names', () => {
      const { container } = render(floating());
      expect(screen.getByRole('button', { name: 'Voice' }).textContent).toContain('EN-US');
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      const list = screen.getByRole('listbox', { name: 'Voice' });
      expect(container.contains(list)).toBe(false);
      expect(list.parentElement).toBe(document.body);
      expect(list.hasAttribute('data-reader-menu')).toBe(true);
      expect(screen.getByRole('option', { name: /Zoey/ }).textContent).toContain('female');
    });

    it('jumps to the option that starts with the typed letters', () => {
      render(floating());
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      press('m');
      expectActive('Maeve female');
      press('a');
      expectActive('Maeve female');
    });

    it('starts from the next option for a repeated first letter', () => {
      render(floating());
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      press('e');
      expectActive('Easton male');
    });

    it('does not pick on a space while the reader is typing', () => {
      const onChange = vi.fn();
      render(
        <SettingsSelect ariaLabel="Voice" value="z" groups={voices} floating onChange={onChange} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      press('e');
      press(' ');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('marks the list busy and shows skeleton rows while options load', () => {
      render(floating({ loading: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      const list = screen.getByRole('listbox', { name: 'Voice' });
      expect(list.getAttribute('aria-busy')).toBe('true');
      expect(list.querySelectorAll('.silo-settings-select-skeleton > *')).toHaveLength(5);
    });

    it('closes on Escape and on a press outside, but not on a press inside', () => {
      render(floating());
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      fireEvent.pointerDown(screen.getByRole('listbox', { name: 'Voice' }));
      expect(screen.queryByRole('listbox')).not.toBeNull();
      press('Escape');
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
});
