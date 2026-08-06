import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { Badge, Collapse, Skeleton, Tag } from 'antd';
import { GET_TASK_CLAIMS } from '../../shared/api/queries';
import type { TaskClaim } from '../../shared/model/types';
import { Timestamp } from '../../shared/ui/Timestamp';

const STATUS_COLOR: Record<string, string> = {
  active: '#52c41a',
  completed: '#1668dc',
  released: '#8c8c8c',
  expired: '#d46b08',
};

interface Props {
  taskId: string;
  activeClaimCount: number;
}

export function TaskClaimsPanel({ taskId, activeClaimCount }: Props) {
  const [loaded, setLoaded] = useState(false);
  const { data, loading } = useQuery<{ taskClaims: TaskClaim[] }>(GET_TASK_CLAIMS, {
    variables: { taskId },
    skip: !loaded,
  });

  const label = (
    <span>
      Claims
      {activeClaimCount > 0 && (
        <Badge count={activeClaimCount} color="#1668dc" style={{ marginLeft: 6 }} />
      )}
    </span>
  );

  return (
    <Collapse
      size="small"
      style={{ marginBottom: 16 }}
      onChange={(keys) => { if (keys.length > 0) setLoaded(true); }}
      items={[{
        key: 'claims',
        label,
        children: loading
          ? <Skeleton active paragraph={{ rows: 2 }} />
          : !data?.taskClaims.length
            ? <span style={{ color: '#8c8c8c', fontSize: 12 }}>No claims yet</span>
            : data.taskClaims.map((c) => (
                <div key={c.id} style={{
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      <Tag color={STATUS_COLOR[c.status] ?? '#8c8c8c'} style={{ fontSize: 10, marginRight: 4 }}>{c.status}</Tag>
                      <Tag style={{ fontSize: 10, marginRight: 4 }}>{c.role}</Tag>
                      {c.clientLabel && <span style={{ color: '#ccc' }}>{c.clientLabel}</span>}
                    </span>
                    <span style={{ color: '#595959', fontSize: 11 }}>
                      expires <Timestamp value={c.leaseExpiresAt} />
                    </span>
                  </div>
                  {c.note && (
                    <div style={{ marginTop: 4, color: '#999', fontStyle: 'italic', paddingLeft: 4 }}>
                      {c.note}
                    </div>
                  )}
                </div>
              )),
      }]}
    />
  );
}
