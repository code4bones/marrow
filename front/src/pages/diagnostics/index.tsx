import { useQuery } from '@apollo/client/react';
import { Alert, Card, Descriptions, Skeleton, Tag, Typography } from 'antd';
import { GET_GATEWAY_STATUS } from '../../shared/api/queries';
import { PageLayout } from '../../shared/ui/PageLayout';

interface GatewayData {
  gatewayVersion: Record<string, unknown>;
  gatewayStatus: Record<string, unknown>;
  gatewayDiagnostics: Record<string, unknown>;
}

function JsonSection({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <Card
      title={<Typography.Text style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</Typography.Text>}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <Descriptions size="small" column={2} bordered>
        {Object.entries(data).map(([k, v]) => (
          <Descriptions.Item key={k} label={<Typography.Text code style={{ fontSize: 11 }}>{k}</Typography.Text>}>
            {typeof v === 'boolean' ? (
              <Tag color={v ? 'green' : 'red'}>{String(v)}</Tag>
            ) : Array.isArray(v) ? (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>[{v.length} items]</Typography.Text>
            ) : typeof v === 'object' && v !== null ? (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{JSON.stringify(v)}</Typography.Text>
            ) : (
              <Typography.Text style={{ fontSize: 12 }}>{String(v ?? '—')}</Typography.Text>
            )}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </Card>
  );
}

export function DiagnosticsPage() {
  const { data, loading, error } = useQuery<GatewayData>(GET_GATEWAY_STATUS);

  return (
    <PageLayout title="Gateway Diagnostics">
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      {loading && <Skeleton active paragraph={{ rows: 8 }} />}
      {data && (
        <>
          <JsonSection title="Version" data={data.gatewayVersion} />
          <JsonSection title="Status" data={data.gatewayStatus} />
          <JsonSection title="Diagnostics" data={data.gatewayDiagnostics} />
        </>
      )}
    </PageLayout>
  );
}
