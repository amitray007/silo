import { useState } from 'react';

export function chipLetter(domain: string | null | undefined): string {
  const segment = (
    String(domain ?? '')
      .replace(/^www\./i, '')
      .split('.')[0] ?? ''
  ).replace(/[^a-z0-9]/gi, '');
  return segment ? segment.charAt(0).toUpperCase() : '·';
}

type IconState = 'pending' | 'loaded' | 'failed';

/**
 * The site's real favicon, served by silo's own `/api/favicon` proxy so the
 * browser never calls a third party per row. While it loads the tile stays
 * empty; a site with no icon shows its first letter on a quiet neutral tile.
 */
export function Chip({ domain, size = 20 }: { domain: string | null | undefined; size?: number }) {
  const host = String(domain ?? '')
    .replace(/^www\./i, '')
    .toLowerCase();
  const [icon, setIcon] = useState<{ host: string; state: IconState }>({ host, state: 'pending' });
  const state = icon.host === host ? icon.state : 'pending';
  const shown = host && state !== 'failed' ? state : 'failed';
  return (
    <span
      className="silo-letter-chip"
      data-state={shown}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {shown === 'failed' && chipLetter(host)}
      {shown !== 'failed' && (
        <img
          src={`/api/favicon?domain=${encodeURIComponent(host)}`}
          alt=""
          onLoad={() => setIcon({ host, state: 'loaded' })}
          onError={() => setIcon({ host, state: 'failed' })}
        />
      )}
    </span>
  );
}
