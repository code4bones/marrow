import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Navigate } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type PendingRegistration, useAuthStore } from '../../shared/model/auth.store';

const baseColumns: ColumnsType<PendingRegistration> = [
  { title: 'Email', dataIndex: 'email' },
  { title: 'Registered', dataIndex: 'createdAt', width: 180, render: (v) => <Timestamp value={v} /> },
];

export function ApprovalsPage() {
  const user = useAuthStore((s) => s.user);
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

  if (user && user.role !== 'admin') {
    return <Navigate to="/profile" replace />;
  }

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
    ...baseColumns,
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
    <PageLayout title="Approvals" subtitle="Accounts waiting for admin sign-off">
      <Card size="small">
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
    </PageLayout>
  );
}
