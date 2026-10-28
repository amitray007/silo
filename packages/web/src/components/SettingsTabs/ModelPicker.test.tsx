import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AiProviderJson } from '../../api/types';
import { ModalShell } from '../ModalShell';
import { ModelPicker } from './ModelPicker';

type Model = NonNullable<AiProviderJson['models']>[number];
const model = (id: string, label: string, extra: Partial<Model> = {}): Model => ({
  id,
  label,
  structuredOutput: 'native',
  reasoning: { type: 'anthropic' },
  ...extra,
});
const provider = (
  kind: AiProviderJson['kind'],
  models: Model[],
  extra: Partial<AiProviderJson> = {},
): AiProviderJson => ({
  kind,
  models,
  configured: true,
  keyReadable: true,
  keyLast4: 'abcd',
  lastTest: null,
  ...extra,
});
const providers: [AiProviderJson, AiProviderJson, AiProviderJson, AiProviderJson] = [
  provider('anthropic', [
    model('claude-old', 'Claude older', { createdAt: '2025-01-01' }),
    model('claude-new', 'Claude newest', { createdAt: '2026-01-01', contextWindow: 200000 }),
  ]),
  provider('openai', [model('gpt-private-id', 'Luna')]),
  provider('gateway', [model('vendor/r1', 'Gateway reasoning', { owner: 'deepseek' })]),
  provider('fireworks', []),
];

