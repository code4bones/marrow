import { Collapse, Skeleton, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface MilestoneGroupable {
  milestone?: string | null;
}

interface Props<T extends MilestoneGroupable> {
  items: T[];
  columns: ColumnsType<T>;
  rowKey: string;
  loading?: boolean;
  /** Caller-supplied so this stays namespace-agnostic (Tasks/Decisions each own their i18n namespace). */
  noMilestoneLabel: string;
}

// Generic "milestone -> its rows" view: one Collapse panel per distinct
// milestone value (sorted A-Z), a trailing panel for rows with no milestone
// at all (only rendered when at least one exists). Each panel's body is a
// plain, unpaginated Table reusing the caller's columns -- the milestone
// column itself is redundant once it's the panel header, so callers should
// filter it out of `columns` before passing them in.
export function MilestoneGroupedList<T extends MilestoneGroupable>({
  items,
  columns,
  rowKey,
  loading,
  noMilestoneLabel,
}: Props<T>) {
  if (loading && items.length === 0) {
    return <Skeleton active paragraph={{ rows: 4 }} />;
  }

  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const item of items) {
    if (item.milestone) {
      const bucket = groups.get(item.milestone) ?? [];
      bucket.push(item);
      groups.set(item.milestone, bucket);
    } else {
      ungrouped.push(item);
    }
  }
  const sortedMilestones = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

  const panelTable = (rows: T[]) => (
    <Table<T>
      dataSource={rows}
      columns={columns}
      rowKey={rowKey}
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
    />
  );

  const panelItems = sortedMilestones.map((milestone) => {
    const rows = groups.get(milestone) ?? [];
    return { key: milestone, label: `${milestone} (${rows.length})`, children: panelTable(rows) };
  });

  if (ungrouped.length > 0) {
    panelItems.push({
      key: '__no_milestone__',
      label: `${noMilestoneLabel} (${ungrouped.length})`,
      children: panelTable(ungrouped),
    });
  }

  return <Collapse size="small" items={panelItems} defaultActiveKey={sortedMilestones.slice(0, 1)} />;
}
