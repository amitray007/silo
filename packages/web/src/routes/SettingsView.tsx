import { Navigate, useParams, useSearchParams } from 'react-router';
import { parseSettingsTab, settingsPath } from '../components/SettingsContext';
import { SettingsPage } from '../components/SettingsPage';

/** Legacy Settings links and tab aliases redirect to the canonical page route. */
export function SettingsView() {
  const { tab: path } = useParams<{ tab: string }>();
  const [search] = useSearchParams();
  const tab = parseSettingsTab(path ?? search.get('tab') ?? undefined) ?? 'plugins';
  const canonical = settingsPath(tab);
  if (`/settings/${path ?? ''}` !== canonical) return <Navigate to={canonical} replace />;
  return <SettingsPage />;
}
