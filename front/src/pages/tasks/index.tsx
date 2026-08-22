import { useQuery } from '@apollo/client/react';
import { Alert, Badge, Select, Switch, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { CreateTaskDrawer } from '../../features/task/CreateTaskDrawer';
import { DeleteTaskButton } from '../../features/task/DeleteTaskButton';
import { TaskStatusSelect } from '../../features/task/TaskStatusSelect';
import { GET_TASKS_PAGE } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { isNewSince } from '../../shared/lib/isNewSince';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useSectionSeenStore } from '../../shared/model/sectionSeen.store';
import type { Paginated, Task } from '../../shared/model/types';
import { MilestoneGroupedList } from '../../shared/ui/MilestoneGroupedList';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { PriorityTag } from '../../shared/ui/PriorityTag';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';
import { TaskFlowchart } from '../../widgets/graph-view/TaskFlowchart';
import { TaskKanbanBoard } from '../../widgets/kanban/TaskKanbanBoard';

function statusOptions(t: (key: string) => string) {
  return [
    { label: t('allStatuses'), value: '' },
    { label: t('statusTodo'), value: 'todo' },
    { label: t('statusDoing'), value: 'doing' },
    { label: t('statusBlocked'), value: 'blocked' },
    { label: t('statusDone'), value: 'done' },
    { label: t('statusCancelled'), value: 'cancelled' },
  ];
}

// T-MEMORY-051 follow-up: server-driven sort. Values are "<TaskSortField>:<SortDirection>"
// GraphQL enum pairs, split apart before being sent as query variables.
function sortOptions(t: (key: string) => string) {
  return [
    { label: t('sortUpdatedNewest'), value: 'UPDATED_AT:DESC' },
    { label: t('sortCreatedNewest'), value: 'CREATED_AT:DESC' },
    { label: t('priority'), value: 'PRIORITY:ASC' },
  ];
}
const DEFAULT_SORT = 'UPDATED_AT:DESC';

