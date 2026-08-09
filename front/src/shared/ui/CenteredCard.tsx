import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MarrowMark } from './MarrowMark';

/** Full-height centered card used by the auth pages (login, register, 2FA, invite/claim links). */
export function CenteredCard({ children, width = 400 }: { children: ReactNode; width?: number }) {
  const { t } = useTranslation('auth');
  const tagline = t('tagline');
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

        /* Looping "exhaust trail" intro on the backronym line only (the
           [logo] MARROW title above stays static). "MARROW" starts centered
           alone, drives off to the left, and its motion synchronously wipes
           open the "Ain't RAM — Recall Outlives Workers" backronym in the
           space it vacates -- like exhaust left behind a departing car.
           Once revealed, the tagline fades in below; everything holds, then
           fades out together and the cycle repeats. All animations share the
           same 7.5s duration and 0 delay so they stay in lockstep. */
        .marrow-anim-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          animation: marrow-group-cycle 7.5s ease-in-out infinite;
        }
        .marrow-row {
          position: relative;
          display: flex;
          align-items: center;
          height: 20px;
        }
        .marrow-car {
          position: absolute;
          top: 50%;
          left: 50%;
          white-space: nowrap;
          animation: marrow-car-move 7.5s ease-in-out infinite;
        }
        .marrow-reveal {
          display: inline-block;
          white-space: nowrap;
          animation: marrow-reveal-wipe 7.5s ease-in-out infinite;
        }
        .marrow-tagline {
          opacity: 0;
          animation: marrow-tagline-fade 7.5s ease-in-out infinite;
        }

        @keyframes marrow-car-move {
          0%, 11% { transform: translate(-50%, -50%); opacity: 1; }
          25%, 100% { transform: translate(-200%, -50%); opacity: 0; }
        }
        @keyframes marrow-reveal-wipe {
          0%, 11% { clip-path: inset(0 100% 0 0); }
          25%, 100% { clip-path: inset(0 0% 0 0); }
        }
        @keyframes marrow-tagline-fade {
          0%, 38% { opacity: 0; }
          45%, 100% { opacity: 0.75; }
        }
        @keyframes marrow-group-cycle {
          0%, 80% { opacity: 1; }
          88%, 100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .marrow-anim-root, .marrow-car, .marrow-reveal, .marrow-tagline {
            animation: none;
          }
          .marrow-row { flex-direction: column; height: auto; gap: 6px; }
          .marrow-car { position: static; transform: none; opacity: 1; }
          .marrow-reveal { clip-path: none; }
          .marrow-tagline { opacity: 0.75; }
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
          I-MEMORY-059 for the wording of both locales. Only render the
          subtitle when non-empty, so a locale without one doesn't leave a
          blank line -- it's always mounted for the lifetime of the
          component (never toggled mid-cycle), so it reserves its layout
          space up front and the animation never shifts the form below. */}
      <div className="marrow-anim-root" style={{ maxWidth: 340 }}>
        <div className="marrow-row">
          <Typography.Text type="secondary" className="marrow-car" style={{ fontSize: 13, fontWeight: 700 }}>
            MARROW
          </Typography.Text>
          <Typography.Text type="secondary" className="marrow-reveal" style={{ fontSize: 13 }}>
            <span className="marrow-acronym-letter">A</span>in&apos;t <span className="marrow-acronym-letter">R</span>AM
            {' — '}
            <span className="marrow-acronym-letter">R</span>ecall <span className="marrow-acronym-letter">O</span>utlives{' '}
            <span className="marrow-acronym-letter">W</span>orkers
          </Typography.Text>
        </div>
        {tagline && (
          <Typography.Text
            type="secondary"
            className="marrow-tagline"
            style={{ fontSize: 12, display: 'block', textAlign: 'center' }}
          >
            {tagline}
          </Typography.Text>
        )}
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
