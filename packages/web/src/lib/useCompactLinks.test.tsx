import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useCompactLinks } from './useCompactLinks';

function Preference() {
  const [compact, setCompact] = useCompactLinks();
  return (
    <button type="button" onClick={() => setCompact(!compact)}>
      {compact ? 'Compact' : 'Detailed'}
    </button>
  );
}
afterEach(() => localStorage.removeItem('silo.compactLinks'));
it('defaults to compact, updates all subscribers, and survives remounting', () => {
  const view = render(
    <>
      <Preference />
      <Preference />
    </>,
  );
  expect(screen.getAllByText('Compact')).toHaveLength(2);
  fireEvent.click(screen.getAllByText('Compact')[0] as HTMLElement);
  expect(screen.getAllByText('Detailed')).toHaveLength(2);
  view.unmount();
  render(<Preference />);
  expect(screen.getByText('Detailed')).toBeDefined();
});
