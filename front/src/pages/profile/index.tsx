import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { DeleteOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type ReactNode, useEffect, useState } from 'react';
import { TotpEnrollWizard } from '../../features/auth/TotpEnrollWizard';
import { PasswordFields } from '../../features/auth/PasswordFields';
import { PageLayout } from '../../shared/ui/PageLayout';
import { Timestamp } from '../../shared/ui/Timestamp';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { API_BASE_URL } from '../../shared/config/env';
import { type PendingRegistration, type PersonalTokenStatus, useAuthStore } from '../../shared/model/auth.store';
import {
  CREATE_GIT_CREDENTIAL,
  DELETE_GIT_CREDENTIAL,
  GET_GATEWAY_CONNECTOR_INFO,
  GET_GIT_CREDENTIALS,
  GET_GIT_PIPELINE_STATUS,
} from '../../shared/api/queries';
import type { GitCredential } from '../../shared/model/types';

const { Text, Paragraph } = Typography;

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
      setError(err instanceof Error ? err.message : 'Something went wrong.');
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
        placeholder="Current password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onPressEnter={() => void handleOk()}
        autoFocus
      />
    </Modal>
  );
}

function RecoveryCodesModal({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  return (
    <Modal open={codes !== null} title="New recovery codes" onCancel={onClose} onOk={onClose} okText="Done" cancelButtonProps={{ style: { display: 'none' } }}>
      <Alert
        type="warning"
        showIcon
        message="Save these now"
        description="Your old recovery codes no longer work. Each new code can be used once. They will not be shown again."
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
 * T-MEMORY-047: this user's own personal Marrow API token, for CLI/agent
 * connections (Claude Code, Codex) — replaces the old admin-issued shared
 * MCP_TOKEN placeholder in ConnectSection below. Shown-once + regenerate,
 * same principle as TOTP recovery codes / the TOTP secret (see
 * TotpEnrollWizard): the plaintext token is only ever visible in the
 * response right after generate/regenerate, never recoverable from the
 * status endpoint afterward. Generation is lazy — if the status check on
 * mount reports no token yet, this component generates one automatically
 * (still an explicit POST, not a side effect of the status GET) so a
 * freshly-approved user sees a working token the first time they open this
 * page, without asking an admin — see docs/AUTH.md's "Personal API tokens"
 * section for why this is lazy-on-first-visit rather than
 * generated at admin-approval time.
 */
function PersonalTokenPanel({ onTokenChange, onStatusChange }: {
  onTokenChange: (token: string | null) => void;
  /** Fires on every status load/refresh — lets ConnectSection build a useful
   * placeholder ("click Regenerate, yours ending in …XXXX isn't shown
   * again") even when it never received the plaintext this page load. */
  onStatusChange: (status: PersonalTokenStatus | null) => void;
}) {
  const fetchPersonalToken = useAuthStore((s) => s.fetchPersonalToken);
  const regeneratePersonalToken = useAuthStore((s) => s.regeneratePersonalToken);

  const [status, setStatus] = useState<PersonalTokenStatus | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await regeneratePersonalToken();
      const nextStatus = { exists: true, tokenHint: result.tokenHint, createdAt: result.createdAt, lastUsedAt: null };
      setStatus(nextStatus);
      onStatusChange(nextStatus);
      setRevealedToken(result.token);
      onTokenChange(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a personal token.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchPersonalToken();
        if (cancelled) return;
        setStatus(result);
        onStatusChange(result);
        setLoading(false);
        if (!result.exists) {
          await generate();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load your personal token status.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>Loading your personal token…</Text>
      </div>
    );
  }

  const hasEverBeenShown = revealedToken !== null;
  const stillGenerating = busy && !hasEverBeenShown && !status?.exists;

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

      {stillGenerating && (
        <div style={{ marginBottom: 12 }}>
          <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12.5 }}>Generating your personal token…</Text>
        </div>
      )}

      {revealedToken && (
        <>
          <Alert
            type="warning"
            showIcon
            message="Copy your token now"
            description="This is the only time it will be shown. If you lose it, use Regenerate below to get a new one — the old one stops working immediately."
            style={{ marginBottom: 12 }}
          />
          <CodeBlock code={revealedToken} />
        </>
      )}

      {!revealedToken && status?.exists && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
          Token ending in <Text code>…{status.tokenHint}</Text> · created <Timestamp value={status.createdAt} /> ·
          last used <Timestamp value={status.lastUsedAt} /> · not shown again — use Regenerate for a new one.
        </Text>
      )}

      {(status?.exists || hasEverBeenShown) && (
        <Popconfirm
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Regenerate personal token?"
          description="Your current token stops working immediately. Anything using it (Claude Code, Codex, …) will need the new one."
          okText="Regenerate"
          okButtonProps={{ danger: true, loading: busy }}
          onConfirm={() => {
            setConfirmOpen(false);
            void generate();
          }}
        >
          <Button size="small" loading={busy && !stillGenerating}>
            Regenerate
          </Button>
        </Popconfirm>
      )}
    </div>
  );
}

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
 * shared secret. The web-connector (Claude.ai/ChatGPT) OAuth client id/secret
 * come from the new gatewayConnectorInfo GraphQL query — a real, deployed
 * value read live from the server, not a placeholder — replacing what used
 * to be a "the magic token your admin gave you" instruction from before the
 * OAuth SSO rework (D-MEMORY-027) removed that shared magic-token gate
 * entirely in favor of a real per-user login at /oauth/authorize.
 */
