import { useSyncExternalStore } from 'react';

/** Keep the CSS width modes in layout.css aligned with these boundaries. */
export const layoutMedia = {
  phone: '(max-width: 640px)',
  sidebar: '(min-width: 641px)',
  fullWindowReader: '(max-width: 1023px)',
} as const;

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const media = matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
