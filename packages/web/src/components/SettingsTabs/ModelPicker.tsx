import { Command } from 'cmdk';
import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { AiProviderJson, AiProviderKind } from '../../api/types';
import { AI_PROVIDER_NAMES } from '../../lib/aiModels';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { trapDialogTab } from '../ModalShell';
import {
  filterModelGroups,
  isolateCommandKeys,
  keyedModelGroups,
  type ModelChoice,
  type ModelGroup,
  ModelOptions,
} from './modelOptions';
import { ProviderLogo } from './ProviderLogo';

/** Mounted only while open, so each new search starts with all providers. */
function ModelPickerPopover({
  id,
  label,
  groups,
  value,
  missing,
  trigger,
  onClose,
  onPick,
}: {
  id: string;
  label: string;
  groups: ModelGroup[];
  value: ModelChoice | null;
  missing: string | null;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onPick: (choice: ModelChoice) => void;
}) {
  const [provider, setProvider] = useState<AiProviderKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previousFilter = useRef({ search, provider });
  const visibleGroups = useMemo(
    () =>
      filterModelGroups(
        provider === 'all' ? groups : groups.filter((group) => group.kind === provider),
        search,
      ),
    [groups, provider, search],
  );
  useEscapeLayer(true, onClose);

  useLayoutEffect(() => {
    if (previousFilter.current.search === search && previousFilter.current.provider === provider) {
      return;
    }
    previousFilter.current = { search, provider };
    // cmdk activates the first rendered item on each input change, even with filtering off.
    if (list.current) list.current.scrollTop = 0;
  }, [search, provider]);

  useLayoutEffect(() => {
    // The content pane excludes Settings' header and close button.
    const boundary = trigger?.closest('.silo-settings-panel, .silo-modal-panel');
    function place() {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const bounds = boundary?.getBoundingClientRect();
      const left = Math.max(0, bounds?.left ?? 0) + 8;
      const right = Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 8;
      const top = Math.max(0, bounds?.top ?? 0) + 8;
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 8;
      const width = Math.max(0, Math.min(Math.max(rect.width, 380), 420, right - left));
      const belowAnchor = Math.max(top, Math.min(rect.bottom + 4, bottom));
      const aboveAnchor = Math.max(top, Math.min(rect.top - 4, bottom));
      const below = Math.max(0, bottom - belowAnchor);
      const above = Math.max(0, aboveAnchor - top);
      const flip = below < 400 && above > below;
      const anchor = flip
        ? {
            '--model-top': 'auto',
            '--model-bottom': `${window.innerHeight - aboveAnchor}px`,
            '--model-fixed-height': 'min(400px, var(--model-height))',
          }
        : {
            '--model-top': `${belowAnchor}px`,
            '--model-bottom': 'auto',
            '--model-fixed-height': 'auto',
          };
      setPosition({
        ...anchor,
        '--model-left': `${Math.max(left, Math.min(rect.right - width, right - width))}px`,
        '--model-width': `${width}px`,
        '--model-height': `${flip ? above : below}px`,
      } as CSSProperties);
    }
    function onScroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) place();
    }
    place();
    const observer = new ResizeObserver(place);
    if (boundary) observer.observe(boundary);
    if (trigger) observer.observe(trigger);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [trigger]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger?.contains(target)) onClose();
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [trigger, onClose]);

  return createPortal(
    <div className="silo-model-picker-layer">
      <button
        type="button"
        className="silo-model-picker-scrim"
        aria-label="Close model picker"
        onClick={onClose}
      />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="silo-model-picker-popover"
        style={position}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          trapDialogTab(event);
          event.stopPropagation();
        }}
      >
        <Command
          label="Search models"
          shouldFilter={false}
          defaultValue={missing || !value ? '' : JSON.stringify([value.provider, value.id])}
          loop
        >
          <div className="silo-palette-input">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <Command.Input
              ref={input}
              placeholder="Search models"
              aria-label="Search models"
              autoCapitalize="off"
              spellCheck={false}
              onValueChange={setSearch}
            />
          </div>
          {missing && <p className="silo-model-missing silo-model-missing-header">{missing}</p>}
          <fieldset className="silo-model-provider-chips" aria-label="Filter by provider">
            <button
              type="button"
              className="silo-model-chip"
              aria-pressed={provider === 'all'}
              onKeyDown={isolateCommandKeys}
              onClick={() => setProvider('all')}
            >
              All
            </button>
            {groups.map((group) => (
              <button
                key={group.kind}
                type="button"
                className="silo-model-chip"
                aria-pressed={provider === group.kind}
                onKeyDown={isolateCommandKeys}
                onClick={() => setProvider(group.kind)}
              >
                <ProviderLogo kind={group.kind} size={14} />
                {AI_PROVIDER_NAMES[group.kind]}{' '}
                <span className="silo-model-count">{group.models.length}</span>
              </button>
            ))}
          </fieldset>
          <Command.List ref={list} label="Models">
            <Command.Empty>
              {!groups.length
                ? 'Add a key in Providers'
                : !search && groups.every((group) => group.models.length === 0)
                  ? 'No models loaded yet - use Refresh on a provider'
                  : 'No models match'}
            </Command.Empty>
            <ModelOptions groups={visibleGroups} value={value} onPick={onPick} />
          </Command.List>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

/** Searchable per-feature choice; settings writes stay with the AI tab. */
export function ModelPicker({
  label,
  providers,
  value,
  disabled,
  onChange,
}: {
  label: string;
  providers: AiProviderJson[];
  value: ModelChoice | null;
  disabled?: boolean;
  onChange: (choice: ModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreAfterSave = useRef(false);
  useEffect(() => {
    if (!disabled && restoreAfterSave.current) {
      trigger.current?.focus({ preventScroll: true });
      restoreAfterSave.current = false;
    }
  }, [disabled]);
  const id = useId();
  const groups = useMemo(() => keyedModelGroups(providers), [providers]);
  const chosen = providers
    .find((p) => p.kind === value?.provider)
    ?.models?.find((m) => m.id === value?.id);
  const missing = value && !chosen ? `${value.id} - no longer available` : null;
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return (
    <span className="silo-model-picker">
      <button
        ref={trigger}
        type="button"
        className="silo-settings-select-trigger silo-model-picker-trigger"
        aria-label={label}
        aria-description={missing ?? undefined}
        title={missing ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {value && <ProviderLogo kind={value.provider} size={18} />}
        <span className="silo-model-trigger-copy">
          {missing ? (
            <span className="silo-model-missing">
              <span className="silo-model-missing-id">{value?.id}</span>
              <span> - no longer available</span>
            </span>
          ) : (
            <span>{chosen?.label ?? 'Choose a model'}</span>
          )}
          {value && <span className="silo-model-via"> · {AI_PROVIDER_NAMES[value.provider]}</span>}
        </span>
        <span aria-hidden="true" className="silo-model-chevron">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m4.5 6.5 3.5 3 3.5-3" />
          </svg>
        </span>
      </button>
      {open && !disabled && (
        <ModelPickerPopover
          id={id}
          label={label}
          groups={groups}
          value={value}
          missing={missing}
          trigger={trigger.current}
          onClose={close}
          onPick={(choice) => {
            restoreAfterSave.current = true;
            close();
            onChange(choice);
          }}
        />
      )}
    </span>
  );
}
