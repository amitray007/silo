import { useState } from 'react';
import type { LinkJson } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { embedFor } from './embedFor';
import { ReaderIcon } from './ReaderIcon';
import { ReaderPlayer } from './ReaderPlayer';
import { originalUrl } from './useReaderActions';

export function Original({ link }: { link: LinkJson }) {
  const { theme } = useTheme();
  const embed = embedFor(link.url, link.sourceData, theme);
  const url = originalUrl(link.url);
  const [failed, setFailed] = useState(false);
  // Until /frame exists, known download extensions are the only non-HTML hint.
  // PDFs stay in the direct iframe, where browser PDF viewers can display them.
  const pdf = /(?:\.pdf|\/pdf(?:\/[^?#]*)?)(?:[?#]|$)/i.test(link.url);
  const download = /\.(?:zip|gz|tar|7z|rar|exe|dmg|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(link.url);
  const mode = embed ? 'player' : url && !download && !failed ? 'direct' : 'card';
  const label = embed?.title ?? (mode === 'direct' ? 'Original page' : 'Link card');
  const sandbox = pdf ? undefined : 'allow-scripts allow-same-origin allow-popups allow-forms';
  return (
    <div className="silo-original" data-mode={mode}>
      <div className="silo-original-bar">
        <span title={link.url}>
          {label} · {link.url}
        </span>
        {url && (
          <a className="silo-reader-btn" href={url} target="_blank" rel="noopener noreferrer">
            Open in new tab <ReaderIcon name="external" />
          </a>
        )}
      </div>
      {embed ? (
        <div className="silo-original-player">
          <ReaderPlayer embed={embed} />
        </div>
      ) : mode === 'direct' ? (
        <>
          <p className="silo-original-hint">
            Blank page? Some sites block embedding. Open it in a new tab.
          </p>
          <iframe
            title="Original page"
            sandbox={sandbox}
            className="silo-original-frame"
            src={url}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <div className="silo-original-card">
          <h2>{link.title || link.url}</h2>
          <p>{link.description || 'This content cannot be displayed here.'}</p>
          {url && (
            <a className="silo-reader-btn" href={url} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          )}
        </div>
      )}
    </div>
  );
}
