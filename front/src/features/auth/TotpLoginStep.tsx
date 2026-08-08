import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

interface TotpFormValues {
  code: string;
}

interface TotpLoginStepProps {
  /** Called after loginTotp() resolves successfully -- e.g. navigate to /projects (LoginPage), or nothing (oauth-authorize page, which re-renders into the consent screen once useAuthStore.status flips to 'authenticated'). */
  onSuccess: () => void;
}

/**
 * Second login step for a totp_enabled account -- extracted out of
 * pages/login so it can also be reused by pages/oauth-authorize (SSO for
 * OAuth connectors reuses Marrow's own login screens instead of a magic
 * token).
 */
export function TotpLoginStep({ onSuccess }: TotpLoginStepProps) {
  const { t } = useTranslation('auth');
  const loginTotp = useAuthStore((s) => s.loginTotp);
  const [form] = Form.useForm<TotpFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const onFinish = async ({ code }: TotpFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await loginTotp(code.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invalidCode'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        {t('twoFactorAuthentication')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        {useRecoveryCode
          ? t('enterRecoveryCode')
          : t('enterAuthenticatorCode')}
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <Form.Item name="code" label={useRecoveryCode ? t('recoveryCode') : t('code')} rules={[{ required: true, message: t('codeIsRequired') }]}>
          <Input autoFocus autoComplete="one-time-code" maxLength={useRecoveryCode ? undefined : 6} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t('verify')}
          </Button>
        </Form.Item>
      </Form>
      <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setUseRecoveryCode((v) => !v)}>
        {useRecoveryCode ? t('useAuthenticatorCodeInstead') : t('useRecoveryCodeInstead')}
      </Button>
    </CenteredCard>
  );
}
