import { type CSSProperties, useState } from 'react';
import {
  useAccessTokens,
  useCreateAccessToken,
  useOAuthClients,
  useRevokeAccessToken,
  useRevokeAllOAuthClients,
  useRevokeOAuthClient,
  useSettings,
  useUpdateSettings,
} from '../../api/hooks';
import type { AccessTokenJson, ConnectedOAuthClient } from '../../api/types';
import { Skeleton } from '../Skeleton';
import { copyLabel, useCopyFlash } from './copyFlash';
import { McpSetupDialog } from './McpSetupDialog';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';
import { SettingsHero } from './SettingsHero';
import { ToggleSwitch } from './ToggleSwitch';

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
 * The two-step Revoke control shared by `TokenRow` and `OAuthClientRow`. The
 * inline confirm (button flips to "Confirm revoke?" / "Cancel" in place) is a
 * deliberate substitute for a browser `window.confirm` dialog (no-dialogs
 * guidance) — it stays inline, on-tone, and dismissible without a modal.
 * a single "Revoke" button that, once clicked, swaps to Cancel / "Confirm
 * revoke?" so a stray double-click can't fire the DELETE twice. Owns its own
 * `confirming` state; `pending` disables the confirm buttons while the mutation
 * is in flight and flips the label to "Revoking…". `onRevoke` fires only on the
 * confirmed second click.
 */
function TwoStepRevoke({ onRevoke, pending }: { onRevoke: () => void; pending: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="silo-settings-btn" onClick={() => setConfirming(true)}>
        Revoke
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        className="silo-settings-btn"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
      <button type="button" className="silo-settings-btn" disabled={pending} onClick={onRevoke}>
        {pending ? 'Revoking…' : 'Confirm revoke?'}
      </button>
    </div>
  );
}

