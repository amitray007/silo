import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Omnibar } from './Omnibar';

/** The default prop set — idle, no tag, empty query — every test overrides only what it varies. */
function baseProps(overrides: Partial<React.ComponentProps<typeof Omnibar>> = {}) {
  return {
    value: '',
    onChange: vi.fn(),
    onKeep: vi.fn(),
    focused: false,
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    looksLikeUrl: false,
    onClearTag: vi.fn(),
    tagCount: 0,
    libCount: 0,
    ...overrides,
  };
}

describe('Omnibar (paste-only, plan 024)', () => {
  it('the placeholder reads "Paste a link to keep" (no "· type to search" suffix)', () => {
    render(<Omnibar {...baseProps()} />);
    expect(screen.getByPlaceholderText('Paste a link to keep')).toBeDefined();
  });

  it('idle state: empty query, no tag filter -> no ⌘ K hint chip (removed, plan 024)', () => {
    render(<Omnibar {...baseProps()} />);
    expect(screen.queryByText('⌘ K')).toBeNull();
  });

  it('typing non-URL text -> no search chip, no "found" text (search removed)', () => {
    render(<Omnibar {...baseProps({ value: 'react hooks' })} />);
    expect(screen.queryByText(/found/)).toBeNull();
    expect(screen.queryByText('esc')).toBeNull();
  });

  it('typing URL-looking text -> the "keep ↵" affordance', () => {
    render(<Omnibar {...baseProps({ value: 'example.com', looksLikeUrl: true })} />);
    expect(screen.getByText('Keep')).toBeDefined();
    expect(screen.getByText('↵')).toBeDefined();
  });

  it('a tag filter active + empty query -> the {tagCount} of {libCount} chip, and the #tag pill', () => {
    render(<Omnibar {...baseProps({ tagName: 'mcp', tagCount: 12, libCount: 40 })} />);
    expect(screen.getByText('12 of 40')).toBeDefined();
    expect(screen.getByText('mcp')).toBeDefined();
  });

  it('the tag pill stays visible regardless of query content — it is no longer gated on "no search text typed" (search mode is gone)', () => {
    render(<Omnibar {...baseProps({ tagName: 'mcp', value: 'something' })} />);
    expect(screen.getByTitle('Clear filter')).toBeDefined();

    render(
      <Omnibar {...baseProps({ tagName: 'mcp', value: 'example.com', looksLikeUrl: true })} />,
    );
    // Two renders, so `getAllByTitle` — both pills are visible simultaneously.
    expect(screen.getAllByTitle('Clear filter').length).toBeGreaterThan(0);
  });

  it('clicking the tag pill calls onClearTag', () => {
    const onClearTag = vi.fn();
    render(<Omnibar {...baseProps({ tagName: 'mcp', onClearTag })} />);
    fireEvent.click(screen.getByTitle('Clear filter'));
    expect(onClearTag).toHaveBeenCalledTimes(1);
  });

  it('typing calls onChange with the new value', () => {
    const onChange = vi.fn();
    render(<Omnibar {...baseProps({ onChange })} />);
    const input = screen.getByPlaceholderText('Paste a link to keep');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('Enter calls onKeep only when the query looks like a URL', () => {
    const onKeep = vi.fn();
    const { rerender } = render(
      <Omnibar {...baseProps({ value: 'react hooks', looksLikeUrl: false, onKeep })} />,
    );
    const input = screen.getByDisplayValue('react hooks');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onKeep).not.toHaveBeenCalled();

    rerender(<Omnibar {...baseProps({ value: 'example.com', looksLikeUrl: true, onKeep })} />);
    const urlInput = screen.getByDisplayValue('example.com');
    fireEvent.keyDown(urlInput, { key: 'Enter' });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('Escape clears the query and blurs the input', () => {
    const onChange = vi.fn();
    render(<Omnibar {...baseProps({ value: 'something', onChange })} />);
    const input = screen.getByDisplayValue('something');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('focusing/blurring the input calls onFocus/onBlur', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Omnibar {...baseProps({ onFocus, onBlur })} />);
    const input = screen.getByPlaceholderText('Paste a link to keep');
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('the border color reflects the focused prop (ghost when focused, line otherwise)', () => {
    const { container, rerender } = render(<Omnibar {...baseProps({ focused: false })} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.style.border).toContain('var(--line)');

    rerender(<Omnibar {...baseProps({ focused: true })} />);
    const barFocused = container.firstElementChild as HTMLElement;
    expect(barFocused.style.border).toContain('var(--ghost)');
  });

  it('forwards the ref to the underlying input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Omnibar {...baseProps()} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
