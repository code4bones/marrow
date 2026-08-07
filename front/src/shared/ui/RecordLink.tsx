import { Tag } from 'antd';
import { ENTITY_COLOR, getEntityType } from '../lib/entityId';
import { useWorkspaceStore } from '../model/workspace.store';

interface Props {
  id: string | null | undefined;
  dim?: boolean;
}

export function RecordLink({ id, dim }: Props) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  if (!id) return <span style={{ color: '#595959' }}>—</span>;

  const type = getEntityType(id);
  const accent = ENTITY_COLOR[type];

  return (
    <Tag
      style={{
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: 'monospace',
        userSelect: 'none',
        background: 'transparent',
        border: `1px solid ${dim ? '#434343' : accent}`,
        color: dim ? '#8c8c8c' : accent,
      }}
      onClick={(e) => { e.stopPropagation(); setSelectedRecord(id, type); }}
    >
      {id}
    </Tag>
  );
}
