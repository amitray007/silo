import type { ReactNode } from 'react';
import { ContentHeader } from '../../components/ContentHeader';

/** Shared header and scrolling list body for Library and Tag views. */
export function ContentFrame({
  title,
  count,
  captureError,
  headerSlot,
  headerBelow,
  children,
  fadeKey,
}: {
  title: ReactNode;
  count?: ReactNode;
  captureError?: string;
  headerSlot: ReactNode;
  /** Full-width row inside the header, under the title. */
  headerBelow?: ReactNode;
  children: ReactNode;
  /**
   * Keys the `.silo-route-fade` wrapper so its `@starting-style` entrance
   * re-fires on navigations that DON'T remount this component. Library↔Tag
   * swaps different component types (natural remount → fade fires), but
   * Tag→Tag (`/tags/foo`→`/tags/bar`) renders the SAME `TagView` at the same
   * `<Outlet/>` position, so React reconciles the node and the fade would be
   * silently skipped. Passing the tag name here forces a fresh node per tag
   * so tag→tag fades like every other route change (review finding).
   */
  fadeKey?: string;
}) {
  return (
    <>
      <ContentHeader
        title={title}
        collection={title === 'Library'}
        count={count}
        below={headerBelow}
        {...(captureError !== undefined ? { captureError } : {})}
      >
        {headerSlot}
      </ContentHeader>
      <div className="silo-content-body">
        <div key={fadeKey} className="silo-content-col silo-route-fade">
          {children}
        </div>
      </div>
    </>
  );
}
