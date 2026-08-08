import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';
import { TASK_STATUS_COLOR } from './taskStatusColor';

function options(t: (key: string) => string) {
  return [
    { label: t('statusTodo'),      value: 'todo' },
    { label: t('statusDoing'),     value: 'doing' },
    { label: t('statusBlocked'),   value: 'blocked' },
    { label: t('statusDone'),      value: 'done' },
    { label: t('statusCancelled'), value: 'cancelled' },
  ];
}

interface Props {
  id: string;
  value: string;
  onDone?: () => void;
}

export function TaskStatusSelect({ id, value, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const [mutate, { loading }] = useMutation(UPDATE_TASK_STATUS, {
    onCompleted: () => { message.success(t('statusUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Select
      value={value}
      size="small"
      loading={loading}
      style={{ width: 105, color: TASK_STATUS_COLOR[value] }}
      options={options(t)}
      onClick={(e) => e.stopPropagation()}
      onChange={(status) => mutate({ variables: { id, status } })}
      variant="borderless"
    />
  );
}
