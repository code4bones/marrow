import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GET_ARTIFACTS, GET_DECISIONS } from '../../shared/api/queries';
import type { Artifact, Decision } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const artifactColumns: ColumnsType<Artifact> = [
  {
    title: 'Path', dataIndex: 'path', minWidth: 220, fixed: 'left', ellipsis: true,
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 180, ellipsis: true },
  { title: 'Type', dataIndex: 'contentType', width: 170, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', minWidth: 160,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const decisionColumns: ColumnsType<Decision> = [
  {
    title: 'ID', dataIndex: 'id', width: 160, fixed: 'left',
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 220, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', minWidth: 180,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}
      >
        {title}
      </Typography.Text>
      {children}
    </div>
  );
}

export function CommonPage() {
  const artifacts = useQuery<{ artifacts: Artifact[] }>(GET_ARTIFACTS, {
    variables: { project: null },
  });
  const decisions = useQuery<{ decisions: Decision[] }>(GET_DECISIONS, {
    variables: { project: null },
  });

  const error = artifacts.error ?? decisions.error;

  return (
    <PageLayout title="Common" subtitle="Shared knowledge across all projects">
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}

      <Section title="Common Artifacts">
        <Table<Artifact>
          dataSource={artifacts.data?.artifacts}
          columns={artifactColumns}
          rowKey="id"
          size="small"
          loading={artifacts.loading}
          pagination={{ pageSize: 50, showTotal: (t) => `${t} artifacts` }}
          scroll={{ x: 'max-content' }}
        />
      </Section>

      <Section title="Common Decisions">
        <Table<Decision>
          dataSource={decisions.data?.decisions}
          columns={decisionColumns}
          rowKey="id"
          size="small"
          loading={decisions.loading}
          pagination={{ pageSize: 50, showTotal: (t) => `${t} decisions` }}
          scroll={{ x: 'max-content' }}
        />
      </Section>
    </PageLayout>
  );
}
