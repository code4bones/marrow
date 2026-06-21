import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  BugOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Col, Row, Skeleton, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import type { Artifact, Decision, Event, ProjectSummary, Task } from '../../shared/model/types';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const taskColumns: ColumnsType<Task> = [
  { title: 'ID', dataIndex: 'id', width: 130, render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text> },
  { title: 'Title', dataIndex: 'title', ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  { title: 'Priority', dataIndex: 'priority', width: 70, align: 'center' },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const decisionColumns: ColumnsType<Decision> = [
  { title: 'ID', dataIndex: 'id', width: 130, render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text> },
  { title: 'Title', dataIndex: 'title', ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  { title: 'Tags', dataIndex: 'tags', width: 160, render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>) },
];

const artifactColumns: ColumnsType<Artifact> = [
  { title: 'Path', dataIndex: 'path', ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text> },
  { title: 'Type', dataIndex: 'contentType', width: 160, ellipsis: true },
  { title: 'Size', dataIndex: 'sizeBytes', width: 80, align: 'right', render: (v) => v ? `${(v / 1024).toFixed(1)}k` : '—' },
  { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
];

const eventColumns: ColumnsType<Event> = [
  { title: 'Type', dataIndex: 'type', width: 140, render: (v) => <Tag>{v}</Tag> },
  { title: 'Title', dataIndex: 'title', ellipsis: true },
  { title: 'Related', dataIndex: 'relatedId', width: 130, render: (v) => v ? <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text> : '—' },
  { title: 'At', dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

export function ProjectOverview({ slug }: { slug: string }) {
  const { data, loading, error } = useQuery<{ projectSummary: ProjectSummary }>(
    GET_PROJECT_SUMMARY,
    { variables: { project: slug } },
  );

  if (loading) return <Skeleton active />;
  if (error) return <Alert type="error" message={error.message} />;

  const s = data!.projectSummary;
  const { counts } = s;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <Typography.Title level={4} style={{ marginBottom: 2 }}>
          {s.project.title}
        </Typography.Title>
        {s.project.description && (
          <Typography.Text type="secondary">{s.project.description}</Typography.Text>
        )}
      </div>

      <Row gutter={16}>
        <Col><Statistic title="Open Tasks" value={counts.openTasks} prefix={<CalendarOutlined />} /></Col>
        <Col><Statistic title="Tasks" value={counts.tasks} /></Col>
        <Col><Statistic title="Decisions" value={counts.decisions} prefix={<ApartmentOutlined />} /></Col>
        <Col><Statistic title="Artifacts" value={counts.artifacts} prefix={<DatabaseOutlined />} /></Col>
        <Col><Statistic title="Events" value={counts.events} prefix={<ThunderboltOutlined />} /></Col>
        <Col><Statistic title="Memory" value={counts.items} /></Col>
        {counts.openTasks > 0 && (
          <Col><Statistic title="Faults" value={0} prefix={<BugOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Col>
        )}
      </Row>

      {s.openTasks.length > 0 && (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>Open Tasks</Typography.Title>
          <Table<Task>
            dataSource={s.openTasks}
            columns={taskColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </div>
      )}

      {s.decisions.length > 0 && (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>Active Decisions</Typography.Title>
          <Table<Decision>
            dataSource={s.decisions}
            columns={decisionColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </div>
      )}

      {s.artifacts.length > 0 && (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>Artifacts</Typography.Title>
          <Table<Artifact>
            dataSource={s.artifacts}
            columns={artifactColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </div>
      )}

      {s.recentEvents.length > 0 && (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>Recent Events</Typography.Title>
          <Table<Event>
            dataSource={s.recentEvents}
            columns={eventColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </div>
      )}
    </div>
  );
}
