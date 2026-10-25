import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiUrl } from '../../api/client';
import { useFrameHint } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { embedFor, type PlayerEmbed } from './embedFor';
import { ReaderIcon } from './ReaderIcon';
import { ReaderPlayer } from './ReaderPlayer';
import { originalUrl } from './useReaderActions';

type FrameMode = 'direct' | 'view';
type Mode = FrameMode | 'player' | 'card';
const labels = { direct: 'Live site', view: 'Silo view', card: 'Link card', player: 'Player' };

function OriginalBar({
  link,
  mode,
  switchMode,
  canView,
}: {
  link: LinkJson;
  mode: Mode;
  switchMode: (mode: FrameMode) => void;
  canView: boolean;
}) {
  const url = originalUrl(link.url);
  return (
    <div className="silo-original-bar">
      <span title={link.url}>
        {labels[mode]} · {link.url}
      </span>
      {(mode === 'view' || (mode === 'direct' && canView)) && (
        <button
          className="silo-reader-btn"
          type="button"
          onClick={() => switchMode(mode === 'direct' ? 'view' : 'direct')}
        >
          {mode === 'direct' ? 'Show silo view' : 'Load live site'}
        </button>
      )}
      {url && (
        <a className="silo-reader-btn" href={url} target="_blank" rel="noopener noreferrer">
          Open in new tab <ReaderIcon name="external" />
        </a>
      )}
    </div>
  );
}

function OriginalContent({
  link,
  mode,
  embed,
  loading,
}: {
  link: LinkJson;
  mode: Mode;
  embed: PlayerEmbed | undefined;
  loading: boolean;
}) {
  if (embed)
    return (
      <div className="silo-original-player">
        <ReaderPlayer embed={embed} />
      </div>
    );
  if (mode === 'direct' || mode === 'view') {
    return (
      <iframe
        key={mode}
        title={mode === 'view' ? 'Silo view' : 'Original page'}
        sandbox={mode === 'view' ? 'allow-popups allow-popups-to-escape-sandbox' : undefined}
        className="silo-original-frame"
        src={
          mode === 'view'
            ? apiUrl(`/api/links/${encodeURIComponent(link.id)}/view`)
            : originalUrl(link.url)
        }
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    );
  }
  return (
    <div className="silo-original-card">
      <h2>{link.title || link.url}</h2>
      <p>
        {loading
          ? 'Loading Original…'
          : link.description || 'This content cannot be displayed here.'}
      </p>
    </div>
  );
}

export function Original({ link }: { link: LinkJson }) {
  const { theme } = useTheme();
  const embed = embedFor(link.url, link.sourceData, theme);
  const hint = useFrameHint(link.id, !embed && Boolean(originalUrl(link.url)));
  const [selected, setSelected] = useState<FrameMode>();
  let mode: Mode = 'card';
  if (embed) mode = 'player';
  else if (hint.data?.mode === 'direct' || hint.data?.mode === 'view')
    mode = selected ?? hint.data.mode;
  const canView = hint.data?.mode === 'view';
  const viewCheck = useQuery({
    queryKey: ['page-view-ready', link.id],
    queryFn: async ({ signal }) => {
      const response = await fetch(apiUrl(`/api/links/${encodeURIComponent(link.id)}/view`), {
        method: 'HEAD',
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      return response.ok;
    },
    enabled: mode === 'view' && canView,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  // Iframe load events also fire for HTTP errors. Check the authenticated route first.
  if (mode === 'view' && (!canView || viewCheck.isFetching || viewCheck.data !== true))
    mode = 'card';
  return (
    <div className="silo-original" data-mode={mode}>
      <OriginalBar link={link} mode={mode} switchMode={setSelected} canView={canView} />
      <OriginalContent
        link={link}
        mode={mode}
        embed={embed}
        loading={hint.isFetching || viewCheck.isFetching}
      />
    </div>
  );
}
