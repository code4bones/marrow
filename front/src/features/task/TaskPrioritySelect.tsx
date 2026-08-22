import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_PRIORITY } from '../../shared/api/queries';
import { priorityTierOf, priorityTierOptions, PRIORITY_TIER_COLOR, PRIORITY_TIER_VALUE } from '../../shared/lib/taskPriority';

interface Props {
  id: string;
  value: number | null | undefined;
  onDone?: () => void;
}

// Mirrors TaskStatusSelect's shape. Always rendered regardless of the
// viewer's own role -- same "backend enforces, control doesn't hide itself"
// convention TaskStatusSelect/TaskAssigneeSelect already follow; a caller
// without the reprioritize permission gets a normal error toast on change.
export function TaskPrioritySelect({ id, value, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const tier = priorityTierOf(value);
  const [mutate, { loading }] = useMutation(UPDATE_TASK_PRIORITY, {
    onCompleted: () => { message.success(t('taskUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

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
