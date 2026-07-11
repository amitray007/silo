import type { CSSProperties } from 'react';
import { useAppConfig } from '../../api/hooks';
import { resolveMcpUrl } from '../../lib/mcpUrl';
import { ModalHeader, ModalShell } from '../ModalShell';
import { copyLabel, useCopyFlash } from './copyFlash';
import { rowDesc } from './rowStyles';

/**
 * Builds the streamable-HTTP MCP client-config snippet for `url` — points at
 * the HTTP MCP listener (`@silo/app`, opt-in via `SILO_MCP_HTTP_PORT`, see
 * `packages/app/src/mcp-http.ts`) with the shared secret in an
 * `Authorization: Bearer` header. `<YOUR_SILO_API_TOKEN>` is a literal
 * placeholder, NOT a real value — the browser is never shown the server's
 * `SILO_API_TOKEN` (it's a server-only secret; the web-auth slice, not this
 * one, is what would ever put real user-scoped credentials in the browser).
 * The user fills in their own token after copying. Moved here from
 * `AccessTab.tsx` when "Copy config" became this dialog's "JSON config" row
 * — the hero button now just opens the dialog, and every copyable value
 * (this JSON blob included) lives in one place.
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

/** Builds the ready-to-run `claude mcp add` CLI line for `url` — same placeholder-token rule as `mcpClientConfig` above. */
function claudeCodeCliCommand(url: string): string {
  return `claude mcp add --transport http silo ${url} --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"`;
}

const fieldLabel: CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  color: 'var(--fnt)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide, 0.02em)',
  marginBottom: 6,
};

const copyRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--bg2)',
};

const copyRowCode: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink)',
};

const fieldBlock: CSSProperties = { marginBottom: 16 };

/** A section heading above a group of fields — signals "these belong together". */
const groupHeading: CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--ink)',
  marginBottom: 4,
};

/** The one-line note under a group heading explaining how its fields are used together. */
const groupNote: CSSProperties = {
  ...rowDesc,
  marginBottom: 12,
};

/**
 * The "Connection" group container — visually binds URL + Transport + Auth
 * header into ONE unit (a subtle inset panel), because they're not three
 * independent options: you use all three TOGETHER to wire up a manual / Cursor
 * / raw-HTTP-client connection. The CLI command and JSON config below sit
 * OUTSIDE this panel as separate, each-self-sufficient alternatives (either one
 * alone is a complete config). Last field's `marginBottom` is zeroed so the
 * panel doesn't carry trailing space.
 */
const connectionGroup: CSSProperties = {
  padding: '14px 14px 0',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  marginBottom: 20,
};

/**
 * One labeled, individually-copyable field — the row shape lifted verbatim
 * from `AccessTab.tsx`'s old token-reveal field (border/bg2/radius-8 row, an
 * ellipsis-truncated `<code>`, a `.silo-settings-btn` Copy button on the
 * right). Each instance owns its OWN `useCopyFlash()` (per the hook's own
 * doc comment) so copying one field's value never flips another field's
 * button label.
 */
function CopyField({ label, value }: { label: string; value: string }) {
  const copy = useCopyFlash();
  return (
    <div style={fieldBlock}>
      <div style={fieldLabel}>{label}</div>
      <div style={copyRow}>
        <code style={copyRowCode}>{value}</code>
        <button type="button" className="silo-settings-btn" onClick={() => copy.copyText(value)}>
          {copyLabel(copy.copied, 'Copy')}
        </button>
      </div>
    </div>
  );
}

/**
 * The "Connect over MCP" setup dialog (Access tab's "Set up" hero action) —
 * replaces the old single "Copy config" button, which copied ONE JSON blob
 * and left every other connection method (the `claude mcp add` CLI, a raw
 * HTTP client that just wants the URL + header, Cursor's same JSON shape) to
 * be reverse-engineered from it. This shows the same information as
 * individually copyable rows instead: URL, transport, the auth header line,
 * the CLI command, and (last, unchanged in substance) the full JSON blob —
 * so nothing from the old single-button flow is lost, it's just no longer
 * the ONLY option.
 *
 * Stacks ON TOP of `SettingsModal` (`AccessTab` renders this while Settings
 * is still open underneath) via `ModalShell`'s `zIndex` prop — see that
 * prop's doc comment for why z-index alone doesn't also solve Escape
 * ordering, and how `ModalShell`'s open-modal stack does.
 *
 * Deliberately SELF-CONTAINED: resolves its own URL via `useAppConfig` +
 * `resolveMcpUrl` rather than taking `url` as a prop, so `AccessTab` only
 * has to own the open/close boolean, not a piece of derived state that
 * duplicates what this dialog needs anyway.
 */
export function McpSetupDialog({ onClose }: { onClose: () => void }) {
  const { data: appConfig } = useAppConfig();
  const url = resolveMcpUrl(appConfig?.mcpUrl, window.location);

  return (
    <ModalShell width={520} ariaLabel="Connect over MCP" onClose={onClose} zIndex={50}>
      <ModalHeader title="Connect over MCP" onClose={onClose} />
      <div style={{ ...rowDesc, marginBottom: 18 }}>
        Connect an agent to silo over MCP. Fill in your API token (create one below in Access
        tokens).
      </div>

      {/* The connection, grouped: URL + Transport + Auth are used TOGETHER for a
          manual / Cursor / raw-HTTP setup — the inset panel makes that "one
          unit, not three options" reading explicit. */}
      <div style={groupHeading}>Connection</div>
      <div style={groupNote}>Use these three together to add silo manually.</div>
      <div style={connectionGroup}>
        <CopyField label="URL" value={url} />
        <div style={fieldBlock}>
          <div style={fieldLabel}>Transport</div>
          <div style={copyRow}>
            <code style={copyRowCode}>Streamable HTTP</code>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <CopyField label="Auth header" value="Authorization: Bearer <YOUR_SILO_API_TOKEN>" />
        </div>
      </div>

      {/* Each of these is a COMPLETE config on its own — an alternative to
          assembling the group above, not part of it. */}
      <div style={groupHeading}>Or paste a ready-made config</div>
      <div style={groupNote}>Each of these is complete on its own.</div>
      <CopyField label="Claude Code CLI" value={claudeCodeCliCommand(url)} />
      <div style={{ marginBottom: 0 }}>
        <CopyField label="JSON config" value={mcpClientConfig(url)} />
      </div>
    </ModalShell>
  );
}
