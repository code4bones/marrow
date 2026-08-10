import { Alert, Button, Empty, Input, Popconfirm, Spin, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type OAuthClient, useAuthStore } from '../../shared/model/auth.store';

const { Text } = Typography;

interface OAuthClientPanelProps {
  /**
   * Scopes this panel to exactly one service (e.g. "Claude.ai", "ChatGPT")
   * instead of showing every credential the user owns. When set, the Label
   * input is hidden entirely — a credential created from this panel is
   * always labeled `fixedLabel`, so which credential belongs to which
   * connector is never something the user has to figure out; it's implied
   * by which part of the page they're looking at.
   */
  fixedLabel?: string;
  /**
   * Also locks the Redirect URI to a known, unchanging value (Claude.ai's
   * callback never changes, unlike ChatGPT's) — when set, creating a
   * credential from this panel needs zero manual input at all, just one
   * click.
   */
  fixedRedirectUri?: string;
  /**
   * Inverse of fixedLabel: shows only credentials whose label is NOT in
   * this list — the catch-all for anything that doesn't belong to a known
   * service (legacy credentials created before per-service labeling, or a
   * genuinely custom connector). Keeps the free-text Label input.
   */
  excludeLabels?: string[];
  /**
   * Called after any successful create/regenerate/delete/relabel -- lets a
   * sibling that also reads this user's credentials (ConnectedSummary,
   * fetched independently on its own mount) know to refetch. Without this,
   * relabeling a legacy credential into "Claude.ai" here left the
   * Connected card at the top of the page showing stale "Not connected
   * yet" until a full page reload, reported live right after the Edit
   * label feature shipped.
   */
  onChanged?: () => void;
}

/**
 * This user's OAuth connector credentials. Used three ways from
 * ConnectSection: once per known service (fixedLabel="Claude.ai" /
 * fixedLabel="ChatGPT", embedded directly under that service's own web-setup
 * instructions) and once as a catch-all for anything else
 * (excludeLabels=["Claude.ai","ChatGPT"]) — replaces the old static, shared
 * PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair (one per whole deployment),
 * and then the one-per-user pair that followed it, with one self-generated,
 * independently-owned credential PER NAMED CONNECTOR.
 *
 * Each credential is fully independent: creating, regenerating, or deleting
 * one never touches another. That's the fix for a real problem hit live —
 * under the old one-per-user model, regenerating to set up a second
 * connector (e.g. ChatGPT) silently invalidated the first one already
 * working (e.g. Claude.ai).
 */
