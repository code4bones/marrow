import { DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation } from '@apollo/client/react';
import { Button, Popconfirm, Space, Tooltip, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { REMOVE_PROJECT_MEMBER_GITLAB, type ProjectGitlabMapping } from '../../shared/api/project-gitlab';

export function MemberGitlabCell({ project, userId, hosts, mappings, loading, onLink, onChanged }: {
  project: string; userId: string; hosts: string[]; mappings: ProjectGitlabMapping[]; loading: boolean;
  onLink: (host: string) => void; onChanged: () => void;
}) {
  const { t } = useTranslation('projects');
  const memberMappings = mappings.filter((item) => item.userId === userId);
  const displayHosts = [...new Set([...hosts, ...memberMappings.map((item) => item.host)])];
  const [unlink, { loading: unlinking }] = useMutation(REMOVE_PROJECT_MEMBER_GITLAB, {
    onCompleted: () => { message.success(t('gitlabMappingRemoved')); onChanged(); },
    onError: (e) => message.error(e.message),
  });
  if (!displayHosts.length) return (
    <Tooltip title={t('addRepositoryFirst')}>
      <Button size="small" icon={<LinkOutlined />} disabled>{t('linkGitlabUser')}</Button>
    </Tooltip>
  );
  return (
    <Space orientation="vertical" size={4}>
      {displayHosts.map((host) => {
        const mapping = memberMappings.find((item) => item.host === host);
        return (
          <Space key={host} size={4} wrap>
            {displayHosts.length > 1 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{host}</Typography.Text>}
            {mapping ? <>
              <Typography.Text title={host} style={{ fontSize: 12 }}>@{mapping.username}</Typography.Text>
              <Popconfirm title={t('unlinkGitlabConfirm')} okText={t('unlinkGitlabUser')} okButtonProps={{ danger: true, loading: unlinking }}
                onConfirm={() => unlink({ variables: { project, userId, host } })}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={loading || unlinking}
                  aria-label={`${t('unlinkGitlabUser')} @${mapping.username}`} title={t('unlinkGitlabUser')} />
              </Popconfirm>
            </> : <Button size="small" icon={<LinkOutlined />} disabled={loading || unlinking} onClick={() => onLink(host)}>{t('linkGitlabUser')}</Button>}
          </Space>
        );
      })}
    </Space>
  );
}
