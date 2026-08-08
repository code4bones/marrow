import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Spin, Typography, message } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteProjectButton } from '../../../features/project/DeleteProjectButton';
import { ProjectInviteLink } from '../../../features/project/ProjectInviteLink';
import { GET_PROJECT_SETTINGS, UPDATE_PROJECT } from '../../../shared/api/queries';
import { useWorkspaceStore } from '../../../shared/model/workspace.store';
import type { Project } from '../../../shared/model/types';
import { PageLayout } from '../../../shared/ui/PageLayout';

const { Text } = Typography;

interface RenameFormValues {
  title: string;
  description: string;
}

/** Title/description form -- any current project member (or admin) can rename, no separate owner concept. */
function RenameSection({ slug }: { slug: string }) {
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
        <Form form={form} layout="vertical" size="small" disabled={saving}>
          <Form.Item name="title" label={t('title')} rules={[{ required: true, message: t('titleRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" size="small" onClick={submit} loading={saving}>
            {t('save')}
          </Button>
        </Form>
      )}
    </Card>
  );
}

function InviteSection({ slug }: { slug: string }) {
  const { t } = useTranslation('projects');
  return (
    <Card title={t('invite')} size="small" style={{ marginBottom: 16 }}>
      <ProjectInviteLink slug={slug} />
    </Card>
  );
}

function DangerZoneSection({ slug }: { slug: string }) {
  const { t } = useTranslation('projects');
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

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

  if (!slug) {
    return (
      <PageLayout title={t('settings')}>
        <Typography.Text type="secondary">{t('selectProjectFirst')}</Typography.Text>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={t('settings')} subtitle={slug}>
      <RenameSection slug={slug} />
      <InviteSection slug={slug} />
      <DangerZoneSection slug={slug} />
    </PageLayout>
  );
}
