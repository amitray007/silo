import { useEffect, useId, useRef, useState } from 'react';
import { useAddTag, useCreateTag, useRemoveTag, useTags } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { buildTagOptions } from '../lib/tagOptions';
import { MenuSurface } from './MenuSurface';

/** Live tag membership, shared by strip, submenu, and edit tokens. */
export function useLinkTags(link: LinkJson) {
  const [tags, setTags] = useState(link.tags);
  const [error, setError] = useState('');
  useEffect(() => setTags(link.tags), [link.tags]);
  const add = useAddTag(link.id);
  const remove = useRemoveTag(link.id);
  const create = useCreateTag();
  const busy = add.isPending || remove.isPending || create.isPending;
  async function toggle(name: string, active: boolean, isNew = false) {
    if (busy) return;
    setError('');
    try {
      if (isNew) name = (await create.mutateAsync(name)).name;
      if (active) await remove.mutateAsync(name);
      else await add.mutateAsync(name);
      setTags((current) =>
        active ? current.filter((tag) => tag !== name) : [...new Set([...current, name])],
      );
    } catch {
      setError("Couldn't update tags. Try again.");
    }
  }
  return { tags, toggle, busy, error };
}

type Membership = ReturnType<typeof useLinkTags>;

function useTagOptions(tags: string[], query: string) {
  const { data } = useTags();
  const all = data?.tags ?? [];
  const { opts, hidden } = buildTagOptions(all, tags, query);
  const name = query.trim();
  const canCreate =
    name.length > 0 &&
    ![...all.map((tag) => tag.name), ...tags].some(
      (tag) => tag.toLowerCase() === name.toLowerCase(),
    );
  return { opts, hidden, name, canCreate, all };
}

function TagChoices({
  membership,
  query,
  onChosen,
  selected = -1,
  listId,
}: {
  membership: Membership;
  query: string;
  onChosen?: (() => void) | undefined;
  selected?: number;
  listId: string;
}) {
  const { opts, hidden, name, canCreate, all } = useTagOptions(membership.tags, query);
  return (
    <div id={listId} role="listbox" aria-label="Tags" aria-multiselectable="true">
      {opts.map((opt, index) => (
        <button
          id={`${listId}-${index}`}
          type="button"
          role="option"
          aria-selected={opt.active}
          key={opt.name}
          disabled={membership.busy}
          className={`silo-menu-item silo-tag-option${selected === index ? ' is-current' : ''}`}
          onClick={() => {
            void membership.toggle(opt.name, opt.active);
            onChosen?.();
          }}
        >
          <span
            className={`silo-tag-checkbox${opt.active ? ' is-checked' : ''}`}
            aria-hidden="true"
          >
            {opt.active ? '✓' : ''}
          </span>
          <span>{opt.name}</span>
          <span className="silo-tag-count">
            {all.find((tag) => tag.name === opt.name)?.count ?? 0}
          </span>
        </button>
      ))}
      {canCreate && (
        <button
          id={`${listId}-${opts.length}`}
          type="button"
          role="option"
          aria-selected="false"
          className={`silo-menu-item${selected === opts.length ? ' is-current' : ''}`}
          disabled={membership.busy}
          onClick={() => {
            void membership.toggle(name, false, true);
            onChosen?.();
          }}
        >
          <span className="silo-menu-icon" aria-hidden="true">
            +
          </span>
          Create “{name}”
        </button>
      )}
      {hidden > 0 && <div className="silo-tag-more">{hidden} more - type to narrow</div>}
      {opts.length === 0 && !canCreate && <div className="silo-tag-more">No tags yet</div>}
    </div>
  );
}

export function TagPicker({
  membership,
  link,
  onClose,
  className,
  onMouseEnter,
  onMouseLeave,
}: {
  membership: Membership;
  link: LinkJson;
  onClose: () => void;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  return (
    <MenuSurface
      className={`silo-tag-picker ${className ?? ''}`}
      link={link}
      onClose={onClose}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="silo-tag-search">
        <input
          className="silo-field"
          aria-label="Find or create tag"
          placeholder="Find or create tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <TagChoices membership={membership} query={query} listId={id} />
      {membership.error && <div role="alert">{membership.error}</div>}
    </MenuSurface>
  );
}

export function TagTokenField({
  membership,
  open,
  onOpenChange,
}: {
  membership: Membership;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const { opts, canCreate, name } = useTagOptions(membership.tags, query);
  const changeOpen = (value: boolean) => {
    onOpenChange(value);
  };
  return (
    <fieldset
      aria-label="Tags"
      className="silo-tag-token-group"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) changeOpen(false);
      }}
    >
      <div className="silo-tag-tokens">
        {membership.tags.map((tag) => (
          <span className="silo-tag-token" key={tag}>
            <b>#</b>
            <span>{tag}</span>
            <button
              type="button"
              title="Remove"
              aria-label={`Remove tag ${tag}`}
              disabled={membership.busy}
              onClick={() => void membership.toggle(tag, true)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          id="edit-tags"
          role="combobox"
          aria-label="Tags"
          aria-expanded={open}
          aria-controls={id}
          aria-activedescendant={
            open && (opts.length || canCreate)
              ? `${id}-${Math.min(selected, opts.length - (canCreate ? 0 : 1))}`
              : undefined
          }
          aria-autocomplete="list"
          placeholder="Add tag"
          value={query}
          onFocus={() => changeOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
            changeOpen(true);
          }}
          onKeyDown={(event) => {
            const count = opts.length + Number(canCreate);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              changeOpen(true);
              setSelected((current) =>
                count ? (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : 0,
              );
            }
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && open && count) {
              event.preventDefault();
              const choice = opts[selected];
              void membership.toggle(choice?.name ?? name, choice?.active ?? false, !choice);
              setQuery('');
              setSelected(0);
            }
            if (event.key === 'Backspace' && !query && membership.tags.length)
              void membership.toggle(membership.tags.at(-1) as string, true);
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              changeOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <div className="silo-tag-suggestions">
          <TagChoices
            membership={membership}
            query={query}
            selected={selected}
            listId={id}
            onChosen={() => {
              setQuery('');
              setSelected(0);
              input.current?.focus();
            }}
          />
        </div>
      )}
      {membership.error && <div role="alert">{membership.error}</div>}
    </fieldset>
  );
}
