import { Action, Icon, List, showToast, Toast, useNavigation } from '@raycast/api';
import { useEffect, useState } from 'react';
import { addTag, CaptureError, listTags, removeTag } from './capture-client.js';
import type { CapturedLink, TagWithCount } from './types.js';

/**
 * The shared filter/create tag model — mirrors the Chrome extension's
 * `tag-list.ts` (source tags from `GET /api/tags`, type-to-filter,
 * case-insensitive, a "Create '<x>'" affordance for a novel query) but as
 * flat pure functions (no picker-state object) since Raycast drives
 * filtering off `List`'s own `onSearchTextChange`, not injected DOM.
 */

/** Existing tags matching `query`, case-insensitive substring match. */
export function filterTags(all: TagWithCount[], query: string): TagWithCount[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((t) => t.name.toLowerCase().includes(q));
}

/** The trimmed query as a new-tag candidate, or null if empty / already an existing tag (case-insensitive). */
export function canCreate(all: TagWithCount[], query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  const exists = all.some((t) => t.name.toLowerCase() === key);
  return exists ? null : trimmed;
}

type TagPickerListProps = {
  title: string;
  /** Tags offered to pick from — the full set for add, the link's own tags for remove. */
  candidateTags: TagWithCount[];
  /** Whether a "Create '<x>'" row is offered for a novel query (add-tag only). */
  allowCreate: boolean;
  onPick: (tag: string) => Promise<CapturedLink>;
  onDone: (updated: CapturedLink) => void;
};

function TagPickerList({ title, candidateTags, allowCreate, onPick, onDone }: TagPickerListProps) {
  const { pop } = useNavigation();
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filtered = filterTags(candidateTags, query);
  const createCandidate = allowCreate ? canCreate(candidateTags, query) : null;

  async function pick(tag: string): Promise<void> {
    setIsSubmitting(true);
    try {
      const updated = await onPick(tag);
      onDone(updated);
      pop();
    } catch (error) {
      const message = error instanceof CaptureError ? error.message : 'Could not update tags';
      await showToast({ style: Toast.Style.Failure, title: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <List
      isLoading={isSubmitting}
      searchBarPlaceholder={title}
      onSearchTextChange={setQuery}
      filtering={false}
    >
      {filtered.map((tag) => (
        <List.Item
          key={tag.name}
          title={tag.name}
          accessories={[{ text: String(tag.count) }]}
          actions={<Action title="Select" onAction={() => void pick(tag.name)} icon={Icon.Tag} />}
        />
      ))}
      {createCandidate && (
        <List.Item
          key="__create__"
          title={`Create "${createCandidate}"`}
          icon={Icon.Plus}
          actions={
            <Action
              title="Create and Add"
              onAction={() => void pick(createCandidate)}
              icon={Icon.Plus}
            />
          }
        />
      )}
    </List>
  );
}

/** `⌘K` → "Add tag…": lists all tags (from `GET /api/tags`) filtered by query, plus a create affordance. */
export function AddTagAction({
  link,
  onDone,
}: {
  link: CapturedLink;
  onDone: (updated: CapturedLink) => void;
}) {
  const [allTags, setAllTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tags = await listTags();
        if (!cancelled) setAllTags(tags);
      } catch {
        // The picker still opens with an empty set + create-affordance if this fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Action.Push
      title="Add Tag…"
      icon={Icon.Tag}
      shortcut={{ modifiers: ['cmd'], key: 't' }}
      target={
        <TagPickerList
          title="Add a tag…"
          candidateTags={allTags}
          allowCreate
          onPick={(tag) => addTag(link.id, tag)}
          onDone={onDone}
        />
      }
    />
  );
}

/** `⌘⇧K` → "Remove tag…": lists only the link's own tags. */
export function RemoveTagAction({
  link,
  onDone,
}: {
  link: CapturedLink;
  onDone: (updated: CapturedLink) => void;
}) {
  const candidateTags: TagWithCount[] = link.tags.map((name) => ({ name, count: 0 }));

  return (
    <Action.Push
      title="Remove Tag…"
      icon={Icon.Tag}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
      target={
        <TagPickerList
          title="Remove a tag…"
          candidateTags={candidateTags}
          allowCreate={false}
          onPick={(tag) => removeTag(link.id, tag)}
          onDone={onDone}
        />
      }
    />
  );
}
