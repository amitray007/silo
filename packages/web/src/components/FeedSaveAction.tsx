import { Link } from 'react-router';
import type { LinkJson } from '../api/types';
import { ReaderIcon } from './reader/ReaderIcon';

/** A saved bookmark opens its Home copy. Saving never toggles or removes it. */
export function FeedSaveAction({
  link,
  save,
  busy,
  tabIndex,
}: {
  link: LinkJson;
  save: () => void;
  busy: boolean;
  tabIndex?: number;
}) {
  if (link.savedLinkId)
    return (
      <Link
        to={`/?link=${link.savedLinkId}`}
        className="silo-reader-iconbtn"
        aria-label="Open saved"
        title="Open saved"
        tabIndex={tabIndex}
        onClick={(event) => event.stopPropagation()}
      >
        <ReaderIcon name="bookmarkFilled" />
      </Link>
    );
  return (
    <button
      type="button"
      className="silo-reader-iconbtn"
      aria-label="Save to Home"
      title="Save to Home"
      disabled={busy}
      tabIndex={tabIndex}
      onClick={(event) => {
        event.stopPropagation();
        save();
      }}
    >
      <ReaderIcon name="bookmark" />
    </button>
  );
}
