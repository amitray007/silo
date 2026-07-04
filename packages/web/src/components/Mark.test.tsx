import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Mark, type MarkKind } from './Mark';

describe('Mark', () => {
  it('renders ¶ in --markt for note', () => {
    render(<Mark kind="note" />);
    const el = screen.getByLabelText('has a note');
    expect(el.textContent).toBe('¶');
    expect(el.style.color).toBe('var(--markt)');
  });

  it('renders ◆ in --ghost (not amber) for claude — provenance, not status', () => {
    render(<Mark kind="claude" />);
    const el = screen.getByLabelText('added by Claude');
    expect(el.textContent).toBe('◆');
    expect(el.style.color).toBe('var(--ghost)');
  });

  it('renders ◌ in --markt with the pulse animation for enriching', () => {
    render(<Mark kind="enriching" />);
    const el = screen.getByLabelText('capturing…');
    expect(el.textContent).toBe('◌');
    expect(el.style.color).toBe('var(--markt)');
    expect(el.style.animation).toContain('siloPulse');
  });

  it('renders ◌ in --warn, static (no animation), for degraded', () => {
    render(<Mark kind="degraded" />);
    const el = screen.getByLabelText('capture incomplete');
    expect(el.textContent).toBe('◌');
    expect(el.style.color).toBe('var(--warn)');
    expect(el.style.animation).toBe('');
  });

  it('has no "full"/healthy kind — silence means complete', () => {
    const kinds: MarkKind[] = ['note', 'claude', 'enriching', 'degraded'];
    expect(kinds).not.toContain('full');
    expect(kinds).toHaveLength(4);
  });
});
