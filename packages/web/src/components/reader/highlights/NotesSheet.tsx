import type { HighlightJson } from '../../../api/types';
import { ReaderIcon } from '../ReaderIcon';
import type { ResolvedHighlight } from './useHighlightLayer';

/**
 * One quiet row per highlight, in reading order. A highlight whose passage is gone shows
 * "Passage not found" and can be deleted; the notes lane of the next slice lists orphans too.
 */
export function NotesSheet({
  resolved,
  orphans,
  canWrite,
  onOpen,
  onDelete,
}: {
  resolved: readonly ResolvedHighlight[];
  orphans: readonly HighlightJson[];
  canWrite: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (resolved.length === 0 && orphans.length === 0)
    return <p className="silo-empty-note">No highlights yet</p>;
  return (
    <ul className="silo-rows">
      {resolved.map((entry) => (
        <li key={entry.id}>
          <button type="button" data-color={entry.color} onClick={() => onOpen(entry.id)}>
            <span className="silo-row-bar" />
            <span className="silo-row-text">
              <span className="silo-row-snippet">{entry.highlight.quote}</span>
              {entry.highlight.note && (
                <span className="silo-row-note">{entry.highlight.note}</span>
              )}
            </span>
          </button>
        </li>
      ))}
      {orphans.map((orphan) => (
        <li key={orphan.id} className="silo-row-orphan">
          <span className="silo-row-line" data-color={orphan.color}>
            <span className="silo-row-bar" />
            <span className="silo-row-text">
              <span className="silo-row-snippet">{orphan.quote}</span>
              <span className="silo-row-note">Passage not found</span>
            </span>
          </span>
          {canWrite && (
            <button
              type="button"
              className="silo-stepper-btn"
              aria-label="Delete highlight"
              title="Delete highlight"
              onClick={() => onDelete(orphan.id)}
            >
              <ReaderIcon name="trash" size={15} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
