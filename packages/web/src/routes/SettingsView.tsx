import { Navigate, useParams, useSearchParams } from 'react-router';
import { parseSettingsTab } from '../components/SettingsContext';

/** Every legacy Settings URL opens the shared modal over the library. */
export function SettingsView() {
  const params = useParams();
  const [search] = useSearchParams();
  const tab =
    parseSettingsTab(params['*']?.split('/')[0] || search.get('tab') || undefined) ?? 'plugins';
  return <Navigate to="/" replace state={{ settingsTab: tab }} />;
}
