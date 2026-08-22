import { useMutation } from '@apollo/client/react';
import { Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { UPDATE_DECISION_ASSIGNEE } from '../../shared/api/queries';
import { useProjectMembers } from '../../shared/lib/useProjectMembers';

interface Props {
  id: string;
  projectId: string | null;
  value: string | null;
  onDone?: () => void;
}

// T-MEMORY-090: mirrors TaskAssigneeSelect -- disabled for common decisions
// (projectId null), which have no member pool to assign from.
export function DecisionAssigneeSelect({ id, projectId, value, onDone }: Props) {
  const { t } = useTranslation('decisions');
  const { members } = useProjectMembers(projectId);
  const [mutate, { loading }] = useMutation(UPDATE_DECISION_ASSIGNEE, {
    onCompleted: () => { message.success(t('assigneeUpdated')); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  if (!projectId) {
    return null;
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
