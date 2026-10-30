import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { SegmentTabs } from './ReaderSegment';

it('keeps one Tab stop and moves selection and focus with arrow keys', () => {
  function Tabs() {
    const [tab, setTab] = useState('inbox');
    return (
      <SegmentTabs
        id="feed-tabs"
        tab={tab}
        setTab={setTab}
        disabled={false}
        tabs={[
          { value: 'inbox', label: 'Inbox' },
          { value: 'archive', label: 'Archive' },
        ]}
      />
    );
  }
  render(<Tabs />);
  const inbox = screen.getByRole('tab', { name: 'Inbox' });
  const archive = screen.getByRole('tab', { name: 'Archive' });
  expect(inbox.tabIndex).toBe(0);
  expect(archive.tabIndex).toBe(-1);
  inbox.focus();
  fireEvent.keyDown(inbox, { key: 'ArrowRight' });
  expect(archive.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(archive);
  expect(archive.tabIndex).toBe(0);
  expect(inbox.tabIndex).toBe(-1);
});
