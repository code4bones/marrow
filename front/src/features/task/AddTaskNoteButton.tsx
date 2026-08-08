import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { FileTextOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { ADD_TASK_NOTE } from '../../shared/api/queries';

interface Props {
  taskId: string;
  onDone?: () => void;
}

export function AddTaskNoteButton({ taskId, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(ADD_TASK_NOTE, {
    onCompleted: () => {
      message.success(t('noteAdded'));
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
      <Button size="small" icon={<FileTextOutlined />} onClick={() => setOpen(true)}>{t('addNote')}</Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText={t('add')}
        title={t('addTaskNote')}
        width={440}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="body" label={t('note')} rules={[{ required: true }]}>
            <Input.TextArea
              rows={5}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder={t('implementationNotePlaceholder')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
