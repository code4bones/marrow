import { Tag } from 'antd';

/**
 * T-MEMORY-051 follow-up: small "New" tag for list-page rows whose
 * updatedAt/createdAt is after the account's notifications_seen_at cursor.
 * Pair with `isNewSince` (shared/lib/isNewSince.ts) to decide whether to render it.
 */
export function NewTag() {
  return (
    <Tag color="blue" style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px', marginLeft: 6 }}>
      New
    </Tag>
  );
}
