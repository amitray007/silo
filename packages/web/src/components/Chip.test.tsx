import { fireEvent, render, screen } from '@testing-library/react';
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

  it('uses the Oat chip tokens (bg2 fill, line border) on the outer chip', () => {
    render(<Chip domain="tbray.org" />);
    const letter = screen.getByText('T');
    const chip = letter.parentElement;
    expect(chip).not.toBeNull();
    expect(chip?.style.background).toBe('var(--bg2)');
    expect(chip?.style.border).toContain('var(--line)');
  });

  it('points the favicon overlay at the self-proxied /api/favicon endpoint (never a third-party host)', () => {
    const { container } = render(<Chip domain="tbray.org" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/favicon?domain=tbray.org');
  });

  it('falls back to the letter (removes the img) when the favicon fails to load', () => {
    const { container } = render(<Chip domain="tbray.org" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    if (!img) return;
    fireEvent.error(img);
    expect(screen.getByText('T')).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders no favicon img when there is no domain', () => {
    const { container } = render(<Chip domain={null} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
