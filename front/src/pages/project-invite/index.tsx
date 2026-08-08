import { useMutation } from '@apollo/client/react';
import { Alert, Button, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TotpLoginStep } from '../../features/auth/TotpLoginStep';
import { CLAIM_PROJECT_INVITE_LINK } from '../../shared/api/queries';
import { API_BASE_URL } from '../../shared/config/env';
import { useAuthStore } from '../../shared/model/auth.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { CenteredCard } from '../../shared/ui/CenteredCard';

const { Title, Text } = Typography;

interface CredentialsFormValues {
  email: string;
  password: string;
}

interface InviteContextResponse {
  ok?: boolean;
  data?: { projectTitle: string; projectSlug: string };
  error?: { message?: string };
}

interface ClaimResult {
  claimProjectInviteLink: { project: { id: string; slug: string; title: string }; joined: boolean };
}

/**
 * Public invite-landing page for a project's reusable invite link
 * (/invite/:code) -- modeled directly on pages/oauth-authorize: resolve the
 * code via the unauthenticated GET /project-invites/:code lookup so the
 * page can show "You're invited to join {projectTitle}" before asking for
 * login; if no valid session, render the login/TOTP form in place (reusing
 * TotpLoginStep exactly like oauth-authorize does); once authenticated, a
 * single "Join project" confirm button calls claimProjectInviteLink, then
 * navigates to /projects/{slug}.
 */
export function ProjectInvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const pendingTotpUserId = useAuthStore((s) => s.pendingTotpUserId);
  const login = useAuthStore((s) => s.login);
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);
  const [form] = Form.useForm<CredentialsFormValues>();

  const [context, setContext] = useState<{ projectTitle: string; projectSlug: string } | null>(null);
  const [contextError, setContextError] = useState<string | null>(
    code ? null : 'This invite link is missing a code.',
  );
  const [contextLoading, setContextLoading] = useState(Boolean(code));
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [claim, { loading: joining }] = useMutation<ClaimResult>(CLAIM_PROJECT_INVITE_LINK);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      return;
    }
    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/project-invites/${encodeURIComponent(code)}`);
        const body: InviteContextResponse = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || body.ok === false || !body.data) {
          setContextError(body.error?.message ?? 'This invite link is no longer valid.');
        } else {
          setContext(body.data);
        }
      } catch {
        if (!cancelled) setContextError('Could not check this invite link. Try again.');
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (status === 'checking' || contextLoading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (contextError || !code) {
    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          Invalid invite link
        </Title>
        <Text type="secondary">{contextError ?? 'This invite link is missing a code.'}</Text>
      </CenteredCard>
    );
  }

  if (status !== 'authenticated' && pendingTotpUserId) {
    // Re-renders into the join-confirm screen below once loginTotp() flips
    // status to 'authenticated' -- no navigation needed here, same pattern
    // as pages/oauth-authorize.
    return <TotpLoginStep onSuccess={() => {}} />;
  }

  if (status !== 'authenticated') {
    const onFinish = async ({ email, password }: CredentialsFormValues) => {
      setLoginError(null);
      setSubmitting(true);
      try {
        await login(email.trim(), password);
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          Sign in to join {context?.projectTitle}
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Sign in to your Marrow account to accept this invite.
        </Text>
        {loginError && <Alert type="error" message={loginError} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Email is required' }]}>
            <Input type="email" autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Password is required' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </CenteredCard>
    );
  }

  const onJoin = async () => {
    setJoinError(null);
    try {
      const result = await claim({ variables: { code } });
      const project = result.data?.claimProjectInviteLink.project;
      if (!project) {
        throw new Error('Could not join this project.');
      }
      setSelectedProject(project.slug);
      navigate(`/projects/${project.slug}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join this project.');
    }
  };

  return (
    <CenteredCard width={440}>
      <Title level={4} style={{ marginBottom: 4 }}>
        You're invited to join {context?.projectTitle}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Joining adds this project to your Marrow account.
      </Text>
      {joinError && <Alert type="error" message={joinError} style={{ marginBottom: 16 }} showIcon />}
      <Button type="primary" block loading={joining} onClick={onJoin}>
        Join project
      </Button>
    </CenteredCard>
  );
}