function ConnectSection() {
  const user = useAuthStore((s) => s.user);
  const mcpUrl = `${API_BASE_URL}/mcp`;

  const [personalToken, setPersonalToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<PersonalTokenStatus | null>(null);

  const { data: connectorInfoData } = useQuery<{
    gatewayConnectorInfo: { mcpUrl: string | null; oauthClientId: string | null; oauthClientSecret: string | null };
  }>(GET_GATEWAY_CONNECTOR_INFO);
  const connectorInfo = connectorInfoData?.gatewayConnectorInfo;

  const suggestedId = user?.email ?? 'me';
  const enc = encodeURIComponent(suggestedId);
  const urlFor = (clientKind: string) => `${mcpUrl}?client_id=${enc}&client_label=${enc}&client_kind=${clientKind}`;

  // personalToken is only ever non-null in the instant right after Generate/
  // Regenerate (shown-once, never re-fetchable) — on every OTHER visit
  // (including any visit after the very first) it's null even though a
  // real, working token exists server-side. Falling back to a static
  // "click Generate/Regenerate" placeholder in that case was misleading for
  // anyone who already has a token (the vast majority of visits) — this now
  // reads the live status (tokenHint included) to say the accurate thing.
  const exportTokenCmd = personalToken
    ? `export MARROW_MCP_TOKEN="${personalToken}"`
    : tokenStatus?.exists
      ? `export MARROW_MCP_TOKEN="<your token isn't shown again — click Regenerate above to get a fresh one (currently ends in …${tokenStatus.tokenHint})>"`
      : 'export MARROW_MCP_TOKEN="<generating your token above, one moment…>"';

  const claudeCodeCmd = [
    'claude mcp add --transport http project-memory \\',
    `  "${urlFor('claude-code')}" \\`,
    '  --header "Authorization: Bearer $MARROW_MCP_TOKEN"',
  ].join('\n');

  const codexCmd = [
    'codex mcp add project-memory \\',
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
  const connectorIdSecretPanel = (
    <Collapse
      size="small"
      style={{ marginTop: 4 }}
      items={[
        {
          key: 'client-id-secret',
          label: 'If it also asks for a Client ID / Client Secret',
          children: connectorInfo ? (
            <>
              <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 8 }}>
                Most connector setups only need the URL above, then log in with your own Marrow account when
                prompted. A few ask for these too — they identify this Marrow deployment's connector app, not you
                personally, and are the same for every user here.
              </Text>
              <CodeBlock code={`Client ID: ${connectorInfo.oauthClientId ?? '(not configured)'}`} />
              <CodeBlock code={`Client Secret: ${connectorInfo.oauthClientSecret ?? '(not configured)'}`} />
            </>
          ) : (
            <Spin size="small" />
          ),
        },
      ]}
    />
  );

  const items = [
    {
      key: 'claude-code',
      label: 'Claude Code',
      children: (
        <>
          <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            Claude Code talks to Marrow over Streamable HTTP, using your own personal API token (
            <Text code>MARROW_MCP_TOKEN</Text> below) — see "Your personal token" above. It's tied to your account, not
            a shared deployment secret.
          </Text>
          <Step n={1}>Set the token in the shell that will run Claude Code:</Step>
          <CodeBlock code={exportTokenCmd} />
          <Step n={2}>Register Marrow as an MCP server:</Step>
          <CodeBlock code={claudeCodeCmd} />
          <Step n={3}>
            Restart Claude Code, then ask it "What is project-memory / pmem, and how do I use it?" — it should call{' '}
            <Text code>gateway.about</Text>.
          </Step>
        </>
      ),
    },
    {
      key: 'codex',
      label: 'Codex',
      children: (
        <>
          <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            Codex uses the same Streamable HTTP endpoint and the same personal API token as Claude Code.
          </Text>
          <Step n={1}>Set the token in the shell that will run Codex:</Step>
          <CodeBlock code={exportTokenCmd} />
          <Step n={2}>Register Marrow as an MCP server:</Step>
          <CodeBlock code={codexCmd} />
          <Step n={3}>
            Restart Codex, then ask it to check pmem — it should call <Text code>gateway.status</Text> and{' '}
            <Text code>gateway.version</Text>.
          </Step>
        </>
      ),
    },
    {
      key: 'claude-web',
      label: 'Claude.ai (web)',
      children: (
        <>
          <Step n={1}>
            In Claude.ai go to <Text strong>Settings → Connectors</Text> and choose{' '}
            <Text strong>Add custom connector</Text>.
          </Step>
          <Step n={2}>Paste this as the connector URL:</Step>
          <CodeBlock code={webConnectorUrl} />
          {connectorIdSecretPanel}
          <Step n={3}>Click Connect — Claude opens Marrow's sign-in page in a new tab.</Step>
          <Step n={4}>
            Log in with your own Marrow account (email + password, same as this profile) and approve access — this
            is a real login, not a shared token, so Claude connects as <Text strong>you</Text> specifically.
          </Step>
          <Step n={5}>
            Back in the chat, ask Claude to check pmem — it should call <Text code>gateway.status</Text>.
          </Step>
        </>
      ),
    },
    {
      key: 'chatgpt-web',
      label: 'ChatGPT (web)',
      children: (
        <>
          <Step n={1}>
            In ChatGPT go to <Text strong>Settings → Connectors</Text> and choose to create/add a new connector.
          </Step>
          <Step n={2}>Paste this as the connector (MCP server) URL:</Step>
          <CodeBlock code={webConnectorUrl} />
          {connectorIdSecretPanel}
          <Step n={3}>Click Connect — ChatGPT opens Marrow's sign-in page.</Step>
          <Step n={4}>Log in with your own Marrow account and approve access.</Step>
          <Step n={5}>Ask ChatGPT to use the project-memory tools — it should be able to call Marrow tools directly.</Step>
        </>
      ),
    },
  ];

  return (
    <Card title="Connect" size="small" style={{ marginBottom: 16 }}>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        How to connect this Marrow instance to a coding agent or a web chat. The endpoint below (
        <Text code>{mcpUrl}</Text>) is this deployment's real address — everything here, including the web-connector
        Client ID/Secret further down, is real and copy-pasteable as-is.
      </Paragraph>

      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        Your personal token
      </Text>
      <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Used by Claude Code / Codex below (<Text code>MARROW_MCP_TOKEN</Text>) — tied to your account and role, not a
        shared deployment secret. Shown once when generated; regenerate any time to invalidate the old one.
      </Paragraph>
      <PersonalTokenPanel onTokenChange={setPersonalToken} onStatusChange={setTokenStatus} />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Web connectors: Claude.ai and ChatGPT only, for now"
        description="Custom/remote MCP connectors are currently supported for Claude.ai and ChatGPT web chat. Other web chat hosts aren't wired up yet — use the CLI paths (Claude Code, Codex) for anything else."
      />
      <Tabs size="small" items={items} />
    </Card>
  );
}

