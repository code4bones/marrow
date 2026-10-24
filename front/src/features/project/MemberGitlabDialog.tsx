import { useMutation, useQuery } from '@apollo/client/react';
import { LoadingOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Space, Table, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SEARCH_PROJECT_GITLAB_USERS, SET_PROJECT_MEMBER_GITLAB, type GitlabUser } from '../../shared/api/project-gitlab';

export function MemberGitlabDialog({ project, userId, email, host, onClose, onSaved }: {
  project: string; userId: string; email: string; host: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation('projects');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(timer);
  }, [input]);
  const canSearch = query.length >= 3;
  const waiting = input.trim().length >= 3 && query !== input.trim();
  const { data, loading, error } = useQuery<{ projectGitlabUsers: GitlabUser[] }>(SEARCH_PROJECT_GITLAB_USERS, {
    variables: { project, host, query }, skip: !canSearch, fetchPolicy: 'network-only',
  });
  const [save, { loading: saving }] = useMutation(SET_PROJECT_MEMBER_GITLAB, {
    onCompleted: () => { message.success(t('gitlabMappingSaved')); onSaved(); onClose(); },
    onError: (e) => message.error(e.message),
  });
  return (
    <Modal title={`${t('linkGitlabUser')} · ${email}`} open onCancel={() => { if (!saving) onClose(); }} width={700} footer={null}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text type="secondary">{host}</Typography.Text>
        <Input aria-label={t('searchGitlabUsers')} placeholder={t('searchGitlabUsers')} value={input} maxLength={100} disabled={saving} autoFocus allowClear
          suffix={loading || waiting ? <LoadingOutlined /> : <SearchOutlined />}
          onChange={(e) => { setInput(e.target.value); setQuery(''); }} />
        {canSearch && error && <Alert type="error" title={error.message} showIcon />}
        {canSearch && <Table<GitlabUser> rowKey="gitlabUserId" size="small" loading={loading} pagination={false}
          dataSource={loading || error ? [] : data?.projectGitlabUsers ?? []} scroll={{ x: 400 }}
          locale={{ emptyText: t('noGitlabUsers') }} columns={[
            { title: t('gitlabUsername'), dataIndex: 'username', render: (value: string) => `@${value}` },
            { title: t('gitlabName'), dataIndex: 'name' },
            { title: t('memberActions'), key: 'action', width: 110, render: (_, row) => <Button size="small" type="primary" disabled={saving}
              onClick={() => save({ variables: { project, userId, host, gitlabUserId: row.gitlabUserId } })}>{t('selectGitlabUser')}</Button> },
          ]} />}
      </Space>
    </Modal>
  );
}
