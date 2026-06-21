import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';

const OPTIONS = [
  { label: 'Todo',      value: 'todo' },
  { label: 'Doing',     value: 'doing' },
  { label: 'Blocked',   value: 'blocked' },
  { label: 'Done',      value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

const COLOR: Record<string, string> = {
  todo: '#595959', doing: '#177ddc', blocked: '#d89614',
  done: '#52c41a', cancelled: '#434343',
};

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
      style={{ width: 105, color: COLOR[value] }}
      options={OPTIONS}
      onClick={(e) => e.stopPropagation()}
      onChange={(status) => mutate({ variables: { id, status } })}
      variant="borderless"
    />
  );
}
