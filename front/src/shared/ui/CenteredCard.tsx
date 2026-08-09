import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MarrowMark } from './MarrowMark';

/** Full-height centered card used by the auth pages (login, register, 2FA, invite/claim links). */
export function CenteredCard({ children, width = 400 }: { children: ReactNode; width?: number }) {
  const { t } = useTranslation('auth');
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
      {/* T-MEMORY-061 / I-MEMORY-058: canonical two-line slogan, always
          together and in this order. The EN backronym is a name (like Bash
          or YACC) -- never translated/localized, one Latin line for every
          language. Acronym letters (A-R-R-O-W, spelling the rest of MARROW)
          are weight/color-accented, never underlined -- underline reads as
          a link in this UI. Only the subtitle beneath it is localized, and
          it's a semantic counterpart to the joke, not a literal translation
          (see I-MEMORY-058 -- machine-translating the EN line reads as a
          product recall of employees). */}
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
          MARROW <span className="marrow-acronym-letter">A</span>in&apos;t <span className="marrow-acronym-letter">R</span>AM
          {' — '}
          <span className="marrow-acronym-letter">R</span>ecall <span className="marrow-acronym-letter">O</span>utlives{' '}
          <span className="marrow-acronym-letter">W</span>orkers
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', opacity: 0.75 }}>
          {t('tagline')}
        </Typography.Text>
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
