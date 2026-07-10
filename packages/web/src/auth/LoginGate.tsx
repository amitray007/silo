import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { GrainDot } from '../components/GrainDot';
import { useAuth } from './AuthContext';

/**
 * The full-viewport login screen shown when `AuthContext` resolves to
 * `'needs-login'` (plan 030 Unit 3;
 * `docs/superpowers/specs/2026-07-10-web-auth-design.md`). Renders INSTEAD
 * of `<Routes>` — there is no app chrome (sidebar/frame) behind it to dim,
 * so this owns its own full-bleed `--bg` ground rather than reusing
 * `ModalShell` (which assumes a scrim over existing page content).
 *
 * A single password field for `SILO_APP_PASSWORD` — a human password,
 * separate from the machine `SILO_API_TOKEN` extensions/MCP use
 * (`docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md`). Design:
 * Oat tokens, Geist 400/500, the brand grain dot, a plain bordered `--bg2`
 * submit button (amber stays a mark only, never a button fill, per
 * `docs/design/tokens.md`).
 */
export function LoginGate() {
  const { login, checkUnreachable } = useAuth();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the password field on mount (effect, not an inline `autoFocus` prop —
  // matches SidebarTags's convention; `autoFocus` is also flagged by the
  // lint's a11y/noAutofocus rule).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || value === '') return;

    setPending(true);
    setFailed(false);
    const ok = await login(value);
    setPending(false);
    if (!ok) {
      setFailed(true);
      // Leave the field populated for a quick retry (e.g. a fumbled
      // paste/typo) rather than forcing a full re-entry.
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        padding: 'var(--s6)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '22rem',
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'var(--bg2)',
          boxShadow: 'var(--elev-2)',
          padding: 'var(--s6)',
          boxSizing: 'border-box',
          animation: 'siloIn .2s var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 'var(--s5)' }}>
          <GrainDot size={16} />
          <span
            style={{
              fontWeight: 500,
              fontSize: 'var(--text-md)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--ink)',
            }}
          >
            silo
          </span>
        </div>

        <p
          style={{
            margin: '0 0 var(--s5)',
            fontSize: 'var(--text-base)',
            color: 'var(--mut)',
            textWrap: 'pretty',
          }}
        >
          Enter your password to continue.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label
            htmlFor={inputId}
            style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase',
              color: 'var(--fnt)',
              marginBottom: 'var(--s2)',
            }}
          >
            Password
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            autoComplete="current-password"
            value={value}
            disabled={pending}
            onChange={(event) => {
              setValue(event.target.value);
              if (failed) setFailed(false);
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--ink)',
              font: 'inherit',
              fontSize: 'var(--text-base)',
              padding: '9px 12px',
              outline: 'none',
            }}
          />

          {failed && (
            <p
              role="alert"
              style={{
                margin: 'var(--s2) 0 0',
                fontSize: 'var(--text-sm)',
                color: 'var(--mut)',
              }}
            >
              That password didn't work.
            </p>
          )}

          {checkUnreachable && (
            <p
              style={{
                margin: 'var(--s2) 0 0',
                fontSize: 'var(--text-sm)',
                color: 'var(--fnt)',
              }}
            >
              Couldn't reach the server — check it's running and try again.
            </p>
          )}

          <button
            type="submit"
            disabled={pending || value === ''}
            style={{
              width: '100%',
              marginTop: 'var(--s5)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--ink)',
              fontFamily: 'inherit',
              fontSize: 'var(--text-base)',
              fontWeight: 500,
              padding: '9px 12px',
              cursor: pending || value === '' ? 'default' : 'pointer',
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
