import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';
import { RequestChangesModal } from './RequestChangesModal';
import { TASK_STATUS_COLOR } from './taskStatusColor';

function options(t: (key: string) => string) {
  return [
    { label: t('statusTodo'),             value: 'todo' },
    { label: t('statusDoing'),            value: 'doing' },
    { label: t('statusBlocked'),          value: 'blocked' },
    { label: t('statusReview'),           value: 'review' },
    { label: t('statusChangesRequested'), value: 'changes_requested' },
    { label: t('statusDone'),             value: 'done' },
    { label: t('statusCancelled'),        value: 'cancelled' },
  ];
}

interface Props {
  id: string;
  value: string;
  onDone?: () => void;
}

// T-MEMORY-115: picking "Changes Requested" opens RequestChangesModal for a
// mandatory reason (seeds the auto-created follow-up task's scope) instead
// of firing the mutation immediately -- every other status change is a
// plain, single-step select same as before.
export function TaskStatusSelect({ id, value, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [mutate, { loading }] = useMutation(UPDATE_TASK_STATUS, {
    onCompleted: () => { message.success(t('statusUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  const handleChange = (status: string) => {
    if (status === 'changes_requested') {
      setRequestChangesOpen(true);
      return;
    }
    mutate({ variables: { id, status } });
  };

  return (
    <>
      <Select
        value={value}
        size="small"
        loading={loading}
        style={{ width: 150, color: TASK_STATUS_COLOR[value] }}
        options={options(t)}
        onClick={(e) => e.stopPropagation()}
        onChange={handleChange}
        variant="borderless"
      />
      <RequestChangesModal
        open={requestChangesOpen}
        loading={loading}
        onCancel={() => setRequestChangesOpen(false)}
        onSubmit={(note) => {
          mutate({ variables: { id, status: 'changes_requested', note } });
          setRequestChangesOpen(false);
        }}
      />
    </>
  );
}
