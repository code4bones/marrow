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

        /* Looping "train pulling out of the station" intro: MARROW starts
           centered and alone, slides/fades left, and in doing so reveals the
           backronym text (left-to-right, via a synchronized clip-path wipe
           driven by the same keyframe timeline) in the space it vacates.
           Once revealed, the tagline fades in below; everything holds, then
           fades out together and the cycle repeats. All three animations
           share the same 7.5s duration and 0 delay so they stay in lockstep. */
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
          height: 52px;
        }
        .marrow-train {
          position: absolute;
          top: 50%;
          left: 50%;
          display: flex;
          align-items: center;
          gap: 14px;
          white-space: nowrap;
          animation: marrow-train-move 7.5s ease-in-out infinite;
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

        @keyframes marrow-train-move {
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
          .marrow-anim-root, .marrow-train, .marrow-reveal, .marrow-tagline {
            animation: none;
          }
          .marrow-row { flex-direction: column; height: auto; gap: 6px; }
          .marrow-train { position: static; transform: none; opacity: 1; }
          .marrow-reveal { clip-path: none; }
          .marrow-tagline { opacity: 0.75; }
        }
      `}</style>
      <div className="marrow-anim-root">
        <div className="marrow-row">
          <div className="marrow-train">
            <MarrowMark size={48} className="marrow-brand-mark" />
            <Typography.Text strong className="marrow-brand-text" style={{ fontSize: 28, letterSpacing: 1 }}>
              MARROW
            </Typography.Text>
          </div>
          {/* T-MEMORY-061 / I-MEMORY-058..060: the EN backronym is a name
              (like Bash or YACC) -- never translated, one Latin line for
              every language. Acronym letters (A-R-R-O-W) are weight/color-
              accented, never underlined -- underline reads as a link in this
              UI. "MARROW" itself isn't repeated here: the animated brand
              lockup above plays that role as it "pulls" this line into view. */}
          <Typography.Text type="secondary" className="marrow-reveal" style={{ fontSize: 13 }}>
            <span className="marrow-acronym-letter">A</span>in&apos;t <span className="marrow-acronym-letter">R</span>AM
            {' — '}
            <span className="marrow-acronym-letter">R</span>ecall <span className="marrow-acronym-letter">O</span>utlives{' '}
            <span className="marrow-acronym-letter">W</span>orkers
          </Typography.Text>
        </div>
        {/* The subtitle (auth.tagline) is a semantic counterpart, not a
            literal translation of the backronym -- see I-MEMORY-059 for the
            wording of both locales. Only render when non-empty, so a locale
            without one doesn't leave a blank line -- it's always mounted
            (never conditionally added mid-cycle), so it reserves its layout
            space up front and the animation never shifts the form below. */}
        {tagline && (
          <Typography.Text
            type="secondary"
            className="marrow-tagline"
            style={{ fontSize: 12, display: 'block', textAlign: 'center', maxWidth: 340 }}
          >
            {tagline}
          </Typography.Text>
        )}
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
