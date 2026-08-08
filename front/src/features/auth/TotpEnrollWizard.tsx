import { Alert, Button, Checkbox, Input, Spin, Typography } from 'antd';
import { toDataURL } from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text, Paragraph } = Typography;

interface TotpEnrollWizardProps {
  /** otpauth:// URL returned by the enroll/register-start call — rendered client-side, never sent anywhere. */
  otpauthUrl: string;
  /** Manual-entry fallback for authenticator apps that can't scan a QR code. */
  secretBase32: string;
  /** Verifies the 6-digit code against the secret above and returns the one-time recovery codes. */
  onConfirm: (code: string) => Promise<{ recoveryCodes: string[] }>;
  /** Called once the user has acknowledged the recovery codes — close a modal, navigate away, etc. */
  onFinish: () => void;
  /** Extra copy shown under the recovery codes, e.g. "your account is now pending admin approval". */
  finishNote?: string;
  finishLabel?: string;
}

/**
 * Two-step TOTP enrollment UI: scan QR + confirm a 6-digit code, then show the
 * one-time recovery codes. Used both by the registration wizard (confirm hits
 * /auth/register/confirm with a token) and by the profile "Enable 2FA" flow
 * (confirm hits the session-based /auth/2fa/confirm) — the caller supplies
 * `onConfirm` so this component doesn't need to know which.
 */
export function TotpEnrollWizard({
  otpauthUrl,
  secretBase32,
  onConfirm,
  onFinish,
  finishNote,
  finishLabel,
}: TotpEnrollWizardProps) {
  const { t } = useTranslation('profile');
  const resolvedFinishLabel = finishLabel ?? t('continue');
  const [step, setStep] = useState<'code' | 'recovery'>('code');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    toDataURL(otpauthUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  const submitCode = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await onConfirm(code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invalidCode'));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'code') {
    return (
      <div>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={t('scanQrCodeAlt')}
              width={220}
              height={220}
              style={{ background: '#fff', padding: 8, borderRadius: 4 }}
            />
          ) : (
            <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin />
            </div>
          )}
        </div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
          {t('scanWithAuthenticatorApp')}
        </Text>
        <Paragraph
          copyable={{ text: secretBase32 }}
          code
          style={{ marginBottom: 16, wordBreak: 'break-all', userSelect: 'all' }}
        >
          {secretBase32}
        </Paragraph>
        <Text style={{ display: 'block', marginBottom: 4 }}>{t('enter6DigitCode')}</Text>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={() => void submitCode()}
          placeholder="123456"
          maxLength={6}
          autoFocus
          style={{ marginBottom: 16, letterSpacing: 2, fontSize: 16 }}
        />
        <Button type="primary" block loading={submitting} disabled={code.trim().length !== 6} onClick={() => void submitCode()}>
          {t('verifyCode')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        message={t('saveRecoveryCodesNow')}
        description={t('recoveryCodesDescription')}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid #303030',
          borderRadius: 6,
          padding: '12px 16px',
          marginBottom: 16,
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.9,
          userSelect: 'all',
        }}
      >
        {recoveryCodes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      {finishNote && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
          {finishNote}
        </Text>
      )}
      <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ marginBottom: 16 }}>
        {t('savedRecoveryCodesConfirm')}
      </Checkbox>
      <Button type="primary" block disabled={!saved} onClick={onFinish}>
        {resolvedFinishLabel}
      </Button>
    </div>
  );
}
