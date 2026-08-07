import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, message } from 'antd';
import { useState } from 'react';
import { CREATE_MEMORY } from '../../shared/api/queries';

const TYPE_OPTIONS = [
  { label: 'Note', value: 'note' },
  { label: 'Convention', value: 'convention' },
  { label: 'Architecture', value: 'architecture_question' },
  { label: 'Fault', value: 'failed_attempt' },
  { label: 'Handoff', value: 'handoff' },
  { label: 'Smoke test', value: 'smoke-test' },
];

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

export function CreateMemoryDrawer({ projectSlug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(CREATE_MEMORY, {
    onCompleted: () => {
      message.success('Memory created');
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
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Memory</Button>
      <Drawer
        title="Create memory item"
        open={open}
        onClose={() => setOpen(false)}
        width={480}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={() => form.submit()}>Create</Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ type: 'note' }}>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="body" label="Body" rules={[{ required: true }]}>
            <Input.TextArea rows={8} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
          <Form.Item name="tags" label="Tags (comma-separated)">
            <Input placeholder="frontend, architecture" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
