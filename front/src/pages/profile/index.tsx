import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { DeleteOutlined, GithubOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { TotpEnrollWizard } from '../../features/auth/TotpEnrollWizard';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { OAuthClientPanel } from '../../features/auth/OAuthClientPanel';
import { PersonalTokenPanel } from '../../features/auth/PersonalTokenPanel';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { API_BASE_URL } from '../../shared/config/env';
import { type GithubLinkStatus, type OAuthClient, type PersonalToken, useAuthStore } from '../../shared/model/auth.store';
import {
  CREATE_GIT_CREDENTIAL,
  DELETE_GIT_CREDENTIAL,
  GET_CREDIT_SETTINGS,
  GET_GIT_CREDENTIALS,
  GET_GIT_PIPELINE_STATUS,
  UPDATE_CREDIT_SETTINGS,
} from '../../shared/api/queries';
import type { GitCredential } from '../../shared/model/types';

const { Text, Paragraph, Title } = Typography;

interface ChangePasswordValues {
  currentPassword: string;
  password: string;
  confirmPassword?: string;
}

/** Modal that gates a destructive/sensitive 2FA action behind the current password. */
function PasswordConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => Promise<void>;
}) {
  const { t } = useTranslation('profile');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setPassword('');
    setError(null);
    onCancel();
  };

  const handleOk = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(password);
      setPassword('');
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('somethingWentWrong'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={close}
      onOk={() => void handleOk()}
      okText={confirmLabel}
      okButtonProps={{ loading: submitting, danger }}
      destroyOnHidden
    >
      {description && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {description}
        </Text>
      )}
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Input.Password
        placeholder={t('currentPassword')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onPressEnter={() => void handleOk()}
        autoFocus
      />
    </Modal>
  );
}

function RecoveryCodesModal({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const { t } = useTranslation('profile');
  return (
    <Modal open={codes !== null} title={t('newRecoveryCodes')} onCancel={onClose} onOk={onClose} okText={t('done')} cancelButtonProps={{ style: { display: 'none' } }}>
      <Alert
        type="warning"
        showIcon
        message={t('saveTheseNow')}
        description={t('recoveryCodesModalDescription')}
        style={{ marginBottom: 16 }}
      />
      <div
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid #303030',
          borderRadius: 6,
          padding: '12px 16px',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.9,
          userSelect: 'all',
        }}
      >
        {(codes ?? []).map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
    </Modal>
  );
}

/** One-line numbered instruction with consistent spacing above its code/action block. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      <Text type="secondary" style={{ fontSize: 12, minWidth: 14 }}>
        {n}.
      </Text>
      <Text style={{ fontSize: 12.5 }}>{children}</Text>
    </div>
  );
}

/**
 * "Set the token in the shell" as a real, copy-pasteable
 * `export MARROW_MCP_TOKEN="..."` command right after generating it --
 * handled by PersonalTokenPanel's own `exportVarName` prop now (see
 * features/auth/PersonalTokenPanel.tsx), one instance per CLI connection
 * (Claude Code, Codex) instead of a single shared token both tabs used to
 * point at.
 */

/**
 * "Connect" — end-to-end onboarding for wiring an agent or a web chat surface
 * up to this Marrow instance. The point of this section is that a brand-new
 * user (including one who just joined via a project invite link) can follow
 * it without ever opening the repo's docs/ or asking an operator to SSH in.
 *
 * The MCP endpoint is derived from API_BASE_URL (same source the app already
 * uses for every /auth/* call — see shared/config/env.ts), so it always
 * reflects the real deployed host instead of a placeholder. The Claude
 * Code / Codex bearer token is this user's own personal Marrow API token
 * (T-MEMORY-047, see PersonalTokenPanel above) instead of an admin-issued
 * shared secret. The web-connector (Claude.ai/ChatGPT) OAuth client id/
 * secret come from this user's own OAuth connector credentials -- one
 * independent credential per connector (see OAuthClientPanel above,
 * rendered once above both web-connector tabs, listing every credential the
 * user has created) instead of a static, shared pair -- replacing what used
 * to be a "the magic token your admin gave you" instruction from before the
 * OAuth SSO rework (D-MEMORY-027) removed that shared magic-token gate
 * entirely in favor of a real per-user login at /oauth/authorize.
 */
