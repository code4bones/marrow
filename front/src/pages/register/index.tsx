import { Alert, Button, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { TotpEnrollWizard } from '../../features/auth/TotpEnrollWizard';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

interface CredentialsFormValues {
  email: string;
  password: string;
  confirmPassword?: string;
}

interface EnrollState {
  token: string;
  otpauthUrl: string;
  secretBase32: string;
}

export function RegisterPage() {
  const { t } = useTranslation('auth');
  const registerStart = useAuthStore((s) => s.registerStart);
  const registerPendingContext = useAuthStore((s) => s.registerPendingContext);
  const registerConfirm = useAuthStore((s) => s.registerConfirm);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<CredentialsFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const githubToken = searchParams.get('githubToken');
  const [loadingGithubContext, setLoadingGithubContext] = useState(Boolean(githubToken));

  // GitHub sign-in for a brand-new email lands here (GET /auth/oauth/github/callback
  // -> registerViaGithub -> redirect with ?githubToken=...) -- skip straight
  // to the same TOTP-enroll step a password registration reaches after
  // submitting the form, just without ever seeing that form.
  useEffect(() => {
    if (!githubToken) {
      return;
    }
    registerPendingContext(githubToken)
      .then((result) => setEnroll({ token: githubToken, otpauthUrl: result.otpauthUrl, secretBase32: result.secretBase32 }))
      .catch((err) => setError(err instanceof Error ? err.message : t('linkInvalidOrExpired')))
      .finally(() => setLoadingGithubContext(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubToken]);

  if (loadingGithubContext) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const onFinish = async ({ email, password }: CredentialsFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerStart(email.trim(), password);
      setEnroll({ token: result.token, otpauthUrl: result.otpauthUrl, secretBase32: result.secretBase32 });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotStartRegistration'));
    } finally {
      setSubmitting(false);
    }
  };

  if (enroll) {
    return (
      <CenteredCard width={440}>
        <Title level={4} style={{ marginBottom: 4 }}>
          {t('setUpTwoFactor')}
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {t('requiredToFinishAccount')}
        </Text>
        <TotpEnrollWizard
          otpauthUrl={enroll.otpauthUrl}
          secretBase32={enroll.secretBase32}
          onConfirm={(code) => registerConfirm(enroll.token, code)}
          finishNote={t('accountCreatedPendingApproval')}
          finishLabel={t('goToSignIn')}
          onFinish={() =>
            navigate('/login', {
              replace: true,
              state: { notice: t('registrationCompleteNotice') },
            })
          }
        />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        {t('createAnAccount')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        {t('registrationDescription')}
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <Form.Item name="email" label={t('email')} rules={[{ required: true, message: t('emailRequired') }]}>
          <Input type="email" autoComplete="username" autoFocus />
        </Form.Item>
        <PasswordFields />
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t('continue')}
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('alreadyHaveAccount')} <Link to="/login">{t('signIn')}</Link>
      </Text>
    </CenteredCard>
  );
}
