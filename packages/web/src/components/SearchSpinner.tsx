import { Blocks } from 'loading-dev';
import { useEffect, useState } from 'react';

/** Delay first-fetch feedback; cached results and completed requests stay quiet. */
export function SearchSpinner({ pending, query }: { pending: boolean; query: string }) {
  const [visibleQuery, setVisibleQuery] = useState<string | null>(null);
  useEffect(() => {
    setVisibleQuery(null);
    if (!pending) return;
    const timer = setTimeout(() => setVisibleQuery(query), 150);
    return () => clearTimeout(timer);
  }, [pending, query]);
  if (!pending || visibleQuery !== query) return null;
  return (
    <span role="status" aria-label="Searching" className="silo-palette-searching">
      <Blocks size={16} color="currentColor" />
    </span>
  );
}
