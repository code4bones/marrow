const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function formatBotTime(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? timeFormat.format(date) : '—';
}

export function formatBotDateTime(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${dateFormat.format(date)} ${timeFormat.format(date)}` : '—';
}
