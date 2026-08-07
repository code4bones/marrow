import { Card } from 'antd';
import type { ReactNode } from 'react';

/** Full-height centered card used by the auth pages (login, register). */
export function CenteredCard({ children, width = 400 }: { children: ReactNode; width?: number }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#141414',
      }}
    >
      <Card style={{ width }}>{children}</Card>
    </div>
  );
}
