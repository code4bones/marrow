import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  BugOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Col, Row, Skeleton, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import { ProjectGraphView } from '../graph-view/ProjectGraphView';
import type { Artifact, Decision, Event, ProjectSummary, Task } from '../../shared/model/types';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const taskColumns: ColumnsType<Task> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  { title: 'Pri', dataIndex: 'priority', width: 55, align: 'center' },
  { title: 'Milestone', dataIndex: 'milestone', width: 120, ellipsis: true, render: (v) => v ?? '—' },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const decisionColumns: ColumnsType<Decision> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', width: 200,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const artifactColumns: ColumnsType<Artifact> = [
  {
    title: 'ID', dataIndex: 'id', width: 140, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  {
    title: 'Path', dataIndex: 'path', minWidth: 200, ellipsis: true,
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Type', dataIndex: 'contentType', width: 180, ellipsis: true },
  { title: 'Size', dataIndex: 'sizeBytes', width: 75, align: 'right', render: (v) => v ? `${(v / 1024).toFixed(1)}k` : '—' },
  { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', width: 200,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const eventColumns: ColumnsType<Event> = [
  { title: 'Type', dataIndex: 'type', width: 160, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  {
    title: 'Related', dataIndex: 'relatedId', width: 140,
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'At', dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
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

export function ProjectOverview({ slug }: { slug: string }) {
  const { data, loading, error } = useQuery<{ projectSummary: ProjectSummary }>(
    GET_PROJECT_SUMMARY,
    { variables: { project: slug } },
  );

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message={error.message} />
      </div>
    );
  }

  const s = data!.projectSummary;
  const { counts } = s;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Fixed header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #303030', flexShrink: 0 }}>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {s.project.title}
        </Typography.Title>
        {s.project.description && (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            {s.project.description}
          </Typography.Text>
        )}
        <Row gutter={24}>
          <Col>
            <Statistic title="Open Tasks" value={counts.openTasks} prefix={<CalendarOutlined />} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic title="All Tasks" value={counts.tasks} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic title="Decisions" value={counts.decisions} prefix={<ApartmentOutlined />} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic title="Artifacts" value={counts.artifacts} prefix={<DatabaseOutlined />} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic title="Events" value={counts.events} prefix={<ThunderboltOutlined />} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic title="Memory" value={counts.items} valueStyle={{ fontSize: 20 }} />
          </Col>
          {counts.openTasks > 0 && (
            <Col>
              <Statistic
                title="Faults"
                value={0}
                prefix={<BugOutlined />}
                valueStyle={{ fontSize: 20, color: '#ff4d4f' }}
              />
            </Col>
          )}
        </Row>
      </div>

      {/* Tabs: Timeline | Summary — timeline first (I-PMEM-011): it's the
          entry point into a project's history, tables are the reference view */}
      <Tabs
        defaultActiveKey="timeline"
        size="small"
        className="tabs-fill"
        tabBarStyle={{ paddingLeft: 24, marginBottom: 0, flexShrink: 0 }}
        items={[
          {
            key: 'timeline',
            label: 'Timeline',
            children: (
              <div style={{ height: '100%' }}>
                <ProjectGraphView slug={slug} />
              </div>
            ),
          },
          {
            key: 'summary',
            label: 'Summary',
            children: (
              <div style={{ overflowY: 'auto', padding: '16px 24px', height: '100%' }}>
                {s.openTasks.length > 0 && (
                  <Section title="Open Tasks">
                    <Table<Task> dataSource={s.openTasks} columns={taskColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.decisions.length > 0 && (
                  <Section title="Active Decisions">
                    <Table<Decision> dataSource={s.decisions} columns={decisionColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.artifacts.length > 0 && (
                  <Section title="Artifacts">
                    <Table<Artifact> dataSource={s.artifacts} columns={artifactColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.recentEvents.length > 0 && (
                  <Section title="Recent Events">
                    <Table<Event> dataSource={s.recentEvents} columns={eventColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
