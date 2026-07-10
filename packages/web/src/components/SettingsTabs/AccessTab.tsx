import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  useAccessTokens,
  useAppConfig,
  useCreateAccessToken,
  useRevokeAccessToken,
  useSettings,
  useUpdateSettings,
} from '../../api/hooks';
import type { AccessTokenJson } from '../../api/types';
import { resolveMcpUrl } from '../../lib/mcpUrl';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';
import { SettingsHero } from './SettingsHero';
import { ToggleSwitch } from './ToggleSwitch';

/**
 * Builds the streamable-HTTP MCP client-config snippet for `url` — points at
 * the HTTP MCP listener (`@silo/app`, opt-in via `SILO_MCP_HTTP_PORT`, see
 * `packages/app/src/mcp-http.ts`) with the shared secret in an
 * `Authorization: Bearer` header. `<YOUR_SILO_API_TOKEN>` is a literal
 * placeholder, NOT a real value — the browser is never shown the server's
 * `SILO_API_TOKEN` (it's a server-only secret; the web-auth slice, not this
 * one, is what would ever put real user-scoped credentials in the browser).
 * The user fills in their own token after copying.
 *
 * `url` is now RESOLVED at click time (deployable-silo slice, Unit 4) rather
 * than hardcoded — `resolveMcpUrl` (`packages/web/src/lib/mcpUrl.ts`) picks
 * an operator-set `SILO_PUBLIC_MCP_URL` override, else derives
 * `https://mcp.<hostname>/mcp` for a real deploy host, else falls back to
 * this dev-default `http://127.0.0.1:8788/mcp` (which mirrors the spec's
 * example port, `docs/superpowers/specs/2026-07-10-mcp-http-apikey-design.md`,
 * `.env.example` — the real bind port is whatever `SILO_MCP_HTTP_PORT` is set
 * to server-side).
 */
function mcpClientConfig(url: string): string {
  return `{
  "mcpServers": {
    "silo": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer <YOUR_SILO_API_TOKEN>" }
    }
  }
}`;
}

/**
 * A tri-state copy-flash label: `null` = never clicked, `true` = last copy
 * succeeded, `false` = last copy failed. Shared by both copy affordances on
 * this tab (Copy config / Copy token) so a failed clipboard write never looks
 * identical to a successful one (review fix, ce-correctness) — insecure
 * context / denied permission / non-user-gesture embeddings all reject
 * `writeText`. Each caller gets its OWN independent state/timer (two separate
 * `useCopyFlash()` calls) since the two buttons' labels must flip
 * independently — copying the token must not also flip "Copy config"'s label.
 */
function useCopyFlash() {
  const [copied, setCopied] = useState<boolean | null>(null);
  // Holds the pending "reset the label" timer so it can be cleared if the tab
  // unmounts (modal closed / tab switched) before it fires — otherwise it'd
  // call setState on an unmounted component (review fix, ce-correctness).
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const flash = (ok: boolean) => {
    setCopied(ok);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => flash(true),
      () => flash(false),
    );
  };

  return { copied, copyText };
}

/** Renders a copy-flash tri-state onto a button label — shared by "Copy config" and "Copy token". */
function copyLabel(copied: boolean | null, idleLabel: string): string {
  return copied === true ? 'Copied' : copied === false ? "Couldn't copy" : idleLabel;
}

/** Formats an ISO date string as a short, human date (e.g. "Jul 11, 2026") — used for both `createdAt` and `lastUsedAt`. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Shared row-label style for a token's name — same weight/color as `rowLabel`, sized down slightly since it sits in a denser list row rather than a top-level settings row. */
const tokenNameStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--ink)',
};

/** Shared style for a token's muted metadata line (prefix · created · last used) under its name. */
const tokenMetaStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--fnt)',
  marginTop: 2,
};

/**
 * One row in the token list — name/prefix/dates on the left, a two-step
 * Revoke affordance on the right. The two-step confirm (button flips to
 * "Confirm revoke?" / "Cancel" in place) is a deliberate substitute for a
 * browser `window.confirm` dialog (no-dialogs guidance) — it stays inline,
 * on-tone, and dismissible without a modal. `pending` disables the row's
 * button while the mutation is in flight so a slow network can't be
 * double-clicked into firing the DELETE twice.
 */
function TokenRow({
  token,
  onRevoke,
  pending,
}: {
  token: AccessTokenJson;
  onRevoke: (id: string) => void;
  pending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={settingsRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={tokenNameStyle}>{token.name}</div>
        <div style={tokenMetaStyle}>
          {token.prefix}… · created {formatDate(token.createdAt)} ·{' '}
          {token.lastUsedAt ? `last used ${formatDate(token.lastUsedAt)}` : 'never used'}
        </div>
      </div>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="silo-settings-btn"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="silo-settings-btn"
            disabled={pending}
            onClick={() => onRevoke(token.id)}
          >
            {pending ? 'Revoking…' : 'Confirm revoke?'}
          </button>
        </div>
      ) : (
        <button type="button" className="silo-settings-btn" onClick={() => setConfirming(true)}>
          Revoke
        </button>
      )}
    </div>
  );
}

