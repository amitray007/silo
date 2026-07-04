import { ComingSoon } from '../components';

/** Catch-all — a calm not-found rather than a hard error for unknown paths. */
export function NotFoundView() {
  return <ComingSoon title="Not found" subtitle="That page doesn't exist." />;
}
