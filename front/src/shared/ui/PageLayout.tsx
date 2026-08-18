import { Tag, Typography } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  /** Project slug, shown as a distinct highlighted tag instead of plain secondary text -- owner: it was easy to miss next to the title. */
  slug?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
  /** Remove padding/scroll from body — use when children manage their own layout (e.g. tabs with graphs) */
  fill?: boolean;
}

export function PageLayout({ title, subtitle, slug, headerExtra, children, fill }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #303030', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <Typography.Title level={4} style={{ marginBottom: subtitle || slug ? 4 : 0 }}>
              {title}
            </Typography.Title>
            {(slug || subtitle) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {slug && (
                  <Tag color="orange" style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>
                    {slug}
                  </Tag>
                )}
                {subtitle && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {subtitle}
                  </Typography.Text>
                )}
              </div>
            )}
          </div>
          {headerExtra && <div style={{ flexShrink: 0 }}>{headerExtra}</div>}
        </div>
      </div>
      <div style={fill
        ? { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
        : { flex: 1, overflowY: 'auto', padding: '16px 24px' }
      }>
        {children}
      </div>
    </div>
  );
}
