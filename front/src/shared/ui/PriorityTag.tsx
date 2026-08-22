import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { priorityTierLabel, priorityTierOf, PRIORITY_TIER_COLOR } from '../lib/taskPriority';

export function PriorityTag({ priority }: { priority: number | null | undefined }) {
  const { t } = useTranslation('tasks');
  const tier = priorityTierOf(priority);
  return (
    <Tag color={PRIORITY_TIER_COLOR[tier]} style={{ fontSize: 10, margin: 0 }}>
      {priorityTierLabel(t, tier)}
    </Tag>
  );
}
