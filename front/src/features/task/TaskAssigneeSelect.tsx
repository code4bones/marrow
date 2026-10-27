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
  value: string[];
  role?: ProjectMemberRole | null;
  onDone?: () => void;
}

// One shared task may have several project participants. An empty list clears assignment.
export function TaskAssigneeSelect({ id, projectId, value, role, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const { members } = useProjectMembers(projectId);
  const [mutate, { loading }] = useMutation(UPDATE_TASK_ASSIGNEE, {
    onCompleted: () => { message.success(t('assigneesUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  // PM and Developer can assign; other roles see the current
  // assignee as plain text instead of a control that would just error.
  if (!canPerform(role, 'assign')) {
    const email = value.map((id) => members.find((m) => m.userId === id)?.email ?? id).join(', ');
    return <Typography.Text style={{ fontSize: 13 }}>{email || t('unassigned')}</Typography.Text>;
  }

  return (
    <Select
      mode="multiple"
      value={value}
      placeholder={t('unassigned')}
      showSearch
      optionFilterProp="label"
      disabled={loading}
      allowClear
      size="small"
      loading={loading}
      style={{ width: '100%', maxWidth: 420 }}
      options={members.map((m) => ({ label: m.email, value: m.userId }))}
      onClick={(e) => e.stopPropagation()}
      onChange={(assignees: string[]) => { void mutate({ variables: { id, assignees } }).catch(() => {}); }}
      variant="borderless"
    />
  );
}
