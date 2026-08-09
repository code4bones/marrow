import { Typography } from 'antd';
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
        .marrow-brand-text { color: #D97706; }
        .marrow-acronym-letter { font-weight: 700; color: #FF8C00; }
        @media (prefers-color-scheme: light) {
          .marrow-brand-mark { color: #202020; }
          .marrow-brand-text { color: #505050; }
          .marrow-acronym-letter { color: #202020; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <MarrowMark size={48} className="marrow-brand-mark" />
        <Typography.Text strong className="marrow-brand-text" style={{ fontSize: 28, letterSpacing: 1 }}>
          MARROW
        </Typography.Text>
      </div>
      {/* D-MEMORY-... / T-MEMORY-061: canonical two-line slogan, always
          together and in this order. Acronym letters (A-R-R-O-W, spelling
          the rest of MARROW) are weight/color-accented, never underlined --
          underline reads as a link in this UI. */}
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
          MARROW <span className="marrow-acronym-letter">A</span>in&apos;t <span className="marrow-acronym-letter">R</span>AM
          {' — '}
          <span className="marrow-acronym-letter">R</span>ecall <span className="marrow-acronym-letter">O</span>utlives{' '}
          <span className="marrow-acronym-letter">W</span>orkers
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', opacity: 0.75 }}>
          Процессы умирают, память остаётся
        </Typography.Text>
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
