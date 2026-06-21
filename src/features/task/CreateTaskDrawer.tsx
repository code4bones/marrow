import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, InputNumber, message } from 'antd';
import { useState } from 'react';
import { CREATE_TASK } from '../../shared/api/queries';

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

export function CreateTaskDrawer({ projectSlug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const [mutate, { loading }] = useMutation(CREATE_TASK, {
    onCompleted: () => {
      message.success('Task created');
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) =>
      mutate({
        variables: {
          input: {
            project: projectSlug,
            title: values.title,
            milestone: values.milestone || undefined,
            priority: values.priority ?? undefined,
            scope: values.scope || undefined,
            acceptance: values.acceptance || undefined,
            notes: values.notes || undefined,
          },
        },
      }),
    );

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        New Task
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Create Task"
        width={480}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            Create
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="milestone" label="Milestone">
            <Input />
          </Form.Item>
          <Form.Item name="priority" label="Priority">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="scope" label="Scope">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="acceptance" label="Acceptance Criteria">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
