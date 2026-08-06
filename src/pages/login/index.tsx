import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { useAuthStore } from '../../shared/model/auth.store';

const { Title, Text } = Typography;

interface CredentialsFormValues {
  email: string;
  password: string;
  confirmPassword?: string;
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#141414',
      }}
    >
      <Card style={{ width: 400 }}>{children}</Card>
    </div>
  );
}

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const bootstrapNeeded = useAuthStore((s) => s.bootstrapNeeded);
  const login = useAuthStore((s) => s.login);
  const bootstrapAdmin = useAuthStore((s) => s.bootstrapAdmin);
  const navigate = useNavigate();
  const [form] = Form.useForm<CredentialsFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'checking' || bootstrapNeeded === null) {
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
      if (bootstrapNeeded) {
        await bootstrapAdmin(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrapNeeded) {
    return (
      <CenteredCard>
        <Title level={4} style={{ marginBottom: 4 }}>
          Set up Project Memory
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          No admin account exists yet. Create the first one — this only happens once, and only while the
          instance has no admin. Do this before exposing the instance publicly.
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item name="email" label="Admin email" rules={[{ required: true, message: 'Email is required' }]}>
            <Input type="email" autoComplete="username" autoFocus />
          </Form.Item>
          <PasswordFields />
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              Create admin account
            </Button>
          </Form.Item>
        </Form>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        Project Memory
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Sign in with your account
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
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