function TokenRow({
  token,
  onRevoke,
  pending,
}: {
  token: AccessTokenJson;
  onRevoke: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div style={settingsRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={tokenNameStyle}>{token.name}</div>
        <div style={tokenMetaStyle}>
          {token.prefix}… · created {formatDate(token.createdAt)} ·{' '}
          {token.lastUsedAt ? `last used ${formatDate(token.lastUsedAt)}` : 'never used'}
        </div>
      </div>
      <TwoStepRevoke onRevoke={() => onRevoke(token.id)} pending={pending} />
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
 * One skeleton row shaped like `TokenRow` — same `settingsRow` shell, a
 * name-line + meta-line skeleton stacked on the left (mirroring
 * `tokenNameStyle`/`tokenMetaStyle`'s sizes so the real row doesn't shift
 * when it replaces this), and a button-shaped skeleton on the right sized to
 * the Revoke button. A local helper (not `TokenRow` itself) since there's no
 * real token to render yet — pulled out so `AccessTokensSection` can render
 * 2–3 without repeating the row markup (jscpd).
 */
function TokenRowSkeleton() {
  return (
    <div style={settingsRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton height={14} width="40%" />
        <Skeleton height={11} width="65%" style={{ marginTop: 6 }} />
      </div>
      <Skeleton height={30} width={64} />
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
 *
 * While `useAccessTokens` is loading, three `TokenRowSkeleton`s stand in for
 * the list — it used to render nothing here, so the real rows would flash
 * in once the fetch resolved. `role="status"` carries the loading semantics
 * (the skeleton blocks themselves are `aria-hidden`), matching the pattern
 * `LoadingState`/`TrashBody` use elsewhere.
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
      {isLoading && (
        <div role="status" aria-label="Loading…">
          <TokenRowSkeleton />
          <TokenRowSkeleton />
          <TokenRowSkeleton />
        </div>
      )}
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
 * One deduped connected-app row — name/granted/last-used/active-token-count
 * on the left (mirroring `TokenRow`'s layout), a `(N connections)` note
 * appended to the meta line only when `connectionCount > 1` (re-registration
 * noise from repeated DCR — the common single-connection case stays quiet,
 * "silence means complete"), and the same two-step Revoke confirm as
 * `TokenRow` on the right. `onRevoke` is handed the whole group (not just an
 * id) since revoking fans out over every id in `clientIds`.
 */
function OAuthClientRow({
  client,
  onRevoke,
  pending,
}: {
  client: ConnectedOAuthClient;
  onRevoke: (client: ConnectedOAuthClient) => void;
  pending: boolean;
}) {
  return (
    <div style={settingsRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={tokenNameStyle}>{client.clientName}</div>
        <div style={tokenMetaStyle}>
          granted {formatDate(client.grantedAt)} ·{' '}
          {client.lastUsedAt ? `last used ${formatDate(client.lastUsedAt)}` : 'never used'} ·{' '}
          {client.activeTokenCount} active token{client.activeTokenCount === 1 ? '' : 's'}
          {client.connectionCount > 1 ? ` · (${client.connectionCount} connections)` : ''}
        </div>
      </div>
      <TwoStepRevoke onRevoke={() => onRevoke(client)} pending={pending} />
    </div>
  );
}

/** One skeleton row shaped like `OAuthClientRow` — reuses `TokenRowSkeleton`'s exact shell (same sizes), since the two lists share row rhythm. */
function OAuthClientRowSkeleton() {
  return (
    <div style={settingsRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton height={14} width="40%" />
        <Skeleton height={11} width="65%" style={{ marginTop: 6 }} />
      </div>
      <Skeleton height={30} width={64} />
    </div>
  );
}

/**
 * The connected-apps section (MCP OAuth Unit 4): lists every deduped OAuth
 * client group (`useOAuthClients`, `GET /api/access-tokens/oauth-clients`)
 * below the manual access-token management above. Distinct from
 * `AccessTokensSection`'s tokens — these are apps that connected via the
 * OAuth "Add custom connector" flow (Claude, ChatGPT), not manually-pasted
 * bearer tokens.
 *
 * A per-row Revoke fans `useRevokeOAuthClient` out over every id in the
 * group's `clientIds` (`Promise.all` — a group is usually one id, but
 * re-registration noise can leave several under one name; all must be
 * revoked for the app to actually disappear from the list, since the list
 * is token-driven). "Revoke all" hits the single collection-delete endpoint
 * instead of fanning out itself. Both share one `pendingName` bit of local
 * state so only the row/section actually in flight shows "Revoking…" — a
 * second click elsewhere is still live while the first is still confirming.
 */
function ConnectedAppsSection() {
  const { data: clients, isLoading } = useOAuthClients();
  const revokeClient = useRevokeOAuthClient();
  const revokeAll = useRevokeAllOAuthClients();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const handleRevokeGroup = async (client: ConnectedOAuthClient) => {
    setPendingName(client.clientName);
    try {
      await Promise.all(client.clientIds.map((id) => revokeClient.mutateAsync(id)));
    } finally {
      setPendingName(null);
    }
  };

  const handleRevokeAll = () => {
    revokeAll.mutate(undefined, { onSettled: () => setConfirmingAll(false) });
  };

  return (
    <>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Connected apps</div>
          <div style={rowDesc}>
            Apps that connected over OAuth (Claude, ChatGPT) — one row per app, even if it
            reconnected more than once.
          </div>
        </div>
        {clients && clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            {confirmingAll ? (
              <>
                <button
                  type="button"
                  className="silo-settings-btn"
                  disabled={revokeAll.isPending}
                  onClick={() => setConfirmingAll(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="silo-settings-btn"
                  disabled={revokeAll.isPending}
                  onClick={handleRevokeAll}
                >
                  {revokeAll.isPending ? 'Revoking…' : 'Confirm revoke all?'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="silo-settings-btn"
                onClick={() => setConfirmingAll(true)}
              >
                Revoke all
              </button>
            )}
          </div>
        )}
      </div>
      {isLoading && (
        <div role="status" aria-label="Loading…">
          <OAuthClientRowSkeleton />
          <OAuthClientRowSkeleton />
        </div>
      )}
      {!isLoading && clients && clients.length === 0 && (
        <div style={settingsRow}>
          <div style={rowDesc}>No apps connected yet.</div>
        </div>
      )}
      {clients?.map((client) => (
        <OAuthClientRow
          key={client.clientName}
          client={client}
          onRevoke={handleRevokeGroup}
          pending={pendingName === client.clientName}
        />
      ))}
    </>
  );
}

/**
 * Settings → Access (v3's `tabAccess`): a hero card explaining MCP access
 * (silo's whole point — "let an agent add, search, and read your links"),
 * with "Set up" as the hero's primary action; below it, a LIVE MCP-access
 * toggle (backed by core's `mcpAccess` setting, default `true` — the HTTP
 * MCP listener enforces it per-request server-side, `403` when off, see
 * `packages/app/src/mcp-http.ts`); below that, the named access-token
 * management section (U4) — create/list/revoke real DB-backed tokens rather
 * than the old single inert env-token row; below THAT, the connected-apps
 * section (MCP OAuth Unit 4) — apps that connected via the OAuth handshake
 * (Claude, ChatGPT's "Add custom connector" flow) rather than a
 * manually-pasted bearer token, deduped by client name with revoke/revoke-all.
 *
 * "Set up" (formerly "Copy config", which copied a single JSON blob) opens
 * `McpSetupDialog` — a SECOND `ModalShell` stacked on top of this Settings
 * modal — showing the URL, transport, auth header, `claude mcp add` CLI
 * command, and the JSON blob as individually copyable rows, since a single
 * JSON blob doesn't serve every way people wire up an MCP client (Claude
 * Desktop JSON, the CLI, Cursor, a raw HTTP client). See that dialog's doc
 * comment for the stacking details.
 */
export function AccessTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const mcpAccess = settings?.mcpAccess ?? true;
  const mcpAccessDisabled = !settings || updateSettings.isPending;

  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <>
      <SettingsHero
        title="MCP access"
        description="Let an agent add, search, and read your links — over HTTP, with the API key inserted. No AI lives inside silo; the mind sits on top, over MCP."
        primaryAction={
          <button
            type="button"
            className="silo-settings-hero-btn-primary"
            onClick={() => setSetupOpen(true)}
          >
            Set up
          </button>
        }
      />
      {setupOpen && <McpSetupDialog onClose={() => setSetupOpen(false)} />}
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
      <ConnectedAppsSection />
    </>
  );
}
