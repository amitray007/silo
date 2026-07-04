import { useParams } from 'react-router-dom';
import { ComingSoon } from '../components';

/** `/tags/:name` — a tag-filtered list lands in a later slice. */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  return (
    <ComingSoon
      title={`#${name} — coming soon`}
      subtitle="Links tagged with this will appear here."
    />
  );
}
