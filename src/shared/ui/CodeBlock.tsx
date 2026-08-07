import { Typography } from 'antd';

const { Paragraph } = Typography;

/**
 * Copy-paste command/config block. Same visual language as the recovery-codes
 * and TOTP-secret blocks (see TotpEnrollWizard), but multi-line and using
 * antd's built-in copyable Paragraph so there's one consistent copy affordance
 * across the app instead of a bespoke copy button per screen.
 */
export function CodeBlock({ code }: { code: string }) {
  return (
    <Paragraph
      copyable={{ text: code }}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid #303030',
        borderRadius: 6,
        padding: '10px 14px',
        marginBottom: 12,
        fontFamily: 'monospace',
        fontSize: 12.5,
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {code}
    </Paragraph>
  );
}
