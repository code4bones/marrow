import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';
import { TASK_STATUS_COLOR } from './taskStatusColor';

const OPTIONS = [
  { label: 'Todo',      value: 'todo' },
  { label: 'Doing',     value: 'doing' },
  { label: 'Blocked',   value: 'blocked' },
  { label: 'Done',      value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

interface Props {
  id: string;
  value: string;
  onDone?: () => void;
}

export function TaskStatusSelect({ id, value, onDone }: Props) {
  const [mutate, { loading }] = useMutation(UPDATE_TASK_STATUS, {
    onCompleted: () => { message.success('Status updated'); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Select
      value={value}
      size="small"
      loading={loading}
      style={{ width: 105, color: TASK_STATUS_COLOR[value] }}
      options={OPTIONS}
      onClick={(e) => e.stopPropagation()}
      onChange={(status) => mutate({ variables: { id, status } })}
      variant="borderless"
    />
  );
}
