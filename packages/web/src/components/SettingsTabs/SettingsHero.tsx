import type { CSSProperties, ReactNode } from 'react';

const heroCard: CSSProperties = {
  position: 'relative',
  borderRadius: 12,
  border: '1px solid var(--hero-border)',
  background: 'linear-gradient(160deg, var(--hero-grad-from), var(--hero-grad-to))',
  padding: '20px 22px',
  marginBottom: 8,
  overflow: 'hidden',
};

const heroTitle: CSSProperties = {
  margin: '10px 0 4px',
  fontSize: '1rem',
  fontWeight: 500,
  color: 'var(--ink)',
};

const heroDesc: CSSProperties = {
  margin: '0 0 16px',
  fontSize: '0.82rem',
  color: 'var(--fnt)',
  lineHeight: 1.55,
  maxWidth: '34rem',
};

const heroIconWrap: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'var(--ink)',
  color: 'var(--bg)',
  // A hairline ring in the card's own border tone ties the badge to the card's
  // edge treatment so it reads as part of the surface, not floating on it.
  boxShadow: '0 0 0 4px var(--hero-grad-from)',
};

/**
 * The Settings hero card — the redesign's answer to
 * `docs/design/refs/settings-reference.png`'s gradient "Upgrade to Plus" card:
 * same shape (rounded card, soft gradient tint, icon badge, title + copy,
 * primary + secondary actions) but HONEST for silo. There's no pricing tier
 * to upsell, so this hero explains silo's actual value prop — "an agent does
 * the intelligence, over MCP" — and its actions are real: `primaryAction` is
 * Access tab's live "Copy config" (the one genuinely wired affordance in this
 * modal), `secondaryAction` an optional companion (e.g. a docs link).
 *
 * Deliberately reused ACROSS tabs rather than hardcoded to one, so a future
 * tab can carry its own honest hero without duplicating the card chrome —
 * today only `AccessTab` uses it.
 */
export function SettingsHero({
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <div style={heroCard}>
      <span style={heroIconWrap} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      <p style={heroTitle}>{title}</p>
      <p style={heroDesc}>{description}</p>
      {(primaryAction || secondaryAction) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
