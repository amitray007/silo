/** Match a CSP ancestor source against the embedding origin, never the page origin. */
function schemeMatches(source: string, protocol: string): boolean {
  return source === protocol || (source === 'http:' && protocol === 'https:');
}

function hostMatches(pattern: string, hostname: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) return hostname.endsWith(pattern.slice(1));
  return pattern === hostname;
}

function sourceMatches(source: string, ancestor: URL, page: URL): boolean {
  if (source.toLowerCase() === "'self'") {
    return (
      ancestor.hostname === page.hostname &&
      ancestor.port === page.port &&
      schemeMatches(page.protocol, ancestor.protocol)
    );
  }
  if (source === '*') return ['http:', 'https:'].includes(ancestor.protocol);
  if (/^[a-z][\w+.-]*:$/i.test(source))
    return schemeMatches(source.toLowerCase(), ancestor.protocol);
  const match =
    /^(?:([a-z][\w+.-]*:)\/\/)?(\[[\da-f:]+\]|\*|(?:\*\.)?[\w.-]+)(?::(\*|\d+))?(\/.*)?$/i.exec(
      source,
    );
  if (!match) return false;
  const [, scheme, host, port, path] = match;
  if (path && path !== '/') return false;
  if (!schemeMatches((scheme ?? page.protocol).toLowerCase(), ancestor.protocol)) return false;
  if (!host || !hostMatches(host.toLowerCase(), ancestor.hostname)) return false;
  if (port === '*') return true;
  const actualPort = ancestor.port || (ancestor.protocol === 'https:' ? '443' : '80');
  if (port) return Number(port) === Number(actualPort);
  return ancestor.port === '';
}

/** Multiple enforced CSP policies intersect. The first duplicate directive wins per policy. */
export function allowsFraming(
  headers: { contentSecurityPolicy?: string; xFrameOptions?: string },
  finalUrl: string,
  origin: string,
): boolean {
  const page = new URL(finalUrl);
  const ancestor = new URL(origin);
  const directives = (headers.contentSecurityPolicy ?? '')
    .split(',')
    .map((policy) => policy.split(';').map((directive) => directive.trim().split(/\s+/)))
    .map((policy) => policy.find((tokens) => tokens[0]?.toLowerCase() === 'frame-ancestors'))
    .filter((tokens) => tokens !== undefined);
  // An enforced frame-ancestors supersedes XFO even when it allows this origin.
  if (directives.length > 0) {
    return directives.every((tokens) =>
      tokens.slice(1).some((source) => sourceMatches(source, ancestor, page)),
    );
  }
  const xfo = headers.xFrameOptions ?? '';
  if (/\b(?:DENY|ALLOW-FROM)\b/i.test(xfo)) return false;
  if (/\bSAMEORIGIN\b/i.test(xfo)) return !xfo.includes(',') && ancestor.origin === page.origin;
  return true;
}
