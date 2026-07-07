import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { useState } from 'react';
import { buildDetailMarkdown, statusLabel } from './lib/detail-markdown.js';
import { groupByDay } from './lib/search-grouping.js';
import { domainOf, sourceIcon } from './lib/source-icon.js';
import type { CapturedLink } from './lib/types.js';
import { useSiloSearch } from './lib/use-silo-search.js';

/**
 * The find surface (brief: "a left results list ... and a right detail
 * pane"), modeled on `docs/plans/refs/raycast-search-detail-reference.png`:
 * a filterable list with day-section headers on the left, a rich detail
 * card + Information table on the right. Enter opens the link in the
 * browser; ⌘K exposes copy-url / open-in-silo.
 */
export default function Command() {
  const [query, setQuery] = useState('');
  const { results, isLoading } = useSiloSearch(query);
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
              <SearchResultItem key={link.id} link={link} />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

function SearchResultItem({ link }: { link: CapturedLink }) {
  const title = link.title?.trim() || domainOf(link.url);

  return (
    <List.Item
      title={title}
      subtitle={domainOf(link.url)}
      icon={sourceIcon(link)}
      detail={
        <List.Item.Detail
          markdown={buildDetailMarkdown(link)}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label
                title="Source"
                text={link.siteName ?? domainOf(link.url)}
              />
              <List.Item.Detail.Metadata.Label title="Type" text={link.sourceKind} />
              <List.Item.Detail.Metadata.Link title="URL" text={link.url} target={link.url} />
              <List.Item.Detail.Metadata.Label title="Title" text={title} />
              <List.Item.Detail.Metadata.Label
                title="Status"
                text={statusLabel(link.captureStatus)}
              />
              <List.Item.Detail.Metadata.Label
                title="Saved at"
                text={new Date(link.createdAt).toLocaleString()}
              />
              {link.tags.length > 0 && (
                <List.Item.Detail.Metadata.TagList title="Tags">
                  {link.tags.map((tag) => (
                    <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
                  ))}
                </List.Item.Detail.Metadata.TagList>
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={link.url} title="Open in Browser" />
          <Action.CopyToClipboard content={link.url} title="Copy URL" icon={Icon.CopyClipboard} />
        </ActionPanel>
      }
    />
  );
}
