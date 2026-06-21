import { Typography } from 'antd';

export function DiagnosticsPage() {
  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Gateway Diagnostics
      </Typography.Title>
      <Typography.Text type="secondary">
        Gateway status and client management will load here.
      </Typography.Text>
    </div>
  );
}
