import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { TotpEnrollWizard } from '../../features/auth/TotpEnrollWizard';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type PendingRegistration, useAuthStore } from '../../shared/model/auth.store';

const { Text } = Typography;

interface ChangePasswordValues {
  currentPassword: string;
  password: string;
  confirmPassword?: string;
}

/** Modal that gates a destructive/sensitive 2FA action behind the current password. */
function PasswordConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setPassword('');
    setError(null);
    onCancel();
  };

  const handleOk = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(password);
      setPassword('');
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={close}
      onOk={() => void handleOk()}
      okText={confirmLabel}
      okButtonProps={{ loading: submitting, danger }}
      destroyOnHidden
    >
      {description && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {description}
        </Text>
      )}
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Input.Password
        placeholder="Current password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onPressEnter={() => void handleOk()}
        autoFocus
      />
    </Modal>
  );
}

function RecoveryCodesModal({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  return (
    <Modal open={codes !== null} title="New recovery codes" onCancel={onClose} onOk={onClose} okText="Done" cancelButtonProps={{ style: { display: 'none' } }}>
      <Alert
        type="warning"
        showIcon
        message="Save these now"
        description="Your old recovery codes no longer work. Each new code can be used once. They will not be shown again."
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid #303030',
          borderRadius: 6,
          padding: '12px 16px',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.9,
          userSelect: 'all',
        }}
      >
        {(codes ?? []).map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
    </Modal>
  );
}

function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);
  const [form] = Form.useForm<ChangePasswordValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const onFinish = async (values: ChangePasswordValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.password);
      form.resetFields();
      message.success('Password changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Account" size="small" style={{ marginBottom: 16 }}>
      <Descriptions size="small" column={1} style={{ marginBottom: 20 }}>
        <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
        <Descriptions.Item label="Role">
          <Tag>{user.role}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={user.status === 'active' ? 'green' : 'default'}>{user.status}</Tag>
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        Change password
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting} style={{ maxWidth: 360 }}>
        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Current password is required' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <PasswordFields />
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={submitting}>
            Update password
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

function TwoFactorSection() {
  const user = useAuthStore((s) => s.user);
  const enroll2fa = useAuthStore((s) => s.enroll2fa);
  const confirm2fa = useAuthStore((s) => s.confirm2fa);
  const disable2fa = useAuthStore((s) => s.disable2fa);
  const regenerateRecoveryCodes = useAuthStore((s) => s.regenerateRecoveryCodes);

  const [enrolling, setEnrolling] = useState<{ otpauthUrl: string; secretBase32: string } | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [startingEnroll, setStartingEnroll] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  if (!user) return null;

  const startEnroll = async () => {
    setEnrollError(null);
    setStartingEnroll(true);
    try {
      const result = await enroll2fa();
      setEnrolling({ otpauthUrl: result.otpauthUrl, secretBase32: result.secretBase32 });
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Could not start 2FA enrollment.');
    } finally {
      setStartingEnroll(false);
    }
  };

  return (
    <Card title="Two-factor authentication" size="small" style={{ marginBottom: 16 }}>
      {!user.totpEnabled && !enrolling && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Two-factor authentication is not enabled on this account.
          </Text>
          {enrollError && <Alert type="error" message={enrollError} style={{ marginBottom: 16 }} showIcon />}
          <Button type="primary" loading={startingEnroll} onClick={() => void startEnroll()}>
            Enable 2FA
          </Button>
        </>
      )}

      {!user.totpEnabled && enrolling && (
        <TotpEnrollWizard
          otpauthUrl={enrolling.otpauthUrl}
          secretBase32={enrolling.secretBase32}
          onConfirm={(code) => confirm2fa(code)}
          finishLabel="Done"
          onFinish={() => {
            setEnrolling(null);
            message.success('Two-factor authentication enabled.');
          }}
        />
      )}

      {user.totpEnabled && (
        <>
          <Tag color="green" style={{ marginBottom: 16 }}>
            Enabled
          </Tag>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setRegenerateOpen(true)}>Regenerate recovery codes</Button>
            <Button danger onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </Button>
          </div>
        </>
      )}

      <PasswordConfirmModal
        open={disableOpen}
        title="Disable 2FA"
        description="Confirm your password to disable two-factor authentication on this account."
        confirmLabel="Disable"
        danger
        onCancel={() => setDisableOpen(false)}
        onConfirm={async (password) => {
          await disable2fa(password);
          message.success('Two-factor authentication disabled.');
        }}
      />

      <PasswordConfirmModal
        open={regenerateOpen}
        title="Regenerate recovery codes"
        description="Confirm your password to invalidate your old recovery codes and generate a new set."
        confirmLabel="Regenerate"
        onCancel={() => setRegenerateOpen(false)}
        onConfirm={async (password) => {
          const result = await regenerateRecoveryCodes(password);
          setNewCodes(result.recoveryCodes);
        }}
      />

      <RecoveryCodesModal codes={newCodes} onClose={() => setNewCodes(null)} />
    </Card>
  );
}

const approvalsColumns: ColumnsType<PendingRegistration> = [
  { title: 'Email', dataIndex: 'email' },
  { title: 'Registered', dataIndex: 'createdAt', width: 180, render: (v) => <Timestamp value={v} /> },
];

function ApprovalsSection() {
  const fetchPendingUsers = useAuthStore((s) => s.fetchPendingUsers);
  const approvePendingUser = useAuthStore((s) => s.approvePendingUser);
  const rejectPendingUser = useAuthStore((s) => s.rejectPendingUser);

  const [users, setUsers] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await fetchPendingUsers();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pending users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchPendingUsers()
      .then((data) => {
        if (cancelled) return;
        setUsers(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load pending users.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setActingId(id);
    try {
      if (action === 'approve') {
        await approvePendingUser(id);
        message.success('User approved.');
      } else {
        await rejectPendingUser(id);
        message.success('User rejected.');
      }
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActingId(null);
    }
  };

  const columns: ColumnsType<PendingRegistration> = [
    ...approvalsColumns,
    {
      title: '',
      key: 'actions',
      width: 180,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" type="primary" loading={actingId === row.id} onClick={() => void act(row.id, 'approve')}>
            Approve
          </Button>
          <Button size="small" danger loading={actingId === row.id} onClick={() => void act(row.id, 'reject')}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card title="Pending approvals" size="small">
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Table<PendingRegistration>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={users}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty description="No accounts waiting for approval" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </Card>
  );
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <PageLayout title="Profile" subtitle="Account, security and access">
      <AccountSection />
      <TwoFactorSection />
      {user?.role === 'admin' && <ApprovalsSection />}
    </PageLayout>
  );
}
