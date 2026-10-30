export function isFeedPost(link: { feedId?: string | null } | null | undefined): boolean {
  return link?.feedId != null;
}
