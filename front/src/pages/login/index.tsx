import { GithubOutlined } from '@ant-design/icons';
import { Alert, Button, Divider, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { TotpLoginStep } from '../../features/auth/TotpLoginStep';
import { API_BASE_URL } from '../../shared/config/env';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

interface CredentialsFormValues {
  email: string;
  password: string;
  confirmPassword?: string;
}

export function LoginPage() {
  const { t } = useTranslation('auth');
  const status = useAuthStore((s) => s.status);
  const bootstrapNeeded = useAuthStore((s) => s.bootstrapNeeded);
  const pendingTotpUserId = useAuthStore((s) => s.pendingTotpUserId);
  const login = useAuthStore((s) => s.login);
  const bootstrapAdmin = useAuthStore((s) => s.bootstrapAdmin);
  const setPendingTotpUserId = useAuthStore((s) => s.setPendingTotpUserId);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [form] = Form.useForm<CredentialsFormValues>();
  const [error, setError] = useState<string | null>(searchParams.get('error'));
  const [submitting, setSubmitting] = useState(false);

  // Landed here from GET /auth/oauth/github/callback, which can't set React
  // Router state (it's a full page navigation, not an SPA one) -- carries
  // its outcome as query params instead.
  useEffect(() => {
    const totpUserId = searchParams.get('pendingTotpUserId');
    if (totpUserId) {
      setPendingTotpUserId(totpUserId);
    }
    if (totpUserId || searchParams.get('error')) {
      setSearchParams((params) => {
        params.delete('pendingTotpUserId');
        params.delete('error');
        return params;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'checking' || bootstrapNeeded === null) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!bootstrapNeeded && pendingTotpUserId) {
    return <TotpLoginStep onSuccess={() => navigate('/projects', { replace: true })} />;
  }

  const onFinish = async ({ email, password }: CredentialsFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      if (bootstrapNeeded) {
        await bootstrapAdmin(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      // login() may instead have set pendingTotpUserId — in that case we stay on
      // this route and the branch above renders the second-factor screen.
      if (useAuthStore.getState().status === 'authenticated') {
        navigate('/projects', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('somethingWentWrong'));
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrapNeeded) {
    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          {t('setUpMarrow')}
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {t('bootstrapAdminDescription')}
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item name="email" label={t('adminEmail')} rules={[{ required: true, message: t('emailRequired') }]}>
            <Input type="email" autoComplete="username" autoFocus />
          </Form.Item>
          <PasswordFields />
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              {t('createAdminAccount')}
            </Button>
          </Form.Item>
        </Form>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        Marrow
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        {t('signInWithYourAccount')}
      </Text>
      {notice && !error && <Alert type="success" message={notice} style={{ marginBottom: 16 }} showIcon />}
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Button
        icon={<GithubOutlined />}
        block
        href={`${API_BASE_URL}/auth/oauth/github/start?intent=login`}
        style={{ marginBottom: 8 }}
      >
        {t('signInWithGithub')}
      </Button>
      <Divider style={{ margin: '8px 0 16px' }}>{t('orDivider')}</Divider>
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <Form.Item name="email" label={t('email')} rules={[{ required: true, message: t('emailRequired') }]}>
          <Input type="email" autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item name="password" label={t('password')} rules={[{ required: true, message: t('passwordRequired') }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t('signIn')}
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('dontHaveAccount')} <Link to="/register">{t('register')}</Link>
      </Text>
    </CenteredCard>
  );
}
