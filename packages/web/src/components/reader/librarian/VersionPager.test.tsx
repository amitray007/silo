import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { pagerOrder } from './answerVersions';
import { VersionPager } from './VersionPager';

const version = (id: string, label: string) => ({
  id,
  parts: [],
  metadata: { model: { provider: 'openai' as const, id, label } },
});

describe('VersionPager', () => {
  it('shows the live answer last, with its model, and steps back to the newest saved one', () => {
    const onSelect = vi.fn();
    render(
      <VersionPager
        entries={pagerOrder([], { id: 'c', model: 'Model C' }, [
          version('a', 'Model A'),
          version('b', 'Model B'),
        ])}
        liveId="c"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('Model C')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Next version' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('keeps positions after the server swaps a saved version with the live one', () => {
    const onSelect = vi.fn();
    const shown = pagerOrder([], { id: 'c', model: 'C' }, [version('a', 'A'), version('b', 'B')]);
    // Selecting "b": it goes live and "c" takes its slot.
    const entries = pagerOrder(
      shown.map((entry) => entry.id),
      { id: 'b', model: 'B' },
      [version('a', 'A'), version('c', 'C')],
    );
    render(<VersionPager entries={entries} liveId="b" onSelect={onSelect} />);
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(onSelect).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }));
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('disables Previous at the first version', () => {
    render(
      <VersionPager
        entries={pagerOrder(['a', 'b'], { id: 'a', model: 'A' }, [version('b', 'B')])}
        liveId="a"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Previous version' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('pagerOrder', () => {
  it('appends ids it has not seen and drops removed ones', () => {
    const order = pagerOrder(['a', 'gone', 'b'], { id: 'c', model: undefined }, [
      version('a', 'A'),
      version('b', 'B'),
    ]);
    expect(order.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});
