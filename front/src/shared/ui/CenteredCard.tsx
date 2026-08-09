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
      {/* T-MEMORY-061 / I-MEMORY-058..060: canonical two-line slogan. The EN
          backronym is a name (like Bash or YACC) -- never translated, one
          Latin line for every language. Acronym letters (A-R-R-O-W) are
          weight/color-accented, never underlined -- underline reads as a
          link in this UI. The subtitle (auth.tagline) is a semantic
          counterpart, not a literal translation of the backronym -- see
          I-MEMORY-059 for the final ru wording and I-MEMORY-060 for why the
          en value is empty here specifically: the EN backronym line already
          says the same thing right above it, so an EN subtitle would repeat
          the joke twice in a row. Only render the subtitle when non-empty,
          so the empty en value doesn't leave a blank line under the mark. */}
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
          MARROW <span className="marrow-acronym-letter">A</span>in&apos;t <span className="marrow-acronym-letter">R</span>AM
          {' — '}
          <span className="marrow-acronym-letter">R</span>ecall <span className="marrow-acronym-letter">O</span>utlives{' '}
          <span className="marrow-acronym-letter">W</span>orkers
        </Typography.Text>
        {t('tagline') && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', opacity: 0.75 }}>
            {t('tagline')}
          </Typography.Text>
        )}
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
