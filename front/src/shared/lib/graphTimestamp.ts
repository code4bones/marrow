/**
 * Compact stamp for graph node cards (GraphTree, DecisionTimeline). Was
 * MM.DD.YY -- owner's original ask, but that was a mistake (month-first
 * reads wrong day-month-year like everywhere else in the app, e.g.
 * shared/ui/Timestamp's ru-RU DD.MM.YY). Now DD.MM.YY, except the year is
 * dropped in favor of an abbreviated month name when it's the current
 * year -- "10 авг 14:30" instead of "10.08.26 14:30" -- since the year adds
 * nothing for the overwhelming majority of nodes (created this year) and
 * just adds noise to every single stamp.
 */
export function formatGraphTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());

  if (d.getFullYear() === new Date().getFullYear()) {
    const dayMonth = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    return `${dayMonth} ${hh}:${min}`;
  }

  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = pad(d.getFullYear() % 100);
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
}
