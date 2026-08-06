import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { CheckCircleOutlined } from '@ant-design/icons';
import { Button, Checkbox, Form, Input, Modal, message } from 'antd';
import { COMPLETE_TASK } from '../../shared/api/queries';

interface Props {
  taskId: string;
  activeClaimCount?: number;
  onDone?: () => void;
}

export function CompleteTaskButton({ taskId, activeClaimCount = 0, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(COMPLETE_TASK, {
    onCompleted: () => {
      message.success('Task completed');
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const onFinish = (values: Record<string, unknown>) => {
    mutate({
      variables: {
        id: taskId,
        acceptanceEvidence: values.acceptanceEvidence || undefined,
        force: values.force || undefined,
      },
    });
  };

  return (
    <>
      <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => setOpen(true)}>
        Complete
      </Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText="Complete"
        title="Complete task"
        width={440}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="acceptanceEvidence" label="Acceptance evidence">
            <Input.TextArea
              rows={4}
              placeholder="What demonstrates the acceptance criteria are met?"
            />
          </Form.Item>
          {activeClaimCount > 0 && (
            <Form.Item name="force" valuePropName="checked">
              <Checkbox>
                Force completion ({activeClaimCount} active claim{activeClaimCount > 1 ? 's' : ''})
              </Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
