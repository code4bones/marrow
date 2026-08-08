import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATE_MEMORY } from '../../shared/api/queries';

function typeOptions(t: (key: string) => string) {
  return [
    { label: t('typeNote'), value: 'note' },
    { label: t('typeConvention'), value: 'convention' },
    { label: t('typeArchitecture'), value: 'architecture_question' },
    { label: t('typeFault'), value: 'failed_attempt' },
    { label: t('typeHandoff'), value: 'handoff' },
    { label: t('typeSmokeTest'), value: 'smoke-test' },
  ];
}

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

export function CreateMemoryDrawer({ projectSlug, onDone }: Props) {
  const { t } = useTranslation('memory');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(CREATE_MEMORY, {
    onCompleted: () => {
      message.success(t('memoryCreated'));
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const onFinish = (values: Record<string, unknown>) => {
    mutate({
      variables: {
        input: {
          project: projectSlug,
          type: values.type,
          title: values.title,
          body: values.body,
          status: values.status || undefined,
          tags: values.tags ? String(values.tags).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        },
      },
    });
  };

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('memory')}</Button>
      <Drawer
        title={t('createMemoryItem')}
        open={open}
        onClose={() => setOpen(false)}
        width={480}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setOpen(false)}>{t('cancel')}</Button>
            <Button type="primary" loading={loading} onClick={() => form.submit()}>{t('create')}</Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ type: 'note' }}>
          <Form.Item name="type" label={t('type')} rules={[{ required: true }]}>
            <Select options={typeOptions(t)} />
          </Form.Item>
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="body" label={t('body')} rules={[{ required: true }]}>
            <Input.TextArea rows={8} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
          <Form.Item name="tags" label={t('tagsCommaSeparated')}>
            <Input placeholder="frontend, architecture" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
