import { useMutation } from '@apollo/client/react';
import { Select, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_ASSIGNEE } from '../../shared/api/queries';
import { canPerform } from '../../shared/lib/taskPermissions';
import { useProjectMembers } from '../../shared/lib/useProjectMembers';
import type { ProjectMemberRole } from '../../shared/model/types';

interface Props {
  id: string;
  projectId: string | null;
  value: string | null;
  role?: ProjectMemberRole | null;
  onDone?: () => void;
}

// T-MEMORY-090: mirrors TaskStatusSelect's shape -- a null value here means
// "unassigned (= owner)", not "no member picked yet".
export function TaskAssigneeSelect({ id, projectId, value, role, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const { members } = useProjectMembers(projectId);
  const [mutate, { loading }] = useMutation(UPDATE_TASK_ASSIGNEE, {
    onCompleted: () => { message.success(t('assigneeUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  // T-context: assign is pm-only -- everyone else sees the current
  // assignee as plain text instead of a control that would just error.
  if (!canPerform(role, 'assign')) {
    const email = members.find((m) => m.userId === value)?.email;
    return <Typography.Text style={{ fontSize: 13 }}>{email ?? t('unassigned')}</Typography.Text>;
  }

  return (
    <Select
      value={value ?? undefined}
      placeholder={t('unassigned')}
      allowClear
      size="small"
      loading={loading}
      style={{ width: '100%', maxWidth: 260 }}
      options={members.map((m) => ({ label: m.email, value: m.userId }))}
      onClick={(e) => e.stopPropagation()}
      onChange={(assignee) => mutate({ variables: { id, assignee: assignee ?? null } })}
      onClear={() => mutate({ variables: { id, assignee: null } })}
      variant="borderless"
    />
  );
}
