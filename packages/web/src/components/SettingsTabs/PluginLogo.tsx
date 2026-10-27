import type { CSSProperties, SVGProps } from 'react';
import type { PluginSource } from '../../lib/pluginSettings';

// Inline brand marks keep source rows independent of third-party requests.
function YCombinatorLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={props.width ?? 24} height={props.height ?? 24} {...props}>
      <title>Hacker News (Y Combinator)</title>
      <path fill="#FFF" d="M0 0h24v24H0z" />
      <path
        fill="#F0652F"
        d="M0 24V0h24v24H0zM6.951 5.896l4.112 7.708v5.064h1.583v-4.972l4.148-7.799h-1.749l-2.457 4.875c-.372.745-.688 1.434-.688 1.434s-.297-.708-.651-1.434L8.831 5.896h-1.88z"
      />
    </svg>
  );
}

function GitHubLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width={props.width ?? 16} height={props.height ?? 16} {...props}>
      <title>GitHub</title>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2 .82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function YouTubeLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 256 180" width={props.width ?? 24} height={props.height ?? 17} {...props}>
      <title>YouTube</title>
      <path
        fill="red"
        d="M250.346 28.075A32.18 32.18 0 0 0 227.69 5.418C207.824 0 127.87 0 127.87 0S47.912.164 28.046 5.582A32.18 32.18 0 0 0 5.39 28.24c-6.009 35.298-8.34 89.084.165 122.97a32.18 32.18 0 0 0 22.656 22.657c19.866 5.418 99.822 5.418 99.822 5.418s79.955 0 99.82-5.418a32.18 32.18 0 0 0 22.657-22.657c6.338-35.348 8.291-89.1-.164-123.134Z"
      />
      <path fill="#FFF" d="m102.421 128.06 66.328-38.418-66.328-38.418z" />
    </svg>
  );
}

function XLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={props.width ?? 24} height={props.height ?? 24} {...props}>
      <title>X (Twitter)</title>
      <path
        fill="currentColor"
        d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
      />
    </svg>
  );
}

export type LogoSource = PluginSource;

const LOGO_BY_SOURCE: Record<LogoSource, (props: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  hacker_news: YCombinatorLogo,
  github: GitHubLogo,
  youtube: YouTubeLogo,
  twitter: XLogo,
};

const tileBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg2)',
  color: 'var(--ink)',
  boxShadow: 'inset 0 0 0 0.5px var(--line)',
  flex: 'none',
};

/** All sources share a rounded tile; monochrome marks follow the theme. */
export function PluginLogo({ source, size = 28 }: { source: LogoSource; size?: number }) {
  const Logo = LOGO_BY_SOURCE[source];
  const logoSize = source === 'hacker_news' ? size : Math.round(size * 0.64);

  return (
    <span aria-hidden="true" style={{ ...tileBase, width: size, height: size }}>
      <Logo width={logoSize} height={source === 'youtube' ? (logoSize * 180) / 256 : logoSize} />
    </span>
  );
}
