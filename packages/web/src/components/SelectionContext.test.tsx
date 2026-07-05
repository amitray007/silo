import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectionProvider, useLibrarySelection, useTrashSelection } from './SelectionContext';

function wrapper({ children }: { children: ReactNode }) {
  return <SelectionProvider>{children}</SelectionProvider>;
}

describe('SelectionContext', () => {
  it('toggle adds then removes an id', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.selected).toEqual(['a']);

    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.selected).toEqual([]);
  });

  it('selectAll replaces the whole selection', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.toggle('x'));
    act(() => result.current.selectAll(['a', 'b', 'c']));
    expect(new Set(result.current.selected)).toEqual(new Set(['a', 'b', 'c']));
    expect(result.current.isSelected('x')).toBe(false);
  });

  it('clear empties the selection', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.selectAll(['a', 'b']));
    act(() => result.current.clear());
    expect(result.current.selected).toEqual([]);
  });

  it('deselect removes exactly the given ids, leaving the rest selected', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.selectAll(['a', 'b', 'c']));
    act(() => result.current.deselect(['b']));
    expect(new Set(result.current.selected)).toEqual(new Set(['a', 'c']));
  });

  it('deselect is a no-op (and preserves the array) for ids not currently selected', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.selectAll(['a']));
    const before = result.current.selected;
    act(() => result.current.deselect(['not-selected']));
    // Same contents, and referential identity is preserved (no needless churn).
    expect(result.current.selected).toBe(before);
  });

  it('deselect([]) is a no-op', () => {
    const { result } = renderHook(() => useLibrarySelection(), { wrapper });

    act(() => result.current.selectAll(['a']));
    act(() => result.current.deselect([]));
    expect(result.current.selected).toEqual(['a']);
  });

  it('the library and trash scopes are independent — mutating one never affects the other', () => {
    const { result } = renderHook(
      () => ({ library: useLibrarySelection(), trash: useTrashSelection() }),
      { wrapper },
    );

    act(() => result.current.library.toggle('lib-1'));
    act(() => result.current.trash.selectAll(['tr-1', 'tr-2']));

    expect(result.current.library.selected).toEqual(['lib-1']);
    expect(new Set(result.current.trash.selected)).toEqual(new Set(['tr-1', 'tr-2']));

    act(() => result.current.library.clear());
    // Clearing library leaves trash untouched.
    expect(result.current.library.selected).toEqual([]);
    expect(new Set(result.current.trash.selected)).toEqual(new Set(['tr-1', 'tr-2']));
  });
});
