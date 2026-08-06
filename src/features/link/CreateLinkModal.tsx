import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, message } from 'antd';
import { useState } from 'react';
import { CREATE_LINK } from '../../shared/api/queries';

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

export function CreateLinkModal({ projectSlug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [mutate, { loading }] = useMutation(CREATE_LINK, {
    onCompleted: () => {
      message.success('Link created');
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
          fromId: values.fromId,
          toId: values.toId,
          relation: values.relation,
        },
      },
    });
  };

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Link</Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okButtonProps={{ loading }}
        okText="Create"
        title="Create link"
        width={400}
      >
        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="fromId" label="From ID" rules={[{ required: true }]}>
            <Input placeholder="T-PMEM-001" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="relation" label="Relation" rules={[{ required: true }]}>
            <Input placeholder="blocks, documents, related_to…" />
          </Form.Item>
          <Form.Item name="toId" label="To ID" rules={[{ required: true }]}>
            <Input placeholder="D-PMEM-001" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