function setup(options: { providers?: AiProviderJson[]; selected?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <ModelPicker
      label="Title model"
      providers={options.providers ?? providers}
      value={options.selected ? { provider: 'anthropic', id: 'claude-new' } : null}
      onChange={onChange}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Title model' });
  fireEvent.click(trigger);
  return { trigger, onChange, input: screen.getByRole('combobox', { name: 'Search models' }) };
}

function search(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}
function press(input: HTMLElement, key: string) {
  fireEvent.keyDown(input, { key });
}

describe('ModelPicker', () => {
  it('searches labels, ids and owners across all readable providers', () => {
    const { input } = setup();
    for (const [query, expected] of [
      ['Luna', 'Luna'],
      ['private-id', 'Luna'],
      ['deepseek', 'Gateway reasoning'],
      ['newest', 'Claude newest'],
    ] as const) {
      search(input, query);
      expect(screen.getAllByRole('option').length).toBeLessThan(4);
      expect(screen.getByRole('option', { name: new RegExp(expected) })).toBeTruthy();
    }
  });

  it('combines chips with search, keeps the chip during typing and resets with All', () => {
    const { input, trigger } = setup();
    const chip = screen.getByRole('button', { name: 'Anthropic 2' });
    expect(screen.queryByRole('button', { name: /Fireworks/ })).toBeNull();
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    search(input, 'gpt-private-id');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('No models match')).toBeTruthy();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('option').textContent).toContain('Luna');
    search(input, '');
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fireEvent.click(chip);
    press(input, 'Escape');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('sorts newest first, shows metadata and marks only the stored choice', () => {
    const { trigger, input } = setup({ selected: true });
    expect(trigger.textContent).toContain('Claude newestvia Anthropic');
    expect(trigger.querySelector('svg')).toBeTruthy();
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Claude newestclaude-new200K✓',
      'Claude olderclaude-old',
      'Lunagpt-private-id',
      'Gateway reasoningvendor/r1deepseek',
    ]);
    const tick = screen.getByText('✓');
    expect(tick.closest('[role="option"]')).toBe(rows[0]);
    press(input, 'ArrowDown');
    expect(screen.getByText('✓').closest('[role="option"]')).toBe(rows[0]);
  });

  it('hides unreadable keys and unconfigured providers even when they have models', () => {
    setup({
      providers: [
        providers[0],
        { ...providers[1], keyReadable: false },
        { ...providers[2], configured: false },
      ],
    });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /OpenAI/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gateway/ })).toBeNull();
  });

  it.each([
    { providers: [] },
    { providers: [provider('openai', [])] },
    { providers: [provider('openai', [model('a', 'A')], { keyReadable: false })] },
  ])('shows the no-provider empty state', (options) => {
    setup(options);
    expect(screen.getByText('Add a key in Providers')).toBeTruthy();
    expect(screen.queryByText('No models match')).toBeNull();
  });

  it('shows the no-match state and recovers when search clears', () => {
    const { input } = setup();
    search(input, 'zzzzzzzzzzzzzzzzzzzzzzzz');
    expect(screen.getByText('No models match')).toBeTruthy();
    search(input, '');
    expect(screen.queryByText('No models match')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('focuses search, moves with arrows and selects with Enter, restoring trigger focus', async () => {
    const { trigger, input, onChange } = setup();
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Claude newest/ }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    press(input, 'ArrowUp');
    press(input, 'Enter');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'anthropic', id: 'claude-old' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores trigger focus after the settings PATCH stops disabling it', async () => {
    function SavingPicker() {
      const [pending, setPending] = useState(false);
      return (
        <>
          <ModelPicker
            label="Title model"
            providers={providers}
            value={null}
            disabled={pending}
            onChange={() => {
              Promise.resolve().then(() => setPending(true));
            }}
          />
          <button type="button" onClick={() => setPending(false)}>
            Finish save
          </button>
        </>
      );
    }
    render(<SavingPicker />);
    const trigger = screen.getByRole('button', { name: 'Title model' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Luna/ }));
    await waitFor(() => expect(trigger).toHaveProperty('disabled', true));
    screen.getByRole('button', { name: 'Finish save' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Finish save' }));
    expect(trigger).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(trigger);
  });

  it('lets keyboard users reach and activate chips without selecting a model', () => {
    const { onChange } = setup();
    const chip = screen.getByRole('button', { name: 'OpenAI 1' });
    chip.focus();
    press(chip, 'Enter');
    // fireEvent does not synthesize the browser's Enter-to-click default.
    fireEvent.click(chip);
    expect(chip.tabIndex).toBe(0);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on outside pointer and restores focus on selection', () => {
    const { trigger, onChange } = setup();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Luna/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'openai', id: 'gpt-private-id' });
    expect(document.activeElement).toBe(trigger);
  });

  it('closes only the picker on Escape and leaves Settings open', () => {
    const onClose = vi.fn();
    function Settings() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ModalShell
          width={500}
          ariaLabel="Settings"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <ModelPicker label="Title model" providers={providers} value={null} onChange={vi.fn()} />
        </ModalShell>
      ) : null;
    }
    render(<Settings />);
    const trigger = screen.getByRole('button', { name: 'Title model' });
    press(trigger, 'ArrowDown');
    press(screen.getByRole('combobox'), 'Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    press(trigger, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['light', 'dark'])('uses the same neutral classes in the %s theme', (theme) => {
    document.documentElement.dataset.theme = theme;
    try {
      const { trigger } = setup();
      expect(trigger.classList.contains('silo-settings-select-trigger')).toBe(true);
      const dialog = screen.getByRole('dialog', { name: 'Title model' });
      expect(dialog.classList.contains('silo-model-picker-popover')).toBe(true);
      expect(dialog.querySelector('.silo-palette-input')).toBeTruthy();
      expect(
        within(dialog)
          .getAllByRole('option')
          .every((row) => row.classList.contains('silo-palette-row')),
      ).toBe(true);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('renders and searches 300 models without timing out', () => {
    const { input } = setup({
      providers: [
        provider(
          'gateway',
          Array.from({ length: 300 }, (_, index) =>
            model(`vendor/model-${index}`, `Model ${index}`),
          ),
        ),
      ],
    });
    expect(screen.getAllByRole('option')).toHaveLength(300);
    search(input, 'model-299');
    expect(screen.getAllByRole('option').length).toBeLessThan(300);
    expect(screen.getByRole('option', { name: /Model 299/ })).toBeTruthy();
  });
});
