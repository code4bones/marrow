import { Tag } from 'antd';

const colorMap: Record<string, string> = {
  active: 'green',
  paused: 'orange',
  archived: 'default',
};

export function ProjectStatusBadge({ status }: { status: string }) {
  return <Tag color={colorMap[status] ?? 'default'}>{status}</Tag>;
}
