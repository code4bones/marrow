import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MarrowMark } from './MarrowMark';

/** A part of the backronym line that grows from nothing into `children` (a word or the "M"->"MARROW"/dash separator), in place, without shifting sibling text vertically -- see the `.marrow-grow` grid trick in the <style> block below. */
function Grow({ anim, children }: { anim: string; children: ReactNode }) {
  return (
    <span className="marrow-grow" style={{ animationName: anim }}>
      <span className="marrow-grow-inner">{children}</span>
    </span>
  );
}

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

        /* Looping backronym reveal on the [logo] MARROW title's subtitle line
           (the title itself is static, untouched). "MARROW" starts as one
           tight word -- literally just its own 6 letters, M-A-R-R-O-W, sitting
           adjacent with no gaps. Each letter (except M) has a hidden trailing
           "suffix" completing it into its backronym word (A -> "in't", first
           R -> "AM", second R -> "ecall", O -> "utlives", W -> "orkers"), plus
           a standalone hidden separator that blooms into " -- " between the
           two words. M's own suffix ("ARROW") reconstructs the word "MARROW"
           itself, in the brand color, since M *is* what the whole thing stands
           for. Growing a suffix pushes the following letters rightward, which
           reads as the word disassembling/spreading letter by letter. Every
           suffix uses the CSS grid 0fr->1fr trick (animating grid-template-
           columns, not width) so it doesn't need a guessed pixel width and
           never affects line height -- only horizontal growth happens, so the
           form below never shifts vertically. All 7 suffixes plus the tagline
           and the group fade share one 8s timeline (0 delay, same duration)
           so they stay in lockstep forever: hold compact -> cascade-bloom
           left to right -> hold expanded (tagline fades in, then out) ->
           snap back to "MARROW" -> hold -> fade out together -> pause -> loop. */
        .marrow-line { white-space: nowrap; }
        .marrow-grow {
          display: inline-grid;
          grid-template-columns: 0fr;
          vertical-align: bottom;
          animation-duration: 8s;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        .marrow-grow-inner {
          overflow: hidden;
          min-width: 0;
          white-space: pre;
        }
        .marrow-tagline {
          opacity: 0;
          animation: marrow-tagline-fade 8s ease-in-out infinite;
        }
        .marrow-anim-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          animation: marrow-group-cycle 8s ease-in-out infinite;
        }

        @keyframes marrow-grow-m    { 0%, 6%  { grid-template-columns: 0fr; } 10%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-a    { 0%, 10% { grid-template-columns: 0fr; } 14%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-r1   { 0%, 14% { grid-template-columns: 0fr; } 18%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-dash { 0%, 18% { grid-template-columns: 0fr; } 20%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-r2   { 0%, 20% { grid-template-columns: 0fr; } 24%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-o    { 0%, 24% { grid-template-columns: 0fr; } 28%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }
        @keyframes marrow-grow-w    { 0%, 28% { grid-template-columns: 0fr; } 32%, 60% { grid-template-columns: 1fr; } 66%, 100% { grid-template-columns: 0fr; } }

        @keyframes marrow-tagline-fade {
          0%, 34% { opacity: 0; }
          40%, 55% { opacity: 0.75; }
          60%, 100% { opacity: 0; }
        }
        @keyframes marrow-group-cycle {
          0%, 85% { opacity: 1; }
          92%, 100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .marrow-anim-root { animation: none; }
          .marrow-grow { grid-template-columns: 1fr; animation: none; }
          .marrow-tagline { opacity: 0.75; animation: none; }
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
      <div className="marrow-anim-root">
        <Typography.Text type="secondary" className="marrow-line" style={{ fontSize: 13 }}>
          <span className="marrow-brand-text">
            M
            <Grow anim="marrow-grow-m">ARROW </Grow>
          </span>
          <span className="marrow-acronym-letter">A</span>
          <Grow anim="marrow-grow-a">in&apos;t </Grow>
          <span className="marrow-acronym-letter">R</span>
          <Grow anim="marrow-grow-r1">AM</Grow>
          <Grow anim="marrow-grow-dash">{' — '}</Grow>
          <span className="marrow-acronym-letter">R</span>
          <Grow anim="marrow-grow-r2">ecall </Grow>
          <span className="marrow-acronym-letter">O</span>
          <Grow anim="marrow-grow-o">utlives </Grow>
          <span className="marrow-acronym-letter">W</span>
          <Grow anim="marrow-grow-w">orkers</Grow>
        </Typography.Text>
        {tagline && (
          <Typography.Text
            type="secondary"
            className="marrow-tagline"
            style={{ fontSize: 12, display: 'block', textAlign: 'center', maxWidth: 320 }}
          >
            {tagline}
          </Typography.Text>
        )}
      </div>
      <div style={{ width }}>{children}</div>
    </div>
  );
}
