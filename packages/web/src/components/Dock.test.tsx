import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dock } from './Dock';

describe('Dock', () => {
  it('positions itself absolute (relative to `.silo-content`, the content panel), never fixed to the viewport (regression test — a `position: fixed` dock centers over the whole viewport, straddling the sidebar/content boundary; see Dock.tsx doc comment)', () => {
    render(<Dock>content</Dock>);
    const dock = screen.getByText('content') as HTMLElement;
    expect(dock.style.position).toBe('absolute');
  });

  it('centers itself horizontally within its positioned ancestor via left:0/right:0/auto margins, not viewport-relative offsets', () => {
    render(<Dock>content</Dock>);
    const dock = screen.getByText('content') as HTMLElement;
    expect(parseFloat(dock.style.left)).toBe(0);
    expect(parseFloat(dock.style.right)).toBe(0);
    expect(dock.style.margin).toBe('0px auto');
  });
});
