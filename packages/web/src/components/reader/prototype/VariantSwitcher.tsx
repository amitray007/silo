// biome-ignore-all lint/a11y/useSemanticElements: throwaway prototype
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { ProtoIcon } from './ProtoIcon';
import { inTextEntry, plain } from './protoKeys';

export const VARIANTS = ['A', 'B', 'C'] as const;
export type Variant = (typeof VARIANTS)[number];
const NAMES: Record<Variant, string> = {
  A: 'Toolbar + popovers',
  B: 'Bottom dock',
  C: 'Side rail + margin notes',
};

export function useVariant() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('variant')?.toUpperCase();
  const variant: Variant = raw === 'A' || raw === 'C' ? raw : 'B';
  const setVariant = useCallback(
    (next: Variant) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          copy.set('variant', next);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );
  const cycle = useCallback(
    (delta: number) => {
      const at = VARIANTS.indexOf(variant);
      setVariant(VARIANTS[(at + delta + VARIANTS.length) % VARIANTS.length] ?? 'A');
    },
    [variant, setVariant],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event as KeyboardEvent & { __protoPass?: boolean }).__protoPass) return;
      if (inTextEntry(event) || !plain(event)) return;
      if (event.key !== '[' && event.key !== ']') return;
      // The app binds "[" to the sidebar; the prototype wins while it is mounted.
      event.preventDefault();
      event.stopPropagation();
      cycle(event.key === ']' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cycle]);
  return { variant, cycle };
}

export function VariantSwitcher({
  variant,
  cycle,
}: {
  variant: Variant;
  cycle: (delta: number) => void;
}) {
  return createPortal(
    <div className="proto-switcher" role="group" aria-label="Prototype variant">
      <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}>
        <ProtoIcon name="chevronLeft" size={16} />
      </button>
      <span>
        {variant} ({NAMES[variant]})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => cycle(1)}>
        <ProtoIcon name="chevronRight" size={16} />
      </button>
    </div>,
    document.body,
  );
}
