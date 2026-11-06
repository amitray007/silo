import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatAppearanceDefaults, parseChatAppearance, useChatAppearance } from './chatAppearance';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('chat appearance', () => {
  it.each(['bad json', 'null', '[]', '42'])('uses defaults for damaged storage: %s', (raw) => {
    expect(parseChatAppearance(raw)).toEqual(chatAppearanceDefaults);
  });

  it('validates each field independently', () => {
    expect(
      parseChatAppearance(
        JSON.stringify({ width: 'wide', size: 23, font: 'serif', weight: 'bold' }),
      ),
    ).toEqual({ width: 'wide', size: 16, font: 'serif', weight: 'regular' });
    expect(parseChatAppearance('{"size":16.5,"font":"unknown"}')).toEqual(chatAppearanceDefaults);
  });

  it('shares updates, survives remount, resets, and leaves Reader settings alone', () => {
    localStorage.setItem('silo.readerType', '{"font":"serif","size":20}');
    const first = renderHook(useChatAppearance);
    const second = renderHook(useChatAppearance);
    act(() =>
      first.result.current.update({ width: 'wide', size: 20, font: 'mono', weight: 'medium' }),
    );
    expect(second.result.current.prefs).toEqual({
      width: 'wide',
      size: 20,
      font: 'mono',
      weight: 'medium',
    });
    expect(second.result.current.style).toMatchObject({
      '--chat-measure': '900px',
      '--chat-size': '1.25rem',
      '--chat-weight': 500,
    });
    first.unmount();
    const restored = renderHook(useChatAppearance);
    expect(restored.result.current.prefs).toEqual(second.result.current.prefs);
    act(() => restored.result.current.reset());
    expect(second.result.current.prefs).toEqual(chatAppearanceDefaults);
    expect(localStorage.getItem('silo.readerType')).toBe('{"font":"serif","size":20}');
  });

  it('reads a change from another tab', () => {
    const { result } = renderHook(useChatAppearance);
    act(() => {
      localStorage.setItem('silo.chatAppearance', '{"size":22,"width":"narrow"}');
      window.dispatchEvent(new StorageEvent('storage', { key: 'silo.chatAppearance' }));
    });
    expect(result.current.prefs.size).toBe(22);
    expect(result.current.prefs.width).toBe('narrow');
  });
});