function AccountSection() {
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
      message.success('Password changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Account" size="small" style={{ marginBottom: 16 }}>
      <Descriptions size="small" column={1} style={{ marginBottom: 20 }}>
        <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
        <Descriptions.Item label="Role">
          <Tag>{user.role}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={user.status === 'active' ? 'green' : 'default'}>{user.status}</Tag>
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        Change password
      </Text>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting} style={{ maxWidth: 360 }}>
        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Current password is required' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <PasswordFields />
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={submitting}>
            Update password
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

function TwoFactorSection() {
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
      setEnrollError(err instanceof Error ? err.message : 'Could not start 2FA enrollment.');
    } finally {
      setStartingEnroll(false);
    }
  };

  return (
    <Card title="Two-factor authentication" size="small" style={{ marginBottom: 16 }}>
      {!user.totpEnabled && !enrolling && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Two-factor authentication is not enabled on this account.
          </Text>
          {enrollError && <Alert type="error" message={enrollError} style={{ marginBottom: 16 }} showIcon />}
          <Button type="primary" loading={startingEnroll} onClick={() => void startEnroll()}>
            Enable 2FA
          </Button>
        </>
      )}

      {!user.totpEnabled && enrolling && (
        <TotpEnrollWizard
          otpauthUrl={enrolling.otpauthUrl}
          secretBase32={enrolling.secretBase32}
          onConfirm={(code) => confirm2fa(code)}
          finishLabel="Done"
          onFinish={() => {
            setEnrolling(null);
            message.success('Two-factor authentication enabled.');
          }}
        />
      )}

      {user.totpEnabled && (
        <>
          <Tag color="green" style={{ marginBottom: 16 }}>
            Enabled
          </Tag>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setRegenerateOpen(true)}>Regenerate recovery codes</Button>
            <Button danger onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </Button>
          </div>
        </>
      )}

      <PasswordConfirmModal
        open={disableOpen}
        title="Disable 2FA"
        description="Confirm your password to disable two-factor authentication on this account."
        confirmLabel="Disable"
        danger
        onCancel={() => setDisableOpen(false)}
        onConfirm={async (password) => {
          await disable2fa(password);
          message.success('Two-factor authentication disabled.');
        }}
      />

      <PasswordConfirmModal
        open={regenerateOpen}
        title="Regenerate recovery codes"
        description="Confirm your password to invalidate your old recovery codes and generate a new set."
        confirmLabel="Regenerate"
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
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_GIT_CREDENTIAL, {
    onCompleted: () => {
      message.success(`Removed credential for ${host}`);
      setOpen(false);
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={`Remove credential for ${host}?`}
      description="The saved token is deleted immediately and can't be recovered. You can add a new one anytime."
      okText="Delete"
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { id } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );
}

