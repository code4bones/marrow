import { Alert, Button, Form, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

interface PasswordFormValues {
  password: string;
  confirmPassword?: string;
}

/**
 * Accepts an admin-issued invite or a password-reset link (same token/password
 * shape on the backend — auth.claim() branches on the token's purpose). No
 * SMTP is configured, so the follow-up email-verification step (if any) is
 * relayed by this same browser via verifyEmail() rather than a real email.
 */
export function ClaimPage() {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const claimContext = useAuthStore((s) => s.claimContext);
  const claim = useAuthStore((s) => s.claim);
  const verifyEmail = useAuthStore((s) => s.verifyEmail);

  const [form] = Form.useForm<PasswordFormValues>();
  const [loading, setLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string>('invite');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = token ? claimContext(token) : Promise.reject(new Error(t('linkMissingToken')));
    run
      .then((result) => {
        if (cancelled) return;
        setEmail(result.email);
        setPurpose(result.purpose);
      })
      .catch((err) => {
        if (cancelled) return;
        setContextError(err instanceof Error ? err.message : t('linkInvalidOrExpired'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, claimContext, t]);

  const onFinish = async ({ password }: PasswordFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await claim(token, password);
      if (result.verifyEmailPath) {
        const verifyToken = new URL(result.verifyEmailPath, window.location.origin).searchParams.get('token');
        if (verifyToken) {
          await verifyEmail(verifyToken);
        }
      }
      navigate('/login', {
        replace: true,
        state: {
          notice:
            purpose === 'invite'
              ? t('accountReadyNotice')
              : t('passwordResetNotice'),
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('couldNotSetPassword'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (contextError) {
    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          {t('linkNotValid')}
        </Title>
        <Alert type="error" message={contextError} style={{ marginBottom: 16 }} showIcon />
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('askForNewLink')} <Link to="/login">{t('goToSignIn')}</Link>.
        </Text>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        {purpose === 'invite' ? t('acceptYourInvite') : t('resetYourPassword')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        {email ? t('settingPasswordFor', { email }) : t('setPasswordToContinue')}
      </Text>
      {submitError && <Alert type="error" message={submitError} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <PasswordFields autoFocus />
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {purpose === 'invite' ? t('acceptInvite') : t('resetPassword')}
          </Button>
        </Form.Item>
      </Form>
    </CenteredCard>
  );
}
