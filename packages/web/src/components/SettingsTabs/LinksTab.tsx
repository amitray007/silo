import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useCleanDefaults, useCleanPreview, useSettings, useUpdateSettings } from '../../api/hooks';
import type { LinkCleaning, LinkCleaningSite } from '../../api/types';
import {
  addParams,
  domainProblem,
  EVERY_SITE_MAX,
  normalizeDomain,
  SITE_PARAMS_MAX,
  SITES_MAX,
  withSite,
} from '../../lib/linkCleaning';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { ReaderIcon } from '../reader/ReaderIcon';
import { Spinner } from '../Spinner';
import { rowDesc, rowLabel, settingsField, settingsRow, settingsRowDivided } from './rowStyles';
import { ToggleSwitch } from './ToggleSwitch';

type Change = (current: LinkCleaning) => LinkCleaning;

/** Removable parameter names with one field to add more. Accepts a comma or space separated paste. */
function ParamChips({
  label,
  names,
  max,
  placeholder,
  onChange,
}: {
  /** Names the list for assistive tech, like `Every site` or `youtube.com strip`. */
  label: string;
  names: readonly string[];
  max: number;
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    const result = addParams(names, draft, max);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    onChange(result.list);
    setDraft('');
    setProblem(null);
  };
  return (
    <div className="silo-lc-params">
      {names.length > 0 && (
        <ul className="silo-lc-chips" aria-label={label}>
          {names.map((name) => (
            <li key={name} className="silo-lc-chip">
              <span>{name}</span>
              <button
                type="button"
                className="silo-lc-chip-x"
                aria-label={`Remove ${name} from ${label}`}
                onClick={() => {
                  onChange(names.filter((item) => item !== name));
                  input.current?.focus();
                }}
              >
                <ReaderIcon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="silo-lc-add" onSubmit={submit} aria-label={`Add to ${label}`}>
        <input
          ref={input}
          className="silo-field"
          style={{ ...settingsField, flex: 1, minWidth: 0 }}
          value={draft}
          placeholder={placeholder}
          aria-label={`Add to ${label}`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
        />
        <button type="submit" className="silo-settings-btn" disabled={!draft.trim()}>
          Add
        </button>
      </form>
      {problem && (
        <div id={errorId} role="alert" className="silo-qa-error silo-lc-problem">
          {problem}
        </div>
      )}
    </div>
  );
}

/** A domain field for adding or renaming a site rule. Normalizes before it saves. */
function DomainForm({
  initial,
  others,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: string;
  others: readonly string[];
  submitLabel: string;
  onSave: (domain: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const ids = { input: useId(), error: useId() };
  useEffect(() => field.current?.focus(), []);
  useEscapeLayer(true, onCancel);
  return (
    <form
      className="silo-lc-domain-form"
      aria-label={initial ? `Rename ${initial}` : 'New site rule'}
      onSubmit={(event) => {
        event.preventDefault();
        const domain = normalizeDomain(draft);
        const refusal = domainProblem(
          domain,
          others.filter((other) => other !== initial),
        );
        if (refusal) {
          setProblem(refusal);
          return;
        }
        onSave(domain);
      }}
    >
      <div className="silo-lc-add">
        <input
          ref={field}
          id={ids.input}
          className="silo-field"
          style={{ ...settingsField, flex: 1, minWidth: 0 }}
          value={draft}
          placeholder="youtube.com"
          aria-label="Domain"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? ids.error : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
        />
        <button type="submit" className="silo-settings-hero-btn-primary">
          {submitLabel}
        </button>
        <button type="button" className="silo-settings-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {problem && (
        <div id={ids.error} role="alert" className="silo-qa-error silo-lc-problem">
          {problem}
        </div>
      )}
    </form>
  );
}

function SiteRow({
  site,
  domains,
  write,
}: {
  site: LinkCleaningSite;
  domains: readonly string[];
  write: (change: Change) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const row = useRef<HTMLLIElement>(null);
  const focusAfter = (selector: string) =>
    requestAnimationFrame(() => row.current?.querySelector<HTMLElement>(selector)?.focus());
  const closeDelete = () => {
    setMode('view');
    focusAfter('[data-delete]');
  };
  useEscapeLayer(mode === 'delete', closeDelete);
  const update = (change: (current: LinkCleaningSite) => LinkCleaningSite) =>
    write((config) => ({ ...config, sites: withSite(config.sites, site.domain, change) }));

  if (mode === 'edit')
    return (
      <li ref={row} data-site={site.domain}>
        <DomainForm
          initial={site.domain}
          others={domains}
          submitLabel="Save"
          onSave={(domain) => {
            update((current) => ({ ...current, domain }));
            setMode('view');
          }}
          onCancel={() => {
            setMode('view');
            focusAfter('[data-edit]');
          }}
        />
      </li>
    );
  return (
    <li ref={row} data-site={site.domain} className="silo-lc-site">
      <div className="silo-lc-site-head">
        <h5 style={rowLabel}>{site.domain}</h5>
        <div className="silo-qa-controls">
          {mode === 'delete' ? (
            <>
              <span className="silo-qa-ask" role="status">
                Remove {site.domain}?
              </span>
              <button
                type="button"
                className="silo-settings-btn silo-qa-danger"
                onClick={() =>
                  write((config) => ({
                    ...config,
                    sites: config.sites.filter((item) => item.domain !== site.domain),
                  }))
                }
              >
                Remove
              </button>
              <button type="button" className="silo-settings-btn" onClick={closeDelete}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="silo-settings-btn silo-qa-icon"
                data-edit
                aria-label={`Edit ${site.domain}`}
                onClick={() => setMode('edit')}
              >
                <ReaderIcon name="edit" size={16} />
              </button>
              <button
                type="button"
                className="silo-settings-btn silo-qa-icon"
                data-delete
                aria-label={`Remove ${site.domain}`}
                onClick={() => {
                  setMode('delete');
                  focusAfter('.silo-qa-danger');
                }}
              >
                <ReaderIcon name="trash" size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="silo-lc-site-lists">
        <div>
          <div className="silo-lc-kind">Strip</div>
          <ParamChips
            label={`${site.domain} strip`}
            names={site.strip}
            max={SITE_PARAMS_MAX}
            placeholder="si, feature"
            onChange={(strip) => update((current) => ({ ...current, strip }))}
          />
        </div>
        <div>
          <div className="silo-lc-kind">Keep</div>
          <ParamChips
            label={`${site.domain} keep`}
            names={site.keep}
            max={SITE_PARAMS_MAX}
            placeholder="t"
            onChange={(keep) => update((current) => ({ ...current, keep }))}
          />
        </div>
      </div>
    </li>
  );
}

function TryLink({ config }: { config: LinkCleaning }) {
  const [url, setUrl] = useState('');
  const preview = useCleanPreview();
  // A result describes the rules in force when it ran. Hide it once the rules change.
  const [ranWith, setRanWith] = useState('');
  const rules = JSON.stringify(config);
  const matchesInput = preview.variables === url.trim();
  const result = preview.data && matchesInput && ranWith === rules ? preview.data : null;
  return (
    <div className="silo-lc-try">
      <form
        className="silo-lc-add"
        aria-label="Try a link"
        onSubmit={(event) => {
          event.preventDefault();
          const value = url.trim();
          if (!value) return;
          setRanWith(rules);
          preview.mutate(value);
        }}
      >
        <input
          className="silo-field"
          style={{ ...settingsField, flex: 1, minWidth: 0 }}
          value={url}
          placeholder="https://example.com/post?utm_source=newsletter"
          aria-label="Link to try"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="silo-settings-btn"
          disabled={!url.trim() || preview.isPending}
        >
          Try
        </button>
      </form>
      {preview.isError && matchesInput && ranWith === rules && (
        <div role="alert" className="silo-qa-error silo-lc-problem">
          Enter a full web address that starts with http:// or https://.
        </div>
      )}
      {result && (
        <div className="silo-lc-result" role="status">
          <div className="silo-lc-kind">Cleaned link</div>
          <div className="silo-lc-url">{result.url}</div>
          {result.removed.length > 0 ? (
            <div className="silo-lc-removed">
              Removed{' '}
              {[...new Set(result.removed)].map((name) => (
                <span key={name} className="silo-lc-chip silo-lc-chip-static">
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="silo-lc-removed">Nothing to remove.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ResetControl({ onReset, pending }: { onReset: () => void; pending: boolean }) {
  const [asking, setAsking] = useState(false);
  const cancel = () => setAsking(false);
  useEscapeLayer(asking, cancel);
  return (
    <div className="silo-qa-controls">
      {asking ? (
        <>
          <span className="silo-qa-ask" role="status">
            Replace your lists with the defaults?
          </span>
          <button
            type="button"
            className="silo-settings-btn silo-qa-danger"
            disabled={pending}
            onClick={() => {
              setAsking(false);
              onReset();
            }}
          >
            Reset
          </button>
          <button type="button" className="silo-settings-btn" onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="silo-settings-btn" onClick={() => setAsking(true)}>
          Reset to defaults
        </button>
      )}
    </div>
  );
}

/**
 * Settings → Links: whether served links drop tracking parameters, and which. The saved rules
 * never touch a stored URL; they apply when a link is shown, opened, copied, or served.
 */
export function LinksTab() {
  const { data: settings, isError, refetch } = useSettings();
  const updateSettings = useUpdateSettings();
  const defaults = useCleanDefaults();
  const saved = settings?.linkCleaning;
  const latest = useRef(saved);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // Quick edits in a row build on the newest value, not on a render that has not caught up yet.
  useEffect(() => {
    if (!updateSettings.isPending) latest.current = saved;
  }, [saved, updateSettings.isPending]);

  if (isError)
    return (
      <div role="alert" className="silo-qa-error silo-lc-problem">
        Could not load link settings.{' '}
        <button type="button" className="silo-settings-btn" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  if (!saved) return <Spinner label="Loading settings" />;
  const config = latest.current && updateSettings.isPending ? latest.current : saved;

  const save = (next: LinkCleaning) => {
    latest.current = next;
    setError(null);
    updateSettings.mutate(
      { linkCleaning: next },
      { onError: (failure) => setError(failure.message || 'Could not save link cleaning.') },
    );
  };
  const write = (change: Change) => save(change(latest.current ?? saved));
  const domains = config.sites.map((site) => site.domain);

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Clean links</div>
          <div style={rowDesc}>
            Hides tracking parameters like utm_source. Saved links keep the original.
          </div>
        </div>
        <ToggleSwitch
          label="Clean links"
          on={config.enabled}
          onToggle={() => write((current) => ({ ...current, enabled: !current.enabled }))}
        />
      </div>
      {error && (
        <div role="alert" className="silo-qa-error silo-lc-problem">
          {error}
        </div>
      )}
      <section aria-label="Try a link" className="silo-lc-section">
        <div style={settingsRow} className="silo-qa-head">
          <div className="silo-qa-copy">
            <h4 style={rowLabel}>Try a link</h4>
            <div style={rowDesc}>See what your saved rules do to a link.</div>
          </div>
        </div>
        <TryLink config={config} />
      </section>
      <section aria-label="Every site" className="silo-lc-section">
        <div style={settingsRow} className="silo-qa-head">
          <div className="silo-qa-copy">
            <h4 style={rowLabel}>Every site</h4>
            <div style={rowDesc}>
              Parameters removed from links on any site. A name ending in * matches every name that
              starts the same way.
            </div>
          </div>
          <ResetControl
            pending={defaults.isPending}
            onReset={() =>
              defaults.mutate(undefined, {
                onSuccess: (value) => save(value),
                onError: () => setError('Could not load the default rules.'),
              })
            }
          />
        </div>
        <ParamChips
          label="Every site"
          names={config.everySite}
          max={EVERY_SITE_MAX}
          placeholder="utm_*, fbclid"
          onChange={(everySite) => write((current) => ({ ...current, everySite }))}
        />
      </section>
      <section aria-label="Per site" className="silo-lc-section">
        <div style={settingsRow} className="silo-qa-head">
          <div className="silo-qa-copy">
            <h4 style={rowLabel}>Per site</h4>
            <div style={rowDesc}>
              Extra parameters to strip on one site, and ones to keep there. Keep wins over every
              strip list. A domain also covers its subdomains.
            </div>
          </div>
        </div>
        <ul className="silo-qa-rows">
          {config.sites.map((site) => (
            <SiteRow key={site.domain} site={site} domains={domains} write={write} />
          ))}
        </ul>
        {adding ? (
          <DomainForm
            others={domains}
            submitLabel="Add site"
            onSave={(domain) => {
              write((current) => ({
                ...current,
                sites: [...current.sites, { domain, strip: [], keep: [] }],
              }));
              setAdding(false);
            }}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => addButton.current?.focus());
            }}
          />
        ) : (
          <div className="silo-qa-add">
            <button
              ref={addButton}
              type="button"
              className="silo-settings-btn"
              disabled={config.sites.length >= SITES_MAX}
              onClick={() => setAdding(true)}
            >
              <ReaderIcon name="plus" size={16} />
              Add site
            </button>
          </div>
        )}
      </section>
    </>
  );
}