/**
 * "Which of my chats are actually connected right now" — pulled together
 * from data already fetched elsewhere on this page (OAuth credential
 * lastUsedAt, personal-token lastUsedAt), no new backend endpoint needed.
 * Reported live: after generating a Codex/ChatGPT credential successfully,
 * there was no single place to see "yes, this is connected" across all
 * services at once without opening each service's own tab.
 *
 * "Revoke" here means deleting/regenerating the underlying credential --
 * it stops any FUTURE login/token-refresh immediately, but an
 * already-issued OAuth access token is a self-contained, unrevoked-until-
 * expiry JWT (30 days) with no server-side session list, so an existing
 * connection doesn't die instantly. That's an OAuth architecture property,
 * not a bug here — not worth a bigger token-blocklist feature just for
 * this.
 */
function ConnectedSummary({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation('profile');
  const fetchOAuthClients = useAuthStore((s) => s.fetchOAuthClients);
  const deleteOAuthClient = useAuthStore((s) => s.deleteOAuthClient);
  const fetchPersonalTokens = useAuthStore((s) => s.fetchPersonalTokens);
  const regeneratePersonalToken = useAuthStore((s) => s.regeneratePersonalToken);
  const [clients, setClients] = useState<OAuthClient[] | null>(null);
  const [tokens, setTokens] = useState<PersonalToken[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    fetchOAuthClients().then(setClients).catch(() => setClients([]));
    fetchPersonalTokens().then(setTokens).catch(() => setTokens([]));
  };
  // refreshKey: bumped by ConnectSection whenever any OAuthClientPanel/
  // PersonalTokenPanel instance below finishes a create/regenerate/delete/
  // relabel -- those panels fetch this same user's credentials/tokens
  // independently on their own mount, so without this signal, relabeling a
  // legacy credential into "Claude.ai" in the Other tab left this card
  // showing stale "Not connected yet" until a full page reload (reported
  // live right after the Edit label feature shipped).
  useEffect(load, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const findClient = (label: string) => clients?.find((c) => c.label === label) ?? null;
  const claude = findClient('Claude.ai');
  const chatgpt = findClient('ChatGPT');
  const findToken = (label: string) => tokens?.find((tk) => tk.label === label) ?? null;
  const claudeCli = findToken('Claude Code (CLI)');
  const codexCli = findToken('Codex (CLI)');

  const revokeOAuth = async (id: string) => {
    setBusyId(id);
    try {
      await deleteOAuthClient(id);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const regenerateToken = async (id: string) => {
    setBusyId(id);
    try {
      await regeneratePersonalToken(id);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const rows: {
    key: string;
    name: string;
    connected: boolean;
    lastUsed: string | null;
    onRevoke?: () => void;
    revokeLabel: string;
    busy?: boolean;
  }[] = [
    {
      key: 'claude-cli',
      name: t('claudeCliConnectionName'),
      connected: Boolean(claudeCli),
      lastUsed: claudeCli?.lastUsedAt ?? null,
      onRevoke: claudeCli ? () => void regenerateToken(claudeCli.id) : undefined,
      revokeLabel: t('regenerate'),
      busy: claudeCli ? busyId === claudeCli.id : false,
    },
    {
      key: 'codex-cli',
      name: t('codexCliConnectionName'),
      connected: Boolean(codexCli),
      lastUsed: codexCli?.lastUsedAt ?? null,
      onRevoke: codexCli ? () => void regenerateToken(codexCli.id) : undefined,
      revokeLabel: t('regenerate'),
      busy: codexCli ? busyId === codexCli.id : false,
    },
    {
      key: 'claude-web',
      name: t('claudeWebConnectionName'),
      connected: Boolean(claude),
      lastUsed: claude?.lastUsedAt ?? null,
      onRevoke: claude ? () => void revokeOAuth(claude.id) : undefined,
      revokeLabel: t('revoke'),
      busy: claude ? busyId === claude.id : false,
    },
    {
      key: 'chatgpt-web',
      name: t('chatgptWebConnectionName'),
      connected: Boolean(chatgpt),
      lastUsed: chatgpt?.lastUsedAt ?? null,
      onRevoke: chatgpt ? () => void revokeOAuth(chatgpt.id) : undefined,
      revokeLabel: t('revoke'),
      busy: chatgpt ? busyId === chatgpt.id : false,
    },
  ];

  return (
    <Card title={t('connected')} size="small" style={{ marginBottom: 16 }}>
      {rows.map((row, i) => (
        <div
          key={row.key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: i < rows.length - 1 ? '1px solid #303030' : undefined,
          }}
        >
          <div>
            <Text strong style={{ marginRight: 8 }}>{row.name}</Text>
            <Tag color={row.connected ? 'green' : 'default'}>{row.connected ? t('connected') : t('notConnectedYet')}</Tag>
            {row.connected && (
              <Text type="secondary" style={{ fontSize: 12.5, marginLeft: 8 }}>
                {t('lastUsed')} <Timestamp value={row.lastUsed} />
              </Text>
            )}
          </div>
          {row.connected && row.onRevoke && (
            <Popconfirm title={t('revokeConfirmTitle')} description={t('revokeConfirmDescription')} onConfirm={row.onRevoke}>
              <Button size="small" danger loading={row.busy}>
                {row.revokeLabel}
              </Button>
            </Popconfirm>
          )}
        </div>
      ))}
    </Card>
  );
}

function ConnectSection() {
  const { t } = useTranslation('profile');
  const user = useAuthStore((s) => s.user);
  const mcpUrl = `${API_BASE_URL}/mcp`;

  // Bumped by every panel below via onChanged, read by ConnectedSummary to
  // know when to refetch -- see ConnectedSummary's own comment.
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const bumpSummary = () => setSummaryRefreshKey((k) => k + 1);

  const suggestedId = user?.email ?? 'me';
  const enc = encodeURIComponent(suggestedId);
  const urlFor = (clientKind: string) => `${mcpUrl}?client_id=${enc}&client_label=${enc}&client_kind=${clientKind}`;

  const claudeCodeCmd = [
    'claude mcp add --transport http marrow \\',
    `  "${urlFor('claude-code')}" \\`,
    '  --header "Authorization: Bearer $MARROW_MCP_TOKEN"',
  ].join('\n');

  const codexCmd = [
    'codex mcp add marrow \\',
    `  --url "${urlFor('codex')}" \\`,
    '  --bearer-token-env-var MARROW_MCP_TOKEN',
  ].join('\n');

  // Bare mcpUrl, deliberately WITHOUT the ?client_id=/client_label=/client_kind=
  // query params urlFor() appends for the CLI paths above: those identify a
  // static bearer-token connection (Claude Code, Codex) with no login step,
  // but an OAuth web connector identifies the caller through the real
  // per-user login /oauth/authorize now requires (D-MEMORY-027) instead —
  // appending them here would just be inert query noise.
  const webConnectorUrl = mcpUrl;

  // Claude.ai's callback is fixed and never changes -- captured here once so
  // creating that credential needs zero manual input. ChatGPT mints a fresh,
  // one-off callback per connector it has no such constant.
  const claudeCallbackUrl = 'https://claude.ai/api/mcp/auth_callback';

  // Grouped by SERVICE (Claude, Codex), each with its CLI + web instructions
  // together and that service's own OAuth credential embedded directly
  // underneath -- previously this was grouped by connection TYPE (CLI tabs
  // separate from web tabs, credentials in one flat undifferentiated list
  // elsewhere on the page), which meant figuring out which Client ID/Secret
  // belonged to which connector required guessing. Now it's implied by
  // which tab you're already reading.
  const items = [
    {
      key: 'claude',
      label: 'Claude',
      children: (
        <>
          <Title level={5} style={{ marginTop: 0 }}>Claude Code (CLI)</Title>
          <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            {t('claudeCliIntro')}
          </Text>
          <PersonalTokenPanel fixedLabel="Claude Code (CLI)" exportVarName="MARROW_MCP_TOKEN" onChanged={bumpSummary} />
          <Step n={1}>{t('setTokenInShellClaude')}</Step>
          <Step n={2}>{t('registerMarrowAsMcp')}</Step>
          <CodeBlock code={claudeCodeCmd} />
          <Step n={3}>
            {t('restartClaudeCodeAsk')}{' '}
            <Text code>gateway.about</Text>.
          </Step>

          <Divider />

          <Title level={5}>Claude.ai (web)</Title>
          <Step n={1}>
            {t('inClaudeAiGoTo')} <Text strong>Settings → Connectors</Text> {t('andChoose')}{' '}
            <Text strong>Add custom connector</Text>.
          </Step>
          <Step n={2}>{t('pasteAsConnectorUrl')}</Step>
          <CodeBlock code={webConnectorUrl} />
          <Step n={3}>{t('clientIdSecretClaude')}</Step>
          <OAuthClientPanel fixedLabel="Claude.ai" fixedRedirectUri={claudeCallbackUrl} onChanged={bumpSummary} />
          <Step n={4}>{t('clickConnectClaude')}</Step>
          <Step n={5}>
            {t('logInApproveAccessClaude')} <Text strong>{t('you')}</Text> {t('specifically')}
          </Step>
          <Step n={6}>
            {t('backInChatAskClaude')} <Text code>gateway.status</Text>.
          </Step>
        </>
      ),
    },
    {
      key: 'codex',
      label: 'Codex',
      children: (
        <>
          <Title level={5} style={{ marginTop: 0 }}>Codex (CLI)</Title>
          <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            {t('codexCliIntro')}
          </Text>
          <PersonalTokenPanel fixedLabel="Codex (CLI)" exportVarName="MARROW_MCP_TOKEN" onChanged={bumpSummary} />
          <Step n={1}>{t('setTokenInShellCodex')}</Step>
          <Step n={2}>{t('registerMarrowAsMcp')}</Step>
          <CodeBlock code={codexCmd} />
          <Step n={3}>
            {t('restartCodexAsk')} <Text code>gateway.status</Text> {t('and')}{' '}
            <Text code>gateway.version</Text>.
          </Step>

          <Divider />

          <Title level={5}>ChatGPT (web)</Title>
          <Step n={1}>
            {t('inChatGptGoTo')} <Text strong>Settings → Connectors</Text> {t('andChooseCreateAddNew')}
          </Step>
          <Step n={2}>{t('pasteAsConnectorMcpUrl')}</Step>
          <CodeBlock code={webConnectorUrl} />
          <Step n={3}>{t('clientIdSecretChatGpt')}</Step>
          <OAuthClientPanel fixedLabel="ChatGPT" onChanged={bumpSummary} />
          <Step n={4}>{t('clickConnectChatGpt')}</Step>
          <Step n={5}>{t('logInApproveAccess')}</Step>
          <Step n={6}>{t('askChatGptToUseTools')}</Step>
        </>
      ),
    },
    {
      // Owner: a small collapsed section below both tabs read as tucked
      // away/associated with whichever tab happened to be open, not its
      // own thing -- a real third tab makes it unambiguous this is a
      // standalone "anything not under a known connection" bucket, not
      // part of Claude's or Codex's own setup.
      key: 'other',
      label: t('otherLegacyCredentials'),
      children: (
        <>
          <OAuthClientPanel excludeLabels={['Claude.ai', 'ChatGPT']} onChanged={bumpSummary} />
          <PersonalTokenPanel excludeLabels={['Claude Code (CLI)', 'Codex (CLI)']} onChanged={bumpSummary} />
        </>
      ),
    },
  ];

  return (
    <>
      <ConnectedSummary refreshKey={summaryRefreshKey} />

      <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 16 }}>
        {t('connectIntroBefore')} (
        <Text code>{mcpUrl}</Text>) {t('connectIntroAfter')}
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('webConnectorsLimitedTitle')}
        description={t('webConnectorsLimitedDescription')}
      />

      <Card size="small">
        <Tabs size="small" items={items} />
      </Card>
    </>
  );
}

function LanguageSection() {
  const { t, i18n } = useTranslation('profile');
  return (
    <Card title={t('language')} size="small" style={{ marginBottom: 16 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
        {t('languageDescription')}
      </Text>
      <Select
        size="small"
        value={i18n.language?.startsWith('ru') ? 'ru' : 'en'}
        onChange={(value: string) => void i18n.changeLanguage(value)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ru', label: 'Русский' },
        ]}
        style={{ width: 160 }}
      />
    </Card>
  );
}

function AccountSection() {
  const { t } = useTranslation('profile');
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);
  const [form] = Form.useForm<ChangePasswordValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const onFinish = async (values: ChangePasswordValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.password);
      form.resetFields();
      message.success(t('passwordChanged'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotChangePassword'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title={t('account')} size="small" style={{ marginBottom: 16 }}>
      <Descriptions size="small" column={1} style={{ marginBottom: 20 }}>
        <Descriptions.Item label={t('email')}>{user.email}</Descriptions.Item>
        <Descriptions.Item label={t('role')}>
          <Tag>{user.role}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('status')}>
          <Tag color={user.status === 'active' ? 'green' : 'default'}>{user.status}</Tag>
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        {t('changePassword')}
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting} style={{ maxWidth: 360 }}>
        <Form.Item
          name="currentPassword"
          label={t('currentPassword')}
          rules={[{ required: true, message: t('currentPasswordRequired') }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <PasswordFields />
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {t('updatePassword')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

function GithubSection() {
  const { t } = useTranslation('profile');
  const fetchGithubStatus = useAuthStore((s) => s.fetchGithubStatus);
  const unlinkGithub = useAuthStore((s) => s.unlinkGithub);
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GithubLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get('githubError'));

  const load = async () => {
    try {
      const result = await fetchGithubStatus();
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotLoadGithubStatus'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const linked = searchParams.get('githubLinked');
    const linkError = searchParams.get('githubError');
    if (!linked && !linkError) {
      return;
    }
    void (async () => {
      if (linked) {
        message.success(t('githubLinked'));
        await load();
      }
      setSearchParams((params) => {
        params.delete('githubLinked');
        params.delete('githubError');
        return params;
      }, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkGithub();
      message.success(t('githubUnlinked'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('couldNotUnlinkGithub'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="GitHub" size="small" style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      {loading ? (
        <Spin size="small" />
      ) : status?.linked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <GithubOutlined style={{ fontSize: 18 }} />
          <Text>{t('githubConnectedAs', { login: status.githubLogin })}</Text>
          <Popconfirm
            title={t('unlinkGithubConfirmTitle')}
            description={t('unlinkGithubDescription')}
            okText={t('unlinkGithub')}
            okButtonProps={{ danger: true, loading: busy }}
            onConfirm={unlink}
          >
            <Button size="small">{t('unlinkGithub')}</Button>
          </Popconfirm>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text type="secondary">{t('githubNotConnected')}</Text>
          <Button icon={<GithubOutlined />} href={`${API_BASE_URL}/auth/oauth/github/start?intent=link`}>
            {t('connectGithub')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function TwoFactorSection() {
  const { t } = useTranslation('profile');
  const user = useAuthStore((s) => s.user);
  const enroll2fa = useAuthStore((s) => s.enroll2fa);
  const confirm2fa = useAuthStore((s) => s.confirm2fa);
  const disable2fa = useAuthStore((s) => s.disable2fa);
  const regenerateRecoveryCodes = useAuthStore((s) => s.regenerateRecoveryCodes);

  const [enrolling, setEnrolling] = useState<{ otpauthUrl: string; secretBase32: string } | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [startingEnroll, setStartingEnroll] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  if (!user) return null;

  const startEnroll = async () => {
    setEnrollError(null);
    setStartingEnroll(true);
    try {
      const result = await enroll2fa();
      setEnrolling({ otpauthUrl: result.otpauthUrl, secretBase32: result.secretBase32 });
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : t('couldNotStart2fa'));
    } finally {
      setStartingEnroll(false);
    }
  };

  return (
    <Card title={t('twoFactorAuthentication')} size="small" style={{ marginBottom: 16 }}>
      {!user.totpEnabled && !enrolling && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            {t('twoFactorNotEnabled')}
          </Text>
          {enrollError && <Alert type="error" message={enrollError} style={{ marginBottom: 16 }} showIcon />}
          <Button type="primary" loading={startingEnroll} onClick={() => void startEnroll()}>
            {t('enable2fa')}
          </Button>
        </>
      )}

      {!user.totpEnabled && enrolling && (
        <TotpEnrollWizard
          otpauthUrl={enrolling.otpauthUrl}
          secretBase32={enrolling.secretBase32}
          onConfirm={(code) => confirm2fa(code)}
          finishLabel={t('done')}
          onFinish={() => {
            setEnrolling(null);
            message.success(t('twoFactorEnabled'));
          }}
        />
      )}

      {user.totpEnabled && (
        <>
          <Tag color="green" style={{ marginBottom: 16 }}>
            {t('enabled')}
          </Tag>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setRegenerateOpen(true)}>{t('regenerateRecoveryCodes')}</Button>
            <Button danger onClick={() => setDisableOpen(true)}>
              {t('disable2fa')}
            </Button>
          </div>
        </>
      )}

      <PasswordConfirmModal
        open={disableOpen}
        title={t('disable2fa')}
        description={t('disable2faDescription')}
        confirmLabel={t('disable')}
        danger
        onCancel={() => setDisableOpen(false)}
        onConfirm={async (password) => {
          await disable2fa(password);
          message.success(t('twoFactorDisabled'));
        }}
      />

      <PasswordConfirmModal
        open={regenerateOpen}
        title={t('regenerateRecoveryCodes')}
        description={t('regenerateRecoveryCodesDescription')}
        confirmLabel={t('regenerate')}
        onCancel={() => setRegenerateOpen(false)}
        onConfirm={async (password) => {
          const result = await regenerateRecoveryCodes(password);
          setNewCodes(result.recoveryCodes);
        }}
      />

      <RecoveryCodesModal codes={newCodes} onClose={() => setNewCodes(null)} />
    </Card>
  );
}

interface CreateGitCredentialValues {
  host: string;
  label: string;
  token: string;
}

/** Delete button for a single saved git credential, gated behind a Popconfirm — same lightweight destructive-action pattern as DeleteTaskButton. */
function DeleteGitCredentialButton({ id, host, onDone }: { id: string; host: string; onDone: () => void }) {
  const { t } = useTranslation('profile');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_GIT_CREDENTIAL, {
    onCompleted: () => {
      message.success(t('removedCredentialFor', { host }));
      setOpen(false);
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={t('removeCredentialConfirmTitle', { host })}
      description={t('removeCredentialDescription')}
      okText={t('delete')}
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { id } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );
}

const gitCredentialColumns = (
  t: (key: string) => string,
  onDeleted: () => void,
): ColumnsType<GitCredential> => [
  { title: t('host'), dataIndex: 'host', render: (v) => <Text code>{v}</Text> },
  { title: t('label'), dataIndex: 'label' },
  { title: t('added'), dataIndex: 'createdAt', width: 140, render: (v) => <Timestamp value={v} /> },
  { title: t('lastUsedCol'), dataIndex: 'lastUsedAt', width: 140, render: (v) => <Timestamp value={v} /> },
  {
    title: '',
    key: 'actions',
    width: 48,
    render: (_, row) => <DeleteGitCredentialButton id={row.id} host={row.host} onDone={onDeleted} />,
  },
];

/**
 * Read-only pipeline-status lookup against a saved git host — a thin, optional
 * companion to the credential list, not a CI dashboard. It only exists to
 * exercise `gitPipelineStatus`; it never triggers or cancels anything.
 */
function PipelineStatusChecker({ hosts }: { hosts: GitCredential[] }) {
  const { t } = useTranslation('profile');
  const [host, setHost] = useState<string | undefined>(undefined);
  const [project, setProject] = useState('');
  const [ref, setRef] = useState('');
  const [run, { data, loading, error }] = useLazyQuery<{ gitPipelineStatus: unknown }>(GET_GIT_PIPELINE_STATUS, {
    fetchPolicy: 'network-only',
  });

  const canRun = !!host && project.trim().length > 0;

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #303030' }}>
      <Text strong style={{ display: 'block', marginBottom: 4 }}>
        {t('checkPipelineStatus')}
      </Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
        {t('pipelineStatusDescription')}
      </Text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Select
          placeholder={t('host')}
          style={{ width: 220 }}
          value={host}
          onChange={setHost}
          options={hosts.map((h) => ({ value: h.host, label: `${h.host} (${h.label})` }))}
          notFoundContent={t('addGitHostBelowFirst')}
        />
        <Input placeholder={t('projectPlaceholder')} value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 220 }} />
        <Input placeholder={t('refPlaceholder')} value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: 240 }} />
        <Button
          type="primary"
          loading={loading}
          disabled={!canRun}
          onClick={() => void run({ variables: { host, project: project.trim(), ref: ref.trim() || undefined } })}
        >
          {t('checkStatus')}
        </Button>
      </div>
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} showIcon />}
      {data && <CodeBlock code={JSON.stringify(data.gitPipelineStatus, null, 2)} />}
    </div>
  );
}

function GitHostsSection() {
  const { t } = useTranslation('profile');
  const { data, loading, error, refetch } = useQuery<{ gitCredentials: GitCredential[] }>(GET_GIT_CREDENTIALS);
  const [form] = Form.useForm<CreateGitCredentialValues>();
  const [createError, setCreateError] = useState<string | null>(null);

  const [createCredential, { loading: creating }] = useMutation(CREATE_GIT_CREDENTIAL, {
    onCompleted: () => {
      message.success(t('gitHostAdded'));
      form.resetFields();
      setCreateError(null);
      void refetch();
    },
    onError: (err) => setCreateError(err.message),
  });

  const onFinish = (values: CreateGitCredentialValues) => {
    setCreateError(null);
    void createCredential({
      variables: { host: values.host.trim(), label: values.label.trim(), token: values.token },
    });
  };

  const credentials = data?.gitCredentials ?? [];

  return (
    <Card title={t('gitHosts')} size="small" style={{ marginBottom: 16 }}>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {t('gitHostsDescription')}
      </Paragraph>

      {error && <Alert type="error" message={error.message} style={{ marginBottom: 16 }} showIcon />}

      <Table<GitCredential>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={credentials}
        columns={gitCredentialColumns(t, () => void refetch())}
        pagination={false}
        style={{ marginBottom: 20 }}
        locale={{ emptyText: <Empty description={t('noGitHostsYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        {t('addAGitHost')}
      </Text>
      {createError && <Alert type="error" message={createError} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={creating} style={{ maxWidth: 360 }}>
        <Form.Item name="host" label={t('host')} rules={[{ required: true, message: t('hostRequired') }]}>
          <Input placeholder="gitlab.example.com" autoComplete="off" />
        </Form.Item>
        <Form.Item name="label" label={t('label')} rules={[{ required: true, message: t('labelRequired') }]}>
          <Input placeholder={t('gitHostLabelPlaceholder')} autoComplete="off" />
        </Form.Item>
        <Form.Item name="token" label={t('personalAccessToken')} rules={[{ required: true, message: t('tokenRequired') }]}>
          <Input.Password placeholder="glpat-…" autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={creating}>
            {t('addGitHost')}
          </Button>
        </Form.Item>
      </Form>

      {credentials.length > 0 && <PipelineStatusChecker hosts={credentials} />}
    </Card>
  );
}

/**
 * T-MEMORY-084: the single global on/off switch for the whole credits
 * economy (wallets, ledger, streaks, penalties/bonuses, and everything the
 * spend catalog/wager tasks still to come will add). Read is open to any
 * signed-in caller (GraphQL query has no admin gate), but this section only
 * ever renders inside the role==='admin' tab below -- the write path
 * (UPDATE_CREDIT_SETTINGS) is enforced admin-only server-side regardless.
 */
function CreditsAdminSection() {
  const { t } = useTranslation('profile');
  const { data, loading, error, refetch } = useQuery<{ creditSettings: { enabled: boolean } }>(GET_CREDIT_SETTINGS);
  const [mutate, { loading: saving }] = useMutation(UPDATE_CREDIT_SETTINGS, {
    onCompleted: () => {
      message.success(t('creditsSettingsUpdated'));
      void refetch();
    },
    onError: (err) => message.error(err.message),
  });

  const enabled = data?.creditSettings.enabled ?? false;

  return (
    <Card title={t('creditsEconomy')} size="small" style={{ marginBottom: 16 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12.5 }}>
        {t('creditsEconomyDescription')}
      </Text>
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 16 }} showIcon />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Switch
          checked={enabled}
          loading={loading || saving}
          checkedChildren={t('creditsEnabledOn')}
          unCheckedChildren={t('creditsEnabledOff')}
          onChange={(checked) => void mutate({ variables: { enabled: checked } })}
        />
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {enabled ? t('creditsEnabledHint') : t('creditsDisabledHint')}
        </Text>
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const { t } = useTranslation('profile');
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const sections = [
    { key: 'connect', label: t('connect'), children: <ConnectSection /> },
    { key: 'account', label: t('account'), children: <><AccountSection /><GithubSection /><LanguageSection /></> },
    { key: 'security', label: t('security'), children: <TwoFactorSection /> },
    { key: 'git', label: t('gitHosts'), children: <GitHostsSection /> },
    ...(isAdmin ? [{ key: 'admin', label: t('admin'), children: <CreditsAdminSection /> }] : []),
  ];

  return (
    <PageLayout title={t('profile')} subtitle={t('profileSubtitle')}>
      <Tabs tabPosition="left" items={sections} style={{ minHeight: 480 }} />
    </PageLayout>
  );
}
