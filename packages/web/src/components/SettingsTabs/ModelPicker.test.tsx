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

function setup(
  options: {
    providers?: AiProviderJson[];
    selected?: boolean;
    value?: { provider: AiProviderJson['kind']; id: string };
  } = {},
) {
  const onChange = vi.fn();
  render(
    <ModelPicker
      label="Title model"
      providers={options.providers ?? providers}
      value={
        options.value ?? (options.selected ? { provider: 'anthropic', id: 'claude-new' } : null)
      }
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
  it('shows the model label and provider in the trigger and tracks the expanded state', () => {
    render(
      <ModelPicker
        label="Title model"
        providers={[provider('fireworks', [model('deepseek', 'DeepSeek V4.1 Flash')])]}
        value={{ provider: 'fireworks', id: 'deepseek' }}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Title model' });
    expect(within(trigger).getByText('DeepSeek V4.1 Flash')).toBeTruthy();
    expect(within(trigger).getByText('· Fireworks')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    press(screen.getByRole('combobox'), 'Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the selected label visible and cannot open while AI is not ready', () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        label="Title model"
        providers={providers}
        value={{ provider: 'anthropic', id: 'claude-new' }}
        disabled
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Title model' });
    expect(trigger).toHaveProperty('disabled', true);
    expect(within(trigger).getByText('Claude newest')).toBeTruthy();
    expect(within(trigger).getByText('· Anthropic')).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('matches only Sonnet models for son and sorts each provider by relevance then date', () => {
    const { input } = setup({
      providers: [
        provider('anthropic', [
          model('opus-4.5', 'Claude Opus 4.5'),
          model('claude-sonnet-old', 'Claude Sonnet 4', { createdAt: '2025-01-01' }),
          model('claude-sonnet-new', 'Claude Sonnet 4.5', { createdAt: '2026-01-01' }),
          model('sonnet', 'Sonnet', { createdAt: '2024-01-01' }),
        ]),
        provider('fireworks', [
          model('nemotron', 'NVIDIA Nemotron 3 Ultra NVFP4'),
          model('gpt-oss-120b', 'OpenAI gpt-oss-120b'),
          model('deepseek', 'DeepSeek V4.1 Flash'),
          model('glm-5p3-flash', 'GLM 5.3 Flash'),
          model('sonnet-fireworks', 'Claude Sonnet', { createdAt: '2026-10-01' }),
        ]),
      ],
    });
    search(input, 'SON');
    expect(
      screen
        .getAllByRole('option')
        .map((row) => row.querySelector('.silo-model-option-label')?.textContent),
    ).toEqual(['Sonnet', 'Claude Sonnet 4.5', 'Claude Sonnet 4', 'Claude Sonnet']);
  });

  it('ranks label prefixes, word prefixes, label substrings, then id or owner matches', () => {
    const { input } = setup({
      providers: [
        provider('fireworks', [
          model('son-id', 'Id match', { createdAt: '2026-01-01' }),
          model('owner', 'Owner match', { owner: 'son', createdAt: '2025-01-01' }),
          model('person', 'Person', { createdAt: '2027-01-01' }),
          model('word', 'Claude Sonnet', { createdAt: '2027-01-01' }),
          model('prefix', 'Sonnet', { createdAt: '2024-01-01' }),
        ]),
      ],
    });
    search(input, 'son');
    expect(
      screen
        .getAllByRole('option')
        .map((row) => row.querySelector('.silo-model-option-label')?.textContent),
    ).toEqual(['Sonnet', 'Claude Sonnet', 'Person', 'Id match', 'Owner match']);
  });

  it('requires every whitespace-separated token and supports id-only queries', () => {
    const { input } = setup({
      providers: [
        provider('fireworks', [
          model('gpt-oss-120b', 'OpenAI gpt-oss-120b'),
          model('gpt-6', 'OpenAI GPT 6'),
          model('glm-5p3-flash', 'GLM 5.3 Flash'),
        ]),
      ],
    });
    search(input, '  GPT\t oss  ');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('gpt-oss-120b');
    search(input, 'glm-5p3');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('GLM 5.3 Flash');
    search(input, 'gpt missing');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it.each(['Claude', 'claude', 'newest', 'no-such-model', ''])(
    'resets scroll and the active item when the query changes to %j',
    async (query) => {
      const { input, onChange } = setup({ value: { provider: 'gateway', id: 'vendor/r1' } });
      const list = screen.getByRole('listbox');
      search(input, 'CLAUDE');
      press(input, 'End');
      list.scrollTop = 300;
      search(input, query);
      await waitFor(() => {
        expect(list.scrollTop).toBe(0);
        const first = screen.queryAllByRole('option')[0];
        if (first) {
          expect(first.getAttribute('aria-selected')).toBe('true');
        } else {
          expect(list.querySelector('[aria-selected="true"]')).toBeNull();
        }
      });
      press(input, 'Enter');
      if (query === 'no-such-model') {
        expect(onChange).not.toHaveBeenCalled();
      } else {
        expect(onChange).toHaveBeenCalledExactlyOnceWith({
          provider: 'anthropic',
          id: 'claude-new',
        });
      }
    },
  );

  it.each([
    [1_000_000, '1M'],
    [1_048_576, '1M'],
    [2_000_000, '2M'],
    [1_500_000, '1.5M'],
    [262_144, '262K'],
    [200_000, '200K'],
    [131_072, '131K'],
    [8_192, '8K'],
  ])('formats a %i-token context window as %s', (tokens, expected) => {
    setup({
      providers: [
        provider('anthropic', [model('context', 'Context model', { contextWindow: tokens })]),
      ],
    });
    expect(screen.getByRole('option').querySelector('.silo-model-context')?.textContent).toBe(
      expected,
    );
  });

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
    expect(screen.getByRole('button', { name: 'Fireworks 0' })).toBeTruthy();
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
    expect(trigger.textContent).toContain('Claude newest · Anthropic');
    expect(trigger.querySelector('svg')).toBeTruthy();
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Claude newest200K✓claude-new',
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
    { providers: [provider('openai', [model('a', 'A')], { keyReadable: false })] },
  ])('shows the no-provider empty state', (options) => {
    setup(options);
    expect(screen.getByText('Add a key in Providers')).toBeTruthy();
    expect(screen.queryByText('No models match')).toBeNull();
  });

  it.each([[], undefined])(
    'keeps a keyed provider with models %j and explains how to load them',
    (models) => {
      const keyed = provider('openai', []);
      if (!models) delete keyed.models;
      const { input } = setup({ providers: [keyed] });
      expect(screen.getByRole('button', { name: 'OpenAI 0' })).toBeTruthy();
      expect(screen.getByText('No models loaded yet - use Refresh on a provider')).toBeTruthy();
      expect(screen.queryByText('Add a key in Providers')).toBeNull();
      search(input, 'anything');
      expect(screen.getByText('No models match')).toBeTruthy();
      search(input, '');
      expect(screen.getByText('No models loaded yet - use Refresh on a provider')).toBeTruthy();
    },
  );

  it('warns about a missing choice in the trigger and list header, and allows a replacement', () => {
    const { trigger, onChange } = setup({ value: { provider: 'fireworks', id: 'removed-model' } });
    const warning = 'removed-model - no longer available';
    expect(trigger.querySelector('.silo-model-missing')?.textContent).toBe(warning);
    expect(trigger.getAttribute('aria-description')).toBe(warning);
    const dialog = screen.getByRole('dialog', { name: 'Title model' });
    expect(within(dialog).getByText(warning).className).toContain('silo-model-missing');
    expect(screen.queryByText('✓')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Luna/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'openai', id: 'gpt-private-id' });
  });

  it.each([1280, 390])(
    'opens with a below-fold choice active and scrolled into view at %ipx',
    async (width) => {
      const originalWidth = window.innerWidth;
      window.innerWidth = width;
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
      try {
        const { input, trigger, onChange } = setup({
          providers: [
            provider(
              'anthropic',
              Array.from({ length: 30 }, (_, i) => model(`claude-${i}`, `Claude ${i}`)),
            ),
            provider('fireworks', [model('current', 'Current Fireworks')]),
          ],
          value: { provider: 'fireworks', id: 'current' },
        });
        const current = screen.getByRole('option', { name: /Current Fireworks/ });
        await waitFor(() => {
          expect(current.getAttribute('aria-selected')).toBe('true');
          expect(scroll.mock.contexts).toContain(current);
        });
        expect(document.activeElement).toBe(input);
        press(input, 'Escape');
        scroll.mockClear();
        fireEvent.click(trigger);
        await waitFor(() =>
          expect(scroll.mock.contexts).toContain(
            screen.getByRole('option', { name: /Current Fireworks/ }),
          ),
        );
        press(screen.getByRole('combobox'), 'Enter');
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ provider: 'fireworks', id: 'current' });
      } finally {
        scroll.mockRestore();
        window.innerWidth = originalWidth;
      }
    },
  );

  it.each([true, false])('keeps the positioning stable while filtering (above: %s)', (above) => {
    const top = above ? window.innerHeight - 100 : 100;
    const rect = vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom: top + 40,
      left: 400,
      right: 680,
      width: 280,
      height: 40,
      x: 400,
      y: top,
      toJSON: () => ({}),
    });
    try {
      const { input } = setup();
      const dialog = screen.getByRole('dialog', { name: 'Title model' });
      expect(dialog.style.getPropertyValue('--model-top')).toBe(above ? 'auto' : '144px');
      expect(dialog.style.getPropertyValue('--model-bottom')).toBe(above ? '104px' : 'auto');
      expect(dialog.style.getPropertyValue('--model-fixed-height')).toBe(
        above ? 'min(400px, var(--model-height))' : 'auto',
      );
      const position = dialog.getAttribute('style');
      search(input, 'Luna');
      expect(dialog.getAttribute('style')).toBe(position);
      search(input, 'no-such-model');
      expect(dialog.getAttribute('style')).toBe(position);
    } finally {
      rect.mockRestore();
    }
  });

  it.each([
    { top: 220, triggerWidth: 280, panelWidth: 580, width: 380, height: 348, above: false },
    { top: 540, triggerWidth: 400, panelWidth: 580, width: 400, height: 328, above: true },
    { top: 540, triggerWidth: 480, panelWidth: 580, width: 420, height: 328, above: true },
    { top: 540, triggerWidth: 280, panelWidth: 360, width: 344, height: 328, above: true },
    { top: 380, triggerWidth: 280, panelWidth: 580, width: 380, height: 188, above: false },
  ])(
    'fits the visible Settings pane: %j',
    ({ top, triggerWidth, panelWidth, width, height, above }) => {
      const box = (left: number, top: number, width: number, height: number) =>
        new DOMRect(left, top, width, height);
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('silo-settings-panel')
            ? box(300, 200, panelWidth, 420)
            : box(300 + panelWidth - 28 - triggerWidth, top, triggerWidth, 40);
        });
      try {
        render(
          <ModalShell width={780} ariaLabel="Settings" onClose={vi.fn()} variant="settings">
            <div className="silo-settings-panel">
              <ModelPicker
                label="Title model"
                providers={providers}
                value={null}
                onChange={vi.fn()}
              />
            </div>
          </ModalShell>,
        );
        const trigger = screen.getByRole('button', { name: 'Title model' });
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Title model' });
        expect(dialog.style.getPropertyValue('--model-width')).toBe(`${width}px`);
        expect(dialog.style.getPropertyValue('--model-left')).toBe(
          `${Math.max(308, 300 + panelWidth - 28 - width)}px`,
        );
        expect(dialog.style.getPropertyValue('--model-height')).toBe(`${height}px`);
        expect(dialog.style.getPropertyValue('--model-top')).toBe(above ? 'auto' : `${top + 44}px`);
        expect(dialog.style.getPropertyValue('--model-bottom')).toBe(
          above ? `${window.innerHeight - top + 4}px` : 'auto',
        );
        // The content pane shrinks while the picker remains open.
        rect.mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('silo-settings-panel')
            ? box(300, 300, panelWidth, 120)
            : box(500, 348, triggerWidth, 40);
        });
        fireEvent.resize(window);
        expect(dialog.style.getPropertyValue('--model-height')).toBe('36px');
        // Even an anchor scrolled out of view stays inside the pane's inset edges.
        rect.mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('silo-settings-panel')
            ? box(300, 200, panelWidth, 420)
            : box(500, 700, triggerWidth, 40);
        });
        fireEvent.scroll(screen.getByRole('dialog', { name: 'Settings' }));
        expect(dialog.style.getPropertyValue('--model-top')).toBe('auto');
        expect(dialog.style.getPropertyValue('--model-bottom')).toBe(
          `${window.innerHeight - 612}px`,
        );
      } finally {
        rect.mockRestore();
      }
    },
  );

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

  it('wraps Tab from the last chip to search and Shift+Tab back to the last chip', () => {
    const { input, onChange } = setup();
    const dialog = screen.getByRole('dialog', { name: 'Title model' });
    // jsdom has no layout; expose the visible controls to the real dialog trap.
    for (const control of dialog.querySelectorAll('button, input')) {
      Object.defineProperty(control, 'offsetParent', { get: () => dialog });
    }
    const last = screen.getByRole('button', { name: 'Fireworks 0' });
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
    // Interior controls keep the browser's normal Tab default.
    const all = screen.getByRole('button', { name: 'All' });
    all.focus();
    expect(fireEvent.keyDown(all, { key: 'Tab' })).toBe(true);
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
