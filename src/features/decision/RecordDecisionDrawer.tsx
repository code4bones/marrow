import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, message } from 'antd';
import { useState } from 'react';
import { RECORD_DECISION } from '../../shared/api/queries';

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

export function RecordDecisionDrawer({ projectSlug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(RECORD_DECISION, {
    onCompleted: () => {
      message.success('Decision recorded');
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
          title: values.title,
          decision: values.decision,
          context: values.context || undefined,
          rationale: values.rationale || undefined,
          consequences: values.consequences || undefined,
          supersedesId: values.supersedesId || undefined,
          tags: values.tags ? String(values.tags).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        },
      },
    });
  };

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Decision</Button>
      <Drawer
        title="Record decision"
        open={open}
        onClose={() => setOpen(false)}
        width={540}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={() => form.submit()}>Record</Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="decision" label="Decision" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="What was decided?" />
          </Form.Item>
          <Form.Item name="context" label="Context">
            <Input.TextArea rows={3} placeholder="Why was this decision needed?" />
          </Form.Item>
          <Form.Item name="rationale" label="Rationale">
            <Input.TextArea rows={3} placeholder="Why this option?" />
          </Form.Item>
          <Form.Item name="consequences" label="Consequences">
            <Input.TextArea rows={2} placeholder="Trade-offs, implications…" />
          </Form.Item>
          <Form.Item name="supersedesId" label="Supersedes (ID)">
            <Input placeholder="D-PMEM-001" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="tags" label="Tags (comma-separated)">
            <Input placeholder="frontend, graphql" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
