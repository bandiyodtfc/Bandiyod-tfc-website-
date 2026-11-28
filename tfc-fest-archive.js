// TFC v92.0: date-based archive, original published records stay intact.
export const GAMES_FEST_END = Date.parse('2027-01-13T00:00:00+05:30');
export function archiveAt(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const start = Date.parse(date + 'T00:00:00+05:30');
  if (!Number.isFinite(start) || new Date(start + 19800000).toISOString().slice(0,10) !== date) return null;
  return start + 86400000;
}
export function isArchived(post, now) {
  return Number.isFinite(post?.archiveAt) && post.archiveAt > 0 && now >= post.archiveAt;
}
export function archiveDate(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value - 86400000 + 19800000).toISOString().slice(0,10) : '';
}
