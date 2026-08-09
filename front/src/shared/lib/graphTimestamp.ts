/** MM.DD.YY HH:mm, fixed regardless of locale -- the graph views (GraphTree, DecisionTimeline) want a compact, unambiguous stamp on every node, distinct from shared/ui/Timestamp's DD.MM.YY (ru-RU) convention used elsewhere in the app. */
export function formatGraphTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const yy = pad(d.getFullYear() % 100);
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${mm}.${dd}.${yy} ${hh}:${min}`;
}
