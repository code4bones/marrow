import { GitlabOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Popconfirm, Spin, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../../shared/config/env';
import { type GitlabLinkStatus, useAuthStore } from '../../shared/model/auth.store';

export function GitlabConnectionSection() {
  const { t } = useTranslation('profile');
  const fetchStatus = useAuthStore(s => s.fetchGitlabStatus);
  const unlinkGitlab = useAuthStore(s => s.unlinkGitlab);
  const [params, setParams] = useSearchParams();
  const linked = params.has('gitlabLinked');
  const callbackError = params.get('gitlabError');
  const [status, setStatus] = useState<GitlabLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(callbackError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then(value => { if (!cancelled) setStatus(value); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : t('gitlabLoadFailed')); });
    if (linked) void message.success(t('gitlabLinked'));
    if (linked || callbackError) {
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('gitlabLinked');
        next.delete('gitlabError');
        return next;
      }, { replace: true });
    }
    return () => { cancelled = true; };
  }, [fetchStatus, linked, callbackError, setParams, t]);

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkGitlab();
      setStatus(await fetchStatus());
      void message.success(t('gitlabUnlinked'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitlabUnlinkFailed'));
    } finally { setBusy(false); }
  };

  return (
    <Card title="GitLab" size="small" style={{ marginBottom: 16 }}>
      {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
      {!status ? (!error && <Spin size="small" />) : !status.enabled ? (
        <Typography.Text type="secondary">{t('gitlabUnavailable')}</Typography.Text>
      ) : (
        <>
          <Typography.Paragraph type="secondary">{t('gitlabSignInDescription')}</Typography.Paragraph>
          <Flex align="center" gap={12} wrap>
            <GitlabOutlined style={{ fontSize: 18 }} />
            <Typography.Text>{status.linked ? t('gitlabConnectedAs', { username: status.username ?? status.issuer }) : t('gitlabNotConnected')}</Typography.Text>
            {status.linked ? (
              <Popconfirm title={t('gitlabUnlinkTitle')} description={t('gitlabUnlinkDescription')}
                okText={t('gitlabDisconnect')} okButtonProps={{ danger: true, loading: busy }} onConfirm={unlink}>
                <Button size="small" loading={busy}>{t('gitlabDisconnect')}</Button>
              </Popconfirm>
            ) : (
              <Button icon={<GitlabOutlined />} href={`${API_BASE_URL}/auth/oauth/gitlab/start?intent=link`}>
                {t('gitlabConnect')}
              </Button>
            )}
          </Flex>
        </>
      )}
    </Card>
  );
}
