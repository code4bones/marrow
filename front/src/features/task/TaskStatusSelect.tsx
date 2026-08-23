import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';
import type { ProjectMemberRole } from '../../shared/model/types';
import { actionForStatus, canPerform } from '../../shared/lib/taskPermissions';
import { RequestChangesModal } from './RequestChangesModal';
import { TASK_STATUS_COLOR } from './taskStatusColor';

function allOptions(t: (key: string) => string) {
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

// T-context: an option is offered only if the viewer's role can actually
// perform the transition it represents -- except the task's OWN current
// status, always kept so the Select never shows a value with no matching
// option. A Tester sees every status as the current label but can only
// pick Done/Changes Requested; a Developer can pick everything except
// those two.
function options(t: (key: string) => string, role: ProjectMemberRole | null | undefined, currentValue: string) {
  return allOptions(t).filter((option) => option.value === currentValue || canPerform(role, actionForStatus(option.value)));
}

interface Props {
  id: string;
  value: string;
  role?: ProjectMemberRole | null;
  onDone?: () => void;
}

// T-MEMORY-115: picking "Changes Requested" opens RequestChangesModal for a
// mandatory reason (seeds the auto-created follow-up task's scope) instead
// of firing the mutation immediately -- every other status change is a
// plain, single-step select same as before.
export function TaskStatusSelect({ id, value, role, onDone }: Props) {
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
        options={options(t, role, value)}
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
