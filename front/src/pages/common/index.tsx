import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { PutTextArtifactDrawer } from '../../features/artifact/PutTextArtifactDrawer';
import { GET_ARTIFACTS, GET_DECISIONS } from '../../shared/api/queries';
import type { Artifact, Decision } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

function artifactColumns(t: (key: string) => string): ColumnsType<Artifact> {
  return [
    {
      title: t('path'), dataIndex: 'path', minWidth: 220, fixed: 'left', ellipsis: true,
      render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
    },
    { title: t('title'), dataIndex: 'title', minWidth: 180, ellipsis: true },
    { title: t('type'), dataIndex: 'contentType', width: 170, ellipsis: true },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 160,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

function decisionColumns(t: (key: string) => string): ColumnsType<Decision> {
  return [
    {
      title: t('idCol'), dataIndex: 'id', width: 160, fixed: 'left',
      render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
    },
    { title: t('title'), dataIndex: 'title', minWidth: 220, ellipsis: true },
    { title: t('status'), dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 180,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}
        >
          {title}
        </Typography.Text>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function CommonPage() {
  const { t } = useTranslation('common');
  const artifacts = useQuery<{ artifacts: Artifact[] }>(GET_ARTIFACTS, {
    variables: { project: null },
  });
  const decisions = useQuery<{ decisions: Decision[] }>(GET_DECISIONS, {
    variables: { project: null },
  });

  const error = artifacts.error ?? decisions.error;

  return (
    <PageLayout title={t('common')} subtitle={t('sharedKnowledgeAcrossProjects')}>
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}

      <Section
        title={t('commonArtifacts')}
        extra={<PutTextArtifactDrawer onDone={() => void artifacts.refetch()} />}
      >
        <Table<Artifact>
          dataSource={artifacts.data?.artifacts}
          columns={artifactColumns(t)}
          rowKey="id"
          size="small"
          loading={artifacts.loading}
          pagination={{ pageSize: 50, showTotal: (count) => t('artifactsCount', { count }) }}
          scroll={{ x: 'max-content' }}
        />
      </Section>

      <Section title={t('commonDecisions')}>
        <Table<Decision>
          dataSource={decisions.data?.decisions}
          columns={decisionColumns(t)}
          rowKey="id"
          size="small"
          loading={decisions.loading}
          pagination={{ pageSize: 50, showTotal: (count) => t('decisionsCount', { count }) }}
          scroll={{ x: 'max-content' }}
        />
      </Section>
    </PageLayout>
  );
}
