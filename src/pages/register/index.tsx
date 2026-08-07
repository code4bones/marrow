import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const registerStart = useAuthStore((s) => s.registerStart);
  const registerConfirm = useAuthStore((s) => s.registerConfirm);
  const navigate = useNavigate();
  const [form] = Form.useForm<CredentialsFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enroll, setEnroll] = useState<EnrollState | null>(null);

  const onFinish = async ({ email, password }: CredentialsFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await registerStart(email.trim(), password);
      setEnroll({ token: result.token, otpauthUrl: result.otpauthUrl, secretBase32: result.secretBase32 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start registration.');
    } finally {
      setSubmitting(false);
    }
  };

  if (enroll) {
    return (
      <CenteredCard width={440}>
        <Title level={4} style={{ marginBottom: 4 }}>
          Set up two-factor authentication
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Required to finish creating your account.
        </Text>
        <TotpEnrollWizard
          otpauthUrl={enroll.otpauthUrl}
          secretBase32={enroll.secretBase32}
          onConfirm={(code) => registerConfirm(enroll.token, code)}
          finishNote="Your account has been created and is now pending admin approval. You'll be able to sign in once an admin approves it."
          finishLabel="Go to sign in"
          onFinish={() =>
            navigate('/login', {
              replace: true,
              state: { notice: 'Registration complete. Your account is pending admin approval.' },
            })
          }
        />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Title level={4} style={{ marginBottom: 4 }}>
        Create an account
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Registration requires setting up two-factor authentication, and new accounts need admin approval before
        they can sign in.
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting}>
        <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Email is required' }]}>
          <Input type="email" autoComplete="username" autoFocus />
        </Form.Item>
        <PasswordFields />
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            Continue
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 13 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </Text>
    </CenteredCard>
  );
}
