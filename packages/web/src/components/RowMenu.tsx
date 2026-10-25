import { useEffect, useRef, useState } from 'react';
import { useRetryCapture, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { MenuAction, MenuSurface } from './MenuSurface';
import { useRowMenu } from './RowMenuContext';
import { ReaderIcon } from './reader/ReaderIcon';
import { useLibrarySelection } from './SelectionContext';
import { TagPicker, useLinkTags } from './TagOptionsList';

export function RowMenu({ link }: { link: LinkJson }) {
  const { closeMenu, openEdit } = useRowMenu();
  const selection = useLibrarySelection();
  const [tagsOpen, setTagsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const trash = useTrashLink(link.id);
  const retry = useRetryCapture(link.id);
  const tags = useLinkTags(link);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tagsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      clearTimeout(tagsTimer.current);
    },
    [],
  );
  const keep = () => {
    clearTimeout(tagsTimer.current);
    setTagsOpen(true);
  };
  const hide = () => {
    if (matchMedia('(max-width: 719px)').matches) return;
    clearTimeout(tagsTimer.current);
    tagsTimer.current = setTimeout(() => setTagsOpen(false), 140);
  };
  return (
    <MenuSurface className="silo-row-menu" link={link} onClose={closeMenu}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover supplements the native Tags button. */}
      <div
        className="silo-tags-anchor"
        onMouseEnter={() => {
          if (!matchMedia('(max-width: 719px)').matches) keep();
        }}
        onMouseLeave={() => {
          if (!matchMedia('(max-width: 719px)').matches) hide();
        }}
      >
        <button
          type="button"
          className="silo-menu-item"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={tagsOpen}
          onClick={keep}
        >
          <span className="silo-menu-icon">#</span>
          <span>Tags</span>
          {tags.tags.length > 0 && <span className="silo-tag-count">{tags.tags.length}</span>}
          <span className="silo-menu-chevron">›</span>
        </button>
        {tagsOpen && (
          <TagPicker
            membership={tags}
            link={link}
            className="silo-tags-flyout"
            onClose={() => setTagsOpen(false)}
            onMouseEnter={keep}
            onMouseLeave={hide}
          />
        )}
      </div>
      <MenuAction
        href={link.url}
        onClick={closeMenu}
        icon={<ReaderIcon name="external" />}
        shortcut="o"
      >
        Open original
      </MenuAction>
      <MenuAction
        icon={<ReaderIcon name="copy" />}
        shortcut="c"
        onClick={() => {
          navigator.clipboard.writeText(link.url).catch(() => {});
          setCopied(true);
          clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopied(false), 700);
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </MenuAction>
      <MenuAction
        icon="✓"
        onClick={() => {
          selection.toggle(link.id);
          closeMenu();
        }}
      >
        {selection.isSelected(link.id) ? 'Deselect item' : 'Select item'}
      </MenuAction>
      <MenuAction icon={<ReaderIcon name="edit" />} shortcut="e" onClick={() => openEdit(link)}>
        Edit
      </MenuAction>
      {link.captureStatus !== 'full' && (
        <MenuAction
          icon={<ReaderIcon name="refresh" />}
          onClick={() => {
            closeMenu();
            retry.mutate();
          }}
        >
          {link.captureStatus === 'enriching' ? 'Re-enrich' : 'Enrich'}
        </MenuAction>
      )}
      <div className="silo-menu-separator" />
      <MenuAction
        icon={<ReaderIcon name="trash" />}
        danger
        onClick={() => {
          closeMenu();
          selection.deselect([link.id]);
          trash.mutate();
        }}
      >
        Move to trash
      </MenuAction>
    </MenuSurface>
  );
}