/**
 * The "New token" create flow: a name input + Create button. On success, the
 * raw token is shown ONCE in a highlighted, copyable reveal field with a
 * one-time-warning and a Copy button (reusing the shared `useCopyFlash`/
 * `copyLabel` pattern); a "Done" control dismisses the reveal, after which
 * only the prefix shows up in the list above. The name input clears after a
 * successful create (both on dismiss AND immediately on success — the reveal
 * itself is enough confirmation the create landed; there's no reason to keep
 * the stale name sitting in the input while the reveal is up).
 */
function CreateTokenForm() {
  const [name, setName] = useState('');
  const createToken = useCreateAccessToken();
  const revealCopy = useCopyFlash();

  const created = createToken.data;
  const trimmedName = name.trim();

  const handleCreate = () => {
    if (!trimmedName) return;
    createToken.mutate(
      { name: trimmedName },
      {
        onSuccess: () => setName(''),
      },
    );
  };

  if (created) {
    return (
      <div style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
        <div style={rowLabel}>New token created</div>
        <div style={rowDesc}>Copy this now — you won't see it again.</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
          }}
        >
          <code
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 'var(--text-sm)',
              color: 'var(--ink)',
            }}
          >
            {created.token}
          </code>
          <button
            type="button"
            className="silo-settings-btn"
            onClick={() => revealCopy.copyText(created.token)}
          >
            {copyLabel(revealCopy.copied, 'Copy')}
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="silo-settings-btn" onClick={() => createToken.reset()}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={rowLabel}>New token</div>
      <div style={rowDesc}>Name it for the device or tool that will use it.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmedName && !createToken.isPending) handleCreate();
          }}
          placeholder="e.g. laptop cli, raycast"
          className="silo-field"
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: 'border-box',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--bg2)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
            fontSize: 'var(--text-sm)',
            padding: '8px 12px',
          }}
        />
        <button
          type="button"
          className="silo-settings-btn"
          disabled={!trimmedName || createToken.isPending}
          onClick={handleCreate}
        >
          {createToken.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

/**
 * The token-management section (U4): a create flow, then the list of
 * existing tokens. Replaces the old inert single "Access token" row — that
 * row copied the LOGGED-IN session token (an env secret proxy that couldn't
 * really be "shown"), whereas this section manages real, named, DB-backed
 * tokens the user creates/revokes directly (`docs/superpowers/specs/
 * 2026-07-11-access-tokens-design.md`).
 */
function AccessTokensSection() {
  const { data: tokens, isLoading } = useAccessTokens();
  const revokeToken = useRevokeAccessToken();

  return (
    <>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Access tokens</div>
          <div style={rowDesc}>
            Named tokens an agent can use to connect. Create one per device/tool; revoke any time.
          </div>
        </div>
      </div>
      <CreateTokenForm />
      {!isLoading && tokens && tokens.length === 0 && (
        <div style={settingsRow}>
          <div style={rowDesc}>No tokens yet — create one to let an agent connect.</div>
        </div>
      )}
      {tokens?.map((token) => (
        <TokenRow
          key={token.id}
          token={token}
          onRevoke={(id) => revokeToken.mutate(id)}
          pending={revokeToken.isPending && revokeToken.variables === token.id}
        />
      ))}
    </>
  );
}

/**
 * Settings → Access (v3's `tabAccess`): a hero card explaining MCP access
 * (silo's whole point — "let an agent add, search, and read your links"),
 * with "Copy config" as the hero's primary action; below it, a LIVE
 * MCP-access toggle (backed by core's `mcpAccess` setting, default `true` —
 * the HTTP MCP listener enforces it per-request server-side, `403` when off,
 * see `packages/app/src/mcp-http.ts`); below that, the named access-token
 * management section (U4) — create/list/revoke real DB-backed tokens rather
 * than the old single inert env-token row. "Copy config" writes the
 * HTTP+bearer config (above, with a placeholder token — a created token is
 * copyable from its own reveal instead) to the clipboard.
 */
export function AccessTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const mcpAccess = settings?.mcpAccess ?? true;
  const mcpAccessDisabled = !settings || updateSettings.isPending;

  const configCopy = useCopyFlash();
  // Feeds `resolveMcpUrl`'s step 1 (an operator-set `SILO_PUBLIC_MCP_URL`
  // override) — `undefined` while loading/absent falls through to the
  // client-derived steps below, same as `mcpAccess`'s `?? true` above.
  const { data: appConfig } = useAppConfig();

  return (
    <>
      <SettingsHero
        title="MCP access"
        description="Let an agent add, search, and read your links — over HTTP, with the API key inserted. No AI lives inside silo; the mind sits on top, over MCP."
        primaryAction={
          <button
            type="button"
            className="silo-settings-hero-btn-primary"
            onClick={() => {
              const url = resolveMcpUrl(appConfig?.mcpUrl, window.location);
              configCopy.copyText(mcpClientConfig(url));
            }}
          >
            {copyLabel(configCopy.copied, 'Copy config')}
          </button>
        }
      />
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>MCP access</div>
          <div style={rowDesc}>
            When off, agents can't reach silo over HTTP even with the API key. The stdio MCP client
            is unaffected.
          </div>
        </div>
        <ToggleSwitch
          on={mcpAccess}
          disabled={mcpAccessDisabled}
          onToggle={() => updateSettings.mutate({ mcpAccess: !mcpAccess })}
          label="MCP access"
        />
      </div>
      <AccessTokensSection />
    </>
  );
}
