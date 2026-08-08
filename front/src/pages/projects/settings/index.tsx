import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Popconfirm, Spin, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteProjectButton } from '../../../features/project/DeleteProjectButton';
import {
  GET_PROJECT_SETTINGS,
  PROJECT_INVITE_LINK,
  REGENERATE_PROJECT_INVITE_LINK,
  UPDATE_PROJECT,
} from '../../../shared/api/queries';
import { useWorkspaceStore } from '../../../shared/model/workspace.store';
import type { Project } from '../../../shared/model/types';
import { CodeBlock } from '../../../shared/ui/CodeBlock';
import { PageLayout } from '../../../shared/ui/PageLayout';

const { Paragraph, Text } = Typography;

interface RenameFormValues {
  title: string;
  description: string;
}

/** Title/description form -- any current project member (or admin) can rename, no separate owner concept. */
function RenameSection({ slug }: { slug: string }) {
  const { data, loading, error } = useQuery<{ project: Project }>(GET_PROJECT_SETTINGS, { variables: { slug } });
  const [form] = Form.useForm<RenameFormValues>();
  const [mutate, { loading: saving }] = useMutation(UPDATE_PROJECT, {
    onCompleted: () => message.success('Project updated'),
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
    <Card title="Rename" size="small" style={{ marginBottom: 16 }}>
      {loading && <Spin size="small" />}
      {error && <Alert type="error" message={error.message} showIcon />}
      {data?.project && (
        <Form form={form} layout="vertical" size="small" disabled={saving}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" size="small" onClick={submit} loading={saving}>
            Save
          </Button>
        </Form>
      )}
    </Card>
  );
}

/**
 * Reusable, per-project invite link -- get-or-create on mount (same lazy
 * generation as PersonalTokenPanel in pages/profile), "Copy link" via the
 * same copyable CodeBlock every token/secret display already uses, and
 * "Regenerate" behind a Popconfirm mirroring PersonalTokenPanel's own
 * regenerate confirm (front/src/pages/profile/index.tsx).
 */
function InviteSection({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = useQuery<{ projectInviteLink: { code: string; url: string } }>(
    PROJECT_INVITE_LINK,
    { variables: { slug }, fetchPolicy: 'network-only' },
  );
  const [regenerate, { loading: regenerating }] = useMutation(REGENERATE_PROJECT_INVITE_LINK, {
    onCompleted: () => {
      message.success('Invite link regenerated -- the old link no longer works');
      void refetch();
    },
    onError: (e) => message.error(e.message),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Card title="Invite" size="small" style={{ marginBottom: 16 }}>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Anyone who opens this link and signs in (or already has a Marrow account) joins this project. Any current
        project member can share it. Regenerating invalidates the old link immediately.
      </Paragraph>
      {loading && <Spin size="small" />}
      {error && <Alert type="error" message={error.message} showIcon />}
      {data?.projectInviteLink && <CodeBlock code={data.projectInviteLink.url} />}
      <Popconfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Regenerate invite link?"
        description="The current link stops working immediately. Anyone who hasn't joined yet will need the new one."
        okText="Regenerate"
        okButtonProps={{ danger: true, loading: regenerating }}
        onConfirm={() => {
          setConfirmOpen(false);
          void regenerate({ variables: { slug } });
        }}
      >
        <Button size="small" loading={regenerating}>
          Regenerate
        </Button>
      </Popconfirm>
    </Card>
  );
}

function DangerZoneSection({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  return (
    <Card title="Danger zone" size="small" style={{ borderColor: '#a61d24' }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
        Hard-deletes this project. This does not depend on project membership -- only a system admin can do this.
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
  const { slug } = useParams<{ slug: string }>();

  if (!slug) {
    return (
      <PageLayout title="Settings">
        <Typography.Text type="secondary">Select a project first.</Typography.Text>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Settings" subtitle={slug}>
      <RenameSection slug={slug} />
      <InviteSection slug={slug} />
      <DangerZoneSection slug={slug} />
    </PageLayout>
  );
}
