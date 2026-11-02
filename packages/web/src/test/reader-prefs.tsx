import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { LinkJson } from '../api/types';
import type { ReaderSettings } from '../lib/readerPrefs';
import { ReaderPrefsProvider, useReaderPrefs } from '../lib/useReaderPrefs';

/** Focused dock tests exercise session choices; API persistence has its own integration tests. */
export function TestArticlePrefs({ link, children }: { link: LinkJson; children: ReactNode }) {
  return (
    <ReaderPrefsProvider link={{ ...link, feedId: 'test-session' }}>
      {children}
      <PrefsProbe />
    </ReaderPrefsProvider>
  );
}
function PrefsProbe() {
  return <output data-testid="article-prefs">{JSON.stringify(useReaderPrefs().prefs)}</output>;
}
export function articlePrefs(): ReaderSettings {
  return JSON.parse(screen.getByTestId('article-prefs').textContent ?? '{}') as ReaderSettings;
}
