import type { Context, Next } from 'hono';

/**
 * AI settings hold a provider key, so only the web session or the operator's
 * env token may change them. Named access tokens (extensions, agents) get 403.
 * `generalTokenAuth` records the matched branch in `authKind`.
 */
export function operatorOnlyFailure(c: Context): Response | null {
  const kind = c.get('authKind');
  if (kind === 'open' || kind === 'env_token' || kind === 'session') return null;
  return c.json(
    {
      error: 'operator_only',
      message: 'Only the web session or the operator token can change AI settings.',
    },
    403,
  );
}

export async function operatorOnly(c: Context, next: Next): Promise<Response | undefined> {
  const denied = operatorOnlyFailure(c);
  if (denied) return denied;
  await next();
  return undefined;
}
