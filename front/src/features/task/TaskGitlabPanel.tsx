import { useMutation, useQuery } from '@apollo/client/react';
import { Button, Select, Space, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPORT_TASK_GITLAB, GET_PROJECT_REPOSITORIES, GET_TASK_GITLAB_STATUS, type ProjectRepository, type TaskGitlabStatus } from '../../shared/api/project-gitlab';
import type { ProjectMemberRole } from '../../shared/model/types';
import { canPerform } from '../../shared/lib/taskPermissions';

export function TaskGitlabPanel({ taskId, projectId, role, assigneeUserId }: {
  taskId: string; projectId: string | null; role?: ProjectMemberRole | null; assigneeUserId?: string | null;
}) {
  const { t } = useTranslation('tasks');
  const [repositoryId, setRepositoryId] = useState<string>();
  const { data, refetch, error } = useQuery<{ taskGitlabStatus: TaskGitlabStatus | null }>(GET_TASK_GITLAB_STATUS, {
    variables: { id: taskId }, pollInterval: 5000,
    skipPollAttempt: (): boolean => !['pending', 'processing', 'uncertain'].includes(data?.taskGitlabStatus?.status ?? ''),
  });
  const { data: repoData } = useQuery<{ projectRepositories: ProjectRepository[] }>(GET_PROJECT_REPOSITORIES, {
    variables: { project: projectId }, skip: !projectId,
  });
  const [exportIssue, { loading }] = useMutation(EXPORT_TASK_GITLAB, {
    onCompleted: () => { void refetch(); }, onError: (e) => message.error(e.message),
  });
  const status = data?.taskGitlabStatus;
  const repositories = repoData?.projectRepositories ?? [];
  if (!status && !repositories.length) return null;
  const canExport = canPerform(role, 'assign') && Boolean(assigneeUserId);
  const needsRepository = status?.lastError === 'REPOSITORY_REQUIRED';
  const retry = status && ['blocked', 'failed', 'cancelled'].includes(status.status);
  const text = status?.lastError === 'GITLAB_ASSIGNEE_NOT_APPLIED' ? t('gitlabAssigneeNotApplied')
    : status?.status === 'uncertain' ? t('gitlabUncertain')
    : ['pending', 'processing'].includes(status?.status ?? '') ? t('gitlabPending')
    : status?.status === 'cancelled' ? t('gitlabCancelled')
    : status?.lastError === 'GITLAB_MAPPING_REQUIRED' ? t('gitlabMappingRequired')
    : status?.lastError === 'GIT_CREDENTIAL_REQUIRED' ? t('gitlabCredentialRequired')
    : status?.status === 'failed' ? t('gitlabFailed') : null;
  return (
    <Space orientation="vertical" size={6} style={{ width: '100%', marginBottom: 14 }}>
      <Typography.Text type="secondary">GitLab</Typography.Text>
      {status?.issueUrl && <Typography.Link href={status.issueUrl} target="_blank" rel="noopener noreferrer">{t('gitlabOpenIssue')}</Typography.Link>}
      {text && <Typography.Text type="secondary">{text}</Typography.Text>}
      {error && <Typography.Text type="danger">{error.message}</Typography.Text>}
      {needsRepository && <Select size="small" style={{ width: '100%' }} value={repositoryId} onChange={setRepositoryId}
        placeholder={t('gitlabRepository')} disabled={!canExport} options={repositories.map((r) => ({ value: r.id, label: `${r.host}/${r.path}` }))} />}
      {canExport && (!status || retry) && <Button size="small" loading={loading} disabled={needsRepository && !repositoryId}
        onClick={() => void exportIssue({ variables: { id: taskId, ...(repositoryId ? { repositoryId } : {}) } })}>
        {t(status ? 'gitlabRetry' : 'gitlabExport')}
      </Button>}
    </Space>
  );
}
