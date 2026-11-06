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
import { useAi, useSettings } from '../../../api/hooks';
import type { AiProviderJson, AiProviderKind } from '../../../api/types';
import { AI_PROVIDER_NAMES } from '../../../lib/aiModels';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { trapDialogTab } from '../../ModalShell';
import {
  filterModelGroups,
  keyedModelGroups,
  type ModelChoice,
  ModelOptions,
  modelLabel,
} from '../../SettingsTabs/modelOptions';
import { ProviderLogo } from '../../SettingsTabs/ProviderLogo';
import { ReaderIcon } from '../ReaderIcon';

const TRY_AGAIN = 'try-again';
const POPOVER_HEIGHT = 420;

/** Providers whose key is stored but cannot be read: named, with no models to pick. */
function unreadableKinds(providers: AiProviderJson[]): AiProviderKind[] {
  return providers.filter((p) => p.configured && !p.keyReadable).map((p) => p.kind);
}

function placeAbove(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const flip = below < POPOVER_HEIGHT && above > below;
  const width = Math.min(300, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return {
    '--model-top': flip ? 'auto' : `${rect.bottom + 4}px`,
    '--model-bottom': flip ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    '--model-left': `${left}px`,
    '--model-width': `${width}px`,
    '--model-height': `${Math.min(POPOVER_HEIGHT, flip ? above : below)}px`,
  } as CSSProperties;
}

function RegeneratePopover({
  trigger,
  current,
  currentLabel,
  providers,
  defaultLabel,
  onClose,
  onPick,
}: {
  trigger: HTMLElement | null;
  current: ModelChoice | null;
  currentLabel: string | null;
  providers: AiProviderJson[];
  defaultLabel: string | null;
  onClose: () => void;
  onPick: (choice?: ModelChoice) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => keyedModelGroups(providers), [providers]);
  const visible = useMemo(() => filterModelGroups(groups, search), [groups, search]);
  const unreadable = search.trim() ? [] : unreadableKinds(providers);
  useEscapeLayer(true, onClose);

  useLayoutEffect(() => {
    if (!trigger) return;
    const place = () => setPosition(placeAbove(trigger));
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
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
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Regenerate answer"
        className="silo-model-picker-popover silo-regen-popover"
        style={position}
        onKeyDown={(event) => {
          trapDialogTab(event);
          event.stopPropagation();
        }}
      >
        <Command label="Regenerate answer" shouldFilter={false} defaultValue={TRY_AGAIN} loop>
          <Command.Item
            value={TRY_AGAIN}
            disabled={search.trim() !== ''}
            className="silo-palette-row silo-regen-again"
            onSelect={() => onPick()}
          >
            <ReaderIcon name="sync" size={16} />
            <span className="silo-regen-again-label">Try again</span>
            {currentLabel && <span className="silo-regen-again-model">{currentLabel}</span>}
          </Command.Item>
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
              placeholder="Regenerate with another model"
              aria-label="Search models"
              autoCapitalize="off"
              spellCheck={false}
              onValueChange={setSearch}
            />
          </div>
          <Command.List label="Models">
            <Command.Empty>{search ? 'No models match' : 'No models loaded yet'}</Command.Empty>
            <ModelOptions groups={visible} value={current} onPick={onPick} logoSize={16} />
            {unreadable.map((kind) => (
              <div key={kind} className="silo-regen-unreadable">
                <span className="silo-regen-unreadable-name">
                  <ProviderLogo kind={kind} size={16} />
                  {AI_PROVIDER_NAMES[kind]}
                </span>
                <span>Key cannot be read. Add it again in Settings → AI.</span>
              </div>
            ))}
          </Command.List>
        </Command>
        <p className="silo-regen-foot">
          Your default stays {defaultLabel ?? 'the model in Settings'}. Change it in Settings → AI.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** The Regenerate button and its model popover. The default model stays a Settings choice. */
export function RegenerateMenu({
  answerModel,
  onRegenerate,
}: {
  answerModel: (ModelChoice & { label: string }) | undefined;
  onRegenerate: (model?: ModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ai = useAi();
  const settings = useSettings({ staleTime: 60_000 });
  const providers = ai.data?.providers ?? [];
  const defaultChoice = settings.data?.ai?.features.librarian?.model ?? null;
  const defaultLabel = modelLabel(providers, defaultChoice);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="silo-reader-iconbtn"
        aria-label="Regenerate answer"
        title="Regenerate answer"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <ReaderIcon name="sync" size={20} />
      </button>
      {open && (
        <RegeneratePopover
          trigger={trigger.current}
          current={answerModel ?? defaultChoice}
          currentLabel={answerModel?.label ?? defaultLabel}
          providers={providers}
          defaultLabel={defaultLabel}
          onClose={close}
          onPick={(choice) => {
            close();
            // Try again repeats the answer's own model; without one the server uses the default.
            onRegenerate(
              choice ?? (answerModel && { provider: answerModel.provider, id: answerModel.id }),
            );
          }}
        />
      )}
    </>
  );
}
