import { Alert, Button, Popconfirm, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type OAuthClientStatus, useAuthStore } from '../../shared/model/auth.store';

const { Text } = Typography;

/**
 * This user's own OAuth connector credential (client_id + client_secret),
 * for the web-connector (Claude.ai/ChatGPT) tabs of the profile's Connect
 * section — replaces the old static, shared PROJECT_MEMORY_OAUTH_CLIENT_ID/
 * _SECRET pair (one per whole deployment) with one self-generated pair per
 * approved user, mirroring PersonalTokenPanel closely. Two differences from
 * that panel: client_id is NOT secret (safe to display persistently, not
 * shown-once) and generation is an explicit "Generate" click here rather
 * than lazy-auto-generated on first visit — a web connector isn't needed
 * just to open this page, unlike a personal token which CLI/agent paths
 * assume exists.
 */
export function OAuthClientPanel() {
  const fetchOAuthClient = useAuthStore((s) => s.fetchOAuthClient);
  const regenerateOAuthClient = useAuthStore((s) => s.regenerateOAuthClient);

  const [status, setStatus] = useState<OAuthClientStatus | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchOAuthClient();
        if (cancelled) return;
        setStatus(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load your OAuth connector credential.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await regenerateOAuthClient();
      setStatus({
        exists: true,
        clientId: result.clientId,
        clientSecretHint: result.clientSecret.slice(-4),
        createdAt: result.createdAt,
        lastUsedAt: null,
      });
      setRevealedSecret(result.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate an OAuth connector credential.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>Loading your OAuth connector credential…</Text>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

      {!status?.exists && (
        <>
          <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            A few connector setups ask for a Client ID / Client Secret in addition to the URL. This generates your
            own — tied to your account, not a shared deployment secret. Most setups don't need it; skip this unless
            yours asks.
          </Text>
          <Button size="small" loading={busy} onClick={() => void generate()}>
            Generate
          </Button>
        </>
      )}

      {status?.exists && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
            Client ID:
          </Text>
          <CodeBlock code={status.clientId ?? ''} />

          {revealedSecret ? (
            <>
              <Alert
                type="warning"
                showIcon
                message="Copy your Client Secret now"
                description="This is the only time it will be shown. If you lose it, use Regenerate below to get a new pair — the old one stops working immediately."
                style={{ marginBottom: 12 }}
              />
              <CodeBlock code={revealedSecret} />
            </>
          ) : (
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
              Client Secret ending in <Text code>…{status.clientSecretHint}</Text> · created{' '}
              <Timestamp value={status.createdAt} /> · last used <Timestamp value={status.lastUsedAt} /> · not shown
              again — use Regenerate for a new pair.
            </Text>
          )}

          <Popconfirm
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Regenerate OAuth connector credential?"
            description="Your current Client ID and Secret both stop working immediately. Any connector using them will need the new pair."
            okText="Regenerate"
            okButtonProps={{ danger: true, loading: busy }}
            onConfirm={() => {
              setConfirmOpen(false);
              void generate();
            }}
          >
            <Button size="small" loading={busy}>
              Regenerate
            </Button>
          </Popconfirm>
        </>
      )}
    </div>
  );
}
