import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Popconfirm, Select, Spin, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteProjectButton } from '../../../features/project/DeleteProjectButton';
import { ProjectInviteLink } from '../../../features/project/ProjectInviteLink';
import {
  APPROVE_PROJECT_MEMBER,
  GET_PENDING_PROJECT_MEMBERS,
  GET_PROJECT_MEMBERS,
  GET_PROJECT_SETTINGS,
  REJECT_PROJECT_MEMBER,
  UPDATE_PROJECT,
  UPDATE_PROJECT_MEMBER_ROLE,
} from '../../../shared/api/queries';
import { useAuthStore } from '../../../shared/model/auth.store';
import { useWorkspaceStore } from '../../../shared/model/workspace.store';
import type { PendingProjectMember, Project, ProjectMember, ProjectMemberRole } from '../../../shared/model/types';
import { PageLayout } from '../../../shared/ui/PageLayout';
import { Timestamp } from '../../../shared/ui/Timestamp';

const { Text } = Typography;

function roleOptions(t: (key: string) => string) {
  return [
    { label: t('rolePm'), value: 'pm' },
    { label: t('roleDeveloper'), value: 'developer' },
    { label: t('roleTester'), value: 'tester' },
  ];
}

interface RenameFormValues {
  title: string;
  description: string;
}

/** Title/description form -- only this project's owner or a system admin can rename. */
function RenameSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const { data, loading, error } = useQuery<{ project: Project }>(GET_PROJECT_SETTINGS, { variables: { slug } });
  const [form] = Form.useForm<RenameFormValues>();
  const [mutate, { loading: saving }] = useMutation(UPDATE_PROJECT, {
    onCompleted: () => message.success(t('projectUpdated')),
    onError: (e) => message.error(e.message),
  });

  useEffect(() => {
    if (data?.project) {
      form.setFieldsValue({ title: data.project.title, description: data.project.description ?? '' });
    }
  }, [data, form]);

  const submit = () =>
    form.validateFields().then((values) =>
      mutate({ variables: { slug, title: values.title, description: values.description } }),
    );

  return (
    <Card title={t('rename')} size="small" style={{ marginBottom: 16 }}>
      {loading && <Spin size="small" />}
      {error && <Alert type="error" message={error.message} showIcon />}
      {data?.project && (
        <Form form={form} layout="vertical" size="small" disabled={saving || !canManage}>
          <Form.Item name="title" label={t('title')} rules={[{ required: true, message: t('titleRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {canManage && (
            <Button type="primary" size="small" onClick={submit} loading={saving}>
              {t('save')}
            </Button>
          )}
        </Form>
      )}
    </Card>
  );
}

function InviteSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  if (!canManage) return null;
  return (
    <Card title={t('invite')} size="small" style={{ marginBottom: 16 }}>
      <ProjectInviteLink slug={slug} />
    </Card>
  );
}

