import { useEffect, useRef, useState } from 'react';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided, tabNote } from './rowStyles';
import { SettingsHero } from './SettingsHero';

/**
 * The streamable-HTTP MCP client-config snippet — points at the HTTP MCP
 * listener (`@silo/app`, opt-in via `SILO_MCP_HTTP_PORT`, see
 * `packages/app/src/mcp-http.ts`) with the shared secret in an
 * `Authorization: Bearer` header. `<YOUR_SILO_API_TOKEN>` is a literal
 * placeholder, NOT a real value — the browser is never shown the server's
 * `SILO_API_TOKEN` (it's a server-only secret; the web-auth slice, not this
 * one, is what would ever put real user-scoped credentials in the browser).
 * The user fills in their own token after copying. 8788 mirrors the spec's
 * example port (`docs/superpowers/specs/2026-07-10-mcp-http-apikey-design.md`,
 * `.env.example`); the real bind port is whatever `SILO_MCP_HTTP_PORT` is set
 * to server-side.
 */
const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "silo": {
      "url": "http://127.0.0.1:8788/mcp",
      "headers": { "Authorization": "Bearer <YOUR_SILO_API_TOKEN>" }
    }
  }
}`;

/**
 * Settings → Access (v3's `tabAccess`): a hero card explaining MCP access
 * (silo's whole point — "let an agent add, search, and read your links"),
 * with "Copy config" as the hero's primary action; below it, an MCP-access
 * status row + an access-token row explaining the env-secret model. MCP over
 * HTTP is real now (U2, `packages/app/src/mcp-http.ts`) but opt-in and
 * server-configured — there is no in-app toggle backend and no way for the
 * browser to read or rotate the server's `SILO_API_TOKEN`, so both rows stay
 * informational/disabled with honest copy rather than faking a live control.
 * "Copy config" is the one live affordance here — it writes the HTTP+bearer
 * config (above, with a placeholder token) to the clipboard.
 */
export function AccessTab() {
  // `copied` is a tri-state: null = never clicked, true = last copy succeeded,
  // false = last copy failed. A failed clipboard write must not look identical
  // to a successful one (review fix, ce-correctness) — insecure context /
  // denied permission / non-user-gesture embeddings all reject `writeText`.
  const [copied, setCopied] = useState<boolean | null>(null);
  // Holds the pending "reset the label" timer so it can be cleared if the tab
  // unmounts (modal closed / tab switched) before it fires — otherwise it'd
  // call setState on an unmounted component (review fix, ce-correctness).
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const flashLabel = (ok: boolean) => {
    setCopied(ok);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(MCP_CLIENT_CONFIG).then(
      () => flashLabel(true),
      () => flashLabel(false),
    );
  };

  return (
    <>
      <SettingsHero
        title="MCP access"
        description="Let an agent add, search, and read your links — over HTTP, with the API key inserted. No AI lives inside silo; the mind sits on top, over MCP."
        primaryAction={
          <button
            type="button"
            className="silo-settings-hero-btn-primary"
            onClick={handleCopyConfig}
          >
            {copied === true ? 'Copied' : copied === false ? "Couldn't copy" : 'Copy config'}
          </button>
        }
      />
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>MCP access</div>
          <div style={rowDesc}>
            On when the server has SILO_MCP_HTTP_PORT + SILO_API_TOKEN set — no per-agent toggle yet
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Set via SILO_MCP_HTTP_PORT + SILO_API_TOKEN on the server — no in-app toggle yet"
          style={{
            width: 13,
            height: 13,
            padding: 0,
            borderRadius: '50%',
            cursor: 'default',
            background: 'var(--ghost)',
            border: '1px solid var(--ghost)',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Access token</div>
          <div style={rowDesc}>
            Set server-side via SILO_API_TOKEN — silo never shows it here. Paste your own value over
            the placeholder in the copied config.
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Configured via SILO_API_TOKEN on the server — not readable or rotatable from the browser"
          className="silo-settings-btn"
        >
          Env-set
        </button>
      </div>
      <p style={tabNote}>
        An agent connecting over MCP looks like any other client — links it adds look like any
        other, nothing else changes.
      </p>
    </>
  );
}
