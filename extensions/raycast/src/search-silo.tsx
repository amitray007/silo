import { List } from '@raycast/api';
import { useState } from 'react';
import { LinkActions } from './lib/link-actions.js';
import { LinkDetail } from './lib/link-detail.js';
import { getBaseUrl } from './lib/preferences.js';
import { groupByDay } from './lib/search-grouping.js';
import { domainOf, sourceIcon } from './lib/source-icon.js';
import type { CapturedLink } from './lib/types.js';
import { useSiloSearch } from './lib/use-silo-search.js';

/**
 * The find surface (design spec CMD 3: "Search Silo") — a filterable list
 * with day-section headers on the left, the shared rich detail pane on the
 * right (favicon-before-title, proxy image, source stats — `lib/link-
 * detail.tsx`), and the full `⌘K` action panel (`lib/link-actions.tsx`),
 * so Search and Browse render identically per the design spec.
 */
export default function Command() {
  const [query, setQuery] = useState('');
  const { results, isLoading, reload } = useSiloSearch(query);
  const sections = groupByDay(results);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search your silo library…"
      isShowingDetail={results.length > 0}
      throttle
    >
      {query.trim() === '' ? (
        <List.EmptyView
          title="Type to search"
          description="Search titles, notes, and full text in silo."
        />
      ) : results.length === 0 && !isLoading ? (
        <List.EmptyView title="No results" description={`Nothing in silo matches "${query}"`} />
      ) : (
        sections.map((section) => (
          <List.Section key={section.title} title={section.title}>
            {section.links.map((link) => (
              <SearchResultItem key={link.id} link={link} onChange={reload} />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

function SearchResultItem({ link, onChange }: { link: CapturedLink; onChange: () => void }) {
  const title = link.title?.trim() || domainOf(link.url);
  const baseUrl = getBaseUrl();

  return (
    <List.Item
      title={title}
      subtitle={domainOf(link.url)}
      icon={sourceIcon(link)}
      // "silence means complete" — the ◌ capturing pulse is the ONLY status
      // chrome a row ever carries, and only while enriching (design tokens).
      accessories={link.captureStatus === 'enriching' ? [{ text: '◌ capturing' }] : []}
      detail={<LinkDetail link={link} baseUrl={baseUrl} />}
      actions={<LinkActions link={link} variant="live" onChange={onChange} />}
    />
  );
}
