import { useEffect, useRef, useState } from 'react';
import {
  rowDesc,
  rowLabel,
  settingsRow,
  settingsRowDivided,
  stubButton,
  tabNote,
} from './rowStyles';

/**
 * The static stdio MCP client-config snippet from `README.md`'s "Connect an
 * MCP client" section — copied verbatim so "Copy config" hands out exactly
 * what a user would otherwise hand-copy from the README. It's static (no
 * per-user token, no settings-backed toggle state) because there is no MCP
 * access-settings API yet (scope "Next") — this is purely a client-side
 * clipboard convenience, not a generated/personalized config.
 */
const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "silo": {
      "command": "pnpm",
      "args": ["--filter", "@silo/app", "start"],
      "env": { "DATABASE_URL": "postgres://silo:silo@localhost:5432/silo" }
    }
  }
}`;

/**
 * Settings → Access (v3's `tabAccess`): MCP-access toggle, "Copy config",
 * access token + "Rotate" — all backed by settings/auth that don't exist yet
 * (MCP access is today a stdio subprocess with no in-app toggle or token;
 * scope "Next" per `docs/product/scope.html`). The toggle and Rotate stay
 * disabled/non-functional. "Copy config" is the one live affordance here — it
 * writes the real static stdio config (above) to the clipboard, which is a
 * client-side-only convenience that needs no backend.
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
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>MCP access</div>
          <div style={rowDesc}>let an agent add, search, and read your links</div>
        </div>
        <button
          type="button"
          disabled
          title="always on — no per-agent toggle yet"
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
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Client config</div>
          <div style={rowDesc}>add silo to Claude's MCP server list</div>
        </div>
        <button
          type="button"
          onClick={handleCopyConfig}
          style={{
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
            borderRadius: 8,
            fontSize: '0.76rem',
            fontWeight: 500,
            color: 'var(--ink)',
            padding: '6px 14px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {copied === true ? 'Copied' : copied === false ? "Couldn't copy" : 'Copy config'}
        </button>
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Access token</div>
          <div style={rowDesc}>
            not yet available — MCP access is a local subprocess, not a token
          </div>
        </div>
        <button type="button" disabled title="not yet available" style={stubButton}>
          Rotate
        </button>
      </div>
      <p style={tabNote}>Links an agent adds look like any other — nothing else changes.</p>
    </>
  );
}
