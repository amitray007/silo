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
  it('loads the real favicon through the silo proxy, hidden until it decodes', () => {
    const { container } = render(<Chip domain="www.TBray.org" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/favicon?domain=tbray.org');
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('pending');
    expect(screen.queryByText('T')).toBeNull();
    fireEvent.load(img as HTMLImageElement);
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('loaded');
  });

  it('shows the letter on a neutral tile when the site has no icon', () => {
    const { container } = render(<Chip domain="tbray.org" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('T').getAttribute('data-state')).toBe('failed');
  });

  it('requests a new icon when the domain changes', () => {
    const { container, rerender } = render(<Chip domain="tbray.org" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(<Chip domain="github.com" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/favicon?domain=github.com',
    );
  });

  it('renders no favicon img when there is no domain', () => {
    const { container } = render(<Chip domain={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('·')).toBeDefined();
  });
});
