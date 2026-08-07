import { Tooltip, Typography } from 'antd';

function fmt(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Tooltip title={value}>
      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {fmt(value)}
      </Typography.Text>
    </Tooltip>
  );
}
