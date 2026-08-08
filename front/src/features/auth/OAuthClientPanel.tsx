import { Alert, Button, Empty, Input, Popconfirm, Spin, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type OAuthClient, useAuthStore } from '../../shared/model/auth.store';

const { Text } = Typography;

/**
 * This user's OAuth connector credentials, for the web-connector
 * (Claude.ai/ChatGPT) tabs of the profile's Connect section — replaces the
 * old static, shared PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair (one per
 * whole deployment), and then the one-per-user pair that followed it, with
 * one self-generated, independently-owned credential PER NAMED CONNECTOR.
 *
 * Each credential is fully independent: creating, regenerating, or deleting
 * one never touches another. That's the fix for a real problem hit live —
 * under the old one-per-user model, regenerating to set up a second
 * connector (e.g. ChatGPT) silently invalidated the first one already
 * working (e.g. Claude.ai). Each credential also stores its own
 * redirect_uri, captured at creation time, so a connector's one-off
 * callback URL (ChatGPT mints a new one per connector) never requires an
 * admin to hand-edit PROJECT_MEMORY_ALLOWED_REDIRECT_URIS.
 */
export function OAuthClientPanel() {
  const fetchOAuthClients = useAuthStore((s) => s.fetchOAuthClients);
  const createOAuthClient = useAuthStore((s) => s.createOAuthClient);
  const regenerateOAuthClient = useAuthStore((s) => s.regenerateOAuthClient);
  const deleteOAuthClient = useAuthStore((s) => s.deleteOAuthClient);

  const [clients, setClients] = useState<OAuthClient[] | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newRedirectUri, setNewRedirectUri] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await fetchOAuthClients();
      setClients(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your OAuth connector credentials.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchOAuthClients();
        if (cancelled) return;
        setClients(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load your OAuth connector credentials.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const result = await createOAuthClient(newLabel.trim(), newRedirectUri.trim());
      setRevealedSecrets((prev) => ({ ...prev, [result.id]: result.clientSecret }));
      setNewLabel('');
      setNewRedirectUri('');
      setAddingOpen(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create an OAuth connector credential.');
    } finally {
      setCreating(false);
    }
  };

  const regenerate = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      const result = await regenerateOAuthClient(id);
      setRevealedSecrets((prev) => ({ ...prev, [id]: result.clientSecret }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate this OAuth connector credential.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await deleteOAuthClient(id);
      setRevealedSecrets((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this OAuth connector credential.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>Loading your OAuth connector credentials…</Text>
      </div>
    );
  }

  const hasClients = (clients?.length ?? 0) > 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

      {!hasClients && !addingOpen && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
          A few connector setups ask for a Client ID / Client Secret in addition to the URL. This generates your own
          — one per connector, tied to your account, not a shared deployment secret. Most setups don't need it; skip
          this unless yours asks.
        </Text>
      )}

      {!hasClients && !addingOpen && (
        <Empty description={false} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '4px 0 12px' }} />
      )}

      {(clients ?? []).map((client) => {
        const revealedSecret = revealedSecrets[client.id];
        return (
          <div
            key={client.id}
            style={{ border: '1px solid #303030', borderRadius: 6, padding: 12, marginBottom: 12 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <Text strong>{client.label || 'Untitled credential'}</Text>
              <Popconfirm
                title="Delete this credential?"
                description="This connector's Client ID and Secret stop working immediately. It has no effect on your other credentials."
                okText="Delete"
                okButtonProps={{ danger: true, loading: busyId === client.id }}
                onConfirm={() => void remove(client.id)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={busyId !== null && busyId !== client.id} />
              </Popconfirm>
            </div>

            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12.5 }}>
              Client ID:
            </Text>
            <CodeBlock code={client.clientId} />

            {revealedSecret ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="Copy your Client Secret now"
                  description="This is the only time it will be shown. If you lose it, use Regenerate below to get a new pair — the old one stops working immediately, but every other credential is unaffected."
                  style={{ marginBottom: 12 }}
                />
                <CodeBlock code={revealedSecret} />
              </>
            ) : (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                Client Secret ending in <Text code>…{client.clientSecretHint}</Text> · created{' '}
                <Timestamp value={client.createdAt} /> · last used <Timestamp value={client.lastUsedAt} /> · not shown
                again — use Regenerate for a new pair.
              </Text>
            )}

            {client.redirectUri && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                Redirect URI: <Text code>{client.redirectUri}</Text>
              </Text>
            )}

            <Popconfirm
              title="Regenerate this credential?"
              description="This connector's current Client ID and Secret both stop working immediately. Any connector using them will need the new pair. Your other credentials are unaffected."
              okText="Regenerate"
              okButtonProps={{ danger: true, loading: busyId === client.id }}
              onConfirm={() => void regenerate(client.id)}
            >
              <Button size="small" disabled={busyId !== null && busyId !== client.id}>
                Regenerate
              </Button>
            </Popconfirm>
          </div>
        );
      })}

      {addingOpen ? (
        <div style={{ border: '1px dashed #303030', borderRadius: 6, padding: 12 }}>
          {createError && <Alert type="error" message={createError} style={{ marginBottom: 12 }} showIcon />}
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
            Label
          </Text>
          <Input
            placeholder="e.g. Claude.ai or ChatGPT"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
            Redirect URI
          </Text>
          <Input
            placeholder="https://…/callback"
            value={newRedirectUri}
            onChange={(e) => setNewRedirectUri(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              type="primary"
              size="small"
              loading={creating}
              disabled={!newLabel.trim() || !newRedirectUri.trim()}
              onClick={() => void create()}
            >
              Create credential
            </Button>
            <Button
              size="small"
              disabled={creating}
              onClick={() => {
                setAddingOpen(false);
                setCreateError(null);
                setNewLabel('');
                setNewRedirectUri('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="small" onClick={() => setAddingOpen(true)}>
          Add connector credential
        </Button>
      )}
    </div>
  );
}
