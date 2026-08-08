import { useEffect, useState } from 'react';
import { Alert, Card, Popconfirm, Select, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Navigate } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { type AccountUser, useAuthStore } from '../../shared/model/auth.store';

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const fetchUsers = useAuthStore((s) => s.fetchUsers);
  const setUserRole = useAuthStore((s) => s.setUserRole);
  const setUserStatus = useAuthStore((s) => s.setUserStatus);

  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = () => {
    fetchUsers()
      .then((data) => { setUsers(data); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load users.'))
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
      message.success('Role updated.');
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not change role.');
    } finally {
      setActingId(null);
    }
  };

  const changeStatus = async (id: string, status: 'active' | 'disabled') => {
    setActingId(id);
    try {
      await setUserStatus(id, status);
      message.success(status === 'active' ? 'User re-enabled.' : 'User disabled.');
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not change status.');
    } finally {
      setActingId(null);
    }
  };

  const columns: ColumnsType<AccountUser> = [
    { title: 'Email', dataIndex: 'email' },
    {
      title: 'Role',
      dataIndex: 'role',
      width: 160,
      render: (role: AccountUser['role'], row) => (
        <Select
          size="small"
          value={role}
          disabled={row.id === currentUser?.id || actingId === row.id}
          style={{ width: 120 }}
          options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]}
          onChange={(value) => void changeRole(row.id, value)}
        />
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (status: AccountUser['status']) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>{status}</Tag>
      ),
    },
    { title: '2FA', dataIndex: 'totpEnabled', width: 80, render: (v: boolean) => (v ? 'On' : 'Off') },
    { title: 'Joined', dataIndex: 'createdAt', width: 180, render: (v) => <Timestamp value={v} /> },
    {
      title: '',
      key: 'actions',
      width: 140,
      render: (_, row) =>
        row.id === currentUser?.id ? null : (
          <Popconfirm
            title={row.status === 'active' ? 'Disable this account?' : 'Re-enable this account?'}
            onConfirm={() => void changeStatus(row.id, row.status === 'active' ? 'disabled' : 'active')}
          >
            <a>{row.status === 'active' ? 'Disable' : 'Enable'}</a>
          </Popconfirm>
        ),
    },
  ];

  return (
    <PageLayout title="Users" subtitle="Everyone with an account on this instance">
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
    </PageLayout>
  );
}
