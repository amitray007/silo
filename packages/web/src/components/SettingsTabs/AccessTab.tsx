import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../api/auth';
import { useSettings, useUpdateSettings } from '../../api/hooks';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided, tabNote } from './rowStyles';
import { SettingsHero } from './SettingsHero';
import { ToggleSwitch } from './ToggleSwitch';

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

/**
 * Settings → Access (v3's `tabAccess`): a hero card explaining MCP access
 * (silo's whole point — "let an agent add, search, and read your links"),
 * with "Copy config" as the hero's primary action; below it, a LIVE
 * MCP-access toggle (backed by core's `mcpAccess` setting, default `true` —
 * the HTTP MCP listener enforces it per-request server-side, `403` when off,
 * see `packages/app/src/mcp-http.ts`) and an access-token row with a
 * "Copy token" button that copies the LOGGED-IN session token to the
 * clipboard (never rendered on screen — the user already holds it, being
 * logged in). "Copy config" writes the HTTP+bearer config (above, with a
 * placeholder token — the real token is never baked into that snippet) to
 * the clipboard.
 */
export function AccessTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const mcpAccess = settings?.mcpAccess ?? true;
  const mcpAccessDisabled = !settings || updateSettings.isPending;

  const configCopy = useCopyFlash();
  const tokenCopy = useCopyFlash();
  const token = getToken();

  return (
    <>
      <SettingsHero
        title="MCP access"
        description="Let an agent add, search, and read your links — over HTTP, with the API key inserted. No AI lives inside silo; the mind sits on top, over MCP."
        primaryAction={
          <button
            type="button"
            className="silo-settings-hero-btn-primary"
            onClick={() => configCopy.copyText(MCP_CLIENT_CONFIG)}
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
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Access token</div>
          <div style={rowDesc}>
            Your session token. Paste it over the placeholder in the copied config.
          </div>
        </div>
        <button
          type="button"
          disabled={!token}
          title={token ? undefined : 'No token in this session — silo runs unauthenticated here'}
          className="silo-settings-btn"
          onClick={token ? () => tokenCopy.copyText(token) : undefined}
        >
          {copyLabel(tokenCopy.copied, 'Copy token')}
        </button>
      </div>
      <p style={tabNote}>
        An agent connecting over MCP looks like any other client — links it adds look like any
        other, nothing else changes.
      </p>
    </>
  );
}
