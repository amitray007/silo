import { useParams } from 'react-router-dom';
import { ComingSoon, ContentHeader } from '../components';

/** `/tags/:name` — a tag-filtered list lands in a later slice. */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  return (
    <>
      <ContentHeader title={`#${name}`} />
      <div className="silo-content-body">
        <div className="silo-content-col">
          <ComingSoon
            title={`#${name} — coming soon`}
            subtitle="Links tagged with this will appear here."
          />
        </div>
      </div>
    </>
  );
}
