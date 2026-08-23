import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_PRIORITY } from '../../shared/api/queries';
import { canPerform } from '../../shared/lib/taskPermissions';
import { priorityTierOf, priorityTierOptions, PRIORITY_TIER_COLOR, PRIORITY_TIER_VALUE } from '../../shared/lib/taskPriority';
import type { ProjectMemberRole } from '../../shared/model/types';
import { PriorityTag } from '../../shared/ui/PriorityTag';

interface Props {
  id: string;
  value: number | null | undefined;
  role?: ProjectMemberRole | null;
  onDone?: () => void;
}

// T-context: reprioritize is pm-only -- everyone else sees a plain
// PriorityTag instead of a control that would just error on change.
export function TaskPrioritySelect({ id, value, role, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const tier = priorityTierOf(value);
  const [mutate, { loading }] = useMutation(UPDATE_TASK_PRIORITY, {
    onCompleted: () => { message.success(t('taskUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  if (!canPerform(role, 'reprioritize')) {
    return <PriorityTag priority={value} />;
  }

  return (
    <Select
      value={tier}
      size="small"
      loading={loading}
      style={{ width: 110, color: PRIORITY_TIER_COLOR[tier] }}
      options={priorityTierOptions(t)}
      onClick={(e) => e.stopPropagation()}
      onChange={(nextTier) => mutate({ variables: { id, priority: PRIORITY_TIER_VALUE[nextTier as keyof typeof PRIORITY_TIER_VALUE] } })}
      variant="borderless"
    />
  );
}
