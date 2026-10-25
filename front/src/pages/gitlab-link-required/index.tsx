import { Button, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../shared/model/auth.store';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { LanguagePicker } from '../../shared/ui/LanguagePicker';

export function GitlabLinkRequiredPage() {
  const { t } = useTranslation('auth');
  const status = useAuthStore(s => s.status);
  const signedIn = status === 'authenticated';

  return (
    <CenteredCard>
      <Typography.Title level={4}>{t('gitlabLinkRequiredTitle')}</Typography.Title>
      <Typography.Paragraph>{t('gitlabLinkRequiredDescription')}</Typography.Paragraph>
      <ol style={{ paddingInlineStart: 20, marginBottom: 24 }}>
        <li>{t('gitlabLinkStepSignIn')}</li>
        <li>{t('gitlabLinkStepProfile')}</li>
        <li>{t('gitlabLinkStepRetry')}</li>
      </ol>
      {status === 'checking' ? <Spin size="small" /> : (
        <Button type="primary" block href={signedIn ? '/profile?section=account' : '/login'}>
          {t(signedIn ? 'gitlabLinkOpenProfile' : 'gitlabLinkSignIn')}
        </Button>
      )}
      <LanguagePicker />
    </CenteredCard>
  );
}