const gitCredentialColumns = (
  onDeleted: () => void,
): ColumnsType<GitCredential> => [
  { title: 'Host', dataIndex: 'host', render: (v) => <Text code>{v}</Text> },
  { title: 'Label', dataIndex: 'label' },
  { title: 'Added', dataIndex: 'createdAt', width: 140, render: (v) => <Timestamp value={v} /> },
  { title: 'Last used', dataIndex: 'lastUsedAt', width: 140, render: (v) => <Timestamp value={v} /> },
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
        Check pipeline status
      </Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
        Looks up the latest pipeline status for a project using the credential saved for that host. The token stays
        on the server; only the structured result comes back here.
      </Text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Select
          placeholder="Host"
          style={{ width: 220 }}
          value={host}
          onChange={setHost}
          options={hosts.map((h) => ({ value: h.host, label: `${h.host} (${h.label})` }))}
          notFoundContent="Add a git host below first"
        />
        <Input placeholder="Project (e.g. group/project)" value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 220 }} />
        <Input placeholder="Ref (optional, defaults to default branch)" value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: 240 }} />
        <Button
          type="primary"
          loading={loading}
          disabled={!canRun}
          onClick={() => void run({ variables: { host, project: project.trim(), ref: ref.trim() || undefined } })}
        >
          Check status
        </Button>
      </div>
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} showIcon />}
      {data && <CodeBlock code={JSON.stringify(data.gitPipelineStatus, null, 2)} />}
    </div>
  );
}

