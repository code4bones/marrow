import { Tag } from 'antd';

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  open: 'green',
  in_progress: 'blue',
  done: 'default',
  paused: 'orange',
  blocked: 'red',
  archived: 'default',
  draft: 'purple',
  superseded: 'default',
  rejected: 'red',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Tag color={STATUS_COLORS[status] ?? 'default'} style={{ textTransform: 'uppercase', fontSize: 11 }}>
      {status}
    </Tag>
  );
}
