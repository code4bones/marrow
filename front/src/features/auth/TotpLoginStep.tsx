import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
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
      setError(err instanceof Error ? err.message : 'Invalid code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        Two-factor authentication
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        {useRecoveryCode
          ? 'Enter one of your recovery codes.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <Form.Item name="code" label={useRecoveryCode ? 'Recovery code' : 'Code'} rules={[{ required: true, message: 'Code is required' }]}>
          <Input autoFocus autoComplete="one-time-code" maxLength={useRecoveryCode ? undefined : 6} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 12 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            Verify
          </Button>
        </Form.Item>
      </Form>
      <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setUseRecoveryCode((v) => !v)}>
        {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
      </Button>
    </CenteredCard>
  );
}
