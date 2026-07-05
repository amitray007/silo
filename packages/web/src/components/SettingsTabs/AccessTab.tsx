import { useEffect, useRef, useState } from 'react';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided, tabNote } from './rowStyles';
import { SettingsHero } from './SettingsHero';

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
 * Settings → Access (v3's `tabAccess`): a hero card explaining MCP access
 * (silo's whole point — "let an agent add, search, and read your links"),
 * with "Copy config" as the hero's primary action; below it, MCP-access
 * toggle + access token rows backed by settings/auth that don't exist yet
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
      <SettingsHero
        title="MCP access"
        description="Let an agent add, search, and read your links — over the Model Context Protocol. No AI lives inside silo; the mind sits on top, over MCP."
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
          <div style={rowDesc}>always on for now — no per-agent toggle yet</div>
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
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Access token</div>
          <div style={rowDesc}>
            not yet available — MCP access is a local subprocess, not a token
          </div>
        </div>
        <button type="button" disabled title="not yet available" className="silo-settings-btn">
          Rotate
        </button>
      </div>
      <p style={tabNote}>Links an agent adds look like any other — nothing else changes.</p>
    </>
  );
}