// T-MEMORY-110: owner-only membership approval + role management. Pending
// requests only ever come from someone claiming the invite link -- approving
// assigns a role in the same action (there's no "active but roleless" state
// a caller can reach through the UI). ownerUserId is excluded from the
// active roster's role editor -- the owner always resolves as pm regardless
// of their own project_members row, so a role picker there would be
// misleading busywork with zero real effect.
function MembersSection({ slug, canManage, ownerUserId }: { slug: string; canManage: boolean; ownerUserId: string | null }) {
  const { t } = useTranslation('projects');
  // Hooks run unconditionally (Rules of Hooks) -- the queries themselves are
  // skipped when the viewer can't manage members, and the early return sits
  // after every hook call, right before the JSX.
  const { data: pendingData, loading: pendingLoading, refetch: refetchPending } = useQuery<{ pendingProjectMembers: PendingProjectMember[] }>(
    GET_PENDING_PROJECT_MEMBERS,
    { variables: { project: slug }, skip: !canManage },
  );
  const { data: membersData, loading: membersLoading, refetch: refetchMembers } = useQuery<{ projectMembers: ProjectMember[] }>(
    GET_PROJECT_MEMBERS,
    { variables: { project: slug }, skip: !canManage },
  );
  const [approveRole, setApproveRole] = useState<Record<string, ProjectMemberRole>>({});
  const [approve, { loading: approving }] = useMutation(APPROVE_PROJECT_MEMBER, {
    onCompleted: () => { message.success(t('memberApproved')); void refetchPending(); void refetchMembers(); },
    onError: (e) => message.error(e.message),
  });
  const [reject, { loading: rejecting }] = useMutation(REJECT_PROJECT_MEMBER, {
    onCompleted: () => { message.success(t('memberRejected')); void refetchPending(); },
    onError: (e) => message.error(e.message),
  });
  const [changeRole, { loading: changingRole }] = useMutation(UPDATE_PROJECT_MEMBER_ROLE, {
    onCompleted: () => { message.success(t('memberRoleUpdated')); void refetchMembers(); },
    onError: (e) => message.error(e.message),
  });

  const pending = pendingData?.pendingProjectMembers ?? [];
  const members = (membersData?.projectMembers ?? []).filter((m) => m.userId !== ownerUserId);

  if (!canManage) return null;

  return (
    <Card title={t('members')} size="small" style={{ marginBottom: 16 }}>
      {(pendingLoading || membersLoading) && <Spin size="small" />}

      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', marginBottom: 8 }}>
            {t('pendingRequests')}
          </Text>
          {pending.map((request) => (
            <div key={request.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <Text style={{ flex: 1, minWidth: 160 }}>{request.email}</Text>
              {request.requestedAt && <Timestamp value={request.requestedAt} />}
              <Select
                size="small"
                style={{ width: 130 }}
                placeholder={t('chooseRole')}
                options={roleOptions(t)}
                value={approveRole[request.userId]}
                onChange={(role) => setApproveRole((prev) => ({ ...prev, [request.userId]: role }))}
              />
              <Button
                size="small"
                type="primary"
                loading={approving}
                disabled={!approveRole[request.userId]}
                onClick={() => approve({ variables: { project: slug, userId: request.userId, role: approveRole[request.userId] } })}
              >
                {t('approve')}
              </Button>
              <Popconfirm title={t('rejectMemberConfirmTitle')} okText={t('reject')} okButtonProps={{ danger: true, loading: rejecting }} onConfirm={() => reject({ variables: { project: slug, userId: request.userId } })}>
                <Button size="small" danger>{t('reject')}</Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', marginBottom: 8 }}>
        {t('activeMembers')}
      </Text>
      {members.length === 0 && pending.length === 0 && !pendingLoading && !membersLoading && (
        <Text type="secondary" style={{ fontSize: 12.5 }}>{t('noOtherMembers')}</Text>
      )}
      {members.map((member) => (
        <div key={member.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Text style={{ flex: 1, minWidth: 160 }}>{member.email}</Text>
          <Select
            size="small"
            style={{ width: 130 }}
            value={member.role ?? undefined}
            options={roleOptions(t)}
            loading={changingRole}
            onChange={(role) => changeRole({ variables: { project: slug, userId: member.userId, role } })}
          />
        </div>
      ))}
    </Card>
  );
}

function DangerZoneSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);
  if (!canManage) return null;

  return (
    <Card title={t('dangerZone')} size="small" style={{ borderColor: '#a61d24' }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
        {t('dangerZoneDescription')}
      </Text>
      <DeleteProjectButton
        slug={slug}
        onDone={() => {
          setSelectedProject(null);
          navigate('/projects');
        }}
      />
    </Card>
  );
}

export function ProjectSettingsPage() {
  const { t } = useTranslation('projects');
  const { slug } = useParams<{ slug: string }>();
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery<{ project: Project }>(GET_PROJECT_SETTINGS, { variables: { slug }, skip: !slug });

  if (!slug) {
    return (
      <PageLayout title={t('settings')}>
        <Typography.Text type="secondary">{t('selectProjectFirst')}</Typography.Text>
      </PageLayout>
    );
  }

  const isOwner = Boolean(user && data?.project && data.project.ownerUserId === user.id);
  const canManage = Boolean(user?.role === 'admin' || isOwner);

  return (
    <PageLayout
      title={t('settings')}
      slug={slug}
      headerExtra={isOwner ? <Tag color="blue">{t('youAreOwner')}</Tag> : undefined}
    >
      <RenameSection slug={slug} canManage={canManage} />
      <InviteSection slug={slug} canManage={canManage} />
      <MembersSection slug={slug} canManage={canManage} ownerUserId={data?.project.ownerUserId ?? null} />
      <DangerZoneSection slug={slug} canManage={canManage} />
    </PageLayout>
  );
}
