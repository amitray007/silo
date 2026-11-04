import { ReaderIcon } from '../ReaderIcon';
import type { PagerEntry } from './answerVersions';

/** "‹ 2 / 3 ›": the live answer is the one shown; a step selects its neighbour on the server. `entries` come from `pagerOrder`. */
export function VersionPager({
  entries,
  liveId,
  onSelect,
}: {
  entries: PagerEntry[];
  liveId: string;
  onSelect: (versionId: string) => void;
}) {
  const index = entries.findIndex((entry) => entry.id === liveId);
  const model = entries[index]?.model;
  const before = entries[index - 1];
  const after = entries[index + 1];
  return (
    <fieldset className="silo-chat-pager" aria-label="Answer versions">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="Previous version"
        title="Previous version"
        disabled={!before}
        onClick={() => before && onSelect(before.id)}
      >
        <ReaderIcon name="back" size={14} />
      </button>
      <span className="silo-chat-pager-count" aria-live="polite">
        {index + 1} / {entries.length}
      </span>
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label="Next version"
        title="Next version"
        disabled={!after}
        onClick={() => after && onSelect(after.id)}
      >
        <ReaderIcon name="right" size={14} />
      </button>
      {model && <span className="silo-chat-pager-model">{model}</span>}
    </fieldset>
  );
}
