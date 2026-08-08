import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATE_PROJECT } from '../../shared/api/queries';

interface Props {
  onDone?: () => void;
}

export function CreateProjectModal({ onDone }: Props) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const [mutate, { loading }] = useMutation(CREATE_PROJECT, {
    onCompleted: () => {
      message.success(t('projectCreated'));
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
            slug: values.slug,
            title: values.title,
            description: values.description || undefined,
            rootPath: values.rootPath || undefined,
          },
        },
      }),
    );

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        {t('newProject')}
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={loading}
        title={t('createProject')}
        okText={t('create')}
        width={440}
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 16 }}>
          <Form.Item name="slug" label={t('slug')} rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: t('slugPattern') }]}>
            <Input placeholder="my-project" />
          </Form.Item>
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="rootPath" label={t('rootPath')}>
            <Input placeholder="/home/user/projects/my-project" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
