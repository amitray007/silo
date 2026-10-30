/** Publisher HTTP(S) URLs use WHATWG parsing; network access still requires safeFetch. */
export function httpUrl(value: string | undefined, base?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
