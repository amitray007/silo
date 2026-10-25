import { ReaderIcon } from './reader/ReaderIcon';

export function LibraryIcon() {
  return <ReaderIcon name="library" />;
}
export function SettingsIcon() {
  return <ReaderIcon name="settings" />;
}
export function LogOutIcon() {
  return <ReaderIcon name="logout" />;
}
export function TrashIcon({
  size = 20,
  stroke = 'currentColor',
}: {
  size?: number;
  stroke?: string;
}) {
  return (
    <span style={{ display: 'contents', color: stroke }}>
      <ReaderIcon name="trash" size={size} />
    </span>
  );
}
export function SearchIcon({
  size = 20,
  stroke = 'currentColor',
}: {
  size?: number;
  stroke?: string;
} = {}) {
  return (
    <span style={{ display: 'contents', color: stroke }}>
      <ReaderIcon name="search" size={size} />
    </span>
  );
}
