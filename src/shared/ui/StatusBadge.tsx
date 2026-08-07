import { Tag } from 'antd';
import { STATUS_COLORS } from './statusColors';

export function StatusBadge({ status }: { status: string }) {
  return (
    <Tag color={STATUS_COLORS[status] ?? 'default'} style={{ textTransform: 'uppercase', fontSize: 11 }}>
      {status}
    </Tag>
  );
}
