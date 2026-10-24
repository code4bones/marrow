import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ADD_PROJECT_REPOSITORY, CONNECT_PROJECT_WEBHOOK, DISCONNECT_PROJECT_WEBHOOK, GET_PROJECT_REPOSITORIES, REMOVE_PROJECT_REPOSITORY, RETRY_PROJECT_WEBHOOK, SET_PROJECT_REPOSITORY_LEAD, type ProjectRepository } from '../../shared/api/project-gitlab';
import { GET_PROJECT_MEMBERS } from '../../shared/api/queries';
import type { ProjectMember } from '../../shared/model/types';

export function ProjectRepositoriesSection({ project, canManage }: { project: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const { data, loading, error, refetch } = useQuery<{ projectRepositories: ProjectRepository[] }>(GET_PROJECT_REPOSITORIES, { variables: { project }, pollInterval: 10000 });
  const members = useQuery<{ projectMembers: ProjectMember[] }>(GET_PROJECT_MEMBERS, { variables: { project }, skip: !canManage });
  const [setLead, { loading: settingLead }] = useMutation(SET_PROJECT_REPOSITORY_LEAD, {
    onCompleted: () => { message.success(t('repositoryLeadUpdated')); void refetch(); },
    onError: (e) => message.error(e.message),
  });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ url: string }>();
  const webhookOptions = { onCompleted: () => { void refetch(); }, onError: (e: Error) => message.error(e.message) };
  const [connect, { loading: connecting }] = useMutation(CONNECT_PROJECT_WEBHOOK, webhookOptions);
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_PROJECT_WEBHOOK, webhookOptions);
  const [retry, { loading: retrying }] = useMutation(RETRY_PROJECT_WEBHOOK, webhookOptions);
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
      {members.error && <Alert type="error" title={members.error.message} showIcon style={{ marginBottom: 8 }} />}
      <Table<ProjectRepository> size="small" rowKey="id" loading={loading} dataSource={data?.projectRepositories ?? []}
        pagination={false} scroll={{ x: 1000 }} locale={{ emptyText: t('noRepositories') }}
        columns={[
          { title: t('repositoryName'), dataIndex: 'name', width: 180 },
          { title: t('gitlabHost'), dataIndex: 'host', width: 200 },
          { title: t('repositoryUrl'), key: 'url', render: (_, row) => <a href={row.webUrl} target="_blank" rel="noopener noreferrer">{row.path}</a> },
          { title: t('repositoryLead'), key: 'lead', width: 260, render: (_, row) => canManage ? <Select<string>
            size="small" showSearch allowClear optionFilterProp="label" style={{ width: '100%' }}
            aria-label={`${t('repositoryLead')}: ${row.name}`} placeholder={t('chooseRepositoryLead')}
            value={row.leadUserId ?? undefined} loading={members.loading || settingLead} disabled={members.loading || settingLead}
            options={(members.data?.projectMembers ?? []).map((member) => ({ value: member.userId, label: member.email }))}
            onChange={(userId) => setLead({ variables: { project, id: row.id, userId: userId ?? null } })}
          /> : row.leadEmail ?? '—' },
          { title: t('issueImport'), key: 'webhook', width: 210, render: (_, row) => <Space orientation="vertical" size={4}>
            {(row.webhook?.lastError || Boolean(row.webhook?.failedCount)) && <Tooltip title={row.webhook?.lastError ?? undefined}>
              <Tag color="red">{t('webhookError')}</Tag>
            </Tooltip>}
            {row.webhook?.lastDeliveryStatus === 'done'
              ? row.webhook.lastTaskId && <Link to={`/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(row.webhook.lastTaskId)}`}>{row.webhook.lastTaskId}</Link>
              : row.webhook?.lastDeliveryStatus && <Tag>{t(`webhookDelivery_${row.webhook.lastDeliveryStatus}`)}</Tag>}
            {row.webhook?.enabled ? <Popconfirm title={t('disableWebhookConfirm')} disabled={!canManage} onConfirm={() => disconnect({ variables: { project, id: row.id } })}>
              <Button size="small" disabled={!canManage || connecting || disconnecting}>{t('disableWebhook')}</Button>
            </Popconfirm> : <Button size="small" loading={connecting} disabled={!canManage || disconnecting} onClick={() => connect({ variables: { project, id: row.id } })}>{t('enableWebhook')}</Button>}
            {canManage && Boolean(row.webhook?.failedCount) && <Button size="small" loading={retrying}
              onClick={() => retry({ variables: { project, id: row.id } })}>{t('retryWebhook')}</Button>}
          </Space> },
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
