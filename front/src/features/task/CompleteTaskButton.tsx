import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { CheckCircleOutlined } from '@ant-design/icons';
import { Button, Checkbox, Form, Input, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { COMPLETE_TASK } from '../../shared/api/queries';

interface Props {
  taskId: string;
  activeClaimCount?: number;
  onDone?: () => void;
}

export function CompleteTaskButton({ taskId, activeClaimCount = 0, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(COMPLETE_TASK, {
    onCompleted: () => {
      message.success(t('taskCompleted'));
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
        {t('complete')}
      </Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText={t('complete')}
        title={t('completeTask')}
        width={440}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="acceptanceEvidence" label={t('acceptanceEvidence')}>
            <Input.TextArea
              rows={4}
              placeholder={t('acceptanceEvidencePlaceholder')}
            />
          </Form.Item>
          {activeClaimCount > 0 && (
            <Form.Item name="force" valuePropName="checked">
              <Checkbox>
                {t('forceCompletionWithCount', { count: activeClaimCount })}
              </Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
