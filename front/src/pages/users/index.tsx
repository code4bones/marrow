import { useEffect, useState } from 'react';
import { Alert, Button, Card, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { type AccountUser, type PasswordResetLink, useAuthStore } from '../../shared/model/auth.store';

export function UsersPage() {
  const { t } = useTranslation('users');
  const currentUser = useAuthStore((s) => s.user);
  const fetchUsers = useAuthStore((s) => s.fetchUsers);
  const setUserRole = useAuthStore((s) => s.setUserRole);
  const setUserStatus = useAuthStore((s) => s.setUserStatus);
  const deleteUser = useAuthStore((s) => s.deleteUser);
  const createPasswordReset = useAuthStore((s) => s.createPasswordReset);

  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<PasswordResetLink | null>(null);

  const load = () => {
    fetchUsers()
      .then((data) => { setUsers(data); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('couldNotLoadUsers')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Same real event feed the Approvals badge uses (user.role_changed /
  // user.status_changed are common-scope events too) — another admin's
  // change shows up here without a manual refresh.
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), load);

  if (currentUser && currentUser.role !== 'admin') {
    return <Navigate to="/profile" replace />;
  }

  const changeRole = async (id: string, role: 'admin' | 'member') => {
    setActingId(id);
    try {
      await setUserRole(id, role);
      message.success(t('roleUpdated'));
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('couldNotChangeRole'));
    } finally {
      setActingId(null);
    }
  };

  const changeStatus = async (id: string, status: 'active' | 'disabled') => {
    setActingId(id);
    try {
      await setUserStatus(id, status);
      message.success(status === 'active' ? t('userReEnabled') : t('userDisabled'));
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('couldNotChangeStatus'));
    } finally {
      setActingId(null);
    }
  };

  const removeUser = async (id: string) => {
    setActingId(id);
    try {
      await deleteUser(id);
      message.success(t('userDeleted'));
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('couldNotDeleteUser'));
    } finally {
      setActingId(null);
    }
  };

  const resetPassword = async (id: string) => {
    setActingId(id);
    try {
      setResetLink(await createPasswordReset(id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('couldNotResetPassword'));
    } finally {
      setActingId(null);
    }
  };

  const columns: ColumnsType<AccountUser> = [
    { title: t('email'), dataIndex: 'email' },
    {
      title: t('role'),
      dataIndex: 'role',
      width: 160,
      render: (role: AccountUser['role'], row) => (
        <Select
          size="small"
          value={role}
          disabled={row.id === currentUser?.id || actingId === row.id}
          style={{ width: 120 }}
          options={[{ value: 'member', label: t('member') }, { value: 'admin', label: t('admin') }]}
          onChange={(value) => void changeRole(row.id, value)}
        />
      ),
    },
    {
      title: t('status'),
      dataIndex: 'status',
      width: 120,
      render: (status: AccountUser['status']) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>{status}</Tag>
      ),
    },
    { title: t('twoFa'), dataIndex: 'totpEnabled', width: 80, render: (v: boolean) => (v ? t('on') : t('off')) },
    { title: t('joined'), dataIndex: 'createdAt', width: 180, render: (v) => <Timestamp value={v} /> },
    {
      title: '',
      key: 'actions',
      width: 330,
      render: (_, row) =>
        row.id === currentUser?.id ? null : (
          <Space size="small" wrap>
            <Popconfirm
              title={t('resetPasswordConfirm', { email: row.email })}
              description={t('resetPasswordWarning')}
              onConfirm={() => void resetPassword(row.id)}
              disabled={row.status !== 'active' || actingId !== null}
              okButtonProps={{ loading: actingId === row.id }}
            >
              <Button type="link" size="small" disabled={row.status !== 'active' || actingId !== null}>
                {t('resetPassword')}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={row.status === 'active' ? t('disableAccountConfirm') : t('enableAccountConfirm')}
              onConfirm={() => void changeStatus(row.id, row.status === 'active' ? 'disabled' : 'active')}
            >
              <a>{row.status === 'active' ? t('disable') : t('enable')}</a>
            </Popconfirm>
            <Popconfirm
              title={t('deleteAccountConfirm')}
              description={t('deleteAccountWarning')}
              okButtonProps={{ danger: true, loading: actingId === row.id }}
              onConfirm={() => void removeUser(row.id)}
            >
              <a style={{ color: '#ff4d4f' }}>{t('delete')}</a>
            </Popconfirm>
          </Space>
        ),
    },
  ];

  return (
    <PageLayout title={t('users')} subtitle={t('everyoneWithAccount')}>
      <Card size="small">
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Table<AccountUser>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={users}
          columns={columns}
          pagination={false}
        />
      </Card>
      <Modal
        open={resetLink !== null}
        destroyOnHidden
        title={t('passwordResetLink')}
        onCancel={() => setResetLink(null)}
        footer={<Button type="primary" onClick={() => setResetLink(null)}>{t('closeResetLink')}</Button>}
      >
        {resetLink && <>
          <Typography.Paragraph>{t('resetLinkFor', { email: resetLink.email })}</Typography.Paragraph>
          <Alert type="warning" showIcon message={t('resetLinkShownOnce')} style={{ marginBottom: 16 }} />
          <CodeBlock code={new URL(resetLink.claimPath, window.location.origin).href} />
          <div style={{ marginBottom: 16 }}>
            <Typography.Text>{t('resetLinkExpires')}</Typography.Text>
            <Timestamp value={resetLink.expiresAt} />
          </div>
          <Typography.Paragraph type="secondary">{t('resetLinkInstructions')}</Typography.Paragraph>
        </>}
      </Modal>
    </PageLayout>
  );
}
