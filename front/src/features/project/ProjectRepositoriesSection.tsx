import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ADD_PROJECT_REPOSITORY, GET_PROJECT_REPOSITORIES, REMOVE_PROJECT_REPOSITORY, type ProjectRepository } from '../../shared/api/project-gitlab';

export function ProjectRepositoriesSection({ project, canManage }: { project: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const { data, loading, error, refetch } = useQuery<{ projectRepositories: ProjectRepository[] }>(GET_PROJECT_REPOSITORIES, { variables: { project } });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ url: string }>();
  const [add, { loading: adding }] = useMutation(ADD_PROJECT_REPOSITORY, {
    onCompleted: () => { message.success(t('repositoryAdded')); setOpen(false); form.resetFields(); void refetch(); },
    onError: (e) => message.error(e.message),
  });
  const [remove, { loading: removing }] = useMutation(REMOVE_PROJECT_REPOSITORY, {
    onCompleted: () => { message.success(t('repositoryRemoved')); void refetch(); },
    onError: (e) => message.error(e.message),
  });
  return (
    <Card title={t('repositories')} size="small" style={{ marginBottom: 16 }}
      extra={canManage && <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('addRepository')}</Button>}>
      {error && <Alert type="error" title={error.message} showIcon style={{ marginBottom: 8 }} />}
      <Table<ProjectRepository> size="small" rowKey="id" loading={loading} dataSource={data?.projectRepositories ?? []}
        pagination={false} scroll={{ x: 620 }} locale={{ emptyText: t('noRepositories') }}
        columns={[
          { title: t('repositoryName'), dataIndex: 'name', width: 180 },
          { title: t('gitlabHost'), dataIndex: 'host', width: 200 },
          { title: t('repositoryUrl'), key: 'url', render: (_, row) => <a href={row.webUrl} target="_blank" rel="noopener noreferrer">{row.path}</a> },
          ...(canManage ? [{ title: t('memberActions'), key: 'actions', width: 100, render: (_: unknown, row: ProjectRepository) => (
            <Popconfirm title={t('removeRepositoryConfirm')} okText={t('remove')} okButtonProps={{ danger: true, loading: removing }}
              onConfirm={() => remove({ variables: { project, id: row.id } })}>
              <Button size="small" danger>{t('remove')}</Button>
            </Popconfirm>
          ) }] : []),
        ]} />
      <Modal title={t('addRepository')} open={open} onCancel={() => { if (!adding) setOpen(false); }} destroyOnHidden
        footer={<Space><Button disabled={adding} onClick={() => setOpen(false)}>{t('common:cancel')}</Button>
          <Button type="primary" loading={adding} onClick={() => form.submit()}>{t('addRepository')}</Button></Space>}>
        <Form form={form} layout="vertical" onFinish={(values) => { void add({ variables: { project, url: values.url.trim() } }); }}>
          <Form.Item name="url" label={t('repositoryUrl')} rules={[{ required: true }, { type: 'url' }]}>
            <Input placeholder="https://gitlab.example.com/group/backend" autoFocus disabled={adding} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
