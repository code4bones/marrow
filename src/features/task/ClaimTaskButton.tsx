import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { ApiOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, message } from 'antd';
import { CLAIM_TASK } from '../../shared/api/queries';

const ROLE_OPTIONS = [
  { label: 'Implementor', value: 'implementor' },
  { label: 'Reviewer', value: 'reviewer' },
  { label: 'Planner', value: 'planner' },
  { label: 'Tester', value: 'tester' },
  { label: 'Analyst', value: 'analyst' },
];

interface Props {
  taskId: string;
  onDone?: () => void;
}

export function ClaimTaskButton({ taskId, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(CLAIM_TASK, {
    onCompleted: () => {
      message.success('Task claimed');
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
          taskId,
          role: values.role,
          scope: values.scope || undefined,
          clientLabel: values.clientLabel || undefined,
        },
      },
    });
  };

  return (
    <>
      <Button size="small" icon={<ApiOutlined />} onClick={() => setOpen(true)}>Claim</Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText="Claim"
        title="Claim task"
        width={380}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }} initialValues={{ role: 'implementor' }}>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="clientLabel" label="Client label">
            <Input placeholder="claude-code, codex, …" />
          </Form.Item>
          <Form.Item name="scope" label="Scope">
            <Input placeholder="optional scope restriction" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
