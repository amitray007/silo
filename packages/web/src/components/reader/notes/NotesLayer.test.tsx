import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { HighlightsApi } from '../highlights/useHighlights';
import { NotesLayer } from './NotesLayer';
import type { NotesLaneApi } from './useNotesLane';

vi.mock('./NotesLane', () => ({
  NotesLane: () => {
    throw new Error('chunk failed');
  },
}));

it('closes the lane and says so when its code fails, leaving the page up', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const scroll = document.createElement('div');
  const frame = document.createElement('div');
  const prose = document.createElement('div');
  frame.append(prose);
  scroll.append(frame);
  document.body.append(scroll);
  const release = vi.fn();
  const report = vi.fn();
  const api = { prose, scroll, resolved: [], report };
  const lane = { open: true, used: true, release, focusIds: [] };
  render(
    <NotesLayer
      api={api as unknown as HighlightsApi}
      lane={lane as unknown as NotesLaneApi}
      resumeY={null}
      panel={document.body}
      onDialHidden={() => {}}
    />,
  );
  await vi.waitFor(() => expect(release).toHaveBeenCalled());
  expect(report).toHaveBeenCalledWith("Couldn't open the notes lane");
  error.mockRestore();
});
