import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Space, Table, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOVE_PROJECT_MEMBER_GITLAB, SEARCH_PROJECT_GITLAB_USERS, SET_PROJECT_MEMBER_GITLAB, type GitlabUser, type ProjectGitlabMapping } from '../../shared/api/project-gitlab';

export function MemberGitlabDialog({ project, userId, email, hosts, mappings, onClose, onSaved }: {
  project: string; userId: string; email: string; hosts: string[]; mappings: ProjectGitlabMapping[];
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation('projects');
  const [host, setHost] = useState(hosts[0]);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error } = useQuery<{ projectGitlabUsers: GitlabUser[] }>(SEARCH_PROJECT_GITLAB_USERS, {
    variables: { project, host, query }, skip: !host || query.length < 2, fetchPolicy: 'network-only',
  });
  const mapping = mappings.find((item) => item.host === host && item.userId === userId);
  const [save, { loading: saving }] = useMutation(SET_PROJECT_MEMBER_GITLAB, {
    onCompleted: () => { message.success(t('gitlabMappingSaved')); onSaved(); onClose(); },
    onError: (e) => message.error(e.message),
  });
  const [unlink, { loading: unlinking }] = useMutation(REMOVE_PROJECT_MEMBER_GITLAB, {
    onCompleted: () => { message.success(t('gitlabMappingRemoved')); onSaved(); },
    onError: (e) => message.error(e.message),
  });
  const busy = saving || unlinking;
  return (
    <Modal title={`${t('linkGitlabUser')} · ${email}`} open onCancel={() => { if (!busy) onClose(); }} width={700} footer={null}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Select aria-label={t('gitlabHost')} value={host} style={{ width: '100%' }} disabled={busy}
          options={hosts.map((value) => ({ label: value, value }))}
          onChange={(value) => { setHost(value); setInput(''); setQuery(''); }} />
        {mapping && <Space wrap><Typography.Text>{t('linkedGitlabUser')}: @{mapping.username}</Typography.Text>
          <Popconfirm title={t('unlinkGitlabConfirm')} onConfirm={() => unlink({ variables: { project, userId, host } })}>
            <Button size="small" danger loading={unlinking} disabled={saving}>{t('unlinkGitlabUser')}</Button>
          </Popconfirm>
        </Space>}
        <Input.Search aria-label={t('searchGitlabUsers')} placeholder={t('searchGitlabUsers')} value={input} maxLength={100} disabled={busy}
          onChange={(e) => { setInput(e.target.value); if (!e.target.value.trim()) setQuery(''); }}
          onSearch={(value) => setQuery(value.trim())} enterButton loading={loading} />
        {query.length === 1 && <Typography.Text type="secondary">{t('gitlabSearchMinLength')}</Typography.Text>}
        {query.length >= 2 && error && <Alert type="error" title={error.message} showIcon />}
        {query.length >= 2 && <Table<GitlabUser> rowKey="gitlabUserId" size="small" loading={loading} pagination={false}
          dataSource={loading || error ? [] : data?.projectGitlabUsers ?? []} scroll={{ x: 400 }}
          locale={{ emptyText: t('noGitlabUsers') }} columns={[
            { title: t('gitlabUsername'), dataIndex: 'username', render: (value: string) => `@${value}` },
            { title: t('gitlabName'), dataIndex: 'name' },
            { title: t('memberActions'), key: 'action', width: 110, render: (_, row) => <Button size="small" type="primary" disabled={busy || mapping?.gitlabUserId === row.gitlabUserId}
              onClick={() => save({ variables: { project, userId, host, gitlabUserId: row.gitlabUserId } })}>{t('selectGitlabUser')}</Button> },
          ]} />}
      </Space>
    </Modal>
  );
}
