import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, chipLetter } from './Chip';

describe('chipLetter', () => {
  it('derives the uppercased first letter of the hostname', () => {
    expect(chipLetter('modelcontextprotocol.io')).toBe('M');
    expect(chipLetter('tbray.org')).toBe('T');
  });

  it('strips a leading www. case-insensitively', () => {
    expect(chipLetter('www.example.com')).toBe('E');
    expect(chipLetter('WWW.EXAMPLE.COM')).toBe('E');
  });

  it('falls back to a middle dot for empty/odd domains', () => {
    expect(chipLetter('')).toBe('·');
    expect(chipLetter(undefined)).toBe('·');
    expect(chipLetter(null)).toBe('·');
    expect(chipLetter('...')).toBe('·');
  });
});

describe('Chip', () => {
  it('renders the derived letter', () => {
    render(<Chip domain="tbray.org" />);
    expect(screen.getByText('T')).toBeDefined();
  });

  it('uses the Oat chip tokens (bg2 fill, line border) — no remote favicon', () => {
    render(<Chip domain="tbray.org" />);
    const chip = screen.getByText('T');
    expect(chip.style.background).toBe('var(--bg2)');
    expect(chip.style.border).toContain('var(--line)');
    // no <img>/background-image favicon fetch anywhere in the chip
    expect(chip.querySelector('img')).toBeNull();
  });
});
