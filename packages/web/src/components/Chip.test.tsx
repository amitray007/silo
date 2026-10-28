import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('loads the real favicon through the silo proxy, hidden until it decodes', () => {
    const { container } = render(<Chip domain="www.TBray.org" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/favicon?domain=tbray.org');
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('pending');
    expect(container.querySelector('svg')).toBeNull();
    fireEvent.load(img as HTMLImageElement);
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('loaded');
  });

  it('shows a neutral globe when the site has no icon', () => {
    const { container } = render(<Chip domain="tbray.org" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('failed');
    expect(container.querySelector('.silo-letter-chip svg.silo-reader-icon')).not.toBeNull();
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
    expect(container.querySelector('svg.silo-reader-icon')).not.toBeNull();
  });
});
