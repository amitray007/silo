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

  it('uses a local letter chip with no image request', () => {
    const { container } = render(<Chip domain="tbray.org" />);
    expect(screen.getByText('T').className).toBe('silo-letter-chip');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders no favicon img when there is no domain', () => {
    const { container } = render(<Chip domain={null} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