export function TasksPage() {
  const { t } = useTranslation('tasks');
  const { slug } = useParams<{ slug: string }>();
  // T-MEMORY-103: Project Overview's Timeline/Kanban/Summary row links
  // straight into this tab (?tab=kanban) since there was previously no way
  // to find the Kanban view except opening Tasks and noticing the tab
  // yourself. Read once on mount only -- Tabs below is otherwise uncontrolled.
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'kanban' ? 'kanban' : 'list';
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [groupByMilestone, setGroupByMilestone] = useState(false);
  const { page, pageSize, offset, onChange } = usePage();
  const [sortField, sortDirection] = sort.split(':');

  // Fetch all tasks (no status filter) for the flowchart and the kanban board
  const { data: allData, refetch: refetchAll } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, limit: 100, offset: 0 },
    skip: !slug,
  });

  const { data, loading, error, refetch } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, status: status || undefined, sortField, sortDirection, limit: pageSize, offset },
    skip: !slug,
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.tasksVersion), refetch);
  const { labelFor } = useActorLabels(
    (data?.tasksPage.items ?? []).flatMap((task) => [task.createdBy, task.assigneeUserId ? `user:${task.assigneeUserId}` : null])
  );
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  // Owner's expectation: opening this section clears its own "new since
  // last viewed" badge on Project Overview, without a separate mark-as-read
  // step. Marked on every mount (including slug changes when switching
  // projects), not debounced -- markSeen is a cheap local-store write.
  const markSeen = useSectionSeenStore((s) => s.markSeen);
  useEffect(() => {
    if (slug) markSeen(slug, 'tasks');
  }, [slug, markSeen]);

  if (!slug) {
    return (
      <PageLayout title={t('tasks')}>
        <Typography.Text type="secondary">{t('selectProjectFirst')}</Typography.Text>
      </PageLayout>
    );
  }

  const pageInfo = data?.tasksPage.pageInfo;
  const allTasks = allData?.tasksPage.items ?? [];
  const filteredAllTasks = status ? allTasks.filter((task) => task.status === status) : allTasks;
  const milestoneSuggestions = Array.from(new Set(allTasks.map((task) => task.milestone).filter((m): m is string => Boolean(m))));

  const columns: ColumnsType<Task> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: t('title'), dataIndex: 'title', minWidth: 220, ellipsis: true,
      render: (v, row) => (
        <span>
          {v}
          {isNewSince(row.updatedAt ?? row.createdAt, notificationsSeenAt) && <NewTag />}
        </span>
      ),
    },
    {
      title: t('status'), dataIndex: 'status', width: 120,
      render: (v, row) => <TaskStatusSelect id={row.id} value={v} onDone={() => refetch()} />,
    },
    {
      title: t('priorityShort'), dataIndex: 'priority', width: 68, align: 'center',
      sorter: (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
      render: (v) => <PriorityTag priority={v} />,
    },
    {
      title: t('claims'), dataIndex: 'activeClaimCount', width: 68, align: 'center',
      render: (v: number) => v > 0 ? <Badge count={v} color="#1668dc" /> : null,
    },
    { title: t('milestone'), dataIndex: 'milestone', width: 130, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    {
      title: t('scope'), dataIndex: 'scope', width: 80,
      render: (v) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—',
    },
    {
      title: t('updated'), dataIndex: 'updatedAt', width: 150,
      render: (v, row) => (
        <span>
          <Timestamp value={v} author={labelFor(row.createdBy)} />
          {row.assigneeDiffersFromOwner && (
            <Tag color="gold" style={{ fontSize: 10, marginLeft: 4 }}>
              {'→'} {labelFor(`user:${row.assigneeUserId}`)}
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '', key: 'actions', width: 40, fixed: 'right',
      render: (_, row) => <DeleteTaskButton id={row.id} onDone={() => refetch()} />,
    },
  ];

  const header = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Select
        value={status}
        onChange={(v) => { setStatus(v); onChange(1, pageSize); }}
        options={statusOptions(t)}
        style={{ width: 150 }}
        size="small"
      />
      <Select
        value={sort}
        onChange={(v) => { setSort(v); onChange(1, pageSize); }}
        options={sortOptions(t)}
        style={{ width: 160 }}
        size="small"
      />
      <Switch
        size="small"
        checked={groupByMilestone}
        onChange={setGroupByMilestone}
        checkedChildren={t('groupByMilestone')}
        unCheckedChildren={t('groupByMilestone')}
      />
      <CreateTaskDrawer projectSlug={slug} onDone={() => refetch()} milestoneSuggestions={milestoneSuggestions} />
    </div>
  );

  return (
    <PageLayout title={t('tasks')} slug={slug} headerExtra={header} fill>
      <Tabs
        defaultActiveKey={initialTab}
        size="small"
        className="tabs-fill"
        tabBarStyle={{ marginBottom: 8, flexShrink: 0, paddingLeft: 24 }}
        items={[
          {
            key: 'list',
            label: t('list'),
            children: (
              <div style={{ height: '100%', overflowY: 'auto', padding: '0 0 8px' }}>
                {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
                {groupByMilestone ? (
                  <MilestoneGroupedList<Task>
                    items={filteredAllTasks}
                    columns={columns.filter((c) => c.key !== 'milestone' && ('dataIndex' in c ? c.dataIndex !== 'milestone' : true))}
                    rowKey="id"
                    noMilestoneLabel={t('noMilestone')}
                  />
                ) : (
                  <Table<Task>
                    dataSource={data?.tasksPage.items}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    loading={loading}
                    scroll={{ x: 'max-content' }}
                    pagination={{
                      current: page,
                      pageSize,
                      total: pageInfo?.totalCount,
                      onChange,
                      showSizeChanger: true,
                      pageSizeOptions: ['15', '25', '50', '100'],
                      showTotal: (count) => t('tasksCount', { count }),
                    }}
                  />
                )}
              </div>
            ),
          },
          {
            key: 'kanban',
            label: t('kanban'),
            children: (
              <div style={{ height: '100%', minHeight: 400 }}>
                <TaskKanbanBoard tasks={allTasks} projectSlug={slug} groupByMilestone={groupByMilestone} onChanged={() => { refetch(); refetchAll(); }} />
              </div>
            ),
          },
          {
            key: 'flowchart',
            label: t('dependencyFlowchart'),
            children: (
              <div style={{ height: '100%', minHeight: 400 }}>
                <TaskFlowchart tasks={allTasks} />
              </div>
            ),
          },
        ]}
      />
    </PageLayout>
  );
}
