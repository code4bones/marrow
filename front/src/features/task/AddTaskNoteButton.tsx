import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { FileTextOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, message } from 'antd';
import { ADD_TASK_NOTE } from '../../shared/api/queries';

interface Props {
  taskId: string;
  onDone?: () => void;
}

export function AddTaskNoteButton({ taskId, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(ADD_TASK_NOTE, {
    onCompleted: () => {
      message.success('Note added');
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const onFinish = (values: Record<string, unknown>) => {
    mutate({ variables: { input: { taskId, body: values.body } } });
  };

  return (
    <>
      <Button size="small" icon={<FileTextOutlined />} onClick={() => setOpen(true)}>Add note</Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText="Add"
        title="Add task note"
        width={440}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="body" label="Note" rules={[{ required: true }]}>
            <Input.TextArea
              rows={5}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder="Implementation note, observation, finding…"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
