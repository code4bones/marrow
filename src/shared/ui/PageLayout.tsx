import { Typography } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function PageLayout({ title, subtitle, headerExtra, children }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #303030', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <Typography.Title level={4} style={{ marginBottom: subtitle ? 2 : 0 }}>
              {title}
            </Typography.Title>
            {subtitle && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {subtitle}
              </Typography.Text>
            )}
          </div>
          {headerExtra && <div style={{ flexShrink: 0 }}>{headerExtra}</div>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {children}
      </div>
    </div>
  );
}
