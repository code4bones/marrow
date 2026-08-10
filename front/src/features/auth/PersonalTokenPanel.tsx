import { Alert, Button, Empty, Input, Popconfirm, Spin, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { Timestamp } from '../../shared/ui/Timestamp';
import { type PersonalToken, useAuthStore } from '../../shared/model/auth.store';

const { Text } = Typography;

interface PersonalTokenPanelProps {
  /**
   * Scopes this panel to exactly one named connection (e.g. "Claude Code
   * (CLI)", "Codex (CLI)") instead of showing every token the user owns.
   * When set: the Label input is hidden (a token created here is always
   * labeled `fixedLabel`), the create affordance disappears once one
   * exists (Regenerate covers "I lost it"), and -- unlike
   * OAuthClientPanel, which has no such auto-create -- a token is created
   * automatically the first time this panel mounts with none yet, so a
   * freshly-approved user sees a working CLI token immediately, without a
   * manual click (T-MEMORY-047's original "lazy on first visit" design,
   * preserved here per-connection instead of per-user).
   */
  fixedLabel?: string;
  /**
   * Inverse of fixedLabel: shows only tokens whose label is NOT in this
   * list -- the catch-all for anything that doesn't belong to a known
   * connection (a legacy unlabeled token, or a genuinely custom one).
   * Never auto-creates.
   */
  excludeLabels?: string[];
  /**
   * When set, a revealed token renders as `export <exportVarName>="..."`,
   * a ready-to-paste shell command, instead of the bare token -- for the
   * CLI-connection panels (Claude Code, Codex), which is what a user
   * actually needs to run next. Omit for a generic/catch-all panel where
   * "export" framing wouldn't make sense.
   */
  exportVarName?: string;
  /**
   * Called after any successful create/regenerate/delete -- lets a sibling
   * that also reads this user's tokens (ConnectedSummary, fetched
   * independently on its own mount) know to refetch, same reasoning as
   * OAuthClientPanel's own onChanged.
   */
  onChanged?: () => void;
}

/**
 * This user's personal Marrow API tokens (T-MEMORY-047, made multi-token
 * mirroring OAuthClientPanel's own fix for oauth_clients). Used three ways
 * from ConnectSection: once per known CLI connection (fixedLabel="Claude
 * Code (CLI)" / fixedLabel="Codex (CLI)", embedded directly under that
 * connection's own setup instructions) and once as a catch-all for
 * anything else (excludeLabels=[...]) -- replaces the old one-token-per-
 * user model, where generating a token for a second agent silently
 * invalidated the first agent's already-working token.
 *
 * Each token is fully independent: creating, regenerating, or deleting one
 * never touches another. That's the fix for a real problem hit live --
 * under the old model, generating a token to connect Codex after Claude
 * Code was already working knocked Claude Code's connection out.
 */
export function PersonalTokenPanel({ fixedLabel, excludeLabels, exportVarName, onChanged }: PersonalTokenPanelProps) {
  const { t } = useTranslation('profile');
  const fetchPersonalTokens = useAuthStore((s) => s.fetchPersonalTokens);
  const createPersonalToken = useAuthStore((s) => s.createPersonalToken);
  const regeneratePersonalToken = useAuthStore((s) => s.regeneratePersonalToken);
  const deletePersonalToken = useAuthStore((s) => s.deletePersonalToken);

  const [allTokens, setAllTokens] = useState<PersonalToken[] | null>(null);
  const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoCreating, setAutoCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = async () => {
    try {
      setAllTokens(await fetchPersonalTokens());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotLoadTokens'));
    }
  };

  const create = async (label: string | null) => {
    setCreateError(null);
    setCreating(true);
    try {
      const result = await createPersonalToken(label);
      setRevealedTokens((prev) => ({ ...prev, [result.id]: result.token }));
      setAddingOpen(false);
      setNewLabel('');
      await load();
      onChanged?.();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('couldNotCreateToken'));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchPersonalTokens();
        if (cancelled) return;
        setAllTokens(result);
        setLoading(false);
        if (fixedLabel && !result.some((token) => token.label === fixedLabel)) {
          setAutoCreating(true);
          const created = await createPersonalToken(fixedLabel);
          if (cancelled) return;
          setRevealedTokens((prev) => ({ ...prev, [created.id]: created.token }));
          setAllTokens(await fetchPersonalTokens());
          setAutoCreating(false);
          onChanged?.();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('couldNotLoadTokens'));
        setLoading(false);
        setAutoCreating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = (allTokens ?? []).filter((token) => {
    if (fixedLabel) return token.label === fixedLabel;
    if (excludeLabels) return !excludeLabels.includes(token.label ?? '');
    return true;
  });

  const regenerate = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      const result = await regeneratePersonalToken(id);
      setRevealedTokens((prev) => ({ ...prev, [id]: result.token }));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotRegenerateToken'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await deletePersonalToken(id);
      setRevealedTokens((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotDeleteToken'));
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

  const hasTokens = tokens.length > 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

      {!hasTokens && !addingOpen && !fixedLabel && (
        <Empty description={false} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '4px 0 12px' }} />
      )}

      {autoCreating && (
        <div style={{ marginBottom: 12 }}>
          <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>{t('generatingPersonalToken')}</Text>
        </div>
      )}

      {tokens.map((token) => {
        const revealedToken = revealedTokens[token.id];
        return (
          <div key={token.id} style={{ border: '1px solid #303030', borderRadius: 6, padding: 12, marginBottom: 12 }}>
            {!fixedLabel && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <Text strong>{token.label || t('untitledToken')}</Text>
                <Popconfirm
                  title={t('deleteTokenConfirmTitle')}
                  description={t('deleteTokenDescription')}
                  okText={t('delete')}
                  okButtonProps={{ danger: true, loading: busyId === token.id }}
                  onConfirm={() => void remove(token.id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={busyId !== null && busyId !== token.id} />
                </Popconfirm>
              </div>
            )}

            {revealedToken ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message={t('copyYourTokenNow')}
                  description={t('copyTokenDescription')}
                  style={{ marginBottom: 12 }}
                />
                <CodeBlock code={exportVarName ? `export ${exportVarName}="${revealedToken}"` : revealedToken} />
              </>
            ) : (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                {t('tokenEndingIn')} <Text code>…{token.tokenHint}</Text> · {t('created')} <Timestamp value={token.createdAt} /> ·
                {' '}{token.lastUsedAt ? (
                  <>
                    <Tag color="green" style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px' }}>{t('activeMarker')}</Tag>
                    {' '}{t('lastUsed')} <Timestamp value={token.lastUsedAt} />
                  </>
                ) : (
                  <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px' }}>{t('neverUsedMarker')}</Tag>
                )} · {t('notShownAgainUseRegenerateOne')}
              </Text>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Popconfirm
                title={t('regeneratePersonalTokenConfirmTitle')}
                description={t('regeneratePersonalTokenDescription')}
                okText={t('regenerate')}
                okButtonProps={{ danger: true, loading: busyId === token.id }}
                onConfirm={() => void regenerate(token.id)}
              >
                <Button size="small" disabled={busyId !== null && busyId !== token.id}>
                  {t('regenerate')}
                </Button>
              </Popconfirm>
              {fixedLabel && (
                <Popconfirm
                  title={t('deleteTokenConfirmTitle')}
                  description={t('deleteTokenDescription')}
                  okText={t('delete')}
                  okButtonProps={{ danger: true, loading: busyId === token.id }}
                  onConfirm={() => void remove(token.id)}
                >
                  <Button size="small" danger disabled={busyId !== null && busyId !== token.id}>
                    {t('delete')}
                  </Button>
                </Popconfirm>
              )}
            </div>
          </div>
        );
      })}

      {/* A fixedLabel panel only ever holds one token at a time -- once it
          exists, hide the create affordance entirely (Regenerate above
          covers "I lost the token"). An unscoped/excludeLabels panel can
          always add more. */}
      {(!hasTokens || !fixedLabel) &&
        (addingOpen ? (
          <div style={{ border: '1px dashed #303030', borderRadius: 6, padding: 12 }}>
            {createError && <Alert type="error" message={createError} style={{ marginBottom: 12 }} showIcon />}
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
              {t('label')}
            </Text>
            <Input
              placeholder={t('labelPlaceholder')}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" size="small" loading={creating} onClick={() => void create(newLabel.trim() || null)}>
                {t('createToken')}
              </Button>
              <Button size="small" disabled={creating} onClick={() => { setAddingOpen(false); setCreateError(null); setNewLabel(''); }}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="small" loading={creating} onClick={() => setAddingOpen(true)}>
            {hasTokens ? t('addAnotherToken') : t('createToken')}
          </Button>
        ))}
    </div>
  );
}
