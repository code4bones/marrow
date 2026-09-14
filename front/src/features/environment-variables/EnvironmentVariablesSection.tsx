import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Drawer, Empty, Form, Input, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import {
  DELETE_ENVIRONMENT_VARIABLE,
  GET_ENVIRONMENT_VARIABLE,
  GET_ENVIRONMENT_VARIABLES,
  SET_ENVIRONMENT_VARIABLE,
} from '../../shared/api/queries';
import type { EnvironmentVariable } from '../../shared/model/types';
import { Timestamp } from '../../shared/ui/Timestamp';

const { Text, Paragraph } = Typography;

interface FormValues {
  key: string;
  value: string;
  secret: boolean;
  description: string;
}

/**
 * Shared by the Profile page's "Environment Variables" tab (project
 * omitted -- the caller's own common/profile-scoped store, mirroring Git
 * hosts) and Project/Settings' "Project Vars" tab (project set -- shared
 * with every member, editable only when canManage). The backend's
 * env.variables_list/environmentVariables query actually returns a MERGED
 * view (project + the caller's own common variables, project winning on
 * key collision) when `project` is given -- filtered here to scope==='project'
 * only, so the project-vars management table only ever shows rows this
 * page can actually create/edit/delete, not the viewer's own common
 * variables leaking in from the merge.
 *
 * Create/edit is a right-side Drawer (GitLab CI/CD variables' own pattern,
 * requested explicitly), not an inline form under the table -- same shape
 * as RecordSkillDrawer/UpdateSkillDrawer, one shared Drawer handling both
 * modes instead of two separate components since the form fields are
 * identical either way.
 */
export function EnvironmentVariablesSection({ project, canManage }: { project?: string; canManage: boolean }) {
  const { t } = useTranslation('environmentVariables');
  const { data, loading, error, refetch } = useQuery<{ environmentVariables: EnvironmentVariable[] }>(GET_ENVIRONMENT_VARIABLES, {
    variables: { project },
  });
  const [fetchVariable] = useLazyQuery<{ environmentVariable: EnvironmentVariable | null }>(GET_ENVIRONMENT_VARIABLE);
  const [revealedByKey, setRevealedByKey] = useState<Record<string, string>>({});
  const [revealingKey, setRevealingKey] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  const [setVariable, { loading: saving }] = useMutation(SET_ENVIRONMENT_VARIABLE, {
    onCompleted: () => {
      message.success(t('saved'));
      setDrawerOpen(false);
      setEditingKey(null);
      form.resetFields();
      void refetch();
    },
    onError: (err) => setFormError(err.message),
  });

  const reveal = async (row: EnvironmentVariable): Promise<string> => {
    if (revealedByKey[row.key] !== undefined) {
      return revealedByKey[row.key];
    }
    setRevealingKey(row.key);
    try {
      const { data: revealData } = await fetchVariable({ variables: { key: row.key, project, redact: false } });
      const value = revealData?.environmentVariable?.value ?? '';
      setRevealedByKey((prev) => ({ ...prev, [row.key]: value }));
      return value;
    } finally {
      setRevealingKey(null);
    }
  };

  const openCreate = () => {
    setEditingKey(null);
    setFormError(null);
    form.resetFields();
    setDrawerOpen(true);
  };

  const openEdit = async (row: EnvironmentVariable) => {
    setEditingKey(row.key);
    setFormError(null);
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const value = await reveal(row);
      form.setFieldsValue({ key: row.key, value, secret: row.secret, description: row.description ?? '' });
    } finally {
      setDrawerLoading(false);
    }
  };

  const submit = () =>
    form.validateFields().then((values) => {
      setFormError(null);
      void setVariable({
        variables: {
          key: values.key.trim(),
          value: values.value,
          project,
          secret: values.secret,
          description: values.description?.trim() || undefined,
        },
      });
    });

  const rows = (data?.environmentVariables ?? []).filter((v) => (project ? v.scope === 'project' : true));

  const columns: ColumnsType<EnvironmentVariable> = [
    { title: t('key'), dataIndex: 'key', render: (v: string) => <Text code>{v}</Text> },
    {
      title: t('value'),
      key: 'value',
      render: (_, row) => {
        const revealed = revealedByKey[row.key];
        const display = revealed ?? row.value;
        return (
          <Space size={6}>
            <Text code style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'middle' }}>
              {display}
            </Text>
            {row.secret && revealed === undefined && (
              <Button
                size="small"
                type="text"
                icon={<EyeOutlined />}
                loading={revealingKey === row.key}
                onClick={() => void reveal(row)}
              />
            )}
          </Space>
        );
      },
    },
    ...(project
      ? []
      : ([
          {
            title: t('scope'),
            dataIndex: 'scope',
            width: 90,
            render: (v: string) => <Tag>{v === 'project' ? t('scopeProject') : t('scopeCommon')}</Tag>,
          },
        ] as ColumnsType<EnvironmentVariable>)),
    { title: t('description'), dataIndex: 'description', ellipsis: true },
    { title: t('updated'), dataIndex: 'updatedAt', width: 140, render: (v: string | null) => <Timestamp value={v} /> },
    ...(canManage
      ? ([
          {
            title: '',
            key: 'actions',
            width: 76,
            render: (_: unknown, row: EnvironmentVariable) => (
              <Space size={2}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => void openEdit(row)} />
                <DeleteEnvironmentVariableButton keyName={row.key} project={project} onDone={() => void refetch()} />
              </Space>
            ),
          },
        ] as ColumnsType<EnvironmentVariable>)
      : []),
  ];

  return (
    <Card
      title={t('title')}
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        canManage && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('addVariable')}
          </Button>
        )
      }
    >
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {project ? t('projectDescription') : t('commonDescription')}
      </Paragraph>

      {error && <Alert type="error" message={error.message} style={{ marginBottom: 16 }} showIcon />}

      <Table<EnvironmentVariable>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty description={t('noneYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingKey ? t('editVariable') : t('addVariable')}
        width={440}
        extra={
          <Button type="primary" size="small" loading={saving} onClick={submit}>
            {t('save')}
          </Button>
        }
      >
        {formError && <Alert type="error" message={formError} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" size="small" disabled={drawerLoading || saving}>
          <Form.Item
            name="key"
            label={t('key')}
            rules={[
              { required: true, message: t('keyRequired') },
              { pattern: /^[A-Za-z0-9_]+$/, message: t('keyPattern') },
            ]}
          >
            <Input placeholder="MY_API_KEY" autoComplete="off" disabled={!!editingKey} />
          </Form.Item>
          <Form.Item name="value" label={t('value')} rules={[{ required: true, message: t('valueRequired') }]}>
            <Input.TextArea rows={4} autoComplete="off" />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input placeholder={t('descriptionPlaceholder')} />
          </Form.Item>
          <Form.Item name="secret" valuePropName="checked" initialValue={false} style={{ marginBottom: 0 }}>
            <Checkbox>{t('secretHint')}</Checkbox>
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
}

function DeleteEnvironmentVariableButton({ keyName, project, onDone }: { keyName: string; project?: string; onDone: () => void }) {
  const { t } = useTranslation('environmentVariables');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_ENVIRONMENT_VARIABLE, {
    onCompleted: () => {
      message.success(t('removedVariable', { key: keyName }));
      setOpen(false);
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={t('removeVariableConfirmTitle', { key: keyName })}
      okText={t('delete')}
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { key: keyName, project } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  );
}