export function OAuthClientPanel({ fixedLabel, fixedRedirectUri, excludeLabels, onChanged }: OAuthClientPanelProps) {
  const { t } = useTranslation('profile');
  const fetchOAuthClients = useAuthStore((s) => s.fetchOAuthClients);
  const createOAuthClient = useAuthStore((s) => s.createOAuthClient);
  const regenerateOAuthClient = useAuthStore((s) => s.regenerateOAuthClient);
  const deleteOAuthClient = useAuthStore((s) => s.deleteOAuthClient);
  const updateOAuthClient = useAuthStore((s) => s.updateOAuthClient);

  const [allClients, setAllClients] = useState<OAuthClient[] | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newRedirectUri, setNewRedirectUri] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRedirectUri, setEditRedirectUri] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = async () => {
    try {
      setAllClients(await fetchOAuthClients());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotLoadCredentials'));
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchOAuthClients();
        if (cancelled) return;
        setAllClients(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('couldNotLoadCredentials'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clients = (allClients ?? []).filter((c) => {
    if (fixedLabel) return c.label === fixedLabel;
    if (excludeLabels) return !excludeLabels.includes(c.label ?? '');
    return true;
  });

  const resetCreateForm = () => {
    setAddingOpen(false);
    setCreateError(null);
    setNewLabel('');
    setNewRedirectUri('');
  };

  const create = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const label = fixedLabel ?? newLabel.trim();
      const redirectUri = fixedRedirectUri ?? newRedirectUri.trim();
      const result = await createOAuthClient(label, redirectUri);
      setRevealedSecrets((prev) => ({ ...prev, [result.id]: result.clientSecret }));
      resetCreateForm();
      await load();
      onChanged?.();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('couldNotCreateCredential'));
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
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotRegenerateCredential'));
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (client: OAuthClient) => {
    setEditError(null);
    setEditingId(client.id);
    setEditLabel(client.label ?? '');
    setEditRedirectUri(client.redirectUri ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    setEditError(null);
    setEditSaving(true);
    try {
      await updateOAuthClient(id, {
        // Label is only editable from the catch-all/unscoped view -- a
        // fixedLabel panel's tokens are always exactly that label, so
        // there's nothing to change there (see the edit-trigger's own
        // fixedLabel guard below).
        ...(fixedLabel ? {} : { label: editLabel.trim() || null }),
        redirectUri: editRedirectUri.trim(),
      });
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('couldNotUpdateRedirectUri'));
    } finally {
      setEditSaving(false);
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
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotDeleteCredential'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>{t('loading')}</Text>
      </div>
    );
  }

  const hasClients = clients.length > 0;
  const canOneClickCreate = Boolean(fixedLabel && fixedRedirectUri);
  const addButtonLabel = fixedLabel ? t('createNamedCredential', { label: fixedLabel }) : t('addConnectorCredential');

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

      {!hasClients && !addingOpen && !fixedLabel && (
        <Empty description={false} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '4px 0 12px' }} />
      )}

      {clients.map((client) => {
        const revealedSecret = revealedSecrets[client.id];
        return (
          <div key={client.id} style={{ border: '1px solid #303030', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            {!fixedLabel && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span>
                  <Text strong>{client.label || t('untitledCredential')}</Text>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    title={t('editLabel')}
                    disabled={busyId !== null && busyId !== client.id}
                    onClick={() => startEdit(client)}
                  />
                </span>
                <Popconfirm
                  title={t('deleteCredentialConfirmTitle')}
                  description={t('deleteCredentialDescription')}
                  okText={t('delete')}
                  okButtonProps={{ danger: true, loading: busyId === client.id }}
                  onConfirm={() => void remove(client.id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={busyId !== null && busyId !== client.id} />
                </Popconfirm>
              </div>
            )}

            {revealedSecret ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message={t('copyClientSecretNow')}
                  description={t('copyClientSecretDescription')}
                  style={{ marginBottom: 12 }}
                />
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12.5 }}>
                  {t('clientIdLabel')}
                </Text>
                <CodeBlock code={client.clientId} />
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12.5 }}>
                  {t('clientSecretLabel')}
                </Text>
                <CodeBlock code={revealedSecret} />
              </>
            ) : (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12.5 }}>
                  {t('clientIdLabel')}
                </Text>
                <CodeBlock code={client.clientId} />
                <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                  {t('clientSecretEndingIn')} <Text code>…{client.clientSecretHint}</Text> · {t('created')}{' '}
                  <Timestamp value={client.createdAt} /> ·{' '}
                  {client.lastUsedAt ? (
                    <>
                      <Tag color="green" style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px' }}>{t('activeMarker')}</Tag>
                      {' '}{t('lastUsed')} <Timestamp value={client.lastUsedAt} />
                    </>
                  ) : (
                    <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px' }}>{t('neverUsedMarker')}</Tag>
                  )} · {t('notShownAgainUseRegenerate')}
                </Text>
              </>
            )}

            {editingId === client.id ? (
              <div style={{ marginBottom: 12 }}>
                {editError && <Alert type="error" message={editError} style={{ marginBottom: 8 }} showIcon />}
                {!fixedLabel && (
                  <>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
                      {t('label')}
                    </Text>
                    <Input
                      placeholder={t('labelPlaceholder')}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      style={{ marginBottom: 8 }}
                    />
                  </>
                )}
                <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
                  {t('redirectUriLabel')}
                </Text>
                <Input
                  placeholder="https://…/callback"
                  value={editRedirectUri}
                  onChange={(e) => setEditRedirectUri(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    loading={editSaving}
                    disabled={!editRedirectUri.trim()}
                    onClick={() => void saveEdit(client.id)}
                  >
                    {t('save')}
                  </Button>
                  <Button size="small" disabled={editSaving} onClick={cancelEdit}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                {t('redirectUriLabel')}{' '}
                {client.redirectUri ? <Text code>{client.redirectUri}</Text> : <Text type="warning">{t('redirectUriNotSet')}</Text>}{' '}
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  title={t('editRedirectUri')}
                  disabled={busyId !== null && busyId !== client.id}
                  onClick={() => startEdit(client)}
                />
              </Text>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Popconfirm
                title={t('regenerateCredentialConfirmTitle')}
                description={t('regenerateCredentialDescription')}
                okText={t('regenerate')}
                okButtonProps={{ danger: true, loading: busyId === client.id }}
                onConfirm={() => void regenerate(client.id)}
              >
                <Button size="small" disabled={busyId !== null && busyId !== client.id}>
                  {t('regenerate')}
                </Button>
              </Popconfirm>
              {fixedLabel && (
                <Popconfirm
                  title={t('deleteCredentialConfirmTitle')}
                  description={t('deleteCredentialDescriptionShort')}
                  okText={t('delete')}
                  okButtonProps={{ danger: true, loading: busyId === client.id }}
                  onConfirm={() => void remove(client.id)}
                >
                  <Button size="small" danger disabled={busyId !== null && busyId !== client.id}>
                    {t('delete')}
                  </Button>
                </Popconfirm>
              )}
            </div>
          </div>
        );
      })}

      {/* A fixedLabel panel only ever holds one credential at a time -- once
          it exists, hide the create affordance entirely (Regenerate above
          covers "I lost the secret"). An unscoped/excludeLabels panel can
          always add more. */}
      {(!hasClients || !fixedLabel) &&
        (addingOpen ? (
          <div style={{ border: '1px dashed #303030', borderRadius: 6, padding: 12 }}>
            {createError && <Alert type="error" message={createError} style={{ marginBottom: 12 }} showIcon />}
            {!fixedLabel && (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
                  {t('label')}
                </Text>
                <Input
                  placeholder={t('labelPlaceholder')}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
              </>
            )}
            {!fixedRedirectUri && (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
                  {t('redirectUri')}
                </Text>
                <Input
                  placeholder="https://…/callback"
                  value={newRedirectUri}
                  onChange={(e) => setNewRedirectUri(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                size="small"
                loading={creating}
                disabled={!(fixedLabel ?? newLabel.trim()) || !(fixedRedirectUri ?? newRedirectUri.trim())}
                onClick={() => void create()}
              >
                {t('createCredential')}
              </Button>
              <Button size="small" disabled={creating} onClick={resetCreateForm}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="small"
            loading={creating}
            onClick={() => (canOneClickCreate ? void create() : setAddingOpen(true))}
          >
            {hasClients ? t('addAnotherCredential') : addButtonLabel}
          </Button>
        ))}
    </div>
  );
}
