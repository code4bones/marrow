import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Drawer, Empty, Form, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import {
  CREATE_AI_PROVIDER_CREDENTIAL,
  DELETE_AI_PROVIDER_CREDENTIAL,
  GET_AI_AVAILABLE_MODELS,
  GET_AI_PROVIDER_CREDENTIALS,
  UPDATE_AI_PROVIDER_CREDENTIAL,
} from '../../shared/api/queries';
import type { AiProviderCredential, AiProviderId } from '../../shared/model/types';
import { Timestamp } from '../../shared/ui/Timestamp';

const { Text, Paragraph } = Typography;

// deepseek is the only provider with a working backend implementation
// today (llm-providers/index.ts's PROVIDERS registry) -- claude/codex are
// still selectable (forward-compatible schema) but ai.ask fails clearly
// if picked as default. Kept as a constant, not hardcoded markup, so a
// second working provider is a one-line addition later.
const PROVIDER_OPTIONS: Array<{ value: AiProviderId; label: string }> = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

interface FormValues {
  provider: AiProviderId;
  label: string;
  apiKey: string;
  model?: string;
  isDefault: boolean;
}

/**
 * Profile page's "AI Providers" tab. Structurally mirrors
 * EnvironmentVariablesSection (a Table + a right-side create/edit Drawer,
 * GitLab-style per the owner's explicit ask) but the underlying domain is
 * its own -- ai.provider_* (modeled on git.credential_*), not
 * env.variable_*. A "Fetch models" button next to the model Select calls
 * ai.available_models with whatever's currently typed in the key field --
 * works before the credential is even saved, matching a natural
 * "paste key -> see models -> pick one -> save" flow.
 */
export function AiProvidersSection() {
  const { t } = useTranslation('aiProviders');
  const { data, loading, error, refetch } = useQuery<{ aiProviderCredentials: AiProviderCredential[] }>(GET_AI_PROVIDER_CREDENTIALS);
  const [fetchModels, { loading: fetchingModels }] = useLazyQuery<{ aiAvailableModels: string[] }>(GET_AI_AVAILABLE_MODELS, {
    fetchPolicy: 'network-only',
  });
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AiProviderCredential | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  const [createCredential, { loading: creating }] = useMutation(CREATE_AI_PROVIDER_CREDENTIAL, {
    onCompleted: () => {
      message.success(t('saved'));
      setDrawerOpen(false);
      form.resetFields();
      void refetch();
    },
    onError: (err) => setFormError(err.message),
  });
  const [updateCredential, { loading: updating }] = useMutation(UPDATE_AI_PROVIDER_CREDENTIAL, {
    onCompleted: () => {
      message.success(t('saved'));
      setDrawerOpen(false);
      form.resetFields();
      void refetch();
    },
    onError: (err) => setFormError(err.message),
  });
  const saving = creating || updating;

  const credentials = data?.aiProviderCredentials ?? [];

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setModelOptions([]);
    form.resetFields();
    form.setFieldsValue({ provider: 'deepseek', isDefault: credentials.length === 0 });
    setDrawerOpen(true);
  };

  const openEdit = (row: AiProviderCredential) => {
    setEditing(row);
    setFormError(null);
    setModelOptions(row.model ? [row.model] : []);
    form.setFieldsValue({ provider: row.provider, label: row.label, model: row.model ?? undefined, isDefault: row.isDefault });
    setDrawerOpen(true);
  };

  const doFetchModels = async () => {
    const values = form.getFieldsValue();
    const apiKey = editing ? values.apiKey?.trim() || undefined : values.apiKey?.trim();
    if (!editing && !apiKey) {
      message.warning(t('typeKeyFirst'));
      return;
    }
    const { data: modelsData } = await fetchModels({ variables: { provider: values.provider, apiKey } });
    if (modelsData?.aiAvailableModels) {
      setModelOptions(modelsData.aiAvailableModels);
      if (modelsData.aiAvailableModels.length === 0) {
        message.info(t('noModelsReturned'));
      }
    }
  };

  const submit = () =>
    form.validateFields().then((values) => {
      setFormError(null);
      if (editing) {
        void updateCredential({ variables: { id: editing.id, label: values.label, model: values.model, isDefault: values.isDefault } });
      } else {
        void createCredential({ variables: { provider: values.provider, label: values.label, apiKey: values.apiKey, model: values.model, isDefault: values.isDefault } });
      }
    });

  const columns: ColumnsType<AiProviderCredential> = [
    { title: t('provider'), dataIndex: 'provider', width: 110, render: (v: AiProviderId) => <Tag>{PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v}</Tag> },
    { title: t('label'), dataIndex: 'label' },
    { title: t('model'), dataIndex: 'model', render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
    { title: t('key'), dataIndex: 'keyHint', width: 100, render: (v: string | null) => (v ? <Text code>…{v}</Text> : '—') },
    {
      title: t('default'),
      dataIndex: 'isDefault',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="blue">{t('defaultBadge')}</Tag> : null),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 140, render: (v: string | null) => <Timestamp value={v} /> },
    {
      title: '',
      key: 'actions',
      width: 76,
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <DeleteAiProviderCredentialButton id={row.id} label={row.label} onDone={() => void refetch()} />
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('title')}
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('addProvider')}
        </Button>
      }
    >
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {t('description')}
      </Paragraph>

      {error && <Alert type="error" message={error.message} style={{ marginBottom: 16 }} showIcon />}

      <Table<AiProviderCredential>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={credentials}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty description={t('noneYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? t('editProvider') : t('addProvider')}
        width={440}
        extra={
          <Button type="primary" size="small" loading={saving} onClick={submit}>
            {t('save')}
          </Button>
        }
      >
        {formError && <Alert type="error" message={formError} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" size="small" disabled={saving}>
          <Form.Item name="provider" label={t('provider')} rules={[{ required: true }]}>
            <Select options={PROVIDER_OPTIONS} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="label" label={t('label')} rules={[{ required: true, message: t('labelRequired') }]}>
            <Input placeholder={t('labelPlaceholder')} autoComplete="off" />
          </Form.Item>
          {!editing && (
            <Form.Item name="apiKey" label={t('apiKey')} rules={[{ required: true, message: t('apiKeyRequired') }]}>
              <Input.Password placeholder="sk-…" autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item label={t('model')}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="model" noStyle>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder={t('modelPlaceholder')}
                  options={modelOptions.map((m) => ({ value: m, label: m }))}
                />
              </Form.Item>
              <Button icon={<ReloadOutlined />} loading={fetchingModels} onClick={() => void doFetchModels()}>
                {t('fetchModels')}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>{t('useAsDefault')}</Checkbox>
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
}

function DeleteAiProviderCredentialButton({ id, label, onDone }: { id: string; label: string; onDone: () => void }) {
  const { t } = useTranslation('aiProviders');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_AI_PROVIDER_CREDENTIAL, {
    onCompleted: () => {
      message.success(t('removedProvider', { label }));
      setOpen(false);
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={t('removeProviderConfirmTitle', { label })}
      okText={t('delete')}
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { id } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );
}
