import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APPROVE_PROJECT_MEMBER, GET_PENDING_PROJECT_MEMBERS, GET_PROJECT_MEMBERS, REJECT_PROJECT_MEMBER, REMOVE_PROJECT_MEMBER, UPDATE_PROJECT_MEMBER_ROLE } from '../../shared/api/queries';
import { GET_PROJECT_GITLAB_MAPPINGS, GET_PROJECT_REPOSITORIES, type ProjectGitlabMapping, type ProjectRepository } from '../../shared/api/project-gitlab';
import type { PendingProjectMember, ProjectMember, ProjectMemberRole } from '../../shared/model/types';
import { Timestamp } from '../../shared/ui/Timestamp';
import { MemberGitlabDialog } from './MemberGitlabDialog';
import { MemberGitlabCell } from './MemberGitlabCell';

interface MemberRow extends ProjectMember { pending: boolean; requestedAt?: string | null }

export function ProjectMembersSection({ slug, canManage, ownerUserId }: { slug: string; canManage: boolean; ownerUserId: string | null }) {
  const { t } = useTranslation('projects');
  const options = { variables: { project: slug }, skip: !canManage };
  const pending = useQuery<{ pendingProjectMembers: PendingProjectMember[] }>(GET_PENDING_PROJECT_MEMBERS, options);
  const members = useQuery<{ projectMembers: ProjectMember[] }>(GET_PROJECT_MEMBERS, options);
  const repositories = useQuery<{ projectRepositories: ProjectRepository[] }>(GET_PROJECT_REPOSITORIES, options);
  const mappings = useQuery<{ projectGitlabMappings: ProjectGitlabMapping[] }>(GET_PROJECT_GITLAB_MAPPINGS, options);
  const [approveRole, setApproveRole] = useState<Record<string, ProjectMemberRole>>({});
  const [selected, setSelected] = useState<{ member: MemberRow; host: string } | null>(null);
  const refresh = () => { void pending.refetch(); void members.refetch(); void mappings.refetch(); };
  const mutationOptions = (key: string) => ({ onCompleted: () => { message.success(t(key)); refresh(); }, onError: (e: Error) => message.error(e.message) });
  const [approve, { loading: approving }] = useMutation(APPROVE_PROJECT_MEMBER, mutationOptions('memberApproved'));
  const [reject, { loading: rejecting }] = useMutation(REJECT_PROJECT_MEMBER, mutationOptions('memberRejected'));
  const [changeRole, { loading: changingRole }] = useMutation(UPDATE_PROJECT_MEMBER_ROLE, mutationOptions('memberRoleUpdated'));
  const [remove, { loading: removing }] = useMutation(REMOVE_PROJECT_MEMBER, mutationOptions('memberRemoved'));
  const roles = [
    { label: t('rolePm'), value: 'pm' }, { label: t('roleDeveloper'), value: 'developer' }, { label: t('roleTester'), value: 'tester' },
  ];
  const hosts = [...new Set((repositories.data?.projectRepositories ?? []).map((repo) => repo.host))];
  const rows: MemberRow[] = [
    ...(pending.data?.pendingProjectMembers ?? []).map((row) => ({ ...row, role: null, pending: true })),
    ...(members.data?.projectMembers ?? []).map((row) => ({ ...row, pending: false })),
  ];
  const error = pending.error ?? members.error ?? mappings.error ?? repositories.error;
  if (!canManage) return null;
  return (
    <Card title={t('members')} size="small" style={{ marginBottom: 16 }}>
      {error && <Alert type="error" title={error.message} showIcon style={{ marginBottom: 8 }} />}
      <Table<MemberRow> rowKey="userId" size="small" loading={pending.loading || members.loading} dataSource={rows}
        pagination={false} scroll={{ x: 880 }} locale={{ emptyText: t('noOtherMembers') }} columns={[
          { title: t('memberAccount'), dataIndex: 'email', width: 240, render: (email: string, row) => (
            <Space orientation="vertical" size={0}><Typography.Text>{email}</Typography.Text>
              {row.pending && row.requestedAt && <Timestamp value={row.requestedAt} />}</Space>
          ) },
          { title: t('memberStatus'), key: 'status', width: 130, render: (_, row) => (
            <Tag color={row.pending ? 'gold' : 'green'}>{t(row.pending ? 'memberPending' : 'memberActive')}</Tag>
          ) },
          { title: t('memberRole'), key: 'role', width: 150, render: (_, row) => row.userId === ownerUserId ? <Tag color="blue">{t('projectOwner')}</Tag> : (
            <Select size="small" style={{ width: 130 }} options={roles} placeholder={t('chooseRole')}
              value={row.pending ? approveRole[row.userId] : row.role ?? undefined} disabled={approving || changingRole}
              onChange={(role: ProjectMemberRole) => row.pending
                ? setApproveRole((prev) => ({ ...prev, [row.userId]: role }))
                : void changeRole({ variables: { project: slug, userId: row.userId, role } })} />
          ) },
          { title: t('gitlabUser'), key: 'gitlab', width: 240, render: (_, row) => row.pending ? '—' : (
            <MemberGitlabCell project={slug} userId={row.userId} hosts={hosts} mappings={mappings.data?.projectGitlabMappings ?? []}
              loading={mappings.loading} onLink={(host) => setSelected({ member: row, host })} onChanged={() => { void mappings.refetch(); }} />
          ) },
          { title: t('memberActions'), key: 'actions', width: 200, render: (_, row) => row.userId === ownerUserId ? null : row.pending ? (
            <Space wrap>
              <Button size="small" type="primary" loading={approving} disabled={!approveRole[row.userId] || rejecting}
                onClick={() => approve({ variables: { project: slug, userId: row.userId, role: approveRole[row.userId] } })}>{t('approve')}</Button>
              <Popconfirm title={t('rejectMemberConfirmTitle')} okText={t('reject')} okButtonProps={{ danger: true, loading: rejecting }}
                onConfirm={() => reject({ variables: { project: slug, userId: row.userId } })}>
                <Button size="small" danger disabled={approving}>{t('reject')}</Button>
              </Popconfirm>
            </Space>
          ) : (
            <Popconfirm title={t('removeMemberConfirmTitle')} okText={t('remove')} okButtonProps={{ danger: true, loading: removing }}
              onConfirm={() => remove({ variables: { project: slug, userId: row.userId } })}>
              <Button size="small" danger>{t('remove')}</Button>
            </Popconfirm>
          ) },
        ]} />
      {selected && <MemberGitlabDialog key={`${slug}:${selected.member.userId}:${selected.host}`} project={slug} userId={selected.member.userId} email={selected.member.email}
        host={selected.host} onClose={() => setSelected(null)} onSaved={() => { void mappings.refetch(); }} />}
    </Card>
  );
}
