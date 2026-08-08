import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { ApiOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { CLAIM_TASK } from '../../shared/api/queries';

function roleOptions(t: (key: string) => string) {
  return [
    { label: t('roleImplementor'), value: 'implementor' },
    { label: t('roleReviewer'), value: 'reviewer' },
    { label: t('rolePlanner'), value: 'planner' },
    { label: t('roleTester'), value: 'tester' },
    { label: t('roleAnalyst'), value: 'analyst' },
  ];
}

interface Props {
  taskId: string;
  onDone?: () => void;
}

export function ClaimTaskButton({ taskId, onDone }: Props) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(CLAIM_TASK, {
    onCompleted: () => {
      message.success(t('taskClaimed'));
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
      <Button size="small" icon={<ApiOutlined />} onClick={() => setOpen(true)}>{t('claim')}</Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText={t('claim')}
        title={t('claimTask')}
        width={380}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }} initialValues={{ role: 'implementor' }}>
          <Form.Item name="role" label={t('role')} rules={[{ required: true }]}>
            <Select options={roleOptions(t)} />
          </Form.Item>
          <Form.Item name="clientLabel" label={t('clientLabel')}>
            <Input placeholder="claude-code, codex, …" />
          </Form.Item>
          <Form.Item name="scope" label={t('scope')}>
            <Input placeholder={t('optionalScopeRestriction')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
