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
      <style>{`
        .marrow-brand-mark { color: #FF8C00; }
        .marrow-brand-text { color: #33FF33; }
        @media (prefers-color-scheme: light) {
          .marrow-brand-mark { color: #202020; }
          .marrow-brand-text { color: #505050; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <MarrowMark size={48} className="marrow-brand-mark" />
        <Typography.Text strong className="marrow-brand-text" style={{ fontSize: 28, letterSpacing: 1 }}>
          MARROW
        </Typography.Text>
      </div>
      <Card style={{ width }}>{children}</Card>
    </div>
  );
}