function GitHostsSection() {
  const { data, loading, error, refetch } = useQuery<{ gitCredentials: GitCredential[] }>(GET_GIT_CREDENTIALS);
  const [form] = Form.useForm<CreateGitCredentialValues>();
  const [createError, setCreateError] = useState<string | null>(null);

  const [createCredential, { loading: creating }] = useMutation(CREATE_GIT_CREDENTIAL, {
    onCompleted: () => {
      message.success('Git host added.');
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
    <Card title="Git hosts" size="small" style={{ marginBottom: 16 }}>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Personal access tokens for GitLab (or similar) instances, used server-side to check pipeline/job status on
        your behalf. Tokens are encrypted at rest and never shown again after you add them — the same one-time
        principle as recovery codes and the 2FA secret.
      </Paragraph>

      {error && <Alert type="error" message={error.message} style={{ marginBottom: 16 }} showIcon />}

      <Table<GitCredential>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={credentials}
        columns={gitCredentialColumns(() => void refetch())}
        pagination={false}
        style={{ marginBottom: 20 }}
        locale={{ emptyText: <Empty description="No git hosts added yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        Add a git host
      </Text>
      {createError && <Alert type="error" message={createError} style={{ marginBottom: 16 }} showIcon />}
      <Form form={form} layout="vertical" onFinish={onFinish} disabled={creating} style={{ maxWidth: 360 }}>
        <Form.Item name="host" label="Host" rules={[{ required: true, message: 'Host is required' }]}>
          <Input placeholder="gitlab.example.com" autoComplete="off" />
        </Form.Item>
        <Form.Item name="label" label="Label" rules={[{ required: true, message: 'Label is required' }]}>
          <Input placeholder="e.g. self-hosted runners box" autoComplete="off" />
        </Form.Item>
        <Form.Item name="token" label="Personal access token" rules={[{ required: true, message: 'Token is required' }]}>
          <Input.Password placeholder="glpat-…" autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={creating}>
            Add git host
          </Button>
        </Form.Item>
      </Form>

      {credentials.length > 0 && <PipelineStatusChecker hosts={credentials} />}
    </Card>
  );
}

const approvalsColumns: ColumnsType<PendingRegistration> = [
  { title: 'Email', dataIndex: 'email' },
  { title: 'Registered', dataIndex: 'createdAt', width: 180, render: (v) => <Timestamp value={v} /> },
];

function ApprovalsSection() {
  const fetchPendingUsers = useAuthStore((s) => s.fetchPendingUsers);
  const approvePendingUser = useAuthStore((s) => s.approvePendingUser);
  const rejectPendingUser = useAuthStore((s) => s.rejectPendingUser);

  const [users, setUsers] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await fetchPendingUsers();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pending users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchPendingUsers()
      .then((data) => {
        if (cancelled) return;
        setUsers(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load pending users.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setActingId(id);
    try {
      if (action === 'approve') {
        await approvePendingUser(id);
        message.success('User approved.');
      } else {
        await rejectPendingUser(id);
        message.success('User rejected.');
      }
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActingId(null);
    }
  };

  const columns: ColumnsType<PendingRegistration> = [
    ...approvalsColumns,
    {
      title: '',
      key: 'actions',
      width: 180,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" type="primary" loading={actingId === row.id} onClick={() => void act(row.id, 'approve')}>
            Approve
          </Button>
          <Button size="small" danger loading={actingId === row.id} onClick={() => void act(row.id, 'reject')}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card title="Pending approvals" size="small">
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
      <Table<PendingRegistration>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={users}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty description="No accounts waiting for approval" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </Card>
  );
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <PageLayout title="Profile" subtitle="Account, security and access">
      <ConnectSection />
      <AccountSection />
      <TwoFactorSection />
      <GitHostsSection />
      {user?.role === 'admin' && <ApprovalsSection />}
    </PageLayout>
  );
}
