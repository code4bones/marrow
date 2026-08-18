import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Spin, Tag, Typography, message } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteProjectButton } from '../../../features/project/DeleteProjectButton';
import { ProjectInviteLink } from '../../../features/project/ProjectInviteLink';
import { GET_PROJECT_SETTINGS, UPDATE_PROJECT } from '../../../shared/api/queries';
import { useAuthStore } from '../../../shared/model/auth.store';
import { useWorkspaceStore } from '../../../shared/model/workspace.store';
import type { Project } from '../../../shared/model/types';
import { PageLayout } from '../../../shared/ui/PageLayout';

const { Text } = Typography;

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
      <DangerZoneSection slug={slug} canManage={canManage} />
    </PageLayout>
  );
}
