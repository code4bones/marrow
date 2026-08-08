import { Alert, Button, Form, Input, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { TotpLoginStep } from '../../features/auth/TotpLoginStep';
import { CenteredCard } from '../../shared/ui/CenteredCard';
import { API_BASE_URL } from '../../shared/config/env';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text, Paragraph } = Typography;

interface CredentialsFormValues {
  email: string;
  password: string;
}

interface AuthorizeResponse {
  ok?: boolean;
  data?: { redirectUri?: string };
  error?: { message?: string };
}

// Same param set the backend's GET /oauth/authorize (oauth.ts) validates
// before redirecting here, plus the two optional ones -- round-tripped
// as-is to POST /oauth/authorize on Approve.
const OAUTH_PARAM_NAMES = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

/**
 * SSO landing page for OAuth-connected clients (Claude Code, ChatGPT
 * connectors): the backend's GET /oauth/authorize 302s here instead of
 * rendering its own magic-token form. Not authenticated yet -> render
 * Marrow's own login (+ TOTP) screens in place; authenticated -> render a
 * consent screen and, on Approve, POST the OAuth params to the backend
 * (cookie sent automatically) and follow the redirectUri it returns. This
 * is an external-redirect target, not in-app navigation -- modeled on
 * pages/claim, not on the authenticated app shell's routes.
 */
export function OAuthAuthorizePage() {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const status = useAuthStore((s) => s.status);
  const bootstrapNeeded = useAuthStore((s) => s.bootstrapNeeded);
  const pendingTotpUserId = useAuthStore((s) => s.pendingTotpUserId);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [form] = Form.useForm<CredentialsFormValues>();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const clientId = searchParams.get('client_id') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';

  const oauthParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    for (const name of OAUTH_PARAM_NAMES) {
      const value = searchParams.get(name);
      if (value !== null) {
        params[name] = value;
      }
    }
    return params;
  };

  if (status === 'checking' || bootstrapNeeded === null) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!redirectUri) {
    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          {t('invalidRequest')}
        </Title>
        <Text type="secondary">{t('authLinkMissingParams')}</Text>
      </CenteredCard>
    );
  }

  if (!bootstrapNeeded && pendingTotpUserId) {
    // Re-renders into the consent screen below once loginTotp() flips
    // status to 'authenticated' -- no navigation needed here.
    return <TotpLoginStep onSuccess={() => {}} />;
  }

  if (status !== 'authenticated') {
    const onFinish = async ({ email, password }: CredentialsFormValues) => {
      setLoginError(null);
      setSubmitting(true);
      try {
        await login(email.trim(), password);
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : t('somethingWentWrong'));
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          {t('signInToMarrow')}
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {t('wantsToConnect', { client: clientId || t('anApplication') })}
        </Text>
        {loginError && <Alert type="error" message={loginError} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item name="email" label={t('email')} rules={[{ required: true, message: t('emailRequired') }]}>
            <Input type="email" autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label={t('password')} rules={[{ required: true, message: t('passwordRequired') }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              {t('signIn')}
            </Button>
          </Form.Item>
        </Form>
      </CenteredCard>
    );
  }

  const onApprove = async () => {
    setDecisionError(null);
    setDeciding(true);
    try {
      const response = await fetch(`${API_BASE_URL}/oauth/authorize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(oauthParams()),
      });
      let body: AuthorizeResponse = {};
      try {
        body = await response.json();
      } catch {
        // fall through to the generic error below
      }
      if (!response.ok || body.ok === false || !body.data?.redirectUri) {
        throw new Error(body.error?.message ?? t('couldNotAuthorizeApplication'));
      }
      window.location.href = body.data.redirectUri;
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : t('couldNotAuthorizeApplication'));
      setDeciding(false);
    }
  };

  const onDeny = () => {
    const target = new URL(redirectUri);
    target.searchParams.set('error', 'access_denied');
    const state = searchParams.get('state');
    if (state) {
      target.searchParams.set('state', state);
    }
    window.location.href = target.toString();
  };

  return (
    <CenteredCard width={440}>
      <Title level={4} style={{ marginBottom: 4 }}>
        {t('authorizeApplication', { client: clientId || t('application') })}
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        {t('marrowWantsToLet')} <strong>{clientId || t('thisApplication')}</strong> {t('accessYourAccount', { email: user?.email, role: user?.role })}
      </Paragraph>
      {decisionError && <Alert type="error" message={decisionError} style={{ marginBottom: 16 }} showIcon />}
      <div style={{ display: 'flex', gap: 12 }}>
        <Button type="primary" block loading={deciding} onClick={onApprove}>
          {t('approve')}
        </Button>
        <Button block disabled={deciding} onClick={onDeny}>
          {t('deny')}
        </Button>
      </div>
    </CenteredCard>
  );
}
