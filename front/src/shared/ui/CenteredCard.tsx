import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { MarrowMark } from './MarrowMark';

/** Full-height centered card used by the auth pages (login, register, 2FA, invite/claim links). */
export function CenteredCard({ children, width = 400 }: { children: ReactNode; width?: number }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: '#141414',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MarrowMark size={28} />
        <Typography.Text strong style={{ fontSize: 18, letterSpacing: 1 }}>
          MARROW
        </Typography.Text>
      </div>
      <Card style={{ width }}>{children}</Card>
    </div>
  );
}
