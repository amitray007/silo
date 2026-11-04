import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderJson } from '../../../api/types';
import { RegenerateMenu } from './RegenerateMenu';

const hooks = vi.hoisted(() => ({ providers: [] as AiProviderJson[] }));
vi.mock('../../../api/hooks', () => ({
  useAi: () => ({ data: { providers: hooks.providers } }),
  useSettings: () => ({
    data: {
      ai: {
        features: { librarian: { enabled: true, model: { provider: 'openai', id: 'gpt-mini' } } },
      },
    },
  }),
}));

const model = (id: string, label: string) => ({
  id,
  label,
  structuredOutput: 'native' as const,
  reasoning: { type: 'anthropic' as const },
});
const provider = (
  kind: AiProviderJson['kind'],
  extra: Partial<AiProviderJson>,
): AiProviderJson => ({
  kind,
  models: [],
  configured: true,
  keyReadable: true,
  keyLast4: 'abcd',
  lastTest: null,
  ...extra,
});

beforeEach(() => {
  hooks.providers = [
    provider('anthropic', { models: [model('claude-x', 'Claude X')] }),
    provider('openai', { models: [model('gpt-mini', 'GPT Mini'), model('gpt-big', 'GPT Big')] }),
    provider('gateway', { keyReadable: false }),
    provider('fireworks', { configured: false, models: [model('fw', 'Fireworks One')] }),
  ];
});

function open(answerModel?: { provider: 'anthropic'; id: string; label: string }) {
  const onRegenerate = vi.fn();
  render(<RegenerateMenu answerModel={answerModel} onRegenerate={onRegenerate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate answer' }));
  return { onRegenerate, dialog: screen.getByRole('dialog', { name: 'Regenerate answer' }) };
}

describe('RegenerateMenu', () => {
  it('lists keyed providers, names an unreadable key, and omits unconfigured providers', () => {
    const { dialog } = open();
    expect(within(dialog).getByText('Claude X')).toBeTruthy();
    expect(within(dialog).getByText('GPT Big')).toBeTruthy();
    expect(within(dialog).getByText('Vercel AI Gateway')).toBeTruthy();
    expect(within(dialog).getByText(/Key cannot be read/)).toBeTruthy();
    expect(within(dialog).queryByText('Fireworks One')).toBeNull();
    expect(within(dialog).queryByText('Fireworks')).toBeNull();
  });

  it('focuses the search field and filters models', () => {
    const { dialog } = open();
    const search = within(dialog).getByPlaceholderText('Regenerate with another model');
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'big' } });
    expect(within(dialog).getByText('GPT Big')).toBeTruthy();
    expect(within(dialog).queryByText('Claude X')).toBeNull();
    expect(within(dialog).queryByText(/Key cannot be read/)).toBeNull();
  });

  it('Try again repeats the answer model, named on the row', () => {
    const answer = { provider: 'anthropic' as const, id: 'claude-x', label: 'Claude X' };
    const { onRegenerate, dialog } = open(answer);
    expect(within(dialog).getAllByText('Claude X')).toHaveLength(2);
    fireEvent.click(within(dialog).getByText('Try again'));
    expect(onRegenerate).toHaveBeenCalledWith({ provider: 'anthropic', id: 'claude-x' });
  });

  it('Try again sends no model when the answer model is unknown', () => {
    const { onRegenerate, dialog } = open();
    fireEvent.click(within(dialog).getByText('Try again'));
    expect(onRegenerate).toHaveBeenCalledWith(undefined);
  });

  it('picking a model regenerates with it and closes', () => {
    const { onRegenerate, dialog } = open();
    fireEvent.click(within(dialog).getByText('GPT Big'));
    expect(onRegenerate).toHaveBeenCalledWith({ provider: 'openai', id: 'gpt-big' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks the answer model, and keeps the default in the footer', () => {
    const { dialog } = open({ provider: 'anthropic', id: 'claude-x', label: 'Claude X' });
    expect(dialog.querySelector('.silo-model-check[data-current]')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'Your default stays GPT Mini. Change it in Settings → AI.',
    );
  });

  it('closes on Escape and returns focus to the button', () => {
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Regenerate answer' }));
  });

  it('closes on a click outside', () => {
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
